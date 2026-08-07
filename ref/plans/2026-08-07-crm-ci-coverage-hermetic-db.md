# CI 커버리지 — hermetic DB(PGlite) seam 설계 (2026-08-07)

**과제**: 권한·파기·돈·전이의 서버 회귀 그물이 전부 `db-bound-tests.ts` registry에 등재돼
`test:pure`(CI)에서 제외 → **CI 커버리지 0**. 배치 16 감사("진짜 발견" 절)와 `#463` 리뷰가
연속으로 같은 지목을 했다. "그물이 있다"와 "PR이 빨개진다"는 다른 말이다 — 배치 16 변이
실증에서 `purgeCustomerCore`의 WHERE를 지워도 CI 8단계가 전량 통과했다.

**원인 구조** (셋이 겹친다):
1. `vitest.config.ts` include가 `client/src/**`+`test/**`뿐 — 서버 코드는 `test:unit` 구조적 0.
2. 라우트 통합 테스트는 `app.request()`가 `dbMiddleware`를 지나므로 403 전제 케이스조차
   DB가 먼저 필요하다(requireRoles류 라우터 게이트가 db 배선 뒤).
3. 실 DB가 **공유 master**라 CI에 못 넣는다(픽스처 잔재·알림 트리거 실발사·Gemini 실콜).

## 결정 — in-memory Postgres(PGlite)를 기존 `setTestDb` seam에 주입

새 seam을 파지 않는다. `dbMiddleware`의 테스트 전용 오버라이드(`setTestDb`, `#209`)와
쿼리 함수의 `Executor` 주입이 이미 있으므로, **거기에 꽂을 DB를 실 master 대신
hermetic PGlite(WASM Postgres)로 바꾸는 것**이 설계의 전부다. 라우트 코드는 무수정.

### 하네스 구성 (`src/test-utils/hermetic-db.ts`, lazy 싱글톤)

1. `PGlite` + pgvector 확장(`@electric-sql/pglite-pgvector`) 기동.
2. master에만 있는 앱 팀 함수 스텁: `uuid_generate_v7()`(→ `gen_random_uuid()`).
   (catalog-admin 정렬 테스트를 이관하는 단계에선 `public.batch_update_sort_order`도.)
3. **catalog·public 미러 = `drizzle-kit/api pushSchema`로 런타임 생성** —
   `src/db/catalog.ts`·`public-app.ts`가 그대로 DDL의 SSOT다(수기 DDL 복제본 금지 —
   스키마 파일이 바뀌면 자동 추종, 드리프트 축 자체가 없다).
4. **crm = 실 마이그레이션 53개를 그대로 적용**(배포 산물 검증 겸용). drizzle의 pglite
   migrator가 아니라 **simple protocol(`client.exec`)로 파일 단위 BEGIN/COMMIT** — 이유는
   아래 실측 함정 ①.
5. drizzle 인스턴스(allSchema)를 `as unknown as Db` 단일 캐스트로 반환(캐스트는 하네스
   1곳에만 존재).

### dual-mode — 로컬 실 DB 검증을 잃지 않는다

이관 파일은 registry에서 빠지는 순간 **양쪽에서 돈다**: 로컬 `test:server`(DATABASE_URL
있음 → 실 master, 기존 그대로) + CI `test:pure`(env 제거 → PGlite). 선택 로직은 helper
1곳: `DATABASE_URL` 있으면 `getDefaultDb()`(+알림 테이블 접촉 파일은 기존 `guardedDb`
유지), 없으면 hermetic. **test:server의 실 DB 통합 가치(실 트리거·실 계약·실측)는 그대로
남기고 CI 그물만 추가**하는 방향이다. "PGlite 초록 ≠ master 초록" 드리프트는 dual-mode가
로컬에서 잡는다(아래 한계 ⓐ).

## 실측 근거 (2026-08-07 스파이크 3종, bun 1.3.14 · PGlite 0.5.4)

- **스파이크 1**: crm 마이그레이션 **53개 전량 적용 61ms**(WASM 기동 ~700ms 1회).
  트랜잭션 내 `set_config`(SET LOCAL 동형) 동작, phone 소유권 CHECK(0034) 실제 발동,
  pgvector(3072) insert + cosine 연산 OK.
