# 견적 시나리오 비교 표시 + 대표 전환 #4c-3b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 김민준 견적함에서 `scenarios.length >= 2`인 견적을 펼쳐 시나리오를 비교하고, 어느 시나리오를 대표(primary)로 둘지 전환하는 UI를 붙인다.

**Architecture:** 서버 `updateQuote`에 `primary_scenario_id` 검증·갱신 경로를 추가하고(헤더 set과 분리, 해당 quote의 시나리오일 때만 set), 프론트는 `QuoteWritePatch.primaryScenarioId`로 PATCH한다. 표시는 견적 행에 "비교 N ▾" 토글 + 펼침 시나리오 카드 목록(아코디언, 한 번에 한 견적). 대표 전환은 낙관 갱신(평탄화 4필드 동시 갱신) + PATCH + 실패 롤백. 평탄화/금액표기 로직은 `kim-quote.ts`에 순수함수로 모아 단위테스트한다.

**Tech Stack:** TypeScript 6.0.3, Hono + drizzle-orm(서버), React + Vite(프론트), zod(검증), vitest(단위/서버 테스트), bun.

---

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `src/db/queries/customer-quotes.ts` | 견적 query | `QuoteHeaderPatch.primaryScenarioId` + `updateQuote` 검증/set |
| `src/routes/customers.ts` | 견적 라우트 zod | `quotePatchBody.primaryScenarioId` |
| `src/routes/customers.test.ts` | 서버 테스트 | 대표 전환 + 타 quote id 무시 테스트 1건 |
| `client/src/lib/customer-quotes.ts` | 프론트 PATCH 타입/호출 | `QuoteWritePatch.primaryScenarioId` |
| `client/src/lib/kim-quote.ts` | 견적 어댑터/순수헬퍼 | `KimQuoteItem.primaryScenarioId` 매핑 + `flattenPrimaryScenario`/`formatScenarioMoneyMode`/`formatTerm`/`formatMonthly` export |
| `client/src/lib/kim-quote.test.ts` | 단위 테스트 | primaryScenarioId 매핑 + 헬퍼 테스트 |
| `client/src/pages/CustomerDetailPage.tsx` | 견적함 UI | `expandedQuoteId` state + 펼침 비교 카드 + `setPrimaryScenario` 핸들러 |
| `client/src/index.css` | 스타일 | `.kim-quote-compare*` / `.kim-quote-scenario-*` |

---

## Task 1: 서버 — `primary_scenario_id` PATCH 경로 (TDD)

**Files:**
- Modify: `src/db/queries/customer-quotes.ts:7-19` (`QuoteHeaderPatch`), `:72-97` (`updateQuote`)
- Modify: `src/routes/customers.ts:103-116` (`quotePatchBody`)
- Test: `src/routes/customers.test.ts` (새 test 1건, `seedThrowawayQuote` 아래에 추가)

- [ ] **Step 1: 실패하는 서버 테스트 작성**

`src/routes/customers.test.ts`의 `test("견적 쓰기: 교차 고객 가드 ...")` 블록(327~341줄) **바로 아래**에 추가. (`quotes`/`quoteScenarios`/`getDefaultDb`/`eq`/`makeTestAuth`/`createApp`는 이미 import됨.)

