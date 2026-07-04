# 앱카드 4섹션 리디자인 구현 계획 (2026-07-04)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development로 태스크 단위 실행. 각 태스크는 TDD(RED→GREEN)·검증·커밋을 포함한다. 체크박스(`- [ ]`)로 추적.

**Goal:** CRM 견적 워크벤치의 앱카드 미리보기(AppCardPreview)를 이사님 확정 4섹션 상세 카드로 전면 확장하고, 카드가 요구하는 시나리오 확장 필드(금리·총비용 2종·출고전납입·자동차세·보조금)의 쓰기/읽기 경로와 발송 시 `valid_until=+7일` 자동 스탬프를 배선한다.

**Architecture:** 순수 조립 함수 `buildAppCardModel`(TDD)이 워크벤치 state 스냅샷 → 표시 라벨 모델로 변환하고, `AppCardPreview`는 그 모델만 렌더한다(현 구조 유지). 시나리오 확장 필드는 [서버 zod → insertScenarios → 클라 read 타입 → 워크벤치 입력/추출/prefill] 전 구간을 잇는다. guidance `keyPoint`(단일)는 `keyPoints[]`로 배열화하되 기존 jsonb 행은 클라 read normalizer로 흡수한다.

**Tech Stack:** Hono + drizzle(bun, 실 master DB) / React 19 + vitest / CSS는 `client/src/styles/` 도메인 파일.

**Spec:** `ref/specs/2026-07-04-crm-app-card-redesign-design.md` (갭 결정 ⓐ~ⓓ 포함 — 함께 읽을 것)

---

## 고정 설계 결정 (구현자 재량 아님)

1. **percent 병기 금액 환산 기준 = `finalVehiclePrice`**: `Math.round(finalVehiclePrice * v / 100)`. finalVehiclePrice가 0이면 `%`만 표기.
2. **섹션1 "총 비용" = `totalReturnCost` 우선, 없으면 `totalTakeoverCost`, 둘 다 없으면 "계산 후 안내"** (스펙의 "표시 규칙 구현 시 확정" 확정본).
3. **자동차세 null → "불포함"**(워크벤치 기본 토글과 일치), **보조금 false/null → "해당 없음"**.
4. 서브라인 옵션: 없으면 "추가옵션 없음", 있으면 `추가옵션 N개`. 섹션2 "추가 옵션" 행 = 옵션명 `", "` join(없으면 "없음").
5. **발송 전 프리뷰**: D-day = `"D-7 · 발송 시 시작"`, 푸터 = `"발송 전 미리보기"`. 발송 후 = valid_until 카운트다운(`D-N`/`만료됨`) + sentAt `yy/MM/dd HH:mm`.
6. **재발송 시 valid_until 재스탬프**(유효기간 리셋) — 의도된 동작(수정 후 재발송이 새 유효기간을 갖는 게 실무상 맞음).
7. keyPoint→keyPoints **하위호환은 클라 read normalize**(`normalizeQuoteGuidance`)로만. 서버 zod는 `keyPoints`만 받는다(클라가 항상 정규화 후 전송, 단일 배포라 옛 클라 없음).
8. 금리 입력은 소수점 보존: `parseInterestRate`(신규). 입력 요소에 `data-discount-unit="percent"`를 달아 jeff money 포맷터(천단위 콤마)를 우회한다(기존 % 입력과 동일 메커니즘).
9. 공채/탁송료/부대비용의 "(면제)/(불포함)" 병기는 **생략**(워크벤치 포함/불포함 토글이 미배선 장식 — 데이터 없는 장식 금지 원칙, #154와 동일 철학). 라벨+금액만.
10. 시나리오 결과 4필드(반납/인수 총비용·출고전납입·금리)와 보조금 금액의 **0 또는 빈값은 null로 저장**(가짜 0 방지).
11. 프리뷰 wrapper `.kim-app-card-preview` 클래스는 **유지**(워크벤치 grid 배치가 참조). 내부 마크업만 신규 `app-card-*` 문법. 워크벤치 폼 신규 클래스도 kim- 접두 금지(`guidance-list` 등). 구 `.kim-app-card` 계열 내부 룰은 dead가 되지만 **제거는 follow-up**(팀 관례 — 시각 회귀 0 원칙).
12. 섹션3 기간 라벨은 구매방식 중립인 **"계약 기간"**(디자인 원문 "리스기간"은 운용리스 전제 — 할부/일시불에도 안전한 라벨 선택).
13. CSS 색상(hero 녹색·블록 파랑·서비스 주황)은 1차 근사값으로 넣고, **Task 9 브라우저 대조에서 디자인 4장 기준으로 보정**한다.

## File Structure

| 파일 | 작업 |
|---|---|
| `src/routes/customers.ts` | zod: quoteScenarioBody 7필드 추가, quoteGuidanceSchema keyPoints 배열화 |
| `src/db/queries/customer-quotes.ts` | ScenarioInput 7필드·insertScenarios 영속·headerSet valid_until 스탬프·QuoteGuidanceInput 동기화 |
| `src/routes/customers.test.ts` | 시나리오 확장 필드 왕복·valid_until 스탬프 테스트(+기존 guidance 픽스처 갱신) |
| `client/src/data/quote-guidance.ts` | QuoteGuidance keyPoints[]·normalizeQuoteGuidance·sanitizeQuoteGuidance(신규) |
| `client/src/data/quote-guidance.test.ts` | 신규 — normalizer/sanitizer 유닛 |
| `client/src/lib/customer-quotes.ts` | 클라 ScenarioInput 7필드·parseInterestRate |
| `client/src/lib/customer-quotes.test.ts` | 신규 — parseInterestRate 유닛 |
| `client/src/lib/quote-items.ts` | CustomerDetailScenario 7필드·guidance normalize 소비 |
| `client/src/lib/quote-items.test.ts` | guidance 픽스처 갱신 |
| `client/src/lib/app-card.ts` | AppCardModel/buildAppCardModel v2 전면 재작성 |
| `client/src/lib/app-card.test.ts` | v2 유닛 재작성 |
| `client/src/components/AppCardPreview.tsx` | 4섹션 리라이트 |
| `client/src/styles/customer-detail-preview.css` | app-card-* 신규 룰 append |
| `client/src/styles/customer-detail-cards.css` | guidance-list 신규 룰 append |
| `client/src/components/customer-detail/quote-workbench-meta.ts` | ManualCard subsidyAmount·EditScenario 확장 |
| `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts` | appCardModel 입력 확장·extract 확장·prefill 확장·자동차세/보조금 state |
| `client/src/components/customer-detail/QuoteWorkbench.tsx` | 추가안내 동적 입력·시나리오 카드 입력 배선 |

## 공통 명령

- 프론트 유닛: `bun run test:unit <파일경로>` (vitest)
- 백엔드: `bun run test:server` (bun:test, `--env-file=.env.local` **실 master DB — 테스트 데이터는 try/finally로 반드시 삭제**)
- 검증 4종: `bun run typecheck` · `bun run lint`(0 problems) · `bun run test:unit` · `bun run test:server`, 큰 변경은 `bun run build`
- 브랜치: `feature/app-card-redesign` (main에서 분기, 태스크마다 커밋)

---

### Task 0: 브랜치 생성

- [ ] `git checkout -b feature/app-card-redesign` (main 최신 확인: `git pull --ff-only` 선행)

### Task 1: [서버] 시나리오 확장 필드 쓰기 경로

**Files:**
- Modify: `src/routes/customers.ts` (quoteScenarioBody, ~line 111)
- Modify: `src/db/queries/customer-quotes.ts` (ScenarioInput ~line 60, insertScenarios ~line 242)
- Test: `src/routes/customers.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `src/routes/customers.test.ts`의 "견적 다중 시나리오(#4c-3a)" 테스트(line 692) 아래에 추가. 하네스는 기존 테스트와 동일(makeTestAuth/createApp/try-finally 삭제):

```ts
test("견적 시나리오 확장 필드(앱카드): 금리·총비용·자동차세·보조금 왕복", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | null = null;
  try {
    const created = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({
        entryMode: "manual", status: "작성중",
        scenarios: [{
          scenarioNo: 1, isSaved: true, purchaseMethod: "운용리스", lender: "우리금융캐피탈",
          monthlyPayment: "1473200", termMonths: 60,
          carTaxIncluded: false, subsidyApplicable: true, subsidyAmount: "1000000",
          totalReturnCost: "167652170", totalTakeoverCost: "182000000", dueAtDelivery: "3000000",
          interestRate: "5.32",
        }],
      }),
    });
    expect(created.status).toBe(201);
    quoteId = ((await created.json()) as { id: string }).id;
    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; scenarios: Array<Record<string, unknown>> }>;
    };
    const sc = detail.quotes.find((x) => x.id === quoteId)!.scenarios[0];
    expect(sc.carTaxIncluded).toBe(false);
    expect(sc.subsidyApplicable).toBe(true);
    expect(sc.subsidyAmount).toBe("1000000");
    expect(sc.totalReturnCost).toBe("167652170");
    expect(sc.totalTakeoverCost).toBe("182000000");
    expect(sc.dueAtDelivery).toBe("3000000");
    expect(sc.interestRate).toBe("5.32");
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});
```

- [ ] **Step 2: 실패 확인** — `bun run test:server` → 새 테스트가 FAIL(신규 필드가 null로 반환 — zod strip + insert 미영속). 나머지 green 확인.
- [ ] **Step 3: 최소 구현** — 3곳:

`src/routes/customers.ts` quoteScenarioBody 끝(`mileageValue` 다음)에:
```ts
  // 앱카드 4섹션(2026-07-04): 계산엔진 연결 전 수기 입력 결과 필드 + 자동차세/보조금
  carTaxIncluded: z.boolean().nullable().optional(),
  subsidyApplicable: z.boolean().nullable().optional(),
  subsidyAmount: z.string().nullable().optional(),
  totalReturnCost: z.string().nullable().optional(),
  totalTakeoverCost: z.string().nullable().optional(),
  dueAtDelivery: z.string().nullable().optional(),
  interestRate: z.string().nullable().optional(),
