# 앱 견적요청 승격 갭 메우기 구현 계획 (2026-07-04)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 태스크별 TDD·검증·커밋. 체크박스로 추적.

**Goal:** 앱 견적요청 승격 시 조건 전체 prefill(기간·보증금/선수금/선납금·비율/금액) + 카드 % 병기 + 견적함 앱 출처 배지 + 니즈 카드 "견적 보기" 전환 + 워크벤치 가격 state 잔상 픽스.

**Spec:** `ref/specs/2026-07-04-crm-quote-request-prefill-gaps-design.md` (도메인 규칙 표·시드 규칙 — 함께 읽을 것)

**브랜치:** `feature/quote-request-prefill-gaps` (main에서 분기)

## 고정 설계 결정 (구현자 재량 아님)

1. 시드 규칙(스펙 표 그대로): lease/rent+deposit→보증금 행, lease/rent+advance→선수금 행, installment+prepayment→선수금 행(금액)+라벨 "선납금", cash/무타입→시드 없음. **비율>0이면 % 모드+비율값**(금액 무시 — CRM 최종가 기준 재계산 정합), 비율 0·금액>0이면 금액 모드+`formatMoney` 값.
2. 기간은 `[12,24,36,48,60]`에 있을 때만 시드(밖이면 60 유지).
3. 시드 로직은 **순수 함수로 추출해 TDD**: `client/src/lib/quote-request-seed.ts` `seedScenarioCardFromRequest(prefill)` — React/DOM 무접촉.
4. "선납금" 라벨 전환은 **구매방식(할부) 기준**이며 워크벤치 카드 선수금 행 + 앱카드 섹션3 선수금 행 양쪽(모델 필드 `downPaymentRowLabel`로 SSOT).
5. promotedQuoteIds는 **최신 승격 견적 우선(created_at desc)** 정렬. 니즈 카드 "견적 보기"는 `ids[0]`을 quoteList에서 찾아 `openEditQuote`, **미발견 시 폴백=기존 "견적 작성" 동작**(캐시 불일치 안전).
6. 견적함 배지 클래스는 `quote-source-app-badge`(kim-* 금지), note "수기 입력 조건" 불변.
7. 가격 리셋 = `setPricingInputs(emptyQuotePricing); setPricing(computePricing(emptyQuotePricing));`를 3경로(openNewWorkbench/openWorkbenchForQuoteRequest/resetQuoteWorkbench)에 추가.

## 공통 검증

`bun run typecheck` 0 · `bun run lint` 0 · `bun run test:unit` · `bun run test:server`(실 master — try/finally 원복) · 큰 변경 시 `bun run build`. 커밋 끝 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, **[skip ci] 토큰 금지**.

---

### Task 1: [서버] 단건 prefill 필드 확장 + promotedQuoteIds (TDD)

**Files:** `src/db/queries/quote-requests.ts` · `src/routes/quote-requests.ts`(타입 통과 확인만) · Test: `src/routes/quote-requests.test.ts`(기존 파일 — 없으면 customers.test.ts 하네스 패턴으로 신설)

- [ ] **RED**: 테스트 2건 — ①`GET /api/quote-requests/:id` 응답에 `period/depositType/depositRatio/rentalDeposit` 포함(실데이터 중 deposit_ratio>0 행 1건 조회해 값 단언 — 예: `SELECT id FROM public.quote_requests WHERE deposit_ratio > 0 LIMIT 1`을 테스트 안에서 조회 후 그 행으로 검증, 쓰기 없음) ②승격 견적 2건을 같은 요청에 만들고(`createQuote`+sourceQuoteRequestId, try/finally 삭제) 목록 응답의 해당 행 `promotedQuoteIds`가 [최신, 이전] 순서 + `promotedQuoteCount`=2.
- [ ] **구현**:
  - `getQuoteRequestDetail` select에 `period: quoteRequests.period, depositType: quoteRequests.depositType, depositRatio: quoteRequests.depositRatio, rentalDeposit: quoteRequests.rentalDeposit` 추가, 반환 타입 `QuoteRequestDetail` 동기 확장.
  - `quoteRequestBaseSelect`에 `depositRatio` 추가 + `AppQuoteRequestRow`에 `depositRatio: number | null` + row 매핑.
  - promo 조회를 `{ id: quotes.id, sourceId: quotes.sourceQuoteRequestId, createdAt: quotes.createdAt }`로 확장 → `promoIdsByReq = Map<string, string[]>`(createdAt desc 정렬 후 push) → row에 `promotedQuoteIds: promoIdsByReq.get(r.id) ?? []`(기존 promotedQuoteCount 유지).