```ts
test("견적 쓰기: PATCH primaryScenarioId → 대표 전환 반영, 타 quote 시나리오 id는 무시", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const db = getDefaultDb();
  // 시나리오 2건 견적(대표 = 1번 시나리오).
  const [q] = await db.insert(quotes).values({
    quoteCode: `QT-TEST-${crypto.randomUUID().slice(0, 8)}`,
    customerId: cid, entryMode: "manual", appStatus: "draft", status: "작성중", revision: 0,
  }).returning({ id: quotes.id });
  const [s1] = await db.insert(quoteScenarios).values({ quoteId: q.id, scenarioNo: 1, purchaseMethod: "운용리스", termMonths: 60, lender: "A캐피탈", monthlyPayment: "100" }).returning({ id: quoteScenarios.id });
  const [s2] = await db.insert(quoteScenarios).values({ quoteId: q.id, scenarioNo: 2, purchaseMethod: "할부", termMonths: 36, lender: "B캐피탈", monthlyPayment: "200" }).returning({ id: quoteScenarios.id });
  await db.update(quotes).set({ primaryScenarioId: s1.id }).where(eq(quotes.id, q.id));
  // 타 quote(시나리오 id 무시 검증용).
  const otherQuoteId = await seedThrowawayQuote(cid);
  const [otherScenario] = await db.select({ id: quoteScenarios.id }).from(quoteScenarios).where(eq(quoteScenarios.quoteId, otherQuoteId));
  try {
    // 대표를 2번 시나리오로 전환.
    const patched = await app.request(`/api/customers/${cid}/quotes/${q.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ primaryScenarioId: s2.id }) });
    expect(patched.status).toBe(200);
    const d1 = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { quotes: Array<{ id: string; primaryScenarioId: string | null }> };
    expect(d1.quotes.find((x) => x.id === q.id)!.primaryScenarioId).toBe(s2.id);

    // 타 quote의 시나리오 id → 무시(대표 불변 = s2).
    const ignored = await app.request(`/api/customers/${cid}/quotes/${q.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ primaryScenarioId: otherScenario.id }) });
    expect(ignored.status).toBe(200);
    const d2 = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { quotes: Array<{ id: string; primaryScenarioId: string | null }> };
    expect(d2.quotes.find((x) => x.id === q.id)!.primaryScenarioId).toBe(s2.id);
  } finally {
    await getDefaultDb().delete(quotes).where(eq(quotes.id, q.id));
    await getDefaultDb().delete(quotes).where(eq(quotes.id, otherQuoteId));
  }
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: 새 테스트 FAIL — zod가 `primaryScenarioId`를 모르고 strip하므로 PATCH가 대표를 바꾸지 않아 `expect(...).toBe(s2.id)`가 `s1.id`로 실패.

- [ ] **Step 3: `QuoteHeaderPatch`에 필드 추가 + `updateQuote` 검증/set 구현**

`src/db/queries/customer-quotes.ts`의 `QuoteHeaderPatch`(7~19줄)에 한 줄 추가:

```ts
export type QuoteHeaderPatch = {
  status?: string | null;
  entryMode?: string | null;
  quoteRound?: string | null;
  stockStatus?: string | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  appStatus?: string | null;
  decisionStatus?: string | null;
  note?: string | null;
  primaryScenarioId?: string | null;
  bumpRevision?: boolean;
};
```

> 주의: `headerSet`(42~59줄)에는 `primaryScenarioId`를 **추가하지 않는다**. 검증이 필요하므로 `updateQuote`에서 별도 처리한다(headerSet은 명시 필드만 set하므로 자동 제외됨).

`updateQuote`(72~97줄)를 통째로 교체:

```ts
// 기존 견적 헤더 + (선택)대표 시나리오 1건 갱신 + (선택)대표 전환. customer_id 가드 불일치/없는 quoteId면 null(→404).
// 대표 전환(primaryScenarioId)은 그 id가 이 quote의 시나리오일 때만 set(타 quote/없는 id는 무시). null이면 해제.
export async function updateQuote(
  customerId: string,
  quoteId: string,
  patch: QuotePatch,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string } | null> {
  const [row] = await ex
    .update(quotes)
    .set(headerSet(patch))
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)))
    .returning({ id: quotes.id, primaryScenarioId: quotes.primaryScenarioId });
  if (!row) return null;

  // 대표 전환 또는 대표 시나리오 갱신이 필요할 때만 시나리오 목록을 조회한다.
  const needScenarios = patch.scenario != null || patch.primaryScenarioId !== undefined;
  const scs = needScenarios
    ? await ex
        .select({ id: quoteScenarios.id })
        .from(quoteScenarios)
        .where(eq(quoteScenarios.quoteId, quoteId))
        .orderBy(asc(quoteScenarios.scenarioNo))
    : [];

  // 대표 전환: 이 quote의 시나리오일 때만(또는 null=해제) set. 무효 id는 무시.
  let primaryId = row.primaryScenarioId;
  if (patch.primaryScenarioId !== undefined && (patch.primaryScenarioId === null || scs.some((s) => s.id === patch.primaryScenarioId))) {
    await ex.update(quotes).set({ primaryScenarioId: patch.primaryScenarioId }).where(eq(quotes.id, quoteId));
    primaryId = patch.primaryScenarioId;
  }

  // 대표 시나리오 1건 갱신(헤더 PATCH와 함께 온 경우) — 갱신된 대표 기준.
  if (patch.scenario) {
    const target = scs.find((s) => s.id === primaryId) ?? scs[0];
    if (target) {
      await ex.update(quoteScenarios).set(scenarioSet(patch.scenario)).where(eq(quoteScenarios.id, target.id));
    }
  }
  return { id: row.id };
}
```

- [ ] **Step 4: 라우트 zod에 `primaryScenarioId` 추가**

`src/routes/customers.ts`의 `quotePatchBody`(103~116줄), `note` 다음 줄에 추가:

```ts
  note: z.string().nullable().optional(),
  primaryScenarioId: z.string().uuid().nullable().optional(),
  bumpRevision: z.boolean().optional(),
