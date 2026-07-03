# AI 슬라이스 리팩토링 백로그 (2026-07-03 분석)

- 대상: PR #142~#150 (업무 AI SSE 스트리밍·Gemini Edge 프록시·prod SSE 데드락 3연속·stop UX 3차 리라이트)에서 어제~오늘 쌓인 코드.
- 방법: 2앵글 분석(재사용·단순화 / 구조·깊이·테스트 가능성) + 세션 실작업자 지식 종합. **분석만 수행, 코드 무변경.**
- 새 세션 착수 시: 이 문서 + `ref/active-session-brief.md`의 #142~#150 항목이면 컨텍스트 충분. 검증은 4종(typecheck·lint·test:unit·test:server)+build, stop/스트리밍 접점은 **행위 보존(순수 이동) 원칙 + prod 스모크 1회**(사고 3건 이력 지점).

## A. 즉시 착수 가능 (저위험 · S 위주 — 1~2 PR로 묶기 좋음)

### PR 후보 A — 파리티·SSOT 가드 (전부 S, 코드 행위 무변경)
1. **`DISPLAY_LIMIT`(서버 30) ↔ `AI_HISTORY_PAGE`(클라 30) 파리티 테스트 부재** — 클라가 `rows.length === AI_HISTORY_PAGE`로 hasMore 판정(`useAssistantThread.ts:97,119`). 서버 LIMIT 변경 시 이전 대화 페이지네이션이 **에러 없이 조용히 죽는** 드리프트. STOP_SUFFIX 패턴(`src/lib/assistant-stream.test.ts`가 클라 모듈 직접 import)과 동일하게 서버 테스트 1케이스 추가(DISPLAY_LIMIT export 필요).
2. **`classifyGeminiError` bun↔Deno 복제 파리티 테스트 부재** — `src/lib/gemini-error.ts` ↔ `supabase/functions/crm-analyst/gemini.ts:4-14`. 갈라지면 재시도 판정이 CRM/crm-analyst에서 달라짐. 고정 픽스처(429/credit/503/generic) 비교 테스트 1개. (※ `UPSTREAM_BASE`↔`GEMINI_DIRECT_BASE` 상수 파리티는 **보류** — 변경 확률 사실상 0 + 양방향 주석 존재, 테스트가 노이즈.)
3. **`NO_HITS_ANSWER` 이중 리터럴** — `routes/assistant.ts:31` 상수 vs `assistant-prompt.ts:7` SYSTEM_PROMPT 내 문구. 한쪽만 바꾸면 "근거 없음" 응답이 경로(직접 반환 vs 모델 생성)별로 갈라짐 → prompt 쪽으로 SSOT 이동 후 보간·import.

