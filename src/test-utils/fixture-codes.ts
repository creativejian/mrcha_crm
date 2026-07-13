// 테스트 픽스처가 실 master DB에 만드는 business code 접두사 registry (SSOT).
//
// 배경(2026-07-10): `DATABASE_URL`이 공유 master라 테스트가 진짜 고객·견적 행을 만든다.
// 정상 종료하면 `afterAll`이 지우지만, **실행이 중간에 끊기면 행이 그대로 남는다.**
// 실제로 `customers.embed.test.ts`의 `CU-EMBRT-…/배선테스트`가 2026-07-09에 남아
// 이사님 고객 목록에 유령으로 떴다. 사람 눈이 아니라 기계가 잡아야 한다.
//
// 이 registry를 두 곳이 소비한다:
//   1. `fixture-codes.test.ts` — 테스트 소스가 registry 밖 접두사를 쓰면 실패(드리프트 차단)
//   2. `src/scripts/check-test-residue.ts` — 실 DB에 잔재가 남아 있으면 실패(`test:server` 말미)
//
// 새 픽스처 접두사를 쓰려면 **여기 먼저 등록한다.** 등록하지 않으면 ①이 실패하고,
// 등록만 하고 정리를 빠뜨리면 ②가 실패한다.

export const TEST_CUSTOMER_CODE_PREFIXES = [
  "CU-ADVID-",      // routes/customers.test.ts — advisorId 배정 키
  "CU-AIHINT-",     // db/queries/ai-hint-sources.test.ts · routes/customers.ai-hint.test.ts
  "CU-AITOOL-",     // db/queries/assistant-tools.test.ts
  "CU-CONSULT-",    // db/queries/consultations.test.ts (CU-CONSULT-RT- 도 여기 걸린다)
  "CU-DEL-",        // routes/customers.delete.test.ts
  "CU-EMBRT-",      // routes/customers.embed.test.ts  ← 2026-07-09 유령 행의 출처
  "CU-EMBSRC-",     // db/queries/embed-sources.test.ts
  "CU-EMBTEST-",    // db/queries/embeddings.test.ts
  "CU-MGST-",       // routes/customers.test.ts — 수동 관리 상태 영속(manage_status) 검증
  "CU-ROUTE-",      // routes/customers.test.ts
  "CU-RSEND-",      // routes/customers.send.test.ts
  "CU-SEND-",       // db/queries/customer-quotes.send.test.ts
  "CU-SMOKE",       // 사람이 손으로 만든 스모크 고객(브라우저 검증). 끝나면 지운다.
  "PUSH-TEST-",     // routes/customers.push.test.ts — ⚠️ 유일하게 CU- 규칙을 안 따른다
] as const;

// 실채번 픽스처의 **이름** registry — 서버가 코드를 채번해 접두사를 제어할 수 없는 테스트용.
// POST /api/customers 라우트 테스트(routes/customers.create.test.ts)가 첫 사례:
// 코드가 CU-YYMM-####(실채번)라 위 접두사 registry로는 잔재를 못 잡는다. 이름이 잡는다.
// "게이트검증"(middleware/role-gate.test.ts)은 403 전제라 평소엔 행을 안 만들지만,
// 게이트 변이/회귀 시 dealer POST가 실제 INSERT돼 잔재가 된다(2026-07-11 변이 검증 중 실발생).
export const TEST_CUSTOMER_NAMES: readonly string[] = [
  "수기등록테스트",   // routes/customers.create.test.ts — POST /api/customers 실채번
  "게이트검증",       // middleware/role-gate.test.ts — 403 전제(게이트 회귀 시만 실 행)
  "상담승격테스트",   // db/queries/consultations.test.ts — createCustomerFromConsultation 실채번 승격
  "라우트승격테스트", // routes/consultations.test.ts — POST create-customer 실채번 승격
  "승격배선테스트",   // routes/customers.embed.test.ts — 견적요청 승격이 실 profile 실명으로 만든 고객을 응답 직후 rename
];

// public.consultations 픽스처의 customer_name registry — 잔재 스캔 **report-only** 전용.
// (public은 앱 소유 — `--clean`이 지우지 않는다. #214 고아 앱 카드와 동일 소유권 경계.)
// 스캔은 접두사 매칭(prefixRegex)이라 동적 서픽스(`상담테스트-${uuid}`)도 잡는다.
// 원미래(2126) 픽스처는 이름과 무관하게 `created_at > now()` 절이 한 겹 더 잡는다.
export const TEST_CONSULTATION_NAMES: readonly string[] = [
  "상담테스트-",       // db/queries/consultations.test.ts insertConsultation 기본값
  "라우트테스트-",     // routes/consultations.test.ts insertConsultation 기본값
  "상담승격테스트",    // db/queries/consultations.test.ts 승격 케이스(위 고객명 registry와 동일 값)
  "라우트승격테스트",  // routes/consultations.test.ts 승격 케이스
  "AI힌트상담-",       // db/queries/ai-hint-sources.test.ts (원미래 2126)
  "AI힌트dismiss검증", // routes/customers.ai-hint.test.ts (원미래 2126)
  "도구테스트",        // db/queries/assistant-tools.test.ts
];

export const TEST_QUOTE_CODE_PREFIXES = [
  "QT-AIHINT-",     // db/queries/ai-hint-sources.test.ts
  "QT-AITOOL-",     // db/queries/assistant-tools.test.ts
  "QT-EMBSRC-",     // db/queries/embed-sources.test.ts — 변수(QUOTE_CODE)로 조립해 눈에 잘 안 띈다
  "QT-TEST-",       // routes/customers.test.ts, db/queries/advisor-quotes.test.ts
] as const;

export function isRegisteredCustomerCode(code: string): boolean {
  return TEST_CUSTOMER_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

export function isRegisteredQuoteCode(code: string): boolean {
  return TEST_QUOTE_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

// Postgres `~` 연산자용 앵커 정규식. `-`는 문자 클래스 밖이라 이스케이프 불필요하지만,
// 접두사에 정규식 메타문자가 섞이면 조용히 오작동하므로 방어한다.
export function prefixRegex(prefixes: readonly string[]): string {
  const escaped = prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `^(${escaped.join("|")})`;
}
