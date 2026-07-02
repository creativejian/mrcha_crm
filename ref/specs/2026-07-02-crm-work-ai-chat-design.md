# CRM 업무 AI 채팅 — 설계 (슬라이스 B1: RAG 수직 슬라이스)

- 작성일: 2026-07-02
- 상태: 설계 승인 대기 → (승인 시) writing-plans로 구현 플랜
- 관련: `client/src/components/Topbar.tsx`(현 mock), crm-analyst(`supabase/functions/crm-analyst/` — Gemini 호출·staff JWT 인증 패턴 재사용 참고)

## 배경 / 현재 상태

- Topbar `work-ai-panel`은 현재 **하드코딩 mock**이다: "오늘 브리핑"(응답대기/견적요청/출고예정 집계), 빠른질문 칩, 우선순위 답변, 입력창+전송버튼(전송은 미동작).
- 업무 AI를 **Gemini + pgvector RAG**로 실제화하려는 슬라이스B. AI 채팅/RAG 관련 기존 코드·spec 전무(greenfield).
- **pgvector는 master DB에 이미 설치됨**(extension `vector` 0.8.0). 앱이 이미 사용 중이라 **관례가 확립돼 있다**:
  - `public.knowledge_chunks.embedding` = `vector(3072)`, `public.insights.embedding` = `vector(3072)`(HNSW 인덱스는 `halfvec(3072)`), `public.faq_questions.embedding` = `vector(3072)`.
  - 즉 앱 표준 = **차원 3072**(`gemini-embedding-001` 네이티브), HNSW 인덱스는 `halfvec` 캐스팅.
- **현재 코퍼스 규모(대부분 김민준 시드)**: `customer_memos` 3행, `consultations` 0행(비어있음), `customer_tasks` 23행, `need_memo`/`need_customer_note`/`need_review_note` 각 1행. → 실 텍스트 ~30청크. **RAG 가치는 실데이터(상담메모·상담이력)가 쌓일수록 커진다.** v1은 파이프라인을 깔아두는 성격.

## 결정 (브레인스토밍 2026-07-02)

1. **방향 = 풀 시맨틱 RAG**(비정형 텍스트 임베딩→pgvector 의미검색). 정형 요약만/구조화 주입은 폐기.
2. **슬라이싱 = 얕은 수직 슬라이스(B1)**. 한 경로를 끝까지: 임베딩테이블+백필 → 질문임베딩+top-k검색 → Gemini 생성 → Topbar 전송버튼 연결(단일샷). 자동임베딩·스트리밍·멀티턴은 후속 덧슬라이스.
3. **코퍼스 = 고객 맥락 전체**: 상담메모(`customer_memos.body`) + 상담이력(`consultations.summary`) + 니즈메모(`customers.need_memo`/`need_customer_note`/`need_review_note`) + 할일(`customer_tasks.body`). 견적 메모(`quotes.note`)는 후속.
4. **권한 scope = admin 먼저(옵션 1)**. v1은 `resolveCustomerScope(user)` seam을 두되 전체 코퍼스(admin 수준). manager(자기 팀만)/사원(본인만) per-팀 필터는 **다음 crm.staff/팀 파운데이션 슬라이스가 이 seam 본문만 교체**. (이유: 팀 개념이 데이터에 전무 — `profiles`에 team 없고 앱 소유라 불가침, teams/staff 테이블 없음, 담당자는 옵션 A 텍스트, `advisor_id` 미populate, staff 계정 0. 진짜 팀/본인 scope는 파운데이션 선행 필요.)
5. **컴퓨트 위치 = 기존 Hono 백엔드**(Edge Function 아님). 검색이 DB 중심이라 drizzle+DATABASE_URL·기존 staff JWT 미들웨어를 그대로 재사용. 단 `GEMINI_API_KEY`를 CF 백엔드 env로 설정 필요.
6. **모델**: 임베딩 `gemini-embedding-001`(네이티브 3072, output_dimensionality 미지정), 생성 `gemini-3.1-flash-lite`(앱/crm-analyst 동일). 단일 상수로 SSOT.
7. **벡터 차원 = 3072**(앱 패리티, MRL 축소/재정규화 이슈 회피, 이 DB에서 검증된 패턴). 컬럼 `vector(3072)`, 인덱스 `(embedding::halfvec(3072)) halfvec_cosine_ops`.
8. **UI = 단일샷**(멀티턴 기억·히스토리 영속 없음), 스트리밍 없음.