```

`src/db/queries/customer-quotes.ts` `ScenarioInput`(line 60~71) 끝에 동형 7필드(`boolean | null` / `string | null`, 전부 optional) 추가.

같은 파일 `insertScenarios` values(line 242~259) `mileageValue` 다음에:
```ts
      carTaxIncluded: sc.carTaxIncluded ?? null,
      subsidyApplicable: sc.subsidyApplicable ?? null,
      subsidyAmount: sc.subsidyAmount ?? null,
      totalReturnCost: sc.totalReturnCost ?? null,
      totalTakeoverCost: sc.totalTakeoverCost ?? null,
      dueAtDelivery: sc.dueAtDelivery ?? null,
      interestRate: sc.interestRate ?? null,
```

- [ ] **Step 4: 통과 확인** — `bun run test:server` 전량 green.
- [ ] **Step 5: 커밋** — `git commit -m "feat(crm): 견적 시나리오 확장 필드 쓰기 경로 — 금리·총비용·출고전납입·자동차세·보조금 (앱카드 리디자인 1)"`

### Task 2: [서버] 발송 시 valid_until = sent_at + 7일 스탬프 (갭ⓐ)

**Files:**
- Modify: `src/db/queries/customer-quotes.ts:86-89` (headerSet)
- Test: `src/routes/customers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**:

```ts
test("견적 발송(갭ⓐ): PATCH appStatus=sent → valid_until = sent_at + 7일 자동 스탬프", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  let quoteId: string | null = null;
  try {
    const created = await app.request(`/api/customers/${cid}/quotes`, {
      method: "POST", headers: h, body: JSON.stringify({ entryMode: "manual", status: "작성중" }),
    });
    quoteId = ((await created.json()) as { id: string }).id;
    const patched = await app.request(`/api/customers/${cid}/quotes/${quoteId}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ appStatus: "sent" }),
    });
    expect(patched.status).toBe(200);
    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
      quotes: Array<{ id: string; sentAt: string | null; validUntil: string | null }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.sentAt).not.toBeNull();
    expect(q.validUntil).not.toBeNull();
    const gapDays = (new Date(q.validUntil!).getTime() - new Date(q.sentAt!).getTime()) / 86_400_000;
    expect(gapDays).toBeCloseTo(7, 5);
  } finally {
    if (quoteId) await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});
```

- [ ] **Step 2: 실패 확인** — `bun run test:server` → validUntil null로 FAIL.
- [ ] **Step 3: 최소 구현** — `headerSet`의 appStatus 분기 교체:

```ts
  if (p.appStatus !== undefined) {
    set.appStatus = p.appStatus;
    if (p.appStatus === "sent") {
      // 발송 시 서버가 시각 확정 + 유효기간 7일 자동 스탬프(갭ⓐ, 2026-07-04 이사님 결정).
      // 재발송도 재스탬프(유효기간 리셋 — 수정 후 재발송이 새 유효기간을 갖는 의도된 동작).
      const sentAt = new Date();
      set.sentAt = sentAt;
      set.validUntil = new Date(sentAt.getTime() + 7 * 86_400_000);
    }
  }
```

- [ ] **Step 4: 통과 확인** — `bun run test:server` 전량 green. (견적함 D-day 라벨은 기존 `validLabelFromUntil`이 valid_until을 이미 소비 — 발송 즉시 목록에 D-7 표시가 자동으로 살아난다.)
- [ ] **Step 5: 커밋** — `feat(crm): 견적 발송 시 valid_until=+7일 자동 스탬프 (앱카드 갭ⓐ)`

### Task 3: guidance keyPoints 배열화 + normalizer (갭ⓑ 데이터층)

**Files:**
- Modify: `client/src/data/quote-guidance.ts`
- Create: `client/src/data/quote-guidance.test.ts`
- Modify: `src/routes/customers.ts:127-134` (quoteGuidanceSchema) · `src/db/queries/customer-quotes.ts:7-15` (QuoteGuidanceInput) · `src/db/schema.ts:213` (주석)
- Modify(컴파일 픽스): `client/src/components/customer-detail/QuoteWorkbench.tsx:507-512` · `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts`(openEditQuote guidance 2곳) · `client/src/lib/quote-items.ts`(toQuoteItem guidance) · `client/src/lib/quote-items.test.ts:135` · `src/routes/customers.test.ts:400` 픽스처

- [ ] **Step 1: 실패 테스트 작성** — `client/src/data/quote-guidance.test.ts` 신규:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_QUOTE_GUIDANCE, normalizeQuoteGuidance, sanitizeQuoteGuidance } from "./quote-guidance";

describe("normalizeQuoteGuidance", () => {
  it("legacy keyPoint(단일 문자열)를 keyPoints 배열로 변환한다", () => {
    const g = normalizeQuoteGuidance({ deliveryComment: "a", stockNotice: "b", expectedDelivery: "c", customerRegion: "d", keyPoint: "핵심", recommendReason: "r", services: ["s"] });
    expect(g?.keyPoints).toEqual(["핵심"]);
  });
  it("keyPoints가 이미 있으면 그대로, 빈 legacy keyPoint는 빈 배열", () => {
    expect(normalizeQuoteGuidance({ ...DEFAULT_QUOTE_GUIDANCE, keyPoints: ["a", "b"] })?.keyPoints).toEqual(["a", "b"]);
    expect(normalizeQuoteGuidance({ deliveryComment: "a", stockNotice: "b", expectedDelivery: "c", customerRegion: "d", keyPoint: "", recommendReason: "", services: [] })?.keyPoints).toEqual([]);
  });
  it("null/undefined는 null", () => {
    expect(normalizeQuoteGuidance(null)).toBeNull();
    expect(normalizeQuoteGuidance(undefined)).toBeNull();
  });
});

describe("sanitizeQuoteGuidance", () => {
  it("빈/공백 keyPoints·services를 제거하고 trim한다", () => {
    const g = sanitizeQuoteGuidance({ ...DEFAULT_QUOTE_GUIDANCE, keyPoints: [" a ", "", "  "], services: ["s1 ", ""] });
    expect(g.keyPoints).toEqual(["a"]);
    expect(g.services).toEqual(["s1"]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `bun run test:unit client/src/data/quote-guidance.test.ts` → 함수 미존재 FAIL.
- [ ] **Step 3: 구현** — `client/src/data/quote-guidance.ts`:
  - `QuoteGuidance.keyPoint: string` → `keyPoints: string[]`
  - `DEFAULT_QUOTE_GUIDANCE.keyPoint: …[0]` → `keyPoints: [QUOTE_GUIDANCE_OPTIONS.keyPoint[0]]` (OPTIONS의 `keyPoint` 키 이름은 제안 목록이므로 유지)
  - 추가:

```ts
// DB jsonb 하위호환 read normalizer: 구행(keyPoint 단일 문자열) → keyPoints 배열. null/undefined는 null.
export function normalizeQuoteGuidance(
  raw: (Partial<QuoteGuidance> & { keyPoint?: string }) | null | undefined,
): QuoteGuidance | null {
  if (raw == null) return null;
  const keyPoints = Array.isArray(raw.keyPoints)
    ? raw.keyPoints
    : (raw.keyPoint ?? "").trim() ? [(raw.keyPoint ?? "").trim()] : [];
  return {
    deliveryComment: raw.deliveryComment ?? "",
    stockNotice: raw.stockNotice ?? "",
    expectedDelivery: raw.expectedDelivery ?? "",
    customerRegion: raw.customerRegion ?? "",
    keyPoints,
    recommendReason: raw.recommendReason ?? "",
    services: Array.isArray(raw.services) ? raw.services : [],
  };
}