### PR 후보 B — SSE 수명 구조화 (서버)
4. **`holdStreamLifetime(c)` 추출 [S, 최고 가성비]** — dbHold set + waitUntil 등록(현 `routes/assistant.ts:182~186` 4줄+주석 12줄)을 `middleware/db.ts`의 원자 헬퍼로. "누락 시 로컬 정상 + prod만 P0"(#143 실사고)인 불변조건을 문서 규칙에서 구조 규칙으로. 부수로 `tryWaitUntil(c,p)`가 db.ts:37~41·assistant.ts:145~152의 executionCtx try/catch 중복 흡수. 기존 #145 회귀 테스트 3종이 커버.
5. **`sleepUnlessAborted` export + 유닛 3케이스 [S]** — 선-abort 즉시 해소·타임아웃·중도 abort(+리스너 해제). 현재 하트비트 계열은 prod tail로만 검증됨.
6. **(선택, M) `sse-liveness` 추출** — streamAsk의 클라 생존 감시 기계장치(hbStop·clientDead/raceDead·하트비트 IIFE, ~45줄)를 `createSseLiveness({writeRaw, heartbeatMs, writeTimeoutMs})`로. **경계 원칙: 타이밍·race·상태만 추출, hono/CF 채널 배선(sse.onAbort·raw signal)과 도메인(선저장/finalize/done payload)은 라우트 잔류.** brief의 "신규 스트리밍 라우트 전제 3종 세트" 명문화가 재사용 근거(YAGNI 아님) + 추출 시 하트비트 3분기(정상 정지/write-timeout/write-throw) 유닛화 가능. prod 검증 코드라 순수 이동 + `heartbeat-timeout` 등 tail 로그 문자열 보존 + 스모크 1회 필수. 두 번째 스트리밍 라우트(후보: 채팅 AI 상담 요약) 전까지는 반드시.

### PR 후보 C — Gemini 호출 정리
7. **Gemini fetch 재시도 루프 3벌 통합 [M]** — `gemini-generate.ts:32-47`(generateAnswer)·`:77-87`(stream)·`gemini-embed.ts:40-55`(embedBatch)가 "attempt<2 → fetch → classify → body 로그 → transient 1회 재시도" 골격을 복제(d4d1deb에서 로그 포맷 수동 동기화 이력 = 드리프트 실증). `geminiPost(url, body, target, {label, fetchImpl, signal?}): Promise<Response>` 추출, 호출부는 파싱만. crm-analyst Deno 복제본(`gemini.ts:36-52`)은 런타임 경계라 현행 유지.
8. **`generateAnswer(Stream)` trailing options 객체화 [S]** — #146이 signal을 6번째 위치 인자로 덧붙여 호출부에 `undefined,` 필러 실재(`routes/assistant.ts:240`). `opts?: {history?; fetchImpl?; signal?}`로, generateAnswer도 대칭. embedTexts(4인자)는 문턱 아래 — 유지.
9. **crm-analyst `?key=` 쿼리 → `x-goog-api-key` 헤더 통일 [S + 재배포 1회]** — `crm-analyst/gemini.ts:30`. #144가 세운 키 정책(쿼리=게이트웨이 로그 노출)의 마지막 잔존. crm-analyst만 재배포(crm-gemini-proxy는 auth.ts만 번들이라 무관).
10. **user+placeholder 선저장 `insertTurn` 헬퍼 [S]** — `routes/assistant.ts:120-124` vs `:171-175`에 now/now+1ms 규약(커서 정렬과 맞물린 암묵 규약) 2벌 복제 → 헬퍼 1개로.

## B. 트리거 기반 (지금 하면 churn — 명명된 시점에)

- **`resolveGeminiTargetFromRequest(c)` env→target 배선 중앙화** — 트리거: **두 번째 백엔드 Gemini 호출자 등장 즉시**(그 PR 첫 커밋으로). 잊으면 "GEMINI_PROXY_URL 미적용 → 로컬 정상 + prod만 HKG 400" — #144~#147 사고 패턴 재현. 프록시 모드는 수신 Authorization 필수라 cron/큐 호출자는 서비스 토큰 방식 결정 필요(주석 명시).
- **드레인 타자기 컨트롤러 추출(`createDrainTypewriter`) + stop 정합화 2경로(trimStoppedMessage/syncStoppedTurn) 재평가** — 트리거: **"생성 중 재질문 supersede" 슬라이스 착수 시**(#142 follow-up 명명). supersede는 4번째 stop 경로+동시 2턴 = 현 `drainTimerRef` 싱글턴("동시 1턴" 전제)을 직접 깸 → 그때 턴별 컨트롤러 인스턴스로. 두 정합화 경로는 실패 의미가 달라(트림 실패=원본 수용 vs 재조회 실패=탈출) 억지 통합 금지. 지금 최소 정리만 원하면 `${displayed}${STOP_SUFFIX}` 3중복의 `frozen(displayed)` 헬퍼(S).
- **crm-gemini-proxy allowlist 파리티** — 트리거: 4번째 Gemini 메서드 추가 시. 현 구조(인증/릴레이 2파일, 무버퍼링)는 유지가 정답.

## C. 검토 후 비권장 (기록용)

- 서버 `parseSseLine` vs 클라 `createSseParser` 공용화 — 파싱 대상·빌드 경계 달라 실익 없음.
- `updateAssistantMessage` vs `updateAssistantMessageContent` 병합 — 의도적 별도 시맨틱(where role 필터·sources 유지), 병합 시 분기만 증가.
- `/ask` 논스트림 JSON 경로 제거 — 설계 결정(하위호환·테스트용 유지)이지 리팩토링 대상 아님.
- 3중 JWT 검증(게이트웨이+CRM+릴레이) 축소 — 의도적 이중 방어, 비용 미미(#144 리뷰 기각).

## 권장 순서 (새 세션 1~2 PR 구성안)

1. **PR A+B 묶음**(전부 S: 1·2·3·4·5) — 저위험 가드/구조화, 반나절.
2. **PR C**(7·8·9·10, M 1건 포함) — Gemini 호출 계층 정리 + crm-analyst 재배포.
3. 6(sse-liveness M)은 1~2와 분리해 단독 PR(스모크 필요)로 하거나 두 번째 스트리밍 라우트 슬라이스에 흡수.