## 범위 (v1 IN / OUT)

**IN**
- `crm.embeddings` 테이블(마이그, crm only) + 백필 스크립트(수동 실행).
- 검색+생성 백엔드 엔드포인트 `POST /api/assistant/ask`(staff JWT).
- Topbar `work-ai-panel` 전송/Enter 연결 → 단일샷 근거 답변 렌더.

**OUT (후속 슬라이스)**
- manager/사원 per-팀·본인 scope (→ crm.staff/팀 파운데이션 슬라이스; 이 spec의 `resolveCustomerScope` seam 교체).
- 쓰기 시 자동 재임베딩(v1은 수동 백필, staleness 허용 — 백필 재실행으로 갱신).
- 스트리밍 응답, 멀티턴 대화 기억/히스토리 영속.
- 견적 코퍼스(`quotes.note`/`guidance`) 확장.
- "오늘 브리핑" 동적화(v1은 기존 정적 유지 또는 제거 — 플랜에서 확정).

## 아키텍처

### 1. 데이터 모델 — `crm.embeddings`

| 컬럼 | 타입 | 비고 |
|------|------|------|
| `id` | `uuid` pk | `defaultRandom()` |
| `source_type` | `text` | `memo`\|`task`\|`need_memo`\|`need_customer_note`\|`need_review_note`\|`consultation` (CHECK) |
| `source_id` | `uuid` | 원본 행 id. `need_*`는 customer_id(니즈는 customers 인라인) |
| `customer_id` | `uuid` | scope 필터·고객 메타 조인. NOT NULL(v1 코퍼스는 전부 고객 귀속) |
| `content` | `text` | 임베딩한 원문 스냅샷(경량 컨텍스트 포함) |
| `content_hash` | `text` | 변경 없으면 재임베딩 skip(멱등) |
| `embedding` | `vector(3072)` | `gemini-embedding-001` 네이티브 |
| `updated_at` | `timestamptz` | |

- 유니크 `(source_type, source_id)` — upsert 키.
- HNSW 인덱스: `USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)`. (~30행이라 현재 seq scan으로 충분하나 앱 관례에 맞춰 생성. `vector` 타입 HNSW는 2000차원 한계라 halfvec 캐스팅 필수.)
- drizzle `schemaFilter:["crm"]` 유지, `db:generate`→`db:migrate`만. pgvector 컬럼 타입은 drizzle 커스텀 타입 또는 `sql` 정의로 표현(플랜에서 확정).

### 2. 임베딩 파이프라인 (백필 — 수동)

- `bun run` 일회성 스크립트(예 `src/scripts/backfill-embeddings.ts`, 경로 플랜에서 확정).
- 흐름: 4개 코퍼스 소스 행 수집 → 소스별 **content 문자열 빌더**(경량 컨텍스트: "고객 {이름} 상담메모: {본문}") → `gemini-embedding-001` 배치 임베딩(3072) → `(source_type, source_id)` upsert. `content_hash` 동일하면 skip.
- 빈/공백 텍스트 행은 스킵. `consultations`(현재 0행)도 파이프라인엔 포함(데이터 차면 자동 대상).
- v1은 신규 쓰기 자동 임베딩 없음 — 백필 재실행으로 갱신(문서화).

### 3. 검색 + 생성 — `POST /api/assistant/ask`

- 인증: 기존 staff JWT 미들웨어(`src/auth/verify.ts` 게이트 재사용).
- 요청: `{ question: string }`.
- 흐름:
  1. `resolveCustomerScope(user)` → `"all" | string[]`(v1: admin/manager/staff 모두 `"all"`).
  2. 질문을 `gemini-embedding-001`(3072)로 임베딩.
  3. pgvector top-k(k=8) 검색: `ORDER BY embedding <=> $queryvec LIMIT k`, scope가 배열이면 `WHERE customer_id = ANY($ids)`. (drizzle `sql` raw로 `<=>` 연산자·`'[...]'::vector(3072)` 리터럴.)
  4. 컨텍스트 조립: 검색된 청크 `content` + 고객 메타(이름/상태/계약가능성)를 근거 블록으로.
  5. `gemini-3.1-flash-lite` 생성. 시스템 프롬프트: 한국어, CRM 업무 어시스턴트, **제공된 근거만으로** 답변, 근거 인용, 모르면 "관련 데이터를 찾지 못했습니다".
  6. 응답: `{ answer: string, sources: [{ customerId, customerName, sourceType, snippet }] }`.