// 저장 직전 정리: 동적 입력칸(+)의 빈 줄 제거 + trim (빈 문자열 영속 방지).
export function sanitizeQuoteGuidance(g: QuoteGuidance): QuoteGuidance {
  return {
    ...g,
    keyPoints: g.keyPoints.map((k) => k.trim()).filter(Boolean),
    services: g.services.map((s) => s.trim()).filter(Boolean),
  };
}
```

- [ ] **Step 4: 소비처 동기화(typecheck 강제 검출)** —
  - 서버 `quoteGuidanceSchema`: `keyPoint: z.string()` → `keyPoints: z.array(z.string())` / `QuoteGuidanceInput`: `keyPoint: string` → `keyPoints: string[]` / `schema.ts:213` 주석의 keyPoint → keyPoints
  - `useQuoteWorkbench.ts` `openEditQuote`(line 966, 981): `dq.guidance ?? null` → `normalizeQuoteGuidance(dq?.guidance) ?? null`, `setGuidance(dq?.guidance ?? DEFAULT_QUOTE_GUIDANCE)` → `setGuidance(normalizeQuoteGuidance(dq?.guidance) ?? DEFAULT_QUOTE_GUIDANCE)` (+import)
  - `quote-items.ts` `toQuoteItem`: `guidance: q.guidance ?? undefined` → `guidance: normalizeQuoteGuidance(q.guidance) ?? undefined`
  - `QuoteWorkbench.tsx` 핵심포인트 select **임시 최소 수정**(Task 7에서 동적 UI로 교체): `value={guidance.keyPoints[0] ?? ""}` / onChange `setGuidance((g) => ({ ...g, keyPoints: [v, ...g.keyPoints.slice(1)] }))`
  - 테스트 픽스처 2곳: `quote-items.test.ts:135` `keyPoint: "e"` → `keyPoints: ["e"]` / `customers.test.ts:400` `keyPoint: "…"` → `keyPoints: ["초기 부담을 낮추는 조건입니다."]`
- [ ] **Step 5: 통과 확인** — `bun run typecheck` 0 · `bun run test:unit` 전량 · `bun run test:server` 전량 green.
- [ ] **Step 6: 커밋** — `feat(crm): 견적 guidance keyPoint→keyPoints 배열화 + read normalizer(하위호환)·sanitizer (앱카드 갭ⓑ 데이터층)`

### Task 4: [클라] read/write 타입 확장 + parseInterestRate

**Files:**
- Modify: `client/src/lib/customer-quotes.ts` (ScenarioInput ~line 113)
- Modify: `client/src/lib/quote-items.ts` (CustomerDetailScenario ~line 53)
- Modify: `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts` (persistWorkbenchQuote optimistic displayScenarios ~line 752)
- Create: `client/src/lib/customer-quotes.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `client/src/lib/customer-quotes.test.ts` 신규:

```ts
import { describe, expect, it } from "vitest";
import { parseInterestRate } from "./customer-quotes";

describe("parseInterestRate", () => {
  it("소수점을 보존한다: '5.32%' → '5.32'", () => {
    expect(parseInterestRate("5.32%")).toBe("5.32");
    expect(parseInterestRate("5.32")).toBe("5.32");
  });
  it("0/빈값/숫자 아님은 null", () => {
    expect(parseInterestRate("0")).toBeNull();
    expect(parseInterestRate("")).toBeNull();
    expect(parseInterestRate("-")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `bun run test:unit client/src/lib/customer-quotes.test.ts` FAIL.
- [ ] **Step 3: 구현** — `client/src/lib/customer-quotes.ts`:

```ts
// "5.32%"/"5.32" → "5.32"(소수점 보존, numeric interest_rate은 문자열 전송). 0 이하/숫자 아님은 null.
export function parseInterestRate(raw: string): string | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}
```

같은 파일 `ScenarioInput`에 서버(Task 1)와 동형 7필드 추가:
```ts
  // 앱카드 4섹션(2026-07-04): 계산엔진 연결 전 수기 입력 결과 필드 + 자동차세/보조금
  carTaxIncluded?: boolean | null;
  subsidyApplicable?: boolean | null;
  subsidyAmount?: string | null;
  totalReturnCost?: string | null;
  totalTakeoverCost?: string | null;
  dueAtDelivery?: string | null;
  interestRate?: string | null;
```

`client/src/lib/quote-items.ts` `CustomerDetailScenario`에 non-optional nullable로 추가(서버 getCustomer는 `select()` 전체라 이미 응답에 실려 있음 — 타입 선언만):
```ts
  carTaxIncluded: boolean | null;
  subsidyApplicable: boolean | null;
  subsidyAmount: string | null;
  totalReturnCost: string | null;
  totalTakeoverCost: string | null;
  dueAtDelivery: string | null;
  interestRate: string | null;
```

`useQuoteWorkbench.ts` optimistic `displayScenarios` 매핑(line 752~768)에 7필드 passthrough 추가(`carTaxIncluded: sc.carTaxIncluded ?? null,` …) — typecheck가 누락을 강제 검출한다.

- [ ] **Step 4: 통과 확인** — 유닛 green + `bun run typecheck` 0.
- [ ] **Step 5: 커밋** — `feat(crm): 클라 시나리오 확장 필드 타입 + parseInterestRate (앱카드 리디자인 4)`

### Task 5: buildAppCardModel v2 (TDD 전면 재작성)

**Files:**
- Modify: `client/src/lib/app-card.ts` (전면 교체)
- Modify: `client/src/lib/app-card.test.ts` (전면 교체)

- [ ] **Step 1: 실패 테스트 작성** — `app-card.test.ts` 전면 교체:

```ts
import { describe, expect, it } from "vitest";
import { buildAppCardModel, type AppCardModelInput } from "./app-card";
import { DEFAULT_QUOTE_GUIDANCE } from "@/data/quote-guidance";

const NOW = new Date("2026-07-04T12:00:00+09:00").getTime();

const base: AppCardModelInput = {
  brandName: "BMW",
  modelName: "X7",
  trimName: "xDrive 40i M Spt 7인승",
  modelYear: 2026,
  basePrice: 154480000,
  optionTotal: 0,
  optionNames: [],
  discount: 11000000,
  discountLabels: ["타사할인"],
  finalVehiclePrice: 142800000,
  acquisitionTax: 3200000,
  acquisitionTaxMode: "normal",
  bond: 0,
  delivery: 0,
  incidental: 0,
  registrationCost: 3200000,
  acquisitionCost: 146000000,
  exteriorColorName: "알파인 화이트",
  interiorColorName: "블랙",
  guidance: {
    ...DEFAULT_QUOTE_GUIDANCE,
    deliveryComment: "이 차량은 1주일 내 출고 가능해요",
    stockNotice: "즉시 출고 가능",
    expectedDelivery: "1주일 이내",
    customerRegion: "서울",
    keyPoints: ["잔존가치 최대 조건으로 월 납입금을 낮춘 조건입니다.", "초기 부담을 낮추는 조건입니다."],
    recommendReason: "잔가율이 높아 월 납입 부담이 낮습니다\n재고 차량이라 즉시 출고됩니다",
    services: ["썬팅: 후퍼옵틱 KBR 전면 + 측후면 제공", "담당 카매니저 출고 일정 개별 안내"],
  },
  purchaseMethod: "운용리스",
  scenario: {
    scenarioNo: 1,
    purchaseMethod: "운용리스",
    termMonths: 60,
    monthlyPayment: "1473200",
    lender: "우리금융캐피탈",
    depositMode: "none",
    depositValue: null,
    downPaymentMode: "percent",
    downPaymentValue: "20",
    residualMode: "percent",
    residualValue: "58",
    mileageMode: "basic",
    mileageValue: "20,000km / 년",
    carTaxIncluded: false,
    subsidyApplicable: false,
    subsidyAmount: null,
    totalReturnCost: "167652170",
    totalTakeoverCost: "182000000",
    dueAtDelivery: "3000000",
    interestRate: "5.32",
  },
  quoteCode: "QT-2607-0001",
  appStatus: "sent",
  sentAtIso: "2026-04-16T18:07:00+09:00",
  validUntilIso: "2026-07-10T12:00:00+09:00",
  nowMs: NOW,
};

describe("buildAppCardModel — 섹션 1 헤더·핵심 요약", () => {
  it("상태/디데이/차명/칩/서브라인을 조립한다", () => {
    const m = buildAppCardModel(base);
    expect(m.statusLabel).toBe("미확인 견적");
    expect(m.ddayLabel).toBe("D-6");
    expect(m.brand).toBe("BMW");
    expect(m.modelLabel).toBe("X7");
    expect(m.trimLabel).toBe("xDrive 40i M Spt 7인승");
    expect(m.purchaseMethod).toBe("운용리스");
    expect(m.termLabel).toBe("60개월");
    expect(m.sublineLabel).toBe("2026년식 ㅣ 154,480,000원 ㅣ 추가옵션 없음");
  });
  it("월납입금·금리칩·잔존(%병기)·총비용(반납 우선)·할인 행", () => {
    const m = buildAppCardModel(base);
    expect(m.monthlyLabel).toBe("1,473,200원");
    expect(m.rateChipLabel).toBe("금리 5.32%");
    expect(m.residualLabel).toBe("82,824,000원 (58%)"); // 142,800,000 × 58%
    expect(m.totalCostLabel).toBe("167,652,170원"); // 반납 우선
    expect(m.discountRowLabel).toBe("최대 할인 적용 (타사할인)");
    expect(m.discountLabel).toBe("11,000,000");
  });
  it("보증금 무보증·주행거리 연 표기·핵심포인트 배열", () => {
    const m = buildAppCardModel(base);
    expect(m.depositLabel).toBe("0원 (무보증)");
    expect(m.mileageLabel).toBe("연 20,000km");
    expect(m.keyPoints).toEqual(["잔존가치 최대 조건으로 월 납입금을 낮춘 조건입니다.", "초기 부담을 낮추는 조건입니다."]);
  });
  it("총비용: 반납 없으면 인수, 둘 다 없으면 계산 후 안내", () => {
    const noReturn = buildAppCardModel({ ...base, scenario: { ...base.scenario!, totalReturnCost: null } });
    expect(noReturn.totalCostLabel).toBe("182,000,000원");
    const none = buildAppCardModel({ ...base, scenario: { ...base.scenario!, totalReturnCost: null, totalTakeoverCost: null } });
    expect(none.totalCostLabel).toBe("계산 후 안내");
  });
});

