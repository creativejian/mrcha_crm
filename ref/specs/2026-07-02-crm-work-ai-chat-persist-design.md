# CRM 업무 AI 채팅 — 대화 영속 + 멀티턴 + 앱 UI 이식 (슬라이스 C1)

- 작성일: 2026-07-02
- 상태: 설계 (사용자 검토 대기)
- 선행: 슬라이스 B1(업무 AI RAG 단일샷, PR #132 머지). 이 슬라이스는 그 위에 대화 영속·멀티턴·앱식 UI를 얹는다.
- 관련: `client/src/components/Topbar.tsx`(업무 AI 팝오버), `src/routes/assistant.ts`(`/api/assistant/ask`), `client/src/lib/assistant.ts`.

## 배경

B1로 업무 AI는 **단일샷 RAG**(질문→검색→Gemini→답변)만 된다. 대화는 `aiTurns` 메모리라 **새로고침 시 소실**되고, 지난 질문 맥락을 못 쓰며, 답변 마크다운이 평문으로 노출된다(B1에서 프롬프트로 평문 강제해 임시 회피).

목표: 앱의 고객 상담 채팅처럼 **직원/관리자 대화를 DB 영속**하고, **앱의 채팅 UX(마크다운 렌더·로딩 애니메이션·버블/composer)를 이식**한다. 색상은 현 CRM 브랜드(`#5836ff`) 유지.

## 앱 실측 (mirror 대상 — 조사 결과)

- **영속**: 앱은 클라이언트가 `public.chat_messages`(uuid7, user_id, message, is_user, a2ui_data, related_questions, sender_type, session_id, created_at)에 직접 쓴다. `public.chat_sessions`(mode ai/pending/human, assigned_staff_id)는 **상담원 핸드오프 전용**. Edge Function은 chat 테이블에 **쓰지 않고** 최근 10메시지를 읽어 Gemini 멀티턴 컨텍스트로만 쓴다. 히스토리 = user_id별 최근 N, 커서 페이지네이션.
- **UI**: 마크다운 = `flutter_markdown_plus`(본문 14px/line-height 1.5, h1 17/700·h2 16/700·h3 14.5/700, `•` 불릿). AI 답변 = **박스 없는 인라인 마크다운**, 유저 = 우측 브랜드색 pill(동적 radius). 로딩 = **더블바운스 닷**(브랜드색 두 원 위상차 펄스, 1600ms, 800ms 지연 후 표시) — **shimmer는 미사용(dead dep)**. Composer = `+`버튼 + 글래스 pill 입력 + 송신↔중지 토글(스트리밍용). 스트리밍 = 진짜 SSE + 클라 타자기 페이싱.
- 파일: `lib/data/repositories/supabase_chat_repository.dart`, `lib/presentation/widgets/chat/chat_message_bubble.dart`(마크다운 스타일), `lib/presentation/screens/chat/chat_screen_message_bubble.dart`(`_ChaDoubleBounceIndicator`), `lib/core/theme/app_theme.dart`(`brandAccent=#5836FF`).

## 결정

1. **범위 = 옵션 A**: 영속 + 멀티턴 + 앱 UI. **SSE 스트리밍·타자기 페이싱·송신/중지 토글은 후속 슬라이스**(가장 무겁고 CF Workers SSE 별도 검증). 현 단일샷 요청 모델 유지.
2. **스키마 단순화**: 앱의 session/mode/handoff는 내부 도구에 불필요 → **단일 `crm.assistant_messages`**(세션 테이블 없음, staff_user_id별 평면 메시지 스트림). 앱도 실제로 chat_messages를 user_id로 조회하므로 정합.
3. **서버 영속(앱과 다름, 의도적)**: 앱은 클라 authoritative지만 내부 도구는 **백엔드가 성공 시 원자적으로 user+assistant 저장**이 깔끔(placeholder 이중 왕복 제거, 단일 진실원). 실패 시 아무것도 저장 안 함.
4. **멀티턴 = 최근 10메시지**(앱과 동일 수치)를 Gemini `contents`로. RAG 검색은 **현재 질문**만 임베딩(단순·앱 유사).
5. **마크다운 렌더 도입** → **B1의 "평문" 프롬프트 지시 되돌림**(마크다운 출력 활용). 프론트 `react-markdown` + `remark-gfm`.
6. **로딩 = 더블바운스 닷** 포팅(브랜드색, 1600ms, 위상차, 800ms 지연). shimmer 안 씀.
7. **대화 scope = 본인 것만**: 메시지는 `staff_user_id`(JWT sub) 키. 각 직원은 자기 대화만. (RAG의 고객 `resolveCustomerScope`와 직교 — 이건 "내 채팅 기록" scope.)

## 범위 (IN / OUT)

**IN**
- `crm.assistant_messages` 테이블(마이그, crm only).
- `POST /api/assistant/ask` 개편: 최근 10메시지 컨텍스트 + user/assistant 메시지 성공 시 원자적 저장.
- `GET /api/assistant/messages` — 본인 최근 대화 로드(패널 진입 시).
- 프론트: 히스토리 로드·렌더(새로고침 생존), 마크다운 렌더, 더블바운스 로딩, 앱식 버블 스타일.
- SYSTEM_PROMPT 평문 지시 제거(마크다운 허용).

**OUT (후속)**
- SSE 스트리밍 + 타자기 페이싱 + 송신/중지 토글.
- 히스토리 무한스크롤/커서 페이지네이션(v1은 최근 N만).
- related_questions 후속질문 칩, a2ui rich 카드.
- 대화 삭제/초기화 UI, 세션 분리/제목.

## 아키텍처

### 1. 데이터 모델 — `crm.assistant_messages`

| 컬럼 | 타입 | 비고 |
|------|------|------|
| `id` | uuid pk `defaultRandom()` | |
| `staffUserId` | uuid("staff_user_id") notNull | JWT sub(=profiles.id). loose id(FK 보류 — crm.customers.advisorId 관례와 동일, public 불가침) |
| `role` | text notNull | `user` \| `assistant` (CHECK, 코드 상수) |
| `content` | text notNull | 메시지 본문(assistant는 마크다운 원문) |
| `sources` | jsonb | assistant 메시지의 RAG 근거 `[{customerId,customerName,sourceType,snippet}]`, user는 null |
| `createdAt` | timestamptz `defaultNow()` notNull | 정렬 키 |

- 인덱스: `(staff_user_id, created_at)`.
- FK 없음(public.profiles 불가침 관례). drizzle `schemaFilter:["crm"]`, `db:generate`→`db:migrate`.

### 2. 백엔드

- **쿼리** `src/db/queries/assistant-messages.ts`:
  - `insertAssistantMessages(rows[], executor)` — user+assistant 원자적 insert(트랜잭션).
  - `listRecentMessages(staffUserId, limit, executor)` — 최근 limit개 `created_at desc` 후 역순(오름차순) 반환.
- **`POST /api/assistant/ask`** 개편(`src/routes/assistant.ts`): trim/apiKey 가드 동일 → `resolveCustomerScope` → 질문 임베딩 → `searchEmbeddings` → 컨텍스트 조립 → **최근 10메시지 로드**해 `generateAnswer(system, history, userPrompt)` → 성공 시 **user+assistant 원자 저장** → `{answer, sources, messages:[{id,role,content,sources,createdAt}×2]}` 반환. 실패 시 한국어 500(저장 없음).
- **`GET /api/assistant/messages`** 신규: `listRecentMessages(c.var.user.id, 30)` → 배열. staff JWT 게이트(기존 `/api/assistant/*` auth+db 미들웨어 그대로 커버).
- **`generateAnswer` 확장**(`src/lib/gemini-generate.ts`): `history: {role:"user"|"assistant"; content:string}[]` 인자 추가 → Gemini `contents`를 `[...history(assistant→role:"model"), {role:"user", parts:[userPrompt]}]`로 구성. history 빈 배열이면 기존과 동일. 기존 테스트 유지 + 멀티턴 테스트 추가.
- **`assistantDeps`** 주입 구조에 `listRecentMessages`/`insertAssistantMessages` 추가(테스트 주입 가능).

### 3. 프론트

- **`client/src/lib/assistant.ts`**: `AssistantMessage` 타입(id, role, content, sources, createdAt). `askAssistant(question)` 반환에 저장된 messages 포함. `fetchAssistantMessages(): Promise<AssistantMessage[]>` 신규(GET).
- **Topbar**: 팝오버 열릴 때 `fetchAssistantMessages`로 히스토리 로드→렌더(새로고침 생존). 전송 시 낙관적 turn 표시(로딩)→성공 시 서버 messages로 확정(id 부여)→실패 시 인라인 에러(비영속). 마크다운은 assistant content를 `react-markdown`+`remark-gfm`으로 렌더(유저는 평문). 로딩=더블바운스 닷 컴포넌트.
- **마크다운 스타일**: 앱 스케일 이식 — 본문 14px/1.5, 헤딩 16~17px/700, `•` 불릿, AI=박스 없는 인라인, 유저=우측 브랜드 pill. 색상 현 브랜드.
- **더블바운스 로딩** `client/src/components/ai/DoubleBounceDots.tsx`(신규): 브랜드색 두 원, CSS keyframes 1600ms 위상차 펄스, 800ms 지연 후 표시.

### 4. 디자인 이식 스펙(앱 실측값, 색상=브랜드)

- 본문 14px/line-height 1.5, 헤딩 h1 17/700·h2 16/700·h3 14.5/700, 불릿 `•`.
- AI 메시지: 박스/배경 없음, 좌측 정렬, 인라인 마크다운. 유저: 우측 정렬 `#5836ff` fill pill.
- 로딩: 더블바운스 닷(#5836ff, 20px 원 2개, 위상차 0.5, 1600ms, easeInOutCubic, scale 0.03→1·opacity 0.15→0.6), 800ms 지연.
- Composer: 현 구조 유지(+ 입력 + 송신). 송신/중지 토글은 스트리밍 후속.

## 데이터 흐름

```
[진입] Topbar open → GET /api/assistant/messages(본인 최근 30) → 렌더(마크다운)
[질문] 낙관적 user turn 표시(로딩 닷) → POST /ask
       → 최근 10메시지 로드 → 질문 임베딩 → pgvector 검색 → 컨텍스트+history → Gemini
       → 성공: user+assistant 원자 저장 → {answer, sources, messages} → 확정 렌더(마크다운)
       → 실패: 한국어 500 → 인라인 에러(비영속)
```

## 에러 처리

- Gemini/검색 실패 → 한국어 500(B1 패턴), 저장 없음, 프론트 인라인 에러.
- 히스토리 로드 실패 → 빈 상태로 시작(치명 아님), 콘솔 로그.
- 저장 실패(성공 답변인데 insert 실패) → 500 반환하되 답변은 이미 생성됨 → 트랜잭션이라 부분저장 없음. 프론트는 에러 표시(사용자 재질문 가능).

## 테스트 전략

- **백엔드(bun:test, 실 DB)**: `assistant-messages` 쿼리(insert 원자성·최근 N 역순), `/ask` 개편(멀티턴 컨텍스트 전달·성공 시 2건 저장·실패 시 0건 — assistantDeps 주입 mock), `GET /messages`(본인 것만), `generateAnswer` 멀티턴 contents 구성(fetch mock).
- **프론트(vitest)**: `fetchAssistantMessages`/`askAssistant` 매핑, 마크다운 렌더(react-markdown), 더블바운스 컴포넌트 렌더.
- **수동/브라우저**: 대화 후 새로고침→히스토리 유지, 멀티턴 후속질문 맥락 반영, 마크다운(헤딩·불릿·볼드) 정상 렌더, 로딩 닷 표시. 검증 예산 typecheck0·lint0·test:server·test:unit·build.

## 후속 슬라이스

1. **SSE 스트리밍** + 타자기 페이싱 + 송신/중지 토글(앱 완전 동일 연출).
2. 히스토리 커서 페이지네이션(오래된 대화 더보기).
3. related_questions 후속질문 칩, a2ui rich 카드.
4. 대화 초기화/삭제, RAG 유사도 임계값·자동 재임베딩 등 B1 후속.

## 구현 시 확인(verify-at-implementation)

- Gemini `generateContent`의 멀티턴 `contents`(assistant=role:"model") 실제 동작을 스모크로 확인.
- `react-markdown`+`remark-gfm` 최신 버전 도입(번들 크기 확인, raw HTML 미렌더 = XSS 안전 기본값 유지).
- `crm.assistant_messages` CHECK(role) 상수는 schema.ts 기술값 관례(named const)로.
- 낙관적 렌더↔서버 확정 messages 매핑(클라 임시 id ↔ 서버 id) 정합.
