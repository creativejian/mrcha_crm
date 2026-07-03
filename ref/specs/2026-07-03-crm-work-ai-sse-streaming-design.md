# CRM 업무 AI — SSE 스트리밍 + 새 턴 앵커 스크롤 (앱 미러)

- 작성일: 2026-07-03
- 상태: 설계 (사용자 승인됨 — 대화에서 섹션별 승인 완료)
- 선행: B1(#132 RAG)·C1(#133 영속/멀티턴)·페이지네이션/폴리시(#134)·리뷰 후속(#136·#138)·프리페치(#139). 이 슬라이스는 `/ask`를 SSE 스트리밍으로 바꾸고 앱의 타자기·중지·새 턴 앵커 스크롤을 이식한다.
- 관련: `src/routes/assistant.ts`, `src/lib/gemini-generate.ts`, `client/src/lib/assistant.ts`, `client/src/components/ai/useAssistantThread.ts`, `client/src/components/ai/AiAssistantPanel.tsx`.

## 배경

C1까지의 업무 AI는 **단일샷 요청**이다: 질문 → 전체 답변 생성 완료까지 로딩 닷 → 한 번에 렌더. 답변이 길면 첫 글자까지 수 초를 기다리고, 생성을 중단할 수 없다. 또 질문 전송 시 "항상 최하단 스크롤"이라 긴 답변이 오면 질문이 화면 밖으로 밀린다.

목표: 앱(`mr-cha-app`)의 AI 채팅과 동일한 UX — **SSE 스트리밍 + 클라 타자기 페이싱 + 송신/중지 토글 + 질문 상단 고정(새 턴 앵커)**. 속도·방식 모두 앱 미러.

## 앱 실측 (mirror 대상 — 조사 결과)

- **전송**: `flutter_client_sse`로 Edge Function `ai-analyst`에 POST + body `stream: true`. SSE 이벤트 = `text`(`{chunk}` 누적) / `done`(`{fullText, ...}` 최종 원문 덮어씀) / `error`(`{code, message}`). (`lib/presentation/providers/chat_streaming_controller.dart`)
- **타자기(디스플레이 드레인)**: 수신 청크를 바로 그리지 않고 버퍼에 누적, **38ms 틱**마다 가변 스텝으로 표시 길이 증가 — 표시길이 <72자: **2자/틱** → <160자: **4자/틱** → 잔여 >160자: **11자/틱** → 잔여 >56자: **7자/틱** → 꼬리: **4자/틱**. UTF-16 서로게이트 페어 중간 절단 방지. `done` 수신 후에도 드레인 완주를 기다린 뒤 마감(`waitForDisplayDrain`).
- **영속**: 스트리밍 시작 전 **빈 assistant placeholder를 DB 저장** → 완료 시 update. **중단(stop)** 시 부분 텍스트 + `" (중단됨)"` update, 부분 0자면 placeholder 삭제(user 질문은 유지). 새 질문 진입 시 이전 스트림 supersede 취소.
- **새 턴 앵커 스크롤**: 질문 전송 시 그 유저 메시지 top이 `kChatNewTurnTargetTop = 90`(앱바 포함 화면 기준, 체감 여백 ~20px)이 되도록 거리 비례 duration(360~720ms) 스크롤. **핵심 트릭 = 마지막 턴에 `minHeight = viewport − bottomClearance − targetTop − 28(bottomGap)` 예약** — 답변이 짧아도 질문이 상단에 고정되고, 스트리밍 답변이 예약 공간을 채우며 자라 스크롤 점프가 없다. (`chat_screen_scroll_visibility.dart`, `chat_timeline_layout_policy.dart`)

## 결정

1. **전송 = SSE**: `/ask` body에 `stream: true` 플래그(앱 미러). 미지정 시 기존 JSON 응답 그대로(하위호환·기존 테스트 불변). Hono `streamSSE`(`hono/streaming`) + Gemini `streamGenerateContent?alt=sse`.
2. **이벤트 프로토콜 = 앱 미러 + CRM 페이로드**: `text`=`{chunk}` / `done`=`{messages: [user, assistant]}`(**저장 완료된 영속본 2건** — 클라가 기존 `mergeAssistantMessages` 재사용) / `error`=`{code, message}`.
3. **중지 저장 정책 = 앱 미러 부분 저장**(사용자 선택): 서버가 클라 중단(request abort)을 감지해 그 시점까지의 부분 답변 + `" (중단됨)"` 저장. 감지 실패 시 자연스럽게 전체 저장으로 강등(상위호환).
4. **영속 순서 변경(C1의 "성공 시 원자 저장" → 앱 미러 선저장)**: 스트리밍 시작 전 user + 빈 placeholder 원자 저장 → 종료 시 placeholder update/삭제. 논스트리밍 경로는 기존 원자 저장 유지.
5. **스트리밍 중 에러(앱과 절충)**: 부분 텍스트 있으면 부분 + `" (연결 오류로 중단됨)"` 저장, 없으면 placeholder 삭제 + `error` 이벤트 → 클라는 기존 에러 turn(재시도 유도). 앱은 에러 문구 자체를 저장하지만 CRM 기존 "실패=미저장+재시도" UX와 절충.
6. **타자기 수치 = 앱 그대로**: 38ms 틱, 스텝 2/4/7/11, 서로게이트 보호. `nextDisplayLength` 순수 함수로 분리해 앱 수치를 테스트로 고정.
7. **생성 중 재전송 차단 유지**: 앱의 supersede(생성 중 새 질문 → 이전 취소) 대신 Send↔Stop 토글의 단순한 2단계(중지 후 재질문). Enter도 차단(현행 asking 가드).
8. **실시간 상담 ChatThread 공용 훅 통합 = 보류**(사용자 선택): 스크롤 문법이 갈라져(최하단 추적 vs 새 턴 앵커) 공용화 실익 감소. 이번엔 업무 AI 패널만.
9. **새 턴 앵커 상단 여백 = 20px**(스크롤 컨테이너 기준 — 앱 90px은 앱바 포함 화면 기준이라 체감 동일).

## 범위 (IN / OUT)

**IN**

- `generateAnswerStream`(async generator) — `streamGenerateContent?alt=sse` 파싱. 재시도는 스트림 시작 전 실패만.
- `/ask` stream 분기: RAG 앞단(scope→임베딩→top-k→메타) 공유 → 선저장 → SSE 송출 → 종료 처리(완료/중단/에러).
- 쿼리 신설: `updateAssistantMessage(id, content, sources)` · `deleteAssistantMessage(id)`.
- 프론트: `askAssistantStream`(fetch ReadableStream + SSE 파서), 드레인 타자기, Send↔Stop 토글(AbortController), 새 턴 앵커 스크롤(min-height 예약 + smooth scroll).
- 스트리밍 중에도 `MarkdownMessage`로 렌더(앱 동일 — 부분 마크다운 렌더 허용).

**OUT (후속)**

- 생성 중 새 질문 supersede.
- 실시간 상담 콘솔 스크롤앵커·커서 페이지네이션 공용 훅(보류 결정).
- related_questions 후속질문 칩, 히스토리 pruning, `aiTurns.answer` dead 필드 정리(C1 잔여 — 이번 리팩토링 범위에 자연 흡수되면 처리).
- 유사도 임계값(B1 잔여).

## 아키텍처

### 1. 백엔드 — `generateAnswerStream` (`src/lib/gemini-generate.ts`)

```
async function* generateAnswerStream(systemPrompt, userPrompt, apiKey, history, fetchImpl): AsyncGenerator<string>
```

- `POST …/models/${GEN_MODEL}:streamGenerateContent?alt=sse&key=…` — body는 기존 `generateAnswer`와 동일(systemInstruction/contents/temperature 0.2).
- 응답 SSE의 각 `data:` JSON에서 `candidates[0].content.parts[0].text`를 추출해 yield.
- HTTP 레벨 실패(연결 전): 기존과 동일하게 `classifyGeminiError` + rate_limited/unavailable 1회 재시도. **스트림 중간 실패는 재시도 없이 throw**(호출부가 부분 저장 처리).

### 2. 백엔드 — `/ask` stream 분기 (`src/routes/assistant.ts`)

- `askSchema`에 `stream: z.boolean().optional()` 추가. `stream !== true`면 기존 경로 그대로.
- stream 경로:
  1. RAG 앞단 공유(현행 코드 재사용). hits 0건이면 고정 문구를 `text` 1회 + `done`으로 송출(저장도 동일 정책).
  2. `insertAssistantMessages`로 user + 빈 assistant placeholder **원자 저장**(createdAt +1ms 관례 유지).
  3. `streamSSE`로 Gemini 청크를 `text` 이벤트 릴레이하며 `fullText` 누적.
  4. **완료**: placeholder를 `fullText + sources`로 update → `done`에 영속본 2건 송출.
  5. **중단 감지**: `c.req.raw.signal`의 abort(클라 AbortController) 또는 SSE write 실패 → 부분 `fullText + " (중단됨)"` update(0자면 placeholder 삭제). 저장은 CF Workers에서 `executionCtx.waitUntil`로 보장(로컬 bun은 executionCtx 없음 — try/catch 후 직접 await).
  6. **스트림 중간 에러**: 결정 5 정책. `error` 이벤트 송출 시 code는 기존 `classifyGeminiError` 계열.
- `AssistantDeps`에 `generateAnswerStream`·`updateAssistantMessage`·`deleteAssistantMessage` 추가(테스트 주입).

### 3. 프론트 — SSE 파서 + 드레인 (`client/src/lib/`)

- `assistant.ts`에 `askAssistantStream(question, callbacks, signal)` 신설 — POST라 EventSource 불가, `fetch` + `res.body.getReader()` + TextDecoder. SSE 파싱(이벤트 경계=빈 줄, `event:`/`data:` 라인)은 **순수 증분 파서**로 분리(`assistant-sse.ts`)해 유닛테스트.
- `assistant-drain.ts`: `nextDisplayLength(target, currentLength)` 순수 함수 — 앱 수치(72/160/56 경계, 스텝 2/4/7/11) + 서로게이트 보호를 그대로 포팅, 테스트로 고정. 드레인 실행(38ms `setInterval`)은 훅 쪽.

### 4. 프론트 — `useAssistantThread` 스트리밍 상태

- `PendingTurn`에 `streamText?: string` 추가 — 값이 있으면 패널이 로딩 닷 대신 `MarkdownMessage(streamText)` 렌더.
- `submit` 개편: `askAssistantStream` 사용. `text` 수신 → fullText 누적 + 드레인 시작(38ms 틱마다 `streamText` 갱신). `done` 수신 → **드레인 완주 대기 후** 영속본 merge + pending 제거(앱 `waitForDisplayDrain` 미러).
- `stop()`: AbortController.abort() → 드레인 중단, `streamText + " (중단됨)"` 임시 표시 → **~500ms 지연 후 `fetchAssistantMessages()` 1회 재조회** merge(서버 저장본이 진실원본 — waitUntil 저장과의 레이스를 지연으로 흡수) → pending 제거. **재조회 실패 시에도 pending 제거**(서버 저장본과의 이중 표시 방지 우선 — 저장본은 다음 히스토리 로드/리로드에서 표시).
- `asking` 의미 유지(생성 중). 반환에 `stop` 추가.

### 5. 프론트 — 새 턴 앵커 스크롤 (`AiAssistantPanel.tsx`)

- **min-height는 마지막 턴의 assistant 메시지 요소에 직접 부여**(턴 wrapper 도입 금지 — #133에서 wrapper가 user 버블 폭 점프를 유발해 Fragment로 확정한 회귀 방지): `minHeight = bodyClientHeight − 20(top 여백) − 28(bottom gap) − 질문버블 높이`. 질문 높이는 전송 직후 1회 측정(질문은 불변).
- 적용 대상 = "현재 마지막 턴"의 assistant 요소(pending이든 영속 교체 후든) — 새 턴 전송 시 이전 것 해제. 영속 교체 시에도 유지해 스크롤 점프 방지.
- 전송 직후 `useLayoutEffect`에서 `body.scrollTo({ top: 질문El.offsetTop − 20, behavior: "smooth" })`.
- 기존 스크롤 effect를 갱신 유형별 분기로 재편: 초기 로드=최하단(유지) / 이전 대화 prepend=기존 `data-eid` 앵커(유지) / **새 턴 전송=앵커 스크롤** / **스트리밍 청크=스크롤 없음**(질문 고정이 핵심).
- 팝오버·확대 패널 공통(bodyClientHeight로 자동 대응), 확대 토글 시 min-height 재계산.
- Send 버튼: `asking`이면 Stop(■) 아이콘 + `stop()` 호출(disabled 해제).

### 6. CSS (`client/src/styles/work-ai-panel.css`)

- 스트리밍 assistant 메시지의 inline `min-height`는 style로(동적 값). 추가 CSS는 Stop 버튼 상태 스타일뿐. 타이핑 캐럿 장식은 OUT(앱에도 없음). `@import` 순서 불변.

## 테스트 전략

- **백엔드(test:server)**: fake `generateAnswerStream` 주입 — ① 정상: text 이벤트 시퀀스 + done에 영속본 2건 + DB update 확인 ② abort: 부분 저장 + `" (중단됨)"` ③ 부분 0자 abort: placeholder 삭제 ④ 스트림 중간 에러: 부분 저장/삭제 분기 ⑤ `stream` 미지정: 기존 JSON 경로 회귀.
- **프론트(test:unit)**: ① `nextDisplayLength` — 앱 수치 경계·서로게이트 케이스 고정 ② SSE 증분 파서 — 청크 경계 분할/멀티 이벤트 ③ `useAssistantThread` — text→done 드레인 완주 후 merge, stop 재조회 동기화 ④ 앵커 스크롤 분기(새 턴 vs prepend vs 초기).
- **브라우저 스모크**(구현 완료 후, magiclink 세션): 실 Gemini 타자기 체감, 중지 → 리로드 후 `" (중단됨)"` 보존, 질문 상단 20px 고정 + 스트리밍 중 스크롤 무점프, 확대/축소 재계산.

## 검증

- `bun run typecheck` 0 · `bun run lint` 0 · `bun run test:unit` · `bun run test:server` · `bun run build`.
- 프로덕션: 기존 `GEMINI_API_KEY`(CF Pages 시크릿) 그대로. CF Workers SSE 스트리밍 응답은 표준 지원 — 배포 후 prod 스모크 1회.

## 리스크 / 완화

- **CF Workers abort 감지 신뢰성**: 감지 실패 시 서버는 끝까지 생성해 전체 저장(강등) — 데이터 유실 없음, UX만 앱과 미세 차이. 스모크에서 실측.
- **드레인 중 done 도착 순서**: 앱 미러의 `waitForDisplayDrain`로 마감 순서 보장(드레인 완주 전 pending 제거 금지).
- **stop 재조회 레이스**: ~500ms 지연 재조회로 흡수, 실패 시 다음 히스토리 로드에서 자연 동기화.
- **부분 마크다운 렌더 깜빡임**: 앱도 동일 방식(부분 렌더) — 문제 시 스모크에서 후속 판단.