describe("buildAppCardModel — 섹션 2 출고 정보·취득원가 구성", () => {
  it("출고 정보 블록 필드", () => {
    const m = buildAppCardModel(base);
    expect(m.deliveryComment).toBe("이 차량은 1주일 내 출고 가능해요");
    expect(m.exteriorColorLabel).toBe("알파인 화이트");
    expect(m.optionSummaryLabel).toBe("없음");
    expect(m.stockNotice).toBe("즉시 출고 가능");
  });
  it("취득원가 구성 라벨(취득세 모드 병기 포함)", () => {
    const m = buildAppCardModel(base);
    expect(m.basePriceLabel).toBe("154,480,000");
    expect(m.finalVehiclePriceLabel).toBe("142,800,000");
    expect(m.acquisitionTaxModeLabel).toBe("일반");
    expect(m.registrationCostLabel).toBe("3,200,000");
    expect(m.acquisitionCostLabel).toBe("146,000,000");
  });
  it("옵션 있으면 서브라인 N개·요약은 이름 나열", () => {
    const m = buildAppCardModel({ ...base, optionNames: ["어드밴스드 패키지", "선루프"], optionTotal: 5000000 });
    expect(m.sublineLabel).toContain("추가옵션 2개");
    expect(m.optionSummaryLabel).toBe("어드밴스드 패키지, 선루프");
  });
});

describe("buildAppCardModel — 섹션 3 추천 견적 조건", () => {
  it("전 조건 라벨(선수금 %선행 병기·자동차세·보조금·금리·총비용 2종·출고전납입)", () => {
    const m = buildAppCardModel(base);
    expect(m.hasScenario).toBe(true);
    expect(m.lenderLabel).toBe("우리금융캐피탈");
    expect(m.downPaymentLabel).toBe("(20%) 28,560,000원"); // 142,800,000 × 20%
    expect(m.carTaxLabel).toBe("불포함");
    expect(m.subsidyLabel).toBe("해당 없음");
    expect(m.rateLabel).toBe("5.32%");
    expect(m.totalReturnCostLabel).toBe("167,652,170원");
    expect(m.totalTakeoverCostLabel).toBe("182,000,000원");
    expect(m.dueAtDeliveryLabel).toBe("3,000,000원");
  });
  it("보조금 해당이면 금액, 자동차세 포함이면 포함", () => {
    const m = buildAppCardModel({ ...base, scenario: { ...base.scenario!, carTaxIncluded: true, subsidyApplicable: true, subsidyAmount: "1000000" } });
    expect(m.carTaxLabel).toBe("포함");
    expect(m.subsidyLabel).toBe("1,000,000원");
  });
  it("시나리오 없으면 hasScenario=false + 안전 폴백", () => {
    const m = buildAppCardModel({ ...base, scenario: null });
    expect(m.hasScenario).toBe(false);
    expect(m.monthlyLabel).toBe("계산 후 안내");
    expect(m.depositLabel).toBe("조건 미정");
    expect(m.rateChipLabel).toBeNull();
    expect(m.rateLabel).toBe("—");
  });
});

describe("buildAppCardModel — 섹션 4·발송 상태", () => {
  it("추천이유 줄 분리·서비스 라벨:값 분리·푸터", () => {
    const m = buildAppCardModel(base);
    expect(m.recommendReasons).toEqual(["잔가율이 높아 월 납입 부담이 낮습니다", "재고 차량이라 즉시 출고됩니다"]);
    expect(m.services[0]).toEqual({ label: "썬팅", value: "후퍼옵틱 KBR 전면 + 측후면 제공" });
    expect(m.services[1]).toEqual({ label: "", value: "담당 카매니저 출고 일정 개별 안내" });
    expect(m.footerStampLabel).toBe("26/04/16 18:07");
    expect(m.quoteCodeLabel).toBe("QT-2607-0001");
  });
  it("발송 전(견적 미저장 포함) 표기: D-7 발송 시 시작·발송 전 미리보기·저장 후 부여", () => {
    const m = buildAppCardModel({ ...base, quoteCode: null, appStatus: null, sentAtIso: null, validUntilIso: null });
    expect(m.ddayLabel).toBe("D-7 · 발송 시 시작");
    expect(m.footerStampLabel).toBe("발송 전 미리보기");
    expect(m.quoteCodeLabel).toBe("저장 후 부여");
  });
  it("만료·확인한 견적", () => {
    const m = buildAppCardModel({ ...base, appStatus: "viewed", validUntilIso: "2026-07-01T00:00:00+09:00" });
    expect(m.statusLabel).toBe("확인한 견적");
    expect(m.ddayLabel).toBe("만료됨");
  });
});
```

- [ ] **Step 2: 실패 확인** — `bun run test:unit client/src/lib/app-card.test.ts` FAIL(타입/필드 미존재).
- [ ] **Step 3: 구현** — `client/src/lib/app-card.ts` 전면 교체:

```ts
import type { QuoteGuidance } from "@/data/quote-guidance";
import type { ScenarioInput } from "./customer-quotes";
import { formatTerm } from "./quote-items";
import { formatMoney } from "./quote-pricing";

// 미리보기 카드 조립 입력. 워크벤치 state에서 추출한 스냅샷(순수 변환을 위해 원시값만 받는다).
export type AppCardModelInput = {
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  modelYear: number | null;
  basePrice: number;
  optionTotal: number;
  optionNames: string[];
  discount: number;
  discountLabels: string[];
  finalVehiclePrice: number;
  acquisitionTax: number;
  acquisitionTaxMode: "normal" | "hybrid" | "electric" | "manual";
  bond: number;
  delivery: number;
  incidental: number;
  registrationCost: number;
  acquisitionCost: number;
  exteriorColorName: string | null;
  interiorColorName: string | null;
  guidance: QuoteGuidance;
  purchaseMethod: string;
  scenario: ScenarioInput | null;
  quoteCode: string | null;
  appStatus: string | null;
  sentAtIso: string | null;
  validUntilIso: string | null;
  nowMs: number;
};

// 카드 표시용 라벨 모델(4섹션). AppCardPreview가 이 값을 그대로 렌더한다.
export type AppCardModel = {
  // 섹션 1 — 헤더·핵심 요약
  statusLabel: string;
  ddayLabel: string;
  brand: string;
  modelLabel: string;
  trimLabel: string;
  purchaseMethod: string;
  termLabel: string;
  sublineLabel: string;
  monthlyLabel: string;
  rateChipLabel: string | null;
  residualLabel: string;
  totalCostLabel: string;
  discountRowLabel: string;
  discountLabel: string;
  depositLabel: string;
  mileageLabel: string;
  keyPoints: string[];
  // 섹션 2 — 출고 정보 + 취득원가 구성
  deliveryComment: string;
  exteriorColorLabel: string;
  interiorColorLabel: string;
  optionSummaryLabel: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  basePriceLabel: string;
  optionTotalLabel: string;
  finalVehiclePriceLabel: string;
  acquisitionTaxLabel: string;
  acquisitionTaxModeLabel: string;
  bondLabel: string;
  deliveryFeeLabel: string;
  incidentalLabel: string;
  registrationCostLabel: string;
  acquisitionCostLabel: string;
  // 섹션 3 — 추천 견적 조건(대표 시나리오 전체)
  hasScenario: boolean;
  lenderLabel: string;
  downPaymentLabel: string;
  carTaxLabel: string;
  subsidyLabel: string;
  rateLabel: string;
  totalReturnCostLabel: string;
  totalTakeoverCostLabel: string;
  dueAtDeliveryLabel: string;
  // 섹션 4 — 추천 이유 + 서비스 + 푸터
  recommendReasons: string[];
  services: { label: string; value: string }[];
  footerStampLabel: string;
  quoteCodeLabel: string;
};

// 계산엔진 미연결 필드는 가짜 숫자 대신 정직한 안내 텍스트로 표시한다.
const CALC_PENDING = "계산 후 안내";
const NO_SOURCE = "—";
const MS_DAY = 86_400_000;
const TAX_MODE_LABELS: Record<AppCardModelInput["acquisitionTaxMode"], string> = {
  normal: "일반", hybrid: "하이브리드 감면", electric: "전기차 감면", manual: "직접 입력",
};

function numOr(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

function moneyLabelOf(raw: string | null | undefined, fallback: string): string {
  const n = numOr(raw);
  return n == null ? fallback : `${formatMoney(n)}원`;
}

// mode+value 병기 포맷. percent 금액 환산 기준 = finalVehiclePrice(0이면 %만).
// percentFirst: 보증금/선수금 "(20%) 28,560,000원" ↔ 잔존가치 "82,824,000원 (58%)" 어순.
function moneyModeLabel(
  mode: string | null | undefined,
  value: string | null | undefined,
  finalVehiclePrice: number,
  opts: { noneLabel: string; percentFirst: boolean },
): string {
  if (mode == null || mode === "none") return opts.noneLabel;
  if (mode === "max") return "최대";
  if (mode === "percent") {
    const v = numOr(value);
    if (v == null) return opts.noneLabel;
    if (!finalVehiclePrice) return `${v}%`;
    const amount = `${formatMoney(Math.round(finalVehiclePrice * v / 100))}원`;
    return opts.percentFirst ? `(${v}%) ${amount}` : `${amount} (${v}%)`;
  }
  const n = numOr(value);
  return n == null ? opts.noneLabel : `${formatMoney(n)}원`;
}

// 발송 전(valid_until 없음)엔 갭ⓐ 정책 안내, 발송 후엔 카운트다운.
function ddayLabelOf(validUntilIso: string | null, now: number): string {
  if (!validUntilIso) return "D-7 · 발송 시 시작";
  const until = new Date(validUntilIso).getTime();
  if (Number.isNaN(until)) return "D-7 · 발송 시 시작";
  const days = Math.ceil((until - now) / MS_DAY);
  return days > 0 ? `D-${days}` : "만료됨";
}

// 푸터 발송시각 "26/04/16 18:07". 발송 전엔 프리뷰 표기.
function stampLabelOf(iso: string | null): string {
  if (!iso) return "발송 전 미리보기";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "발송 전 미리보기";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).slice(2)}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "20,000km / 년" → "연 20,000km" (디자인 표기). 형태가 다르면 원문 유지.
