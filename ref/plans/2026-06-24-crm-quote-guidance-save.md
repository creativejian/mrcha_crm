# 견적 "추가 안내 사항" 저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 워크벤치 "추가 안내 사항"(출고시기·재고·예상출고·고객지역·핵심포인트·추천이유·서비스1~4)을 `quotes.guidance` jsonb에 저장하고, 워크벤치 입력을 controlled로 wiring해 저장·복원되게 한다.

**Architecture:** quotes에 jsonb 컬럼 1개(`guidance`) 추가(options/discount_lines 패턴). 백엔드 create/updateQuote + zod가 guidance를 통과시키고, getCustomer는 `select()` 전체 컬럼이라 자동 노출. 프론트는 추가 안내 입력을 `guidance` state(controlled)로 바꿔 persistWorkbenchQuote에서 추출·저장, 수정 진입 시 editPrefill로 복원.

**Tech Stack:** Drizzle(jsonb)·Hono·zod·React·TypeScript. 마이그레이션 1개(crm only, additive). 검증=typecheck/lint/test:server/test:unit/build + 브라우저.

**Context (compact 대비):** spec=`ref/specs/2026-06-24-crm-quote-guidance-save-design.md`. 범위=DB저장+wiring만(미리보기/앱 노출·enum/lookup·stock_status통합은 비범위). 재고여부(guidance.stockNotice)는 기존 `stock_status`와 별개. select 옵션은 프론트 상수(enum/lookup화는 나중).

**기존 코드 위치(라인은 grep으로 재확인):**
- `src/db/schema.ts`: `quotes`(120~168), jsonb 패턴=`options`(141)·`discountLines`(143).
- `src/db/queries/customer-quotes.ts`: `QuoteHeaderPatch`(7)·`headerSet`(60~)·`updateQuote`(111)·`QuoteCreateBody`(186)·`createQuote`(255~293 insert).
- `src/routes/customers.ts`: `quoteCreateBody`(72)·`quotePatchBody`(103) zod. (stockStatus가 `z.enum` 패턴, note가 `z.string().nullable().optional()`.)
- `src/db/queries/customers.ts`: getCustomer quotes=`executor.select().from(quotes)...`(103) — **전체 컬럼 select라 guidance 자동 포함**.
- `client/src/lib/kim-quote.ts`: `KimQuoteItem`(4)·`CustomerDetailQuote`(70)·`toKimQuoteItem`(185).
- `client/src/pages/CustomerDetailPage.tsx`: 추가안내 JSX(`kim-app-guidance-grid`, 출고시기 코멘트~서비스4~핵심포인트~추천이유, grep `kim-app-guidance-grid`)·`KimEditPrefill`(110)·수정진입 `setEditPrefill(dq ? {`(4404)·신규열기(grep `setManualQuoteCards([...kimManualQuoteConditionCards])` 직전 핸들러)·`persistWorkbenchQuote`(grep).
- 서버 테스트=`src/routes/customers.test.ts`, 프론트=`client/src/lib/kim-quote.test.ts`.

---

## Task 1: schema + 마이그레이션 (quotes.guidance jsonb)

**Files:** Modify `src/db/schema.ts`, 생성 `drizzle/0004_*.sql`

- [ ] **Step 1: schema에 guidance 컬럼 추가**

`src/db/schema.ts` quotes 테이블의 `note: text("note"),`(157) 줄 다음에 추가(grep `note: text("note")`):

```ts
  guidance: jsonb("guidance"), // {deliveryComment, stockNotice, expectedDelivery, customerRegion, keyPoint, recommendReason, services[]} — 앱 노출용 안내, 표시 전용
```

(`jsonb`는 이미 import됨 — `options`/`discountLines`에서 사용 중.)

- [ ] **Step 2: 마이그레이션 생성**

Run: `bun run db:generate`
Expected: `drizzle/0004_*.sql` 생성, 내용은 `ALTER TABLE "crm"."quotes" ADD COLUMN "guidance" jsonb;` (crm only, nullable·additive). diff에 crm.quotes만 있는지 확인(public/catalog 불가침).

- [ ] **Step 3: 마이그레이션 적용**

Run: `bun run db:migrate`
Expected: 0004 적용 성공. (⚠️ master 공유 DB — generate→migrate만, `db:push` 금지.)

- [ ] **Step 4: typecheck**

Run: `bun run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): quotes.guidance jsonb 컬럼 추가 (추가 안내 사항 저장용)"
```

---

## Task 2: 백엔드 create/update + zod + 서버 테스트

**Files:** Modify `src/db/queries/customer-quotes.ts`, `src/routes/customers.ts`, Test `src/routes/customers.test.ts`