- 응답 형식(structured output)은 crm-analyst 패턴 참고(플랜에서 확정).

### 4. 스코프 resolver seam

- `resolveCustomerScope(user: AuthedUser): "all" | string[]` 단일 함수.
- v1 본문: `return "all";`(모든 CRM 역할). **다음 파운데이션 슬라이스가 이 함수만 교체** — admin→`"all"`, manager→팀 소속 고객 id[], staff→본인 배정 고객 id[]. 호출부(엔드포인트)는 불변.

### 5. UI 연결 (Topbar `work-ai-panel`)

- 전송버튼/Enter → `POST /api/assistant/ask` 호출 → 사용자 말풍선 + 어시스턴트 답변 + 근거(sources) 렌더.
- 로딩 상태("생각 중…"), 에러 상태 인라인.
- 빠른질문 칩: 클릭 시 입력 채움(기존 동작 유지). mock "예상 답변"·"오늘 브리핑" 처리는 플랜에서(브리핑 정적 유지 or 제거).
- **단일샷**: 각 질문 독립, 대화 히스토리 미영속(패널 세션 내 표시만).

## 데이터 흐름

```
[백필] 코퍼스행 → content빌더 → gemini-embedding-001(3072) → crm.embeddings upsert
[질의] 질문 → resolveCustomerScope(user) → 질문임베딩(3072)
      → pgvector top-k(scope 필터) → 컨텍스트 조립(청크+고객메타)
      → gemini-3.1-flash-lite → {answer, sources}
      → Topbar 렌더
```

## 에러 처리

- Gemini(임베딩/생성) 실패 → 500 + 프론트 "일시적으로 답변에 실패했습니다".
- 검색 0건 → 200 + `answer`="관련 CRM 데이터를 찾지 못했습니다", `sources`=[].
- 인증 실패 → 401(기존 게이트).
- 백필: 개별 행 임베딩 실패는 로그 + 스킵(전체 중단 아님), 요약 리포트.

## 테스트 전략

- **순수 유닛(TDD 우선)**: content 문자열 빌더(소스별), 컨텍스트/프롬프트 조립기, `resolveCustomerScope`, 응답 파서. 임베딩/생성 API는 mock.
- **엔드포인트**: 인증 게이트·검색 필터(scope 배열/all)·에러 분기 단위/통합 테스트(Gemini mock, DB는 테스트 픽스처 or mock).
- **수동 검증**: 백필 실 실행 → `crm.embeddings` 행 확인 → 브라우저에서 실제 질문→근거답변 스모크(실 Gemini). staff 계정으로.
- 검증 예산: typecheck 0 · lint 0 · `bun run test:unit` green · build.

## 후속 슬라이스 (이 spec 이후)

1. **crm.staff/팀 파운데이션** — `resolveCustomerScope` 실제화(manager=팀, staff=본인). `advisor_id` 연결. 리스트/상세 scope에도 재사용. (배정 옵션 A의 후속.)
2. 쓰기 시 자동 재임베딩(memo/task/need/consultation CRUD 훅 or 백엔드 트리거).
3. 스트리밍 응답, 멀티턴 대화.
4. 견적 코퍼스 확장, "오늘 브리핑" 동적화.

## 구현 시 확인(verify-at-implementation)

- `gemini-embedding-001` 실제 사용 가능 여부·기본 차원 3072·정규화 동작을 구현 착수 시 실호출로 확인(레포 관례: DB/외부 의미는 가정 말고 실측).
- CF 백엔드 런타임에 `GEMINI_API_KEY` env 주입 경로(로컬 `.env.local` + CF Pages 대시보드 secret) 확인.
- drizzle에서 `vector(3072)`/halfvec 인덱스 표현 방식(커스텀 타입 vs 마이그 raw SQL) 확정.
- CF 백엔드에서 Gemini fetch(외부 HTTP) 및 pgvector 쿼리 동작 확인(기존 DB 쿼리는 프로덕션 검증됨).