function mileageLabelOf(raw: string | null | undefined): string {
  if (!raw) return "연 20,000km";
  const head = raw.split("/")[0]?.trim();
  return head ? `연 ${head}` : raw;
}

// "썬팅: 후퍼옵틱 …" → {label: "썬팅", value: "후퍼옵틱 …"}. 콜론 없으면 label 없이 전체.
function splitService(raw: string): { label: string; value: string } {
  const idx = raw.indexOf(":");
  if (idx === -1) return { label: "", value: raw.trim() };
  return { label: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim() };
}

export function buildAppCardModel(input: AppCardModelInput): AppCardModel {
  const s = input.scenario;
  const fvp = input.finalVehiclePrice;
  const rate = numOr(s?.interestRate);
  const totalReturn = numOr(s?.totalReturnCost);
  const totalTakeover = numOr(s?.totalTakeoverCost);
  const totalCost = totalReturn ?? totalTakeover; // 반납 우선(설계 결정 2)
  return {
    statusLabel: input.appStatus === "viewed" ? "확인한 견적" : "미확인 견적",
    ddayLabel: ddayLabelOf(input.validUntilIso, input.nowMs),
    brand: input.brandName ?? "차량 미선택",
    modelLabel: input.modelName ?? "차량 미선택",
    trimLabel: input.trimName ?? "",
    purchaseMethod: input.purchaseMethod,
    termLabel: formatTerm(s?.termMonths ?? null),
    sublineLabel: [
      input.modelYear != null ? `${input.modelYear}년식` : null,
      `${formatMoney(input.basePrice)}원`,
      input.optionNames.length ? `추가옵션 ${input.optionNames.length}개` : "추가옵션 없음",
    ].filter(Boolean).join(" ㅣ "),
    monthlyLabel: moneyLabelOf(s?.monthlyPayment, CALC_PENDING),
    rateChipLabel: rate != null ? `금리 ${rate}%` : null,
    residualLabel: s ? moneyModeLabel(s.residualMode, s.residualValue, fvp, { noneLabel: CALC_PENDING, percentFirst: false }) : CALC_PENDING,
    totalCostLabel: totalCost != null ? `${formatMoney(totalCost)}원` : CALC_PENDING,
    discountRowLabel: input.discountLabels.length ? `최대 할인 적용 (${input.discountLabels.join("·")})` : "최대 할인 적용",
    discountLabel: formatMoney(input.discount),
    depositLabel: s ? moneyModeLabel(s.depositMode, s.depositValue, fvp, { noneLabel: "0원 (무보증)", percentFirst: true }) : "조건 미정",
    mileageLabel: mileageLabelOf(s?.mileageValue),
    keyPoints: input.guidance.keyPoints.map((k) => k.trim()).filter(Boolean),
    deliveryComment: input.guidance.deliveryComment,
    exteriorColorLabel: input.exteriorColorName ?? "미선택",
    interiorColorLabel: input.interiorColorName ?? "미선택",
    optionSummaryLabel: input.optionNames.length ? input.optionNames.join(", ") : "없음",
    stockNotice: input.guidance.stockNotice,
    expectedDelivery: input.guidance.expectedDelivery,
    customerRegion: input.guidance.customerRegion,
    basePriceLabel: formatMoney(input.basePrice),
    optionTotalLabel: formatMoney(input.optionTotal),
    finalVehiclePriceLabel: formatMoney(fvp),
    acquisitionTaxLabel: formatMoney(input.acquisitionTax),
    acquisitionTaxModeLabel: TAX_MODE_LABELS[input.acquisitionTaxMode],
    bondLabel: formatMoney(input.bond),
    deliveryFeeLabel: formatMoney(input.delivery),
    incidentalLabel: formatMoney(input.incidental),
    registrationCostLabel: formatMoney(input.registrationCost),
    acquisitionCostLabel: formatMoney(input.acquisitionCost),
    hasScenario: s != null,
    lenderLabel: s?.lender ?? "금융사 미정",
    downPaymentLabel: s ? moneyModeLabel(s.downPaymentMode, s.downPaymentValue, fvp, { noneLabel: "없음", percentFirst: true }) : "없음",
    carTaxLabel: s?.carTaxIncluded === true ? "포함" : "불포함",
    subsidyLabel: s?.subsidyApplicable === true ? moneyLabelOf(s.subsidyAmount, NO_SOURCE) : "해당 없음",
    rateLabel: rate != null ? `${rate}%` : NO_SOURCE,
    totalReturnCostLabel: totalReturn != null ? `${formatMoney(totalReturn)}원` : NO_SOURCE,
    totalTakeoverCostLabel: totalTakeover != null ? `${formatMoney(totalTakeover)}원` : NO_SOURCE,
    dueAtDeliveryLabel: moneyLabelOf(s?.dueAtDelivery, NO_SOURCE),
    recommendReasons: input.guidance.recommendReason.split("\n").map((line) => line.trim()).filter(Boolean),
    services: input.guidance.services.map((sv) => sv.trim()).filter(Boolean).map(splitService),
    footerStampLabel: stampLabelOf(input.sentAtIso),
    quoteCodeLabel: input.quoteCode ?? "저장 후 부여",
  };
}
```

주의: 이 시점에 `AppCardPreview.tsx`·`useQuoteWorkbench.ts`가 구 모델 필드를 참조해 **typecheck가 깨진다** — Task 6과 같은 커밋으로 묶지 말고, Task 5는 **테스트만 green 확인 후 Task 6까지 완료한 뒤 함께 커밋**한다(중간 커밋 금지). `bun run test:unit client/src/lib/app-card.test.ts` green이 Task 5의 완료 기준.

- [ ] **Step 4: 통과 확인** — `bun run test:unit client/src/lib/app-card.test.ts` green.

### Task 6: AppCardPreview 4섹션 리라이트 + CSS + 훅 배선

**Files:**
- Modify: `client/src/components/AppCardPreview.tsx` (전면 교체)
- Modify: `client/src/styles/customer-detail-preview.css` (파일 끝 append)
- Modify: `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts:163-184` (appCardModel 조립)

- [ ] **Step 1: 훅 배선** — `useQuoteWorkbench.ts`의 `appCardModel` 조립부(line 169~184)를 교체(위쪽 `editingQuote` 계산 직후):

```ts
  // 앱카드 푸터/디데이용 영속 견적(수정 진입 editingQuoteId 또는 신규 첫 작성완료 persistedQuoteIdRef).
  // ref 읽기지만 quoteCode 도착(detail 재페치/quotes swap) 자체가 재렌더를 유발해 최신값이 잡힌다.
  const persistedQuoteId = editingQuoteId ?? persistedQuoteIdRef.current;
  const persistedQuote = persistedQuoteId ? detail.quotes.find((q) => q.id === persistedQuoteId) : undefined;
  const appCardModel: AppCardModel = buildAppCardModel({
    brandName: workbenchVehicle?.brand?.name ?? null,
    modelName: workbenchVehicle?.model?.name ?? trimDetail?.modelName ?? null,
    trimName: trimDetail?.trimName ?? trimDetail?.name ?? null,
    modelYear: trimDetail?.modelYear ?? null,
    basePrice: pricingInputs.basePrice,
    optionTotal: pricingInputs.optionPrice,
    optionNames: trimDetail ? trimDetail.options.filter((o) => selectedWorkbenchOptionIds.includes(o.id)).map((o) => o.name) : [],
    discount: pricingInputs.discount,
    discountLabels: discountLines.map((line) => line.label),
    finalVehiclePrice: pricing.finalVehiclePrice,
    acquisitionTax: pricingInputs.acquisitionTax,
    acquisitionTaxMode,
    bond: pricingInputs.bond,
    delivery: pricingInputs.delivery,
    incidental: pricingInputs.incidental,
    registrationCost: pricing.registrationCost,
    acquisitionCost: pricing.acquisitionCost,
    exteriorColorName: exteriorColor?.name ?? null,
    interiorColorName: interiorColor?.name ?? null,
    guidance,
    purchaseMethod: solutionWorkbenchPurchaseMethod,
    scenario: cardScenario,
    quoteCode: persistedQuote?.quoteCode ?? null,
    appStatus: persistedQuote?.appStatus ?? null,
    sentAtIso: persistedQuote?.sentAt ?? null,
    validUntilIso: persistedQuote?.validUntil ?? null,
    nowMs: nowMs(),
  });