- [ ] **검증·커밋**: `feat(crm): 견적요청 단건 조건 필드 + promotedQuoteIds(최신순) — 승격 prefill/견적 보기 데이터층`

### Task 2: [클라 lib] 어댑터 확장 + % 병기 + 시드 순수 함수 (TDD)

**Files:** `client/src/lib/quote-requests.ts` · Create: `client/src/lib/quote-request-seed.ts` + `.test.ts` · Modify: 기존 어댑터 테스트(있으면 픽스처 갱신)

- [ ] **RED**: `quote-request-seed.test.ts` — 시드 규칙 전 케이스:

```ts
import { describe, expect, it } from "vitest";
import { seedScenarioCardFromRequest } from "./quote-request-seed";

const base = { period: 60, depositType: null as string | null, depositRatio: 0, rentalDeposit: 0, purchaseMethod: "운용리스" };

describe("seedScenarioCardFromRequest", () => {
  it("리스+보증금 비율: % 모드+비율값(금액 무시 — 최종가 재계산 정합)", () => {
    const s = seedScenarioCardFromRequest({ ...base, depositType: "deposit", depositRatio: 20, rentalDeposit: 11800000 });
    expect(s).toEqual({ termMonths: 60, depositMode: "percent", depositValue: "20", downPaymentMode: null, downPaymentValue: null });
  });
  it("리스+선수금 금액만: 선수금 행 금액 모드+콤마 포맷", () => {
    const s = seedScenarioCardFromRequest({ ...base, depositType: "advance", depositRatio: 0, rentalDeposit: 5000000 });
    expect(s).toEqual({ termMonths: 60, depositMode: null, depositValue: null, downPaymentMode: "amount", downPaymentValue: "5,000,000" });
  });
  it("할부+선납금: 선수금 행 금액 시드(라벨 전환은 표시층 책임)", () => {
    const s = seedScenarioCardFromRequest({ ...base, purchaseMethod: "할부", depositType: "prepayment", rentalDeposit: 3000000 });
    expect(s.downPaymentMode).toBe("amount");
    expect(s.downPaymentValue).toBe("3,000,000");
    expect(s.depositMode).toBeNull();
  });
  it("일시불/무타입/값 0: 초기비용 시드 없음", () => {
    expect(seedScenarioCardFromRequest({ ...base, purchaseMethod: "일시불" })).toEqual({ termMonths: 60, depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null });
    expect(seedScenarioCardFromRequest({ ...base, depositType: "deposit" }).depositMode).toBeNull(); // 비율·금액 둘 다 0
  });
  it("기간이 버튼 옵션 밖이면 null(60 유지)", () => {
    expect(seedScenarioCardFromRequest({ ...base, period: 72 }).termMonths).toBeNull();
    expect(seedScenarioCardFromRequest({ ...base, period: 36 }).termMonths).toBe(36);
  });
});
```

- [ ] **구현** `client/src/lib/quote-request-seed.ts`:

```ts
import { formatMoney } from "./quote-pricing";

// 앱 견적요청 조건 → 워크벤치 카드1 시드(순수). 도메인 규칙(스펙 표):
// lease/rent: deposit→보증금 행, advance→선수금 행. installment: prepayment→선수금 행(라벨 "선납금"은 표시층).
// 비율>0이면 % 모드(금액 무시 — CRM 최종가 기준 재계산 정합), 비율 0·금액>0이면 금액 모드. cash/무타입/0값은 시드 없음.
export type ScenarioCardSeed = {
  termMonths: number | null;
  depositMode: "percent" | "amount" | null;
  depositValue: string | null;
  downPaymentMode: "percent" | "amount" | null;
  downPaymentValue: string | null;
};

const TERM_OPTIONS = [12, 24, 36, 48, 60];

export function seedScenarioCardFromRequest(req: {
  period: number | null;
  depositType: string | null;
  depositRatio: number | null;
  rentalDeposit: number | null;
  purchaseMethod: string | null;
}): ScenarioCardSeed {
  const termMonths = req.period != null && TERM_OPTIONS.includes(req.period) ? req.period : null;
  const ratio = req.depositRatio ?? 0;
  const amount = req.rentalDeposit ?? 0;
  const mode: "percent" | "amount" | null = ratio > 0 ? "percent" : amount > 0 ? "amount" : null;
  const value = mode === "percent" ? String(ratio) : mode === "amount" ? formatMoney(amount) : null;
  const target: "deposit" | "downPayment" | null =
    req.depositType === "deposit" ? "deposit"
    : req.depositType === "advance" || req.depositType === "prepayment" ? "downPayment"
    : null;
  return {
    termMonths,
    depositMode: target === "deposit" ? mode : null,
    depositValue: target === "deposit" ? value : null,
    downPaymentMode: target === "downPayment" ? mode : null,
    downPaymentValue: target === "downPayment" ? value : null,
  };
}
```

- [ ] **어댑터 확장** `client/src/lib/quote-requests.ts`:
  - `QuoteRequestPrefill`에 `period/depositType/depositRatio/rentalDeposit`(서버 단건 응답 passthrough) 추가, `fetchQuoteRequestDetail` 매핑.
  - `AppQuoteRequestRow`/`AppQuoteRequest`에 `depositRatio`·`promotedQuoteIds: string[]` 추가.
  - depositLabel % 병기: `depositName` 뒤에 `(ratio%)`와 금액을 앱카드 문법으로 — 비율>0·금액>0 → `보증금 (20%) 1,180만원`(기존 `formatPriceRangeKorean` 유지), 금액만 → 기존, 비율만 → `보증금 (20%)`. 라벨 조립을 **순수 헬퍼 `depositLabelOf(row)`로 추출**해 유닛 3케이스(quote-requests 어댑터 테스트 파일 — 없으면 신설).
- [ ] **검증·커밋**: `feat(crm): 승격 prefill 시드 순수 함수 + 카드 보증금 % 병기 + promotedQuoteIds 어댑터`

### Task 3: 워크벤치 시드 배선 + 가격 state 리셋 + 선납금 라벨

**Files:** `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts` · `client/src/components/customer-detail/QuoteWorkbench.tsx` · `client/src/components/AppCardPreview.tsx` · `client/src/lib/app-card.ts`(+test)

- [ ] **시드 배선** — `openWorkbenchForQuoteRequest`의 prefill 설정부에서 `const seed = seedScenarioCardFromRequest({ ...detail, purchaseMethod: detail.purchaseMethod });` 후:
  - `setManualQuoteCards([{ ...emptyQuoteConditionCards[0], depositMode: seed.depositMode ?? "none", depositValue: seed.depositValue ?? "0", downPaymentMode: seed.downPaymentMode ?? "none", downPaymentValue: seed.downPaymentValue ?? "0" }, emptyQuoteConditionCards[1], emptyQuoteConditionCards[2]]);`
  - `setManualDepositModes(seed.depositMode ? { "manual-condition-1": seed.depositMode } : {});` / `setManualDownPaymentModes(...)` 동형 / `setManualTermMonths(seed.termMonths ? { "manual-condition-1": seed.termMonths } : {});`
  - (기존 `setManualQuoteCards([...emptyQuoteConditionCards])`·`setManualTermMonths({})` 라인을 위 시드 버전으로 교체 — 이 함수 한정. mode 맵 2종도 리셋 겸 시드.)
