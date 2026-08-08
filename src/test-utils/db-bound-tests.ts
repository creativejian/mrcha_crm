// 실 DB(공유 master)·시크릿 없이는 못 도는 테스트 registry (SSOT) — CI 순수 러너의 **제외 목록**.
// 소비처: src/scripts/run-pure-tests.ts (CI `pure` step) — 여기 없는 src 테스트는 전부 CI에서 돈다.
//
// **fail-closed 설계**: 새 DB 의존 테스트를 여기 등록하지 않으면 CI가 env 없이 그 파일을 돌려
// 시끄럽게 실패한다. 포함 목록(등록해야 CI에 들어가는 방식)이었다면 새 순수 테스트가 조용히
// CI 밖에 남는다 — 0725 경량 정합성 체크가 잡은 "조용한 공백" 부류라 방향을 반대로 뒤집었다.
//
// 판별 기준은 추측이 아니라 **실측**이다: `.env.local`이 없는 깨끗한 worktree에서
// `bun test <파일>`이 도는가(2026-07-25 78파일 전수 실측). ⚠️ 레포 루트에서의 실행은 판별에
// 못 쓴다 — bun이 `.env.local`을 자동 로드해 DB 의존이 가려진다(ci.yml 헤더의 "env -i로는
// 부족" 경고와 같은 축). 재판별이 필요하면 `git worktree add <tmp> HEAD` + node_modules 심링크.
//
// 🟢 여기서 빠지는 새 경로(2026-08-07, CI 커버리지 seam — plan 2026-08-07-crm-ci-coverage-hermetic-db):
// `test-utils/hermetic-db.ts`(dual-mode: 로컬 = 실 master / CI = in-memory PGlite)로 이관하면
// env 없이 돌 수 있어 등록이 필요 없어진다. 권한·파기·돈·전이 축 12파일이 1단계로 이관됐다
// (배치 16 "진짜 발견" 해소). 이관 절차 = 파일에서 getDefaultDb()→getTestDb() 교체(+라우트는
// setTestDb 배선) 후 ①env 제거 실행 ②실 master 실행 양쪽 실측 — 실측 없이 여기서 빼지 말 것.

export const DB_BOUND_TEST_FILES: readonly string[] = [
  // ── 쿼리 레이어 — getDefaultDb()가 실 master에 직결 ─────────────────────────
  "src/db/queries/advisor-quotes.test.ts",
  "src/db/queries/ai-hint-sources.test.ts",
  "src/db/queries/app-user-link.test.ts",
  "src/db/queries/assistant-messages.test.ts",
  "src/db/queries/assistant-tools.test.ts",
  "src/db/queries/canonical-drift.test.ts", // 실 catalog 전수 스캔이 목적(읽기 전용 · 픽스처 0)
  "src/db/queries/catalog-admin.test.ts",
  "src/db/queries/catalog-counts.test.ts",
  "src/db/queries/consultations.test.ts",
  "src/db/queries/customer-delivery.test.ts",
  "src/db/queries/customer-quotes.send.test.ts",
  "src/db/queries/customers.create.test.ts",
  "src/db/queries/customers.settlement-exposure.test.ts",
  "src/db/queries/customers.next-delivery.test.ts",
  "src/db/queries/dealer-discounts.test.ts",
  "src/db/queries/dealer-profiles.test.ts",
  "src/db/queries/discount-adoptions.test.ts",
  "src/db/queries/embed-sources.test.ts",
  "src/db/queries/embeddings-meta.test.ts",
  "src/db/queries/embeddings.test.ts",
  "src/db/queries/quote-requests.test.ts",
  "src/db/queries/reports.test.ts", // 읽기 전용(픽스처 0)이지만 집계 대상이 실 master다
  "src/db/queries/staff.test.ts",
  "src/db/queries/vehicles.test.ts",
  "src/lib/promotion-embeds.test.ts",

  // ── 라우트 통합 — app.request()가 dbMiddleware를 지나므로 403 전제 케이스조차 DB가
  //    먼저 필요하다(미들웨어가 게이트보다 앞). assistant는 실 Gemini 라우팅 시도까지
  //    얹혀 있다(test:server 1회당 실 9콜 계측의 출처 — 배치 15 M7). ────────────
  "src/middleware/db.test.ts",
  "src/routes/assistant.test.ts",
  "src/routes/catalog.discount-adoptions.test.ts",
  "src/routes/catalog.test.ts",
  "src/routes/consultations.test.ts",
  "src/routes/content.test.ts",
  "src/routes/customers.ai-hint.test.ts",
  "src/routes/customers.create.test.ts",
  "src/routes/customers.delivery.test.ts",
  "src/routes/customers.embed.test.ts",
  "src/routes/customers.phone.test.ts",
  "src/routes/customers.test.ts",
  "src/routes/dealer.discounts.test.ts",
  "src/routes/quote-requests.test.ts",
  "src/routes/reports.test.ts",
  "src/routes/solution.test.ts",
  // ⚠️ hermetic 이관 **부적합**(2026-08-08 판정): 실 조직 데이터(스태프 profile·담당 고객 수)를
  // 전제로 목록을 훑어 대조하므로, 빈 hermetic DB에서는 루프가 0회 돌아 **공허하게 통과**한다
  // (그물이 사라지는 게 아니라 초록 거짓말이 된다 — reports.test.ts와 같은 부류).
  "src/routes/staff.test.ts",
  "src/routes/vehicles.test.ts",

  // ── 실 DB 불변식·가드 — 데이터/커넥션 자체가 검증 대상 ──────────────────────
  "src/db/updated-at-clock-guard.test.ts", // 소스 스캔 tripwire + 실 DB now() 단일값 단언 혼합
  "src/test-utils/embedding-model-consistency.test.ts", // crm.embeddings 실 코퍼스 대조
  "src/test-utils/fixture-residue.test.ts", // 실 DB 잔재 스캔이 목적
  "src/test-utils/notify-gate.test.ts", // 알림 가드 GUC — 실 트랜잭션 필요
];