```

- [ ] **Step 5: 테스트 실행 → 통과 + 회귀 없음**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: 새 테스트 PASS, 기존 견적 PATCH/DELETE/404/교차가드 테스트 전부 PASS.

- [ ] **Step 6: typecheck/lint → 커밋**

```bash
bun run typecheck && bun run lint
git add src/db/queries/customer-quotes.ts src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 견적 대표 시나리오 전환 #4c-3b — primaryScenarioId PATCH(서버)"
```
Expected: typecheck 0, lint 0 problems.

---

## Task 2: 프론트 lib — 타입 + 평탄화/금액표기 헬퍼 (TDD)

**Files:**
- Modify: `client/src/lib/kim-quote.ts` (`KimQuoteItem` 타입, `toKimQuoteItem`, 헬퍼 export)
- Modify: `client/src/lib/customer-quotes.ts:21-39` (`QuoteWritePatch`)
- Test: `client/src/lib/kim-quote.test.ts` (새 describe 추가)

- [ ] **Step 1: 실패하는 단위 테스트 작성**

`client/src/lib/kim-quote.test.ts` 끝(148줄, 파일 마지막 `});` 아래)에 추가. import 줄(3줄)도 교체:

```ts
import { flattenPrimaryScenario, formatScenarioMoneyMode, toKimQuoteItem, type CustomerDetailQuote } from "./kim-quote";
```

파일 끝에 추가:

```ts
describe("toKimQuoteItem primaryScenarioId 노출", () => {
  it("primaryScenarioId를 매핑", () => {
    const k = toKimQuoteItem(makeQuote({ primaryScenarioId: "s1" }), NOW);
    expect(k.primaryScenarioId).toBe("s1");
  });
  it("primaryScenarioId null이면 undefined", () => {
    const k = toKimQuoteItem(makeQuote({ primaryScenarioId: null }), NOW);
    expect(k.primaryScenarioId).toBeUndefined();
  });
});

describe("flattenPrimaryScenario", () => {
  it("시나리오 → 대표 요약 4필드", () => {
    const flat = flattenPrimaryScenario({ id: "s2", scenarioNo: 2, purchaseMethod: "할부", lender: "B캐피탈", termMonths: 36, monthlyPayment: "200", depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: false });
    expect(flat.financeType).toBe("할부");
    expect(flat.term).toBe("36개월");
    expect(flat.monthlyPayment).toBe("월 200원");
    expect(flat.lender).toBe("B캐피탈");
  });
  it("null이면 폴백", () => {
    const flat = flattenPrimaryScenario(null);
    expect(flat.financeType).toBeUndefined();
    expect(flat.term).toBe("조건 미정");
    expect(flat.monthlyPayment).toBeUndefined();
    expect(flat.lender).toBe("금융사 미정");
  });
});