- [ ] **가격 state 리셋** — 3경로(openNewWorkbench/openWorkbenchForQuoteRequest/resetQuoteWorkbench)에 `setPricingInputs(emptyQuotePricing); setPricing(computePricing(emptyQuotePricing));` 추가(이미 import돼 있는 심볼 확인).
- [ ] **선납금 라벨** — ①`app-card.ts`: `AppCardModel`에 `downPaymentRowLabel: string` 추가, `buildAppCardModel`에서 `input.purchaseMethod === "할부" ? "선납금" : "선수금"`, 테스트 1케이스(할부→선납금). ②`AppCardPreview` 섹션3 `<dt>선수금</dt>` → `<dt>{model.downPaymentRowLabel}</dt>`. ③`QuoteWorkbench.tsx` 카드 선수금 라벨 `<span>선수금</span>` → `<span>{solutionWorkbenchPurchaseMethod === "할부" ? "선납금" : "선수금"}</span>`.
- [ ] **검증·커밋**: `feat(crm): 승격 prefill 카드1 시드 배선 + 워크벤치 가격 state 잔상 리셋 + 할부 선납금 라벨`

### Task 4: 견적함 앱 출처 배지 + 니즈 카드 "견적 보기"

**Files:** `client/src/lib/quote-items.ts`(+test 픽스처) · `client/src/components/customer-detail/QuoteList.tsx` · `client/src/components/customer-detail/NeedsDashboard.tsx` · 부모 배선(`CustomerDetailPage.tsx`의 NeedsDashboard props 경로 — 실제 부모 확인) · CSS(`customer-detail-cards.css` 또는 견적함 도메인 파일 — 기존 배지 클래스 옆)

- [ ] **타입**: `CustomerDetailQuote`에 `sourceQuoteRequestId: string | null`(서버 select 전체라 이미 응답에 실림 — 선언만), `QuoteItem`에 `sourceQuoteRequestId?: string`, `toQuoteItem` passthrough. 테스트 픽스처 갱신.
- [ ] **배지**: QuoteList 카드에서 `quote.sourceQuoteRequestId` 존재 시 `<span className="quote-source-app-badge">앱 요청</span>`(위치: 기존 배지/노트 행 — 실물 구조 보고 결정). CSS는 기존 `kim-needs-request-badge` 톤 참고해 신규 클래스로.
- [ ] **니즈 카드**: NeedsDashboard의 요청 카드 — `req.promotedQuoteIds.length > 0`이면 기본 버튼 "견적 보기"(+기존 "견적 작성"은 보조 버튼으로 유지, 시각 위계 낮춤). "견적 보기" 핸들러는 부모에서 `quoteList.quotes.find((q) => q.id === ids[0])` → 있으면 `openEditQuote(quote)`, 없으면 기존 승격 플로우 폴백. props 배선은 기존 "견적 작성" 경로와 대칭.
- [ ] **검증·커밋**: `feat(crm): 견적함 앱 요청 출처 배지 + 니즈 카드 견적 보기 전환(중복 작성 방지)`

### Task 5: 통합 검증 + 브라우저 스모크 + PR

- [ ] 검증 4종 + build 전량 green.
- [ ] 브라우저 스모크(magiclink, dev 서버 재사용 — dev:api는 watch 없음이라 **백엔드 변경 반영 위해 재시작 필요**·사용자 서버면 요청): 김지안 요청별 ①보증금(deposit) 요청 "견적 작성" → 카드1 보증금 시드 확인 ②견적 있는 요청(530e) "견적 보기" → QT-2606-0007 수정 워크벤치 오픈 ③견적함 "앱 요청" 배지 ④새 견적 열 때 최종가 0원 시작(잔상 소멸) ⑤(비율>0 요청은 김지안에 없음 — 타 유저 요청으로 인박스에서 확인 or 시드 유닛으로 갈음, 보고서에 명시). **스모크 생성 견적 삭제 원복.**
- [ ] brief 갱신 + PR 생성(스크린샷·검증 기록) → 사용자 확인 후 머지.