- [ ] **Step 1: guidance 타입 + 쿼리 통과**

`src/db/queries/customer-quotes.ts` 상단(타입 근처)에 추가:

```ts
export type QuoteGuidanceInput = {
  deliveryComment: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  keyPoint: string;
  recommendReason: string;
  services: string[];
};
```

`QuoteHeaderPatch`(7~)에 `guidance?: QuoteGuidanceInput | null;` 추가.
`QuoteCreateBody`(186~)에 `guidance?: QuoteGuidanceInput | null;` 추가.
`headerSet`(grep `if (p.note !== undefined) set.note = p.note;`) 다음 줄에 추가:

```ts
  if (p.guidance !== undefined) set.guidance = p.guidance;
```

`createQuote` insert(grep `note: body.note ?? null,`) 다음에 추가:

```ts
    guidance: body.guidance ?? null,
```

- [ ] **Step 2: zod 스키마**

`src/routes/customers.ts`에 quoteCreateBody 앞에 공유 스키마 추가(grep `const quoteCreateBody = z.object({`):

```ts
const quoteGuidanceSchema = z.object({
  deliveryComment: z.string(),
  stockNotice: z.string(),
  expectedDelivery: z.string(),
  customerRegion: z.string(),
  keyPoint: z.string(),
  recommendReason: z.string(),
  services: z.array(z.string()),
});
```

`quoteCreateBody`(72~)와 `quotePatchBody`(103~) 각각에 `note:` 줄 옆에 추가:

```ts
  guidance: quoteGuidanceSchema.nullable().optional(),
```

- [ ] **Step 3: 서버 테스트 작성 (라운드트립)**

`src/routes/customers.test.ts`에 기존 createQuote/updateQuote 테스트 옆에 추가(grep 기존 quote 테스트 패턴 따름). 핵심: POST로 guidance 포함 생성 → getCustomer 응답에 guidance 일치, PATCH로 guidance 수정 → 반영, guidance 생략 시 null 허용.

```ts
it("견적 생성·수정 시 guidance(추가 안내)가 라운드트립된다", async () => {
  const guidance = {
    deliveryComment: "이 차량은 1주일 내 출고 가능해요",
    stockNotice: "재고 확인 필요",
    expectedDelivery: "확인 후 안내",
    customerRegion: "인천",
    keyPoint: "초기 부담을 낮추는 조건입니다.",
    recommendReason: "안정적인 조건입니다.",
    services: ["썬팅", "블랙박스", "", ""],
  };
  // POST /:id/quotes with guidance → 200, 반환 id
  // GET /:id → quotes[].guidance === guidance
  // PATCH /:id/quotes/:childId { guidance: {...stockNotice:"즉시 출고 가능"} } → 200
  // GET 재조회 → 반영 확인
});
```

(기존 테스트 파일의 helper/세팅(앱 인스턴스·테스트 고객 생성)을 그대로 재사용. 정확한 helper 이름은 파일 상단 확인.)

- [ ] **Step 4: typecheck + test:server**

Run: `bun run typecheck` → 0 · `bun run test:server` → PASS(기존 62 + 신규).

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/customer-quotes.ts src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): create/updateQuote + zod에 guidance 통과 + 서버 라운드트립 테스트"
```

---

## Task 3: 상수 + 읽기 어댑터 + 단위테스트

**Files:** Create `client/src/data/quote-guidance.ts`, Modify `client/src/lib/kim-quote.ts`, Test `client/src/lib/kim-quote.test.ts`

- [ ] **Step 1: 상수 파일 생성**

`client/src/data/quote-guidance.ts`:

```ts
export type QuoteGuidance = {
  deliveryComment: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  keyPoint: string;
  recommendReason: string;
  services: string[];
};

export const QUOTE_GUIDANCE_OPTIONS = {
  deliveryComment: [
    "이 차량은 1주일 내 출고 가능해요",
    "배정 확인 후 출고 일정을 안내드릴게요",
    "주문 후 생산 일정 확인이 필요해요",
    "색상 확정 후 출고 가능 시점을 안내드릴게요",
  ],
  stockNotice: ["재고 확인 필요", "즉시 출고 가능", "배정 대기", "주문 필요"],
  expectedDelivery: ["확인 후 안내", "1주일 이내", "2주 이내", "1개월 이내", "1개월 이상"],
  customerRegion: ["서울", "인천", "경기", "부산", "대구", "광주", "대전", "기타"],
  keyPoint: [
    "잔존가치 최대 조건으로 월 납입금을 낮춘 조건입니다.",
    "초기 부담을 낮추는 조건입니다.",
    "월 납입금과 초기 비용 균형을 맞춘 조건입니다.",
    "인수 선택까지 고려한 안정적인 조건입니다.",
  ],
} as const;