- **스파이크 2**: `pushSchema`로 catalog 7 + public 7테이블 자동 생성(~800ms, 문장 36).
- **스파이크 3**: 실제 `createApp` + `setTestDb(PGlite)` end-to-end **4/4** —
  dealer 쓰기 403(게이트) · admin 목록 200(SELECT 조인) · admin 생성 201(INSERT) ·
  staff 미존재 고객 404(customerScopeGate SELECT). 요청 4건 23ms.
  임베딩·AI 힌트 쓰기 훅은 `NODE_ENV=test` 기본 off로 자동 침묵(스파이크 로그 실측).

### 실측에서 잡힌 함정 (하네스가 전부 흡수)

| # | 함정 | 처리 |
|---|---|---|
| ① | 0014 등 breakpoint 없는 다문장 마이그레이션 — PGlite extended protocol이 42601 | simple protocol(`exec`)로 파일 단위 적용 |
| ② | identity `maxValue` bigint max가 JS number 정밀도로 `…776000` 반올림 → 22003 | DDL 문자열에서 리터럴 교정 |
| ③ | introspect 아티팩트: text 컬럼 인덱스에 `int8_ops` opclass → 42804 | CREATE INDEX에서 opclass 토큰 제거(기본 opclass로) |
| ④ | `uuid_generate_v7()` master 전용 함수 | 스텁(위 2) |

## 마찰면 — 이관 시 파일별로 확인할 것

- **`executor.execute()` 배열 소비 4곳**(embeddings.ts·catalog-admin.ts×2·dealer-profiles.ts):
  postgres-js는 배열(RowList), PGlite 드라이버는 `{rows}` 객체를 반환한다. 이 경로를 지나는
  파일을 이관하려면 **드라이버 무관 정규화 헬퍼**(`Array.isArray(r) ? r : r.rows`)를 먼저
  깐다. 1단계 이관 대상이 이 4곳을 안 지나면 보류.
- **PGlite는 단일 세션** — 병렬 트랜잭션(Promise.all에 `.transaction()` 2개)은 BEGIN/COMMIT이
  interleave돼 깨진다. 테스트는 순차 실행이라 실제 위험은 낮지만 **하네스 규칙으로 명문화**.
- **halfvec**(`searchEmbeddings`)·실 Gemini(assistant) — 이관 불가 축, registry 잔류.
- **DB 트리거·RLS 부재** — 알림 트리거가 없으니 guard 불필요(무해). 트리거 행위 자체를
  검증하는 테스트(notify-gate.test.ts)는 registry 잔류.

## 이관 원칙과 1단계 대상

**원칙**: 파일 단위로 ①PGlite에서 실측 통과 ②로컬 실 master에서도 통과(회귀 0) 확인 후
registry에서 제거한다. 실측 없이 일괄 제거 금지(fail-closed 설계 유지 — 새 DB 의존 테스트
등록 규칙은 불변, 다만 "hermetic으로 돌 수 있으면 등록하지 않아도 된다"가 새로 열린다).

1단계 = 배치 16·`#463` 리뷰가 지목한 정확한 축(≈12파일):

| 축 | 파일 |
|---|---|
| 권한 | `middleware/role-gate.test.ts` · `routes/customers.quote-access.test.ts` · `routes/customers.role-scope.test.ts` · `routes/inbox-role-gate.test.ts` · `routes/dealer.role-gate.test.ts` |
| 파기 | `routes/customers.delete.test.ts` · `db/queries/account-deletion.test.ts` · `db/queries/deletion-jobs.test.ts` |
| 돈 | `routes/customers.settlement.test.ts`(마스킹 **배선** — 배치 16이 "2층 중 아래층만 걸림"으로 지목한 그 층) · `db/queries/reports.revenue-basis.test.ts` |
| 전이 | `db/queries/quote-requests.confirm.test.ts`(`#465` 가드) · `routes/customers.push.test.ts` |

이관 불가로 판정된 파일은 이 문서에 사유를 남긴다. 2단계 이후(별도 세션)로 남는 것:
customers.send·app-account-deletion(오케스트레이터)·catalog 승인 축(409 드리프트·batch_update_sort_order
스텁 필요)·나머지 라우트 통합.