```

- [ ] **Step 2: 컴포넌트 리라이트** — `client/src/components/AppCardPreview.tsx` 전면 교체:

```tsx
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { AppCardModel } from "@/lib/app-card";

// 고객 앱 견적카드 미리보기(4섹션 상세 카드, 2026-07-04 이사님 확정 디자인 미러).
// model 1개만 받고 DOM/state를 직접 읽지 않는다(조립은 부모 워크벤치 책임).
// 바깥 .kim-app-card-preview는 워크벤치 grid 배치가 참조하므로 유지, 내부는 app-card-* 신규 문법.
export function AppCardPreview({ model, inModal = false }: { model: AppCardModel; inModal?: boolean }) {
  const [costOpen, setCostOpen] = useState(true);
  const [conditionOpen, setConditionOpen] = useState(true);
  return (
    <aside className={`kim-app-card-preview${inModal ? " in-modal" : ""}`} aria-label="앱 견적카드 미리보기">
      <div className="app-card">
        {/* 섹션 1 — 헤더·핵심 요약 */}
        <section className="app-card-hero">
          <div className="app-card-status-row">
            <span>🔔 {model.statusLabel}</span>
            <em>● {model.ddayLabel}</em>
          </div>
          <span className="app-card-brand">{model.brand}</span>
          <strong className="app-card-model">{model.modelLabel} {model.trimLabel}</strong>
          <div className="app-card-chip-row">
            <span>{model.purchaseMethod}</span>
            <span>{model.termLabel}</span>
          </div>
          <p className="app-card-subline">{model.sublineLabel}</p>
          <div className="app-card-pay">
            <span>월 납입금</span>
            <div>
              <strong>{model.monthlyLabel}</strong>
              {model.rateChipLabel ? <em>{model.rateChipLabel}</em> : null}
            </div>
            <p>잔존가치 {model.residualLabel} ㅣ 총 비용 {model.totalCostLabel}</p>
          </div>
          <div className="app-card-discount-row">
            <span>{model.discountRowLabel}</span>
            <strong>-{model.discountLabel}원</strong>
          </div>
          <div className="app-card-mini-grid">
            <div><span>보증금</span><strong>{model.depositLabel}</strong></div>
            <div><span>주행거리</span><strong>{model.mileageLabel}</strong></div>
          </div>
          {model.keyPoints.length ? (
            <div className="app-card-keypoints">
              <header>📊 견적 핵심 포인트</header>
              <ul>{model.keyPoints.map((point, i) => <li key={`${i}-${point}`}>{point}</li>)}</ul>
            </div>
          ) : null}
          <button className="app-card-consult" disabled type="button">이 견적으로 상담 시작하기</button>
          <p className="app-card-hero-foot">● 상세 견적</p>
        </section>

        {/* 섹션 2 — 출고 정보 + 취득원가 구성 */}
        <section className="app-card-block">
          <header className="app-card-block-head is-blue">🚗 {model.deliveryComment}</header>
          <dl className="app-card-rows">
            <dt>외장 컬러</dt><dd>{model.exteriorColorLabel}</dd>
            <dt>내장 컬러</dt><dd>{model.interiorColorLabel}</dd>
            <dt>추가 옵션</dt><dd>{model.optionSummaryLabel}</dd>
            <dt>재고 여부</dt><dd className="is-green">{model.stockNotice}</dd>
            <dt>예상 출고 기간</dt><dd>{model.expectedDelivery}</dd>
            <dt>고객 지역</dt><dd>{model.customerRegion}</dd>
          </dl>
        </section>
        <section className="app-card-block">
          <button className="app-card-block-head is-blue is-toggle" onClick={() => setCostOpen((open) => !open)} type="button">
            📌 취득원가 구성을 확인하는 것이 중요해요
            {costOpen ? <ChevronUp size={14} strokeWidth={2.2} /> : <ChevronDown size={14} strokeWidth={2.2} />}
          </button>
          {costOpen ? (
            <dl className="app-card-rows">
              <dt>차량 기본가격</dt><dd>{model.basePriceLabel}원</dd>
              <dt>추가 옵션가격</dt><dd>{model.optionTotalLabel}원</dd>
              <dt>할인금액</dt><dd>-{model.discountLabel}원</dd>
              <dt className="is-strong">최종 차량가격 ①</dt><dd className="is-green is-strong">{model.finalVehiclePriceLabel}원</dd>
              <dt>취득세 ({model.acquisitionTaxModeLabel})</dt><dd>{model.acquisitionTaxLabel}원</dd>
              <dt>공채</dt><dd>{model.bondLabel}원</dd>
              <dt>탁송료</dt><dd>{model.deliveryFeeLabel}원</dd>
              <dt>부대비용</dt><dd>{model.incidentalLabel}원</dd>
              <dt className="is-strong">등록비용 합계 ②</dt><dd className="is-green is-strong">{model.registrationCostLabel}원</dd>
              <dt className="is-strong">취득원가 ① + ②</dt><dd className="is-blue is-strong">{model.acquisitionCostLabel}원</dd>
            </dl>
          ) : null}
        </section>

        {/* 섹션 3 — 추천 견적 조건(대표 시나리오 전체) */}
        <section className="app-card-block">
          <button className="app-card-block-head is-blue is-toggle" onClick={() => setConditionOpen((open) => !open)} type="button">
            📄 가장 추천드리는 견적 조건입니다!
            {conditionOpen ? <ChevronUp size={14} strokeWidth={2.2} /> : <ChevronDown size={14} strokeWidth={2.2} />}
          </button>
          {conditionOpen ? (
            model.hasScenario ? (
              <dl className="app-card-rows">
                <dt>구매방식</dt><dd>{model.purchaseMethod}</dd>
                <dt>금융사</dt><dd>{model.lenderLabel}</dd>
                <dt>계약 기간</dt><dd>{model.termLabel}</dd>
                <dt>약정 주행거리</dt><dd>{model.mileageLabel}</dd>
                <dt>보증금</dt><dd>{model.depositLabel}</dd>
                <dt>선수금</dt><dd>{model.downPaymentLabel}</dd>
                <dt>잔존가치</dt><dd>{model.residualLabel}</dd>
                <dt>자동차세</dt><dd>{model.carTaxLabel}</dd>
                <dt>전기차 보조금</dt><dd>{model.subsidyLabel}</dd>
                <dt>금리 (잔존가치 지불 시)</dt><dd className="is-green">{model.rateLabel}</dd>
                <dt>반납까지 총 비용</dt><dd>{model.totalReturnCostLabel}</dd>
                <dt>인수까지 총 비용</dt><dd>{model.totalTakeoverCostLabel}</dd>
                <dt className="is-strong">최종 월 납입금</dt><dd className="is-blue is-big">{model.monthlyLabel}</dd>
                <dt className="is-strong">출고 전 납입금액</dt><dd className="is-blue is-big">{model.dueAtDeliveryLabel}</dd>
              </dl>
            ) : (
              <p className="app-card-empty">조건 저장 후 표시됩니다</p>
            )
          ) : null}
        </section>

        {/* 섹션 4 — 추천 이유 + 서비스 + 푸터 */}
        {model.recommendReasons.length ? (
          <section className="app-card-block">
            <header className="app-card-block-head is-blue">💡 이 견적을 추천드리는 이유는요</header>
            <ul className="app-card-reasons">
              {model.recommendReasons.map((reason, i) => <li key={`${i}-${reason}`}>{reason}</li>)}
            </ul>
          </section>
        ) : null}
        {model.services.length ? (
          <section className="app-card-block">
            <header className="app-card-block-head is-orange">🎁 서비스가 빠질수가 있나요</header>
            <ul className="app-card-services">
              {model.services.map((service, i) => (
                <li key={`${i}-${service.value}`}>{service.label ? <b>{service.label}: </b> : null}{service.value}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <footer className="app-card-foot">
          <span>{model.footerStampLabel}</span>
          <span>No. {model.quoteCodeLabel}</span>
        </footer>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: CSS append** — `client/src/styles/customer-detail-preview.css` 파일 끝에(색상은 1차 근사값 — Task 9 디자인 대조에서 보정):

```css
/* ── 앱카드 4섹션 미리보기(2026-07-04 리디자인) — 신규 app-card-* 문법.
   구 .kim-app-card 계열 룰은 dead(제거는 follow-up, 시각 회귀 0 원칙). ── */
.app-card {
  display: grid;
  gap: 10px;
  width: 100%;
  max-width: 360px;
  margin: 0 auto;
  font-size: 12.5px;
  color: #30363d;
}

.app-card-hero {
  display: grid;
  gap: 8px;
  border-radius: 14px;
  padding: 14px;
  background: linear-gradient(160deg, #0ba46e 0%, #078a5c 100%);
  color: #fff;
}

.app-card-status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  font-weight: 700;
}

.app-card-status-row em {
  font-style: normal;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  padding: 2px 8px;
}

.app-card-brand { font-size: 11.5px; font-weight: 600; opacity: 0.85; }
.app-card-model { font-size: 15.5px; font-weight: 850; line-height: 1.35; }

.app-card-chip-row { display: flex; gap: 5px; }
.app-card-chip-row span {
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 700;
}

.app-card-subline { font-size: 11px; opacity: 0.88; }

.app-card-pay {
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  color: #30363d;
  display: grid;
  gap: 3px;
}
.app-card-pay > span { font-size: 11px; color: #6b7480; font-weight: 600; }
.app-card-pay > div { display: flex; align-items: baseline; gap: 8px; }
.app-card-pay strong { font-size: 19px; font-weight: 850; color: #078a5c; }
.app-card-pay em {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 750;
  color: #078a5c;
  background: rgba(11, 164, 110, 0.1);
  border-radius: 999px;
  padding: 2px 7px;
}
.app-card-pay p { font-size: 11px; color: #6b7480; }

.app-card-discount-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 11.5px;
  font-weight: 700;
}
.app-card-discount-row strong { font-size: 13px; font-weight: 850; }

.app-card-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.app-card-mini-grid > div {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 7px 10px;
  display: grid;
  gap: 2px;
}
.app-card-mini-grid span { font-size: 10.5px; opacity: 0.85; }
.app-card-mini-grid strong { font-size: 12px; font-weight: 800; }

.app-card-keypoints {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 8px 11px;
  display: grid;
  gap: 5px;
}
.app-card-keypoints header { font-size: 11.5px; font-weight: 800; }
.app-card-keypoints ul { display: grid; gap: 3px; padding-left: 14px; }
.app-card-keypoints li { font-size: 11px; line-height: 1.45; list-style: disc; }

.app-card-consult {
  background: #fff;
  color: #078a5c;
  border-radius: 9px;
  padding: 9px 0;
  font-size: 12.5px;
  font-weight: 850;
  cursor: default;
}
.app-card-hero-foot { text-align: center; font-size: 10.5px; opacity: 0.8; }

.app-card-block {
  border: 1px solid #e4e4e2;
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}

.app-card-block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 800;
  text-align: left;
}
.app-card-block-head.is-blue { background: #eef4ff; color: #1d4ed8; }
.app-card-block-head.is-orange { background: #fff4e5; color: #c2620a; }
.app-card-block-head.is-toggle { cursor: pointer; }

.app-card-rows {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 7px 12px;
  padding: 11px 12px;
}
.app-card-rows dt { font-size: 11.5px; color: #6b7480; font-weight: 600; }
.app-card-rows dd { font-size: 11.5px; font-weight: 700; text-align: right; }
.app-card-rows .is-strong { font-weight: 850; color: #30363d; }
.app-card-rows dd.is-green { color: #078a5c; }
.app-card-rows dd.is-blue { color: #1d4ed8; }
.app-card-rows dd.is-big { font-size: 13.5px; }

.app-card-empty { padding: 14px 12px; font-size: 11.5px; color: #8a919b; }

.app-card-reasons, .app-card-services { display: grid; gap: 6px; padding: 11px 14px; }
.app-card-reasons li { font-size: 11.5px; line-height: 1.5; list-style: none; }
.app-card-reasons li::before { content: "✓ "; color: #078a5c; font-weight: 850; }
.app-card-services li { font-size: 11.5px; line-height: 1.5; list-style: none; }
.app-card-services b { font-weight: 800; }

.app-card-foot {
  display: flex;
  justify-content: space-between;
  padding: 2px 4px 6px;
  font-size: 10.5px;
  color: #8a919b;
}
```

- [ ] **Step 4: 통과 확인** — `bun run typecheck` 0 · `bun run lint` 0 · `bun run test:unit` 전량 green · `bun run build`.
- [ ] **Step 5: 커밋(Task 5+6 묶음)** — `feat(crm): 앱카드 4섹션 리디자인 — buildAppCardModel v2 + AppCardPreview 리라이트 + app-card-* CSS`

### Task 7: 워크벤치 추가안내 — 핵심포인트 복수(+)·서비스 동적(+) (갭ⓑⓒ UI)

**Files:**
- Modify: `client/src/components/customer-detail/QuoteWorkbench.tsx:472-517` (추가 안내 섹션)
- Modify: `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts` (persistWorkbenchQuote snapshot.guidance)
- Modify: `client/src/styles/customer-detail-cards.css` (guidance-list 룰 append)

- [ ] **Step 1: 저장 시 sanitize** — `useQuoteWorkbench.ts` `persistWorkbenchQuote`의 snapshot(line 704~725)에서 `guidance,` → `guidance: sanitizeQuoteGuidance(guidance),` (+import). 빈 동적 입력칸이 DB에 영속되지 않는다.
- [ ] **Step 2: UI 교체** — `QuoteWorkbench.tsx` 추가 안내 그리드에서 ①고정 서비스 1~4 input 4개 제거 ②핵심포인트 select 제거 후, 그리드 아래(추천이유 textarea 위)에 동적 리스트 2블록 추가:

```tsx
                      <div className="wide guidance-list" role="group" aria-label="핵심포인트 목록">
                        <span>핵심포인트</span>
                        {guidance.keyPoints.map((point, i) => (
                          <div className="guidance-list-row" key={i}>
                            <input
                              list="guidance-keypoint-options"
                              placeholder="카드에 bullet로 노출됩니다"
                              value={point}
                              onChange={(e) => { const v = e.currentTarget.value; setGuidance((g) => { const k = [...g.keyPoints]; k[i] = v; return { ...g, keyPoints: k }; }); }}
                            />
                            <button aria-label={`핵심포인트 ${i + 1} 삭제`} onClick={() => setGuidance((g) => ({ ...g, keyPoints: g.keyPoints.filter((_, idx) => idx !== i) }))} type="button"><Trash2 size={13} strokeWidth={2.1} /></button>
                          </div>
                        ))}
                        <button className="guidance-list-add" onClick={() => setGuidance((g) => ({ ...g, keyPoints: [...g.keyPoints, ""] }))} type="button">+ 핵심포인트 추가</button>
                        <datalist id="guidance-keypoint-options">
                          {QUOTE_GUIDANCE_OPTIONS.keyPoint.map((o) => <option key={o} value={o} />)}
                        </datalist>
                      </div>
                      <div className="wide guidance-list" role="group" aria-label="서비스 목록">
                        <span>서비스 목록</span>
                        {guidance.services.map((service, i) => (
                          <div className="guidance-list-row" key={i}>
                            <input
                              placeholder="라벨: 내용 (예: 썬팅: 후퍼옵틱 KBR 전면)"
                              value={service}
                              onChange={(e) => { const v = e.currentTarget.value; setGuidance((g) => { const s = [...g.services]; s[i] = v; return { ...g, services: s }; }); }}
                            />
                            <button aria-label={`서비스 ${i + 1} 삭제`} onClick={() => setGuidance((g) => ({ ...g, services: g.services.filter((_, idx) => idx !== i) }))} type="button"><Trash2 size={13} strokeWidth={2.1} /></button>
                          </div>
                        ))}
                        <button className="guidance-list-add" onClick={() => setGuidance((g) => ({ ...g, services: [...g.services, ""] }))} type="button">+ 서비스 추가</button>
                      </div>
```

(남는 select 4개 — 출고시기/재고/예상출고/지역 — 는 그대로 2열 그리드에 두고, 동적 리스트 2블록과 추천이유는 `wide`로 전폭. `setGuidance`가 이미 재렌더→appCardModel 재조립을 유발하므로 미리보기 즉시 갱신, `markQuoteDraftChanged`는 폼 컨테이너 onChange 위임이 처리 — 추가 배선 불필요.)

- [ ] **Step 3: CSS append** — `client/src/styles/customer-detail-cards.css` 끝에:

```css
/* 추가 안내 동적 입력 리스트(핵심포인트/서비스 +) — 앱카드 리디자인(2026-07-04) */
.guidance-list { display: grid; gap: 6px; }
.guidance-list-row { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; }
.guidance-list-row button {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(17, 17, 17, 0.08);
  border-radius: 5px;
  background: #fbfbfa;
  color: #8a919b;
}
.guidance-list-row button:hover { color: #d13438; border-color: rgba(209, 52, 56, 0.35); }
.guidance-list-add {
  justify-self: start;
  border: 1px dashed rgba(var(--brand-rgb), 0.35);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--brand);
  background: rgba(var(--brand-rgb), 0.04);
}
```

- [ ] **Step 4: 통과 확인** — `bun run typecheck` 0 · `bun run lint` 0 · `bun run test:unit` 전량 green.
- [ ] **Step 5: 커밋** — `feat(crm): 워크벤치 추가안내 동적 입력 — 핵심포인트 복수(+)·서비스 칸 확장(+) (앱카드 갭ⓑⓒ)`

### Task 8: 워크벤치 시나리오 카드 — 결과 4필드 수기 입력 + 자동차세/보조금 실배선

**Files:**
- Modify: `client/src/components/customer-detail/quote-workbench-meta.ts` (ManualCard·EditScenario·emptyQuoteConditionCards)
- Modify: `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts` (state 맵·extract·prefill·reset)
- Modify: `client/src/components/customer-detail/QuoteWorkbench.tsx:443-451` (자동차세/보조금/결과 그리드)

- [ ] **Step 1: 타입/기본값** — `quote-workbench-meta.ts`:
  - `ManualCard`에 `subsidyAmount: string;` 추가, `emptyQuoteConditionCards` 3카드에 `subsidyAmount: "0",` 추가.
  - `EditScenario`에 추가:
```ts
  carTaxIncluded: boolean;
  subsidyApplicable: boolean;
  subsidyAmount: string;
  totalReturnCost: string;
  totalTakeoverCost: string;
  dueAtDelivery: string;
  interestRate: string;
```
- [ ] **Step 2: 훅 state 맵 + setter** — `useQuoteWorkbench.ts`의 manual*Modes state 옆에:

```ts
  const [manualCarTaxIncluded, setManualCarTaxIncluded] = useState<Record<string, boolean>>({});
  const [manualSubsidyApplicable, setManualSubsidyApplicable] = useState<Record<string, boolean>>({});
```

setter(기존 `setManualDepositMode` 패턴과 동일하게 map set + `markQuoteDraftChanged()`):
```ts
  function setManualCarTaxFor(conditionId: string, included: boolean) {
    setManualCarTaxIncluded((current) => ({ ...current, [conditionId]: included }));
    markQuoteDraftChanged();
  }
  function setManualSubsidyFor(conditionId: string, applicable: boolean) {
    setManualSubsidyApplicable((current) => ({ ...current, [conditionId]: applicable }));
    markQuoteDraftChanged();
  }
```

미리보기 동기화 effect(line 674) deps에 `manualCarTaxIncluded, manualSubsidyApplicable` 추가. `openNewWorkbench`·prefill 리셋 경로(`setManualTermMonths({})` 하는 3곳)에 두 맵 리셋(`{}`) 추가.

- [ ] **Step 3: extract 확장** — `extractWorkbenchScenarios` push 객체에 추가(파일 상단 근처에 `nz` 헬퍼):

```ts
  // 결과 필드 0/빈값은 null(가짜 0 영속 방지 — 설계 결정 10).
  const nz = (raw: string | null) => (raw != null && Number(raw) > 0 ? raw : null);
```
```ts
        carTaxIncluded: manualCarTaxIncluded[condId] ?? false,
        subsidyApplicable: manualSubsidyApplicable[condId] ?? false,
        subsidyAmount: (manualSubsidyApplicable[condId] ?? false) ? nz(parseMonthlyPayment(fieldVal("subsidy") ?? "")) : null,
        totalReturnCost: nz(parseMonthlyPayment(fieldVal("totalReturn") ?? "")),
        totalTakeoverCost: nz(parseMonthlyPayment(fieldVal("totalTakeover") ?? "")),
        dueAtDelivery: nz(parseMonthlyPayment(fieldVal("dueAtDelivery") ?? "")),
        interestRate: parseInterestRate(fieldVal("interestRate") ?? ""),
```
(+`parseInterestRate` import)

- [ ] **Step 4: prefill 왕복** — `openEditQuote`의 editScenarios 매핑에:
```ts
      carTaxIncluded: s.carTaxIncluded ?? false,
      subsidyApplicable: s.subsidyApplicable ?? false,
      subsidyAmount: s.subsidyAmount ?? "0",
      totalReturnCost: s.totalReturnCost ?? "",
      totalTakeoverCost: s.totalTakeoverCost ?? "",
      dueAtDelivery: s.dueAtDelivery ?? "",
      interestRate: s.interestRate ?? "",
```
`buildManualCardsFromScenarios` 카드 매핑에:
```ts
        subsidyAmount: sc.subsidyAmount && Number(sc.subsidyAmount) > 0 ? formatMoney(Number(sc.subsidyAmount)) : "0",
        totalReturn: sc.totalReturnCost ? formatMoney(Number(sc.totalReturnCost)) : "0",
        totalTakeover: sc.totalTakeoverCost ? formatMoney(Number(sc.totalTakeoverCost)) : "0",
        dueAtDelivery: sc.dueAtDelivery ? formatMoney(Number(sc.dueAtDelivery)) : "0",
        interestRate: sc.interestRate ?? "0",
```
`openEditQuote`의 mode 맵 초기화 5줄 옆에:
```ts
    setManualCarTaxIncluded(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.carTaxIncluded])));
    setManualSubsidyApplicable(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.subsidyApplicable])));
```

- [ ] **Step 5: JSX 배선** — `QuoteWorkbench.tsx` 비교카드 map 내부에서 (카드 상단에 `const carTaxOn = manualCarTaxIncluded[condition.id] ?? false;` / `const subsidyOn = manualSubsidyApplicable[condition.id] ?? false;` 파생 — 훅 반환값에 두 맵과 setter 노출 필요):

자동차세 행(line 443) 교체:
```tsx
<label><span>자동차세</span><div className="kim-jeff-segment"><button className={!carTaxOn ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualCarTaxFor(condition.id, false)} type="button">불포함</button><button className={carTaxOn ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualCarTaxFor(condition.id, true)} type="button">포함</button></div></label>
```

보조금 행(line 444) 교체:
```tsx
<label className="before-emphasis"><span>보조금</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={!subsidyOn ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualSubsidyFor(condition.id, false)} type="button">비해당</button><button className={subsidyOn ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualSubsidyFor(condition.id, true)} type="button">해당</button></div><div className={`kim-jeff-money-input${!subsidyOn ? " is-fixed" : ""}`}><input aria-label="보조금 금액" data-sc-field="subsidy" defaultValue={condition.subsidyAmount} disabled={isConditionSaved} readOnly={!subsidyOn} /><em>원</em></div></div></label>
```

결과 그리드(line 446~451) 교체 — readOnly 제거·data-sc-field 부여·금리는 percent 우회:
```tsx
<div className="kim-manual-result-grid">
  <label><span>반납 총비용</span><div className="kim-jeff-money-input"><input aria-label="반납 총비용" data-sc-field="totalReturn" defaultValue={condition.totalReturn} disabled={isConditionSaved} /><em>원</em></div></label>
  <label><span>인수 총비용</span><div className="kim-jeff-money-input"><input aria-label="인수 총비용" data-sc-field="totalTakeover" defaultValue={condition.totalTakeover} disabled={isConditionSaved} /><em>원</em></div></label>
  <label><span>출고 전 납입</span><div className="kim-jeff-money-input"><input aria-label="출고 전 납입" data-sc-field="dueAtDelivery" defaultValue={condition.dueAtDelivery} disabled={isConditionSaved} /><em>원</em></div></label>
  <label><span>금리</span><div className="kim-jeff-money-input"><input aria-label="금리" data-discount-unit="percent" data-sc-field="interestRate" defaultValue={condition.interestRate} disabled={isConditionSaved} /><em>%</em></div></label>
</div>
```
(카드 key에 `editingQuoteId`가 포함돼 수정 진입 시 remount → defaultValue 프리필 적용. `data-discount-unit="percent"`는 jeff money 포맷터의 천단위 콤마를 우회해 소수점 금리를 보존하는 기존 메커니즘.)

- [ ] **Step 6: 통과 확인** — `bun run typecheck` 0 · `bun run lint` 0 · `bun run test:unit` 전량 · `bun run test:server` 전량 · `bun run build`.
- [ ] **Step 7: 커밋** — `feat(crm): 워크벤치 시나리오 결과 4필드 수기 입력 + 자동차세/보조금 토글 실배선 (앱카드 리디자인 8)`

### Task 9: 통합 검증 + 브라우저 스모크·디자인 대조

- [ ] **Step 1: 검증 4종 + build** — `bun run typecheck` · `bun run lint` · `bun run test:unit` · `bun run test:server` · `bun run build` 전부 green.
- [ ] **Step 2: 브라우저 스모크**(agent-browser, magiclink 우회 — brief "로컬 브라우저 스모크 로그인 우회" 절차):
  1. `bun dev` 기동(작업 후 반드시 종료) → 김민준 상세 → 견적함 "+" 새 견적.
  2. 차량 선택·가격 입력·1번 카드에 금융사/월납입/**금리 5.32·반납/인수 총비용·출고 전 납입** 입력, 자동차세 "포함"·보조금 "해당+금액" 토글 → 우측 상시 미리보기 4섹션 실시간 반영 확인.
  3. 핵심포인트 `+`로 2줄, 서비스 `+`로 5줄 입력 → 카드 bullet/서비스 목록 반영 확인.
  4. 작성완료 → 앱카드보기 모달 → 4섹션 + 푸터 `No. QT-…` + "D-7 · 발송 시 시작"/"발송 전 미리보기" 확인. 접기 토글 2곳 동작.
  5. 발송 → 견적함 D-7 배지 + 카드 재진입(수정) 시 프리필 왕복(금리/총비용/자동차세/보조금/핵심포인트 복수) 확인. psql로 `valid_until = sent_at + 7일` 대조.
  6. **스모크로 만든 견적은 공유 master — 반드시 삭제**(견적함 삭제 → psql로 잔존 0 확인).
- [ ] **Step 3: 디자인 대조** — 미리보기 스크린샷을 캡처해 **사용자(유슨생)에게 디자인 이미지 4장 재첨부를 요청**하고 대조. 색/간격/위계 차이는 CSS 보정 후 재캡처.
- [ ] **Step 4: brief 갱신 + PR** — `ref/active-session-brief.md` Current Focus 갱신(구현 완료 기록, kim-app 구 CSS dead 제거 follow-up 명시). `gh pr create`(본문에 스크린샷·검증 기록, **[skip ci] 금지**) → 사용자 확인 후 squash 머지.

## 범위 밖 (재확인)

- 견적 앱 발송 파이프라인(public 수신 테이블) — 다음 슬라이스.
- "이 견적으로 상담 시작하기" 실동작 — 앱 슬라이스.
- 견적 계산엔진 — 수치는 수기 입력 유지.
- 구 `.kim-app-card` 계열 dead CSS 제거 — follow-up.