// 신규 견적 작성 시 기본 제안값(상담사가 수정). select는 첫 옵션, services는 자주 쓰는 제안.
export const DEFAULT_QUOTE_GUIDANCE: QuoteGuidance = {
  deliveryComment: QUOTE_GUIDANCE_OPTIONS.deliveryComment[0],
  stockNotice: QUOTE_GUIDANCE_OPTIONS.stockNotice[0],
  expectedDelivery: QUOTE_GUIDANCE_OPTIONS.expectedDelivery[0],
  customerRegion: QUOTE_GUIDANCE_OPTIONS.customerRegion[0],
  keyPoint: QUOTE_GUIDANCE_OPTIONS.keyPoint[0],
  recommendReason: "",
  services: [
    "썬팅: 후퍼옵틱 KBR 전면 + 측후면 제공",
    "블랙박스: 기본 제공",
    "출고 기념품: 키케이스, 주차번호판, 머그컵",
    "담당 카매니저 출고 일정 개별 안내",
  ],
};
```

- [ ] **Step 2: 읽기 어댑터에 guidance 추가**

`client/src/lib/kim-quote.ts`:
- 상단 import: `import type { QuoteGuidance } from "@/data/quote-guidance";`
- `CustomerDetailQuote`(70~)에 `guidance: QuoteGuidance | null;` 추가.
- `KimQuoteItem`(4~)에 `guidance?: QuoteGuidance;` 추가.
- `toKimQuoteItem`(185~) 반환 객체에 `guidance: q.guidance ?? undefined,` 추가.

- [ ] **Step 3: 단위테스트**

`client/src/lib/kim-quote.test.ts`에 추가:

```ts
it("toKimQuoteItem이 guidance를 매핑한다", () => {
  const g = { deliveryComment: "a", stockNotice: "b", expectedDelivery: "c", customerRegion: "d", keyPoint: "e", recommendReason: "f", services: ["s"] };
  const base = /* 기존 테스트의 CustomerDetailQuote fixture 패턴 따라 구성 */ makeQuote({ guidance: g });
  expect(toKimQuoteItem(base, 0).guidance).toEqual(g);
});
it("guidance null이면 undefined로 매핑한다", () => {
  const base = makeQuote({ guidance: null });
  expect(toKimQuoteItem(base, 0).guidance).toBeUndefined();
});
```

(파일 상단의 기존 CustomerDetailQuote fixture 헬퍼/구조를 재사용해 `guidance` 필드만 채운다. 헬퍼가 없으면 기존 테스트가 쓰는 완전한 객체 리터럴을 복제하고 guidance만 추가.)

- [ ] **Step 4: typecheck + test:unit**

Run: `bun run typecheck` → 0 · `bun run test:unit` → PASS(기존 224 + 신규).

- [ ] **Step 5: Commit**

```bash
git add client/src/data/quote-guidance.ts client/src/lib/kim-quote.ts client/src/lib/kim-quote.test.ts
git commit -m "feat(crm): quote-guidance 상수 + kim-quote 읽기 어댑터 guidance 매핑"
```

---

## Task 4: 프론트 wiring (controlled state + 추출/복원/리셋)

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

거대 컴포넌트라 TDD 대신 typecheck+lint+브라우저 검증(brief 관례).

- [ ] **Step 1: import + state**

상단 import에 추가:

```ts
import { DEFAULT_QUOTE_GUIDANCE, QUOTE_GUIDANCE_OPTIONS, type QuoteGuidance } from "@/data/quote-guidance";
```

`editingQuoteId` state 근처(grep `const [editingQuoteId`)에 추가:

```ts
  const [guidance, setGuidance] = useState<QuoteGuidance>(DEFAULT_QUOTE_GUIDANCE);
```

- [ ] **Step 2: 추가안내 JSX를 controlled로 전환**

`kim-app-guidance-grid` 영역(grep) 각 입력을 controlled로. select는 `value={guidance.X}` + `onChange`, input/textarea도 동일. `defaultValue`/하드코딩 `<option>`을 상수 map으로. 예(출고시기 코멘트):

```tsx
<label>
  <span>출고시기 코멘트</span>
  <select value={guidance.deliveryComment} onChange={(e) => setGuidance((g) => ({ ...g, deliveryComment: e.currentTarget.value }))}>
    {QUOTE_GUIDANCE_OPTIONS.deliveryComment.map((o) => <option key={o}>{o}</option>)}
  </select>
</label>
```

동일 패턴 적용:
- `stockNotice`(재고여부)·`expectedDelivery`(예상 출고 기간)·`customerRegion`(고객 지역)·`keyPoint`(핵심포인트) → `<select value={guidance.X} onChange=...>{QUOTE_GUIDANCE_OPTIONS.X.map(...)}</select>`
- `recommendReason`(추천이유) → `<textarea value={guidance.recommendReason} onChange={(e) => setGuidance((g) => ({ ...g, recommendReason: e.currentTarget.value }))} rows={2} />`
- 서비스 1~4 → `<input value={guidance.services[i]} onChange={(e) => setGuidance((g) => { const s = [...g.services]; s[i] = e.currentTarget.value; return { ...g, services: s }; })} />` (i=0..3)

- [ ] **Step 3: persistWorkbenchQuote에서 guidance 저장**

`persistWorkbenchQuote`(grep `function persistWorkbenchQuote`)의 `snapshot` 객체에 `guidance,` 추가(state를 그대로). → UPDATE patch·INSERT payload 둘 다 snapshot spread로 전달되므로 자동 포함. (snapshot이 patch/payload에 `...snapshot`으로 들어가는지 확인 — 들어감.)

- [ ] **Step 4: 수정 진입 복원**

`KimEditPrefill`(110)에 `guidance: QuoteGuidance | null;` 추가.
수정 진입 `setEditPrefill(dq ? {`(grep)에 `guidance: dq.guidance ?? null,` 추가.
그리고 같은 핸들러에서 `setEditingQuoteId(openQuoteAction.id)` 근처에 `setGuidance(dq?.guidance ?? DEFAULT_QUOTE_GUIDANCE);` 추가(복원). (dq=detail quote, grep로 변수명 확인.)

- [ ] **Step 5: 신규 열기 리셋**

신규 워크벤치 열기 핸들러(grep `setManualQuoteCards([...kimManualQuoteConditionCards]);` 중 신규 분기, `setEditingQuoteId(null)` 있는 곳)에 `setGuidance(DEFAULT_QUOTE_GUIDANCE);` 추가.

- [ ] **Step 6: typecheck + lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0.
실패 시: `guidance.services[i]` 인덱스 타입, `QuoteGuidance` import 경로 확인.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 워크벤치 추가 안내 입력 controlled wiring + 저장/복원/리셋"
```

---

## Task 5: 전체 검증 + PR

- [ ] **Step 1: 검증 5종**

Run: `bun run typecheck` → 0 · `bun run lint` → 0 · `bun run test:unit` → PASS · `bun run test:server` → PASS · `bun run build` → OK.

- [ ] **Step 2: PR (spec·plan은 이미 main에 커밋됨, 코드만)**

브랜치는 Task 1 시작 전 생성: `feat/crm-quote-guidance-save`.

```bash
git push -u origin feat/crm-quote-guidance-save
gh pr create --base main --head feat/crm-quote-guidance-save \
  --title "feat(crm): 견적 추가 안내 사항 저장 (guidance jsonb)" \
  --body "<spec 링크 + 변경 요약 + 브라우저 실측 체크리스트. skip-ci 토큰 금지>"
```

---

## 브라우저 실측 (카카오 세션, 머지 전)

- 워크벤치 추가 안내 입력 변경 → "작성완료" → 리로드 시 유지
- 수정 진입 시 저장된 추가 안내 복원(기존 견적은 기본값)
- 신규 작성 시 기본값으로 시작
- 견적별로 다른 추가 안내 유지

## Self-Review (작성자 체크 결과)

- **Spec coverage:** guidance jsonb 컬럼(Task1)·백엔드 create/update/zod(Task2)·읽기 어댑터+상수(Task3)·controlled wiring+추출/복원/리셋(Task4) — spec 전 항목 커버. 미리보기/앱·enum/lookup·stock_status통합은 비범위로 제외(spec 일치). ✅
- **Placeholder scan:** 코드 스텝은 실제 코드. 테스트 fixture는 "기존 헬퍼 재사용" 지시(파일별 헬퍼명이 달라 grep 위임) — 구조는 제시. PR 본문만 실행 시 채움.
- **Type consistency:** `QuoteGuidance`(프론트, quote-guidance.ts) ↔ `QuoteGuidanceInput`(서버, customer-quotes.ts) 동일 형태(7필드, services string[]). zod `quoteGuidanceSchema`도 동일. `guidance` 필드명 전 Task 일관. ✅
- **주의:** 서버/프론트 guidance 타입이 두 곳(의도적 분리 — 서버는 client import 불가). 형태 불일치 시 런타임 zod가 잡음. customerRegion 기본값=첫 옵션 "서울"(현재 mock "인천"과 다름, 의도적 통일).