describe("formatScenarioMoneyMode", () => {
  it("percent → N%", () => {
    expect(formatScenarioMoneyMode("percent", "30")).toBe("30%");
  });
  it("amount → 만원 절삭(천단위 콤마)", () => {
    expect(formatScenarioMoneyMode("amount", "10000000")).toBe("1,000만원");
  });
  it("none → 없음, max → 최대", () => {
    expect(formatScenarioMoneyMode("none", null)).toBe("없음");
    expect(formatScenarioMoneyMode("max", null)).toBe("최대");
  });
  it("mode null/빈값/NaN → undefined", () => {
    expect(formatScenarioMoneyMode(null, "30")).toBeUndefined();
    expect(formatScenarioMoneyMode("percent", null)).toBeUndefined();
    expect(formatScenarioMoneyMode("amount", "abc")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts`
Expected: FAIL — `flattenPrimaryScenario`/`formatScenarioMoneyMode` export 없음(`is not a function`), `k.primaryScenarioId` undefined.

- [ ] **Step 3: `kim-quote.ts` 헬퍼 export + 타입/매핑 추가**

(a) `KimQuoteItem`(4~43줄)의 `scenarios?` 위에 한 줄 추가:

```ts
  // #4c-3a 다중 시나리오(비교 표시는 #4c-3b가 소비)
  scenarios?: CustomerDetailScenario[];
  primaryScenarioId?: string;
  originalNeedsReplacement?: boolean;
```

(b) `formatTerm`(125~127줄)과 `formatMonthly`(129~134줄)를 `export function`으로 변경:

```ts
export function formatTerm(termMonths: number | null): string {
  return termMonths != null ? `${termMonths}개월` : "조건 미정";
}

export function formatMonthly(raw: string | null): string | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) return undefined;
  return `월 ${n.toLocaleString("ko-KR")}원`;
}
```

(c) `formatMonthly` 정의 **아래**에 새 헬퍼 2개 추가:

```ts
// 대표 시나리오 → 견적 행 요약 4필드(financeType/term/monthlyPayment/lender). toKimQuoteItem과 "대표로" 핸들러가 공유.
export function flattenPrimaryScenario(
  s: CustomerDetailScenario | null,
): Pick<KimQuoteItem, "financeType" | "term" | "monthlyPayment" | "lender"> {
  return {
    financeType: s?.purchaseMethod ?? undefined,
    term: formatTerm(s?.termMonths ?? null),
    monthlyPayment: formatMonthly(s?.monthlyPayment ?? null),
    lender: s?.lender ?? "금융사 미정",
  };
}

// 시나리오 금액 mode+value 표기. percent→"N%", amount→"N만원"(만원 절삭), none→"없음", max→"최대", 그 외/빈값→undefined.
export function formatScenarioMoneyMode(mode: string | null, value: string | null): string | undefined {
  if (mode === "none") return "없음";
  if (mode === "max") return "최대";
  if (mode === "percent") return value ? `${value}%` : undefined;
  if (mode === "amount") {
    if (!value) return undefined;
    const n = Number(value);
    if (Number.isNaN(n)) return undefined;
    return `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
  }
  return undefined;
}
```

(d) `toKimQuoteItem`(146~180줄)에서 평탄화 4줄을 `flattenPrimaryScenario`로 교체하고 `primaryScenarioId` 매핑 추가. 기존 162~165줄:

```ts
    financeType: primary?.purchaseMethod ?? undefined,
    term: formatTerm(primary?.termMonths ?? null),
    monthlyPayment: formatMonthly(primary?.monthlyPayment ?? null),
    lender: primary?.lender ?? "금융사 미정",
```

을 다음으로 교체:

```ts
    ...flattenPrimaryScenario(primary),
```

그리고 마지막 `scenarios: q.scenarios,`(178줄) 위에 한 줄 추가:

```ts
    primaryScenarioId: q.primaryScenarioId ?? undefined,
    scenarios: q.scenarios,
```

- [ ] **Step 4: `QuoteWritePatch`에 `primaryScenarioId` 추가**

`client/src/lib/customer-quotes.ts`의 `QuoteWritePatch`(21~39줄), `note` 다음 줄에 추가:

```ts
  note?: string | null;
  primaryScenarioId?: string | null;
  bumpRevision?: boolean;
```

- [ ] **Step 5: 단위 테스트 실행 → 통과 + 기존 회귀 없음**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts`
Expected: 새 describe 전부 PASS, 기존 `toKimQuoteItem` 테스트(평탄화/scenarios 보존 포함) PASS.

- [ ] **Step 6: typecheck/lint → 커밋**

```bash
bun run typecheck && bun run lint
git add client/src/lib/kim-quote.ts client/src/lib/kim-quote.test.ts client/src/lib/customer-quotes.ts
git commit -m "feat(crm): 견적 시나리오 평탄화/금액표기 헬퍼 + primaryScenarioId 타입 #4c-3b"
```
Expected: typecheck 0, lint 0 problems.

---

## Task 3: CustomerDetailPage — 펼침 비교 카드 + 대표 전환 핸들러

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx:1` (lucide import), `:5` (kim-quote import), `:917` (state), `:2583` 이후(핸들러), `:4318` 이후(렌더)

> 거대 페이지 컴포넌트라 단위테스트 없이 typecheck + 수동/스크린샷 검증(프로젝트 관례).

- [ ] **Step 1: import 추가 (lucide `Star`, kim-quote 헬퍼)**

1줄 lucide import에서 `Sparkles, Trash2`를 `Sparkles, Star, Trash2`로 교체(알파벳 순):

```ts
import { ArrowLeft, Bot, BriefcaseBusiness, Calculator, CalendarClock, CarFront, Check, ChevronDown, ChevronRight, Download, Eye, File, FilePlus2, FileText, FileUp, FolderOpen, GripVertical, History, Image, ListChecks, MapPin, Maximize2, MessageSquareText, MoreHorizontal, Paperclip, PencilLine, Phone, RefreshCcw, RotateCcw, Route, Send, Smartphone, Sparkles, Star, Trash2, UserRound, X } from "lucide-react";
```

5줄 kim-quote import를 교체:

```ts
import { toKimQuoteItem, flattenPrimaryScenario, formatMonthly, formatScenarioMoneyMode, type KimQuoteItem } from "@/lib/kim-quote";
```

- [ ] **Step 2: `expandedQuoteId` state 추가**

`client/src/pages/CustomerDetailPage.tsx:917`의 `const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null);` **아래**에 추가:

```ts
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null);
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
```

- [ ] **Step 3: `setPrimaryScenario` 핸들러 추가**

`updateQuoteDecisionStatus` 함수가 끝나는 `}`(2583줄) **아래**에 추가:

```ts
  function setPrimaryScenario(quoteId: string, scenarioId: string) {
    const prevQuotes = quotes;
    setQuotes((current) => current.map((quote) => {
      if (quote.id !== quoteId) return quote;
      const next = quote.scenarios?.find((s) => s.id === scenarioId) ?? null;
      return { ...quote, primaryScenarioId: scenarioId, ...flattenPrimaryScenario(next) };
    }));
    if (customer.id && !quoteId.startsWith("kim-")) {
      void apiUpdateQuote(customer.id, quoteId, { primaryScenarioId: scenarioId }).catch(() => { setQuotes(prevQuotes); onToast("대표 시나리오 저장에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast("대표 시나리오를 변경했습니다.");
  }
```

- [ ] **Step 4: 펼침 비교 UI 렌더 추가**

`client/src/pages/CustomerDetailPage.tsx`의 견적 행 `kim-quote-row-main` 안, `{quote.note ? <p className="kim-quote-row-note">{quote.note}</p> : null}`(4318줄) **아래**(`</div>` 닫기 전)에 추가:

```tsx
                    {quote.note ? <p className="kim-quote-row-note">{quote.note}</p> : null}
                    {quote.scenarios && quote.scenarios.length >= 2 ? (
                      <div className="kim-quote-compare">
                        <button
                          type="button"
                          className={`kim-quote-compare-toggle${expandedQuoteId === quote.id ? " is-open" : ""}`}
                          aria-expanded={expandedQuoteId === quote.id}
                          onClick={() => setExpandedQuoteId((current) => (current === quote.id ? null : quote.id))}
                        >
                          비교 {quote.scenarios.length}
                          <ChevronDown size={12} strokeWidth={2.6} />
                        </button>
                        {expandedQuoteId === quote.id ? (
                          <ul className="kim-quote-scenario-cards">
                            {[...quote.scenarios]
                              .sort((a, b) => (a.scenarioNo ?? 0) - (b.scenarioNo ?? 0))
                              .map((scenario) => {
                                const isPrimary = (quote.primaryScenarioId ?? null) === scenario.id;
                                const monthly = formatMonthly(scenario.monthlyPayment);
                                const deposit = formatScenarioMoneyMode(scenario.depositMode, scenario.depositValue);
                                const downPayment = formatScenarioMoneyMode(scenario.downPaymentMode, scenario.downPaymentValue);
                                const residual = formatScenarioMoneyMode(scenario.residualMode, scenario.residualValue);
                                return (
                                  <li key={scenario.id} className={`kim-quote-scenario-card${isPrimary ? " is-primary" : ""}`}>
                                    <div className="kim-quote-scenario-head">
                                      <span className="kim-quote-scenario-no">{scenario.scenarioNo ?? "-"}</span>
                                      {scenario.lender ? <span className="kim-quote-scenario-lender">{scenario.lender}</span> : null}
                                      {isPrimary ? (
                                        <span className="kim-quote-scenario-star"><Star size={11} strokeWidth={2.6} />대표</span>
                                      ) : (
                                        <button type="button" className="kim-quote-scenario-pick" onClick={() => setPrimaryScenario(quote.id, scenario.id)}>대표로</button>
                                      )}
                                    </div>
                                    <div className="kim-quote-scenario-figures">
                                      {monthly ? <strong>{monthly}</strong> : <span>월 납입금 미정</span>}
                                      {deposit ? <span>보증금 {deposit}</span> : null}
                                      {downPayment ? <span>선수금 {downPayment}</span> : null}
                                      {residual ? <span>잔존 {residual}</span> : null}
                                      {scenario.mileageValue ? <span>약정 {scenario.mileageValue}</span> : null}
                                    </div>
                                  </li>
                                );
                              })}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
```

- [ ] **Step 5: typecheck → 커밋**

```bash
bun run typecheck && bun run lint
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 견적함 시나리오 펼침 비교 + 대표 전환 핸들러 #4c-3b"
```
Expected: typecheck 0, lint 0 problems.

---

## Task 4: CSS — 펼침 비교 카드 스타일

**Files:**
- Modify: `client/src/index.css` (`.kim-quote-color-chip i` 규칙 8324줄 닫기 `}` 아래에 삽입)

- [ ] **Step 1: 스타일 추가**

`client/src/index.css`의 `.kim-quote-color-chip i { ... }`(8319~8324줄) **아래**에 추가:

```css
/* #4c-3b 시나리오 비교 펼침(아코디언) */
.kim-quote-compare {
  margin-top: 6px;
}
.kim-quote-compare-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  background: #f7f8fa;
  color: #4f5862;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.kim-quote-compare-toggle:hover {
  border-color: rgba(88, 54, 255, 0.34);
  color: var(--brand);
}
.kim-quote-compare-toggle svg {
  transition: transform 0.18s ease;
}
.kim-quote-compare-toggle.is-open svg {
  transform: rotate(180deg);
}
.kim-quote-scenario-cards {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kim-quote-scenario-card {
  border: 1px solid #e4e4e2;
  border-radius: 6px;
  padding: 7px 9px;
  background: #fbfbfa;
}
.kim-quote-scenario-card.is-primary {
  border-color: rgba(88, 54, 255, 0.34);
  background: #f6f4ff;
}
.kim-quote-scenario-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kim-quote-scenario-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 4px;
  background: #eceef1;
  color: #5f6872;
  font-size: 10px;
  font-weight: 800;
}
.kim-quote-scenario-lender {
  color: #30363d;
  font-size: 11.5px;
  font-weight: 760;
}
.kim-quote-scenario-star {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  color: var(--brand);
  font-size: 10.5px;
  font-weight: 800;
}
.kim-quote-scenario-pick {
  margin-left: auto;
  height: 20px;
  padding: 0 8px;
  border: 1px solid rgba(88, 54, 255, 0.22);
  border-radius: 5px;
  background: #f4f1ff;
  color: var(--brand);
  font-size: 10.5px;
  font-weight: 760;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.kim-quote-scenario-pick:hover {
  background: #ece8ff;
  border-color: rgba(88, 54, 255, 0.4);
}
.kim-quote-scenario-figures {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 10px;
  margin-top: 5px;
  font-size: 11px;
  color: #5f6872;
}
.kim-quote-scenario-figures strong {
  color: #155eef;
  font-weight: 820;
}
```

- [ ] **Step 2: 빌드 확인**

Run: `bun run build`
Expected: 빌드 성공(CSS 경고 0).

- [ ] **Step 3: 커밋**

```bash
git add client/src/index.css
git commit -m "style(crm): 견적 시나리오 비교 펼침 카드 스타일 #4c-3b"
```

---

## Task 5: 최종 검증 + brief 갱신

**Files:**
- Modify: `ref/active-session-brief.md` (Current Focus 갱신)

- [ ] **Step 1: 전체 검증 4종**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun test --env-file=.env.local && bun run build
```
Expected: typecheck 0 · lint 0 · test:unit 통과(kim-quote 신규 케이스 포함) · test:server 통과(견적 대표 전환 신규 포함, 기존 58 + 1 = 59) · build OK.

- [ ] **Step 2: brief 갱신**

`ref/active-session-brief.md`의 `## Current Focus` 헤더와 #4c-3b 항목을 "spec만 → 구현 main 머지 반영"으로 갱신. 검증 수치(test:unit/test:server 신규 합계) 기입. **⏳브라우저 검증 미완**(#4c 일괄, 인증 세션 필요)으로 표기. 60줄 이하 유지(AGENTS.md 핸드오프 규칙).

- [ ] **Step 3: brief 커밋**

```bash
git add ref/active-session-brief.md ref/plans/2026-06-22-crm-quotes-scenario-compare.md
git commit -m "docs(brief,plan): #4c-3b 시나리오 비교 표시+대표 전환 구현 반영"
```

- [ ] **Step 4: PR 흐름은 사용자 지시 후**

브랜치/PR/머지는 사용자(송실장/유슨생)가 지시할 때 진행(CLAUDE.md: 커밋/푸시는 사용자 지시 시). 인프라 아닌 견적 UI라 PR 권장(brief 관례). `[skip ci]` 토큰 금지.

---

## Self-Review (작성자 체크 완료)

**1. Spec coverage**
- 표시 설계(펼침 아코디언, scenarios>=2, expandedQuoteId, scenario_no 오름차순, ★/대표로) → Task 3 Step 4 ✅
- 대표 전환(KimQuoteItem.primaryScenarioId, 서버 검증 set, 프론트 낙관+PATCH+롤백, 대표 평탄화 갱신, kim- 가드) → Task 1·2·3 ✅
- 계층 변경 5곳(customer-quotes.ts query, customers.ts zod, customer-quotes.ts lib, kim-quote.ts, CustomerDetailPage+css) → Task 1~4 ✅
- 검증(server: primaryScenarioId 반영 + 타 quote 무시 / unit: 매핑 + 헬퍼) → Task 1 Step 1, Task 2 Step 1 ✅

**2. Placeholder scan** — 모든 step에 실제 코드/명령/기대출력 포함, TBD/생략 없음 ✅

**3. Type consistency**
- `flattenPrimaryScenario(s: CustomerDetailScenario | null)` → Task 2 정의, Task 3 핸들러에서 동일 시그니처 호출 ✅
- `formatScenarioMoneyMode(mode, value)` → Task 2 정의, Task 3 카드에서 동일 호출 ✅
- `QuoteWritePatch.primaryScenarioId?: string | null` ↔ 서버 `quotePatchBody`(uuid nullable optional) ↔ `QuoteHeaderPatch.primaryScenarioId?: string | null` 일치 ✅
- `setPrimaryScenario(quoteId, scenarioId)` 호출부(카드 "대표로")와 정의 시그니처 일치 ✅
- `KimQuoteItem.primaryScenarioId?: string`(undefined 폴백) ↔ `toKimQuoteItem`의 `?? undefined` 일치 ✅

**주의(구현자용 caveat):**
- `apiUpdateQuote`는 성공 시 `invalidateCustomerDetail` 호출(상세 캐시 불변식) — 이미 `customer-quotes.ts`에 있음, 추가 작업 불필요.
- 임시 id(`kim-`) 견적은 저장 전이라 PATCH 생략(낙관 갱신만) — `setPrimaryScenario` 가드 포함.
- `headerSet`에 `primaryScenarioId`를 넣지 말 것(검증 우회됨). `updateQuote`에서만 처리.
