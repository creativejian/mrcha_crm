# 업무 AI 견적 코퍼스 확장 + 증분 임베딩 설계

- 날짜: 2026-07-05
- 상태: 확정(유슨생 승인) — 구현 전
- 선행: B1 업무 AI RAG(#132), SSE 스트리밍(#142~#147), 견적 앱 발송 파이프라인(#159)

## 목적 / 동기

발송 파이프라인 완결 후 "오늘 발송한 견적을 업무 AI가 답하나?" → 못 함. 원인 2겹:

1. **RAG 코퍼스에 견적 없음** — 현행 코퍼스는 메모·할일·상담이력(summary)·니즈 3필드 6종뿐.
   견적(crm.quotes)/발송 상태가 임베딩되지 않아 "이번 주 발송 견적?", "제임스 조건?"에 답 불가
   (B1 #132 follow-up "견적 코퍼스 확장" 보류분).
2. **on-write 임베딩 없음** — `src/scripts/backfill-embeddings.ts` 수동 실행 시에만 적재.
   쓰기 라우트의 embedTexts 호출 0 실측. 방금 쓴 메모도 백필 전엔 AI가 모른다.

목표: ⓐ 견적 요약 텍스트 임베딩 ⓑ 쓰기 시점 증분 임베딩(백필 불필요화) + content_hash 재임베딩 skip.

## 확정 결정

1. **열람(viewed) 상태 미포함** — viewed_at은 앱이 public.advisor_quotes에 직접 쓰므로 CRM 훅이
   없어 임베딩에 넣으면 박제(스테일)된다. 임베딩엔 발송 여부·시각까지만. 열람은 CRM 견적함 배지
   (read-through, #159)가 전담 — 역할 분리.
2. **견적 청크 = 헤더 + 대표 시나리오 + guidance 텍스트** — 견적당 1행(source_type=`quote`,
   source_id=quote.id). 고객명·견적코드·차량 + 대표 시나리오(구매방식/기간/월납입/금융사) +
   발송 상태 + guidance(추천이유·핵심포인트·서비스). 시나리오 전부 병기(청크 희석)·최소 구성
   (맥락 질문 불가)은 기각.
3. **증분 트리거 = 메모·할일·니즈 3필드·견적 전부** — CRM 쓰기 경로가 있는 코퍼스 소스 전체.
   상담이력(consultations)은 CRM 쓰기 경로가 없어 제외 — 향후 채팅 AI 요약 자동 수신 경로가
   생길 때 그쪽에서 훅 추가.
4. **content_hash 재임베딩 skip 포함**(B1 follow-up 흡수) — 임베딩 전 기존 행 hash 비교, 같으면
   Gemini 호출 생략. 훅과 백필 양쪽 적용. 견적 PATCH는 요약 무관 필드 변경(상태 토글 등)이 많아
   실익이 크다.
5. **실행 방식 = 응답 후 비동기 훅(A안)** — 저장 응답 비차단. dbHold+waitUntil 패턴
   (`holdStreamLifetime`, #143/#145에서 검증) 재사용. 동기 임베딩(저장이 Gemini 왕복만큼 느려짐·
   장애 전파)·큐 테이블+워커(신규 인프라, 규모 과잉)는 기각.
6. **삭제 경로는 동기 + 백필에 고아 정리 추가** — 현행 버그: 메모/할일/견적 삭제 시 임베딩 행을
   지우는 경로가 없어(customer cascade만 존재) 삭제된 원본이 계속 검색에 걸림. DELETE 라우트에서
   임베딩 행 삭제 1쿼리 await(Gemini 무관·저렴), 이미 쌓인 고아는 백필의 고아 정리가 청소.

## 아키텍처 / 컴포넌트

### 1. 코퍼스 확장 — `src/lib/assistant-corpus.ts`

- `CorpusSourceType`에 `"quote"` 추가, LABEL `quote: "견적"`.
- 순수 함수 `buildQuoteChunkText(q, sc, customerName)` 신설 — 견적 요약 자연어 텍스트 조립.
  콘텐츠 예:

  ```
  고객 제임스 견적 QT-2607-0001: BMW 320i M Sport · 운용리스 60개월 · 월 2,350,000원
  · 하나캐피탈 · 26/07/05 발송 · 추천이유: … · 핵심포인트: … · 서비스: …
  ```

  - 발송 상태: appStatus `draft`→"작성 중", `sent`→KST 발송시각 표기(결정 1 — 열람 미포함).
  - 값 없는 항목은 생략(빈 라벨 나열 금지) — 최소 구성은 `고객 X 견적 QT-…: 차량 미선택 · 작성 중`.
- 라벨 헬퍼는 `src/lib/app-card-payload.ts`의 기존 구현(`formatMoney`·`vehicleTitleOf`·
  `formatTerm`·`stampLabelOf`)에 **export를 추가해 재사용** — 복제 금지. 라벨 규칙이 바뀌면
  코퍼스도 자동 추종한다. (app-card-payload는 순수 모듈이라 import 안전. 이 재사용은 클라 파리티
  tripwire 대상 아님 — 파리티 테스트는 payload 필드 집합만 잠근다.)

### 2. 스키마·쿼리

- `src/db/schema.ts` `EMBEDDING_SOURCE_TYPES`에 `"quote"` 추가 → **마이그레이션 0016**
  (CHECK drop→add). 신규 타입 추가라 기존 행 위반 없음 — 0015 같은 중간 백필 불필요.
- `src/db/queries/embeddings.ts`에 2함수 추가:
  - `getEmbeddingHash(sourceType, sourceId)` — hash skip용 1쿼리(content_hash만 select).
  - `deleteEmbeddingBySource(sourceType, sourceId)` — 삭제 훅·빈 텍스트 처리용(멱등).

### 3. 증분 임베딩 훅 — `src/lib/embed-on-write.ts` (신규)

- **deps 주입형**(assistantDeps 패턴): `embedOnWriteDeps = { embedTexts, upsertEmbedding,
  getEmbeddingHash, deleteEmbeddingBySource, load* }` — 테스트가 fake 주입.
- fresh-read 로더: 소스타입별로 원본 행+고객명을 읽는 소형 로더(memo/task/quote+대표 시나리오/
  need 필드). quote 로더는 quotes 행 + primary_scenario_id 일치(없으면 scenario_no 최소) 시나리오
  + customers.name.
- 공개 API: `scheduleEmbedOnWrite(c, { sourceType, customerId, sourceId })`. 흐름:
  1. 게이트: `GEMINI_API_KEY` 부재 또는 `EMBED_ON_WRITE=off` → skip(+로그).
  2. 태스크 promise를 `holdStreamLifetime(c)` 재사용으로 dbHold+waitUntil에 등록,
     `task.finally(release)` — 응답 비차단 + CF에서 연결 수명(endAfterHold)·아이솔레이트
     회수(waitUntil) 확보. 로컬 bun은 executionCtx 없음 → fire-and-forget(싱글톤 db라 안전).
  3. 태스크 본문: 원본 fresh read(커밋된 최신값) → 행 없음/빈 텍스트 →
     `deleteEmbeddingBySource` / 있으면 청크 조립 → `getEmbeddingHash` 비교, 같으면 종료(skip)
     → `embedTexts([content], target, "RETRIEVAL_DOCUMENT")` → `upsertEmbedding`.
- Gemini 타깃은 `/ask`와 동일 배선: `resolveGeminiTarget({ apiKey, proxyUrl,
  authHeader: c.req.header("Authorization") })` — prod는 서울 핀 프록시 경유(#144), 로컬 직결.
- **콜사이트**(`src/routes/customers.ts`):
  - POST/PATCH `/:id/memos*` → `sourceType: "memo"`
  - POST/PATCH `/:id/tasks*` → `sourceType: "task"`
  - PATCH `/:id`(customers) → patch에 needMemo/needCustomerNote/needReviewNote 키가 **온 것만**
    각각의 source_type으로 스케줄(sourceId=customerId). 비워진 값(null/공백)은 태스크의
    fresh read가 빈 텍스트로 판정해 임베딩 행 삭제 — 경로 통일.
  - POST `/:id/quotes`, PATCH `/:id/quotes/:childId` → `sourceType: "quote"`.
    **반드시 트랜잭션 resolve 후 스케줄**(라우트에서 `db.transaction(...)` await 뒤) —
    커밋 전 fresh read가 구값을 보는 것을 방지.
  - DELETE(메모/할일/견적) → **동기**로 `deleteEmbeddingBySource` await(실패는 catch 로그,
    404 응답엔 영향 없음). 견적 DELETE는 기존 트랜잭션(advisor_quotes 회수) 밖에서 후처리.

### 4. 백필 스크립트 확장 — `src/scripts/backfill-embeddings.ts` (보정 도구로 잔존)

- `gather()`에 quote collect 추가: quotes 전체 + customers(name) 조인 + quote_scenarios 전체를
  메모리 매핑해 견적당 대표 시나리오 1건 선정(스크립트 규모라 OK).
- **hash skip**: 기존 embeddings의 (source_type, source_id)→content_hash 맵 1쿼리 선로드 →
  동일 hash 청크는 embedTexts 대상에서 제외(변경분만 임베딩). 로그: `N청크 중 M 임베딩, K skip`.
- **고아 정리**: 소스타입별 NOT EXISTS로 원본이 사라진 임베딩 행 일괄 delete — 현행 고아
  (삭제 경로 부재로 쌓인 것)도 이번 1회 실행으로 청소.

## 데이터 흐름 (증분)

```
저장 요청 → zod → 쿼리(트랜잭션 포함) → 201/200 응답 반환
                                    └(waitUntil)→ fresh read → 청크 조립 → hash 비교
                                                     ├ 같음 → 종료(skip)
                                                     ├ 원본 소실/빈 텍스트 → 임베딩 행 삭제
                                                     └ 다름 → Gemini embed 1건 → upsert
다음 /ask → pgvector top-k에 즉시 반영
```

## 에러 처리 / 경합

- 훅 전 구간 try/catch → `[embed-on-write]` prefix 로그만. 저장 응답 불변, 실패 건은 다음
  쓰기나 백필이 보정(내구성 없음 — 내부 도구 규모에서 수용, 로그로 관측).
- 부분 실패(임베딩 성공·upsert 실패 등)도 동일 — upsert 멱등이라 재시도 안전.
- 연속 저장 경합: 각 태스크가 실행 시점 fresh read라 대부분 최신값으로 자기치유. 이론상
  앞선 태스크의 구값 read가 늦게 upsert돼 일시 스테일 가능 — 수용(다음 쓰기/백필 보정).
- 스케줄 자체(게이트·promise 등록)는 동기 구간 — throw 금지(전체 try/catch).

## 테스트 전략

- `buildQuoteChunkText` 유닛 TDD: 풀필드/최소 필드(차량 미선택·시나리오 없음)/발송 전후/
  legacy keyPoint(단수) 승격/빈 guidance/값 없는 항목 생략.
- `embed-on-write` 유닛(fake deps): hash 동일 → Gemini 미호출 skip / 변경 → upsert /
  원본 소실·빈 텍스트 → delete / 게이트 off → no-op / deps throw → 훅이 삼키고 무전파.
- 라우트 배선 테스트(test:server): deps 주입 fake로 메모 POST→스케줄 호출, 견적 PATCH→
  커밋 후 스케줄, DELETE→임베딩 행 삭제. 실 DB 왕복 통합 1~2건(fake embedTexts 고정 벡터).
- **`package.json` `test:server`에 `EMBED_ON_WRITE=off` 기본 부착** — 기존 쓰기 테스트
  (customers.test.ts 등)가 실 GEMINI_API_KEY(.env.local)로 실 Gemini 호출 + master 임베딩
  오염을 일으키지 않게. 훅 전용 테스트는 deps 주입으로 게이트와 무관하게 검증.
- 4종 검증(typecheck·lint·test:unit·test:server) + build.

## 수동 검증(스모크)

- 로컬: 메모 저장 → psql로 crm.embeddings 행 실측 → 업무 AI 질문에 반영 확인.
  견적 작성→발송→"이번 주 발송 견적?" 질문. 스모크 데이터(메모·견적·임베딩·advisor_quotes)
  원복/삭제 — 공유 master 원칙.
- 백필 1회 실행: 견적 소급 적재 + 고아 정리 + skip 로그 확인.

## 함정 / 주의 (재발 방지 포인트)

- **test:server 오염**: 훅 도입 순간 기존 쓰기 테스트가 실 Gemini를 부른다 — `EMBED_ON_WRITE=off`
  플래그가 구현 순서상 훅 배선보다 먼저 들어가야 한다(#159 고아 카드 누수와 같은 유형).
- **커밋 후 스케줄**: 견적 훅을 쿼리 함수(트랜잭션 내부)에 넣으면 fresh read가 커밋 전 값을
  본다 — 발송 훅(트랜잭션 필요)과 반대로 이건 라우트 레벨이 맞다.
- **dbHold 수명**: waitUntil만 걸고 dbHold를 안 걸면 CF에서 미들웨어가 연결을 먼저 닫아 태스크
  쿼리가 죽은 연결로 실패(#143 유형). `holdStreamLifetime` 재사용으로 구조적으로 방지.
- **프록시 authHeader**: Edge 릴레이는 staff JWT 게이트 — Authorization 포워딩 누락 시 prod에서만
  401(#144 함정).
- CHECK 마이그레이션은 drop→add 순서(0015 관례). `db:push` 금지 — `db:generate`→`db:migrate`.

## Follow-up (이번 슬라이스 제외)

- consultations 자동 수신 경로 신설 시 그쪽 훅 추가(결정 3).
- 열람 상태의 코퍼스 반영(앱 열람 시점 갱신 경로 — 크로스 레포, 결정 1).
- 유사도 임계값(현재 top-k 항상 반환 — B1 기존 한계), 히스토리 pruning.
- 훅 실패 재시도/내구성(큐) — 실사용에서 실패율이 관측되면 재부상.