## 한계 (알고 수용)

- ⓐ **public·catalog 미러 드리프트**: 앱 팀이 실 스키마를 바꿔도 미러 기반 PGlite는 초록일
  수 있다. dual-mode(로컬 test:server = 실 master)가 이 축을 잡고, 미러 자체의 갱신 규약은
  기존과 동일(`db:pull:catalog` 등).
- ⓑ **실 데이터 전제 테스트는 영구 이관 불가**(reports.test.ts 실 집계·embedding 코퍼스·
  fixture-residue·clock guard) — registry의 존재 이유가 그대로 남는다.
- ⓒ PGlite에는 앱 팀 트리거·RLS·pg_net이 없다 — 그 행위는 로컬 test:server 몫.

## 검증 계획

- 표준 8종 + **pure 러너 로컬 실행**(`bun run test:pure` — `--env-file=/dev/null`이라 CI 동형).
- 이관 파일 각각 로컬 `test:server` 재실행(실 master 모드 회귀 0, 알림 4테이블 무접촉 확인).
- **변이 실증 최소 2건**: 게이트 배선 1건(예: settlement 권한) + 전이 가드 1건을 제거해
  `test:pure`가 RED가 되는지 — "CI에서 빨개진다"가 이 설계의 존재 이유이므로 이것이 완료 조건.

## ✅ 1단계 이행 결과 (2026-08-07 같은 세션 — 12파일 전량 이관 완료)

- **pure 스위트 295 → 412**(+117 — 권한·파기·돈·전이 그물 전부 CI 진입), exit 0.
  실 master 모드(dual)에서도 같은 12파일 **117/117** + `check:residue` 잔재 0.
- **변이 실증 3종 전부 RED**(주입 → `test:pure` RED 확인 → 원복):
  ①정산 라우트 권한 개방(admin→+manager) → settlement manager 403 케이스 RED
  ②`#465` 발송 후 역행 차단 조건 제거 → confirm status=completed 케이스 RED
  ③`purgeCustomerCore` WHERE 제거(배치 16의 "CI 8단계 전량 통과" 변이) → RED.
  단 ③을 잡은 층은 행위 그물이 아니라 `delete-where-guard` tripwire다 — hermetic에서도
  "내 고객이 지워졌는가" 단언은 전량 삭제와 구분 불가(2층 방어가 둘 다 CI에 있는 게 설계 의도).
- **실측 함정 추가 2건**(설계 시점 미예측):
  - ⚠️ **PGlite를 닫지 않으면 0 fail이어도 프로세스 exit 99**(bun run·bun test 동일 — 스파이크
    때 `$?`를 안 봐서 설계 단계에서 놓쳤다). 해소 = bunfig `[test].preload`의 전역 teardown
    (`test-utils/test-teardown.ts`) — preload의 afterAll은 **전체 런 기준 마지막 1회**라(실측)
    파일 경계를 넘는 싱글톤과 공존한다.
  - ⚠️ **`fixture-codes` 판별자 회귀**: 실 DB 테스트 판별이 `getDefaultDb` 문자열 포함이라,
    이관 파일이 그 문자열을 잃으면서 코드 리터럴 스캔에서 빠졌다 → 판별자에 `getTestDb` 추가
    (dual-mode는 로컬에서 여전히 실 master에 쓴다).
- 하네스에 hermetic 전용 시드 3종: `상담사테스트` profile(정확히 1행 계약) + 미연결 profile 2 +
  최소 catalog(브랜드·모델·트림, 확정 할인 포함 — 딜러 마스킹 role 대조 성립).
  profiles INSERT는 `profiles-write-guard`에 명시 예외 등록(DATABASE_URL 부재 모드 전용 —
  실 master에 물리적으로 닿을 수 없음).
- `execute()` 배열 소비 정규화 = `toRows`(client.ts) — embeddings·catalog-admin·dealer-profiles
  3곳 적용(postgres-js 동작 불변).

**2단계 후보**(이 문서 "이관 원칙" 유지 — 파일별 실측 후 registry 제거): customers.send ·
app-account-deletion · account-deletions(라우트) · catalog 승인 축(`batch_update_sort_order` 스텁
필요) · consultations · me · staff · 나머지 라우트 통합.
