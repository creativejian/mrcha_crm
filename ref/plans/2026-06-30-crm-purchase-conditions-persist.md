# 상세 구매조건 7필드 영속 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 상세 "상세 구매조건"의 미저장 7필드(계약기간·초기비용·연간 주행거리·인도 방식·계약 포커스·고객 특이사항·심사 특이사항)를 `crm.customers`에 영속화한다.

**Architecture:** 고객 단위 니즈로 보고 `crm.customers`에 7개 nullable text 컬럼을 추가한다. 단일선택 닫힌집합 3개(계약기간·연간주행·인도방식)는 DB CHECK + `client/src/data` 코드 상수 SSOT로 무결성을 보장하고(계약기간은 다중→단일 UI로 전환), 나머지 4개는 직렬화 text다. 쓰기는 기존 `savePatch`(PATCH /api/customers/:id) + `invalidateCustomerDetail` 인프라를 `needMethod` 패턴 그대로 재사용한다.

**Tech Stack:** TypeScript 6.0.3, Drizzle ORM(crm 스키마, `schemaFilter:["crm"]`), Hono + zod(백엔드), React(프론트), vitest(test:unit), bun test(test:server).

**Spec:** `ref/specs/2026-06-30-crm-purchase-conditions-persist-design.md`

---

## 파일 구조

| 파일 | 역할 | 변경 |
|---|---|---|
| `client/src/data/customers.ts` | enum/옵션 상수 SSOT | 상수 3개 추가 |
| `src/db/schema.ts` | crm 스키마 정의 | customers 7컬럼 + 3 CHECK |
| `drizzle/0009_*.sql` | 마이그레이션 | 생성·적용 (crm only) |
| `src/db/queries/customers.ts` | 쿼리·쓰기 타입 | `CustomerWritePatch` Pick 7컬럼 |
| `src/routes/customers.ts` | PATCH zod 검증 | `customerWriteSchema` 7필드 |
| `src/routes/customers.test.ts` | 서버 테스트 | 파싱·라운드트립 테스트 |
| `client/src/lib/customers.ts` | 어댑터·타입 | Response/Data/매핑/Patch 4곳 |
| `client/src/lib/customers.test.ts` | lib 단위 테스트 | fixture·매핑 테스트 |
| `client/src/components/customer-detail/purchase-meta.ts` | 구매조건 메타 SSOT | 상수 re-export + label→key 맵 |
| `client/src/components/customer-detail/hooks/useCustomerPurchase.ts` | 구매조건 상태·핸들러 | 초기화 9필드 + 7핸들러 savePatch + 계약기간 단일화 |
| `client/src/components/customer-detail/PurchaseConditions.tsx` | 구매조건 렌더 | 계약기간 단일 UI + 핸들러명 |

**범위 밖:** `savePurchaseConditions`/`renderPurchaseEditor`(인라인 일괄 폼, `{kind:"purchase"}`)는 코드에 여는 트리거가 없는 **비활성 코드**라 건드리지 않는다(단일선택 CHECK 컬럼에 자유텍스트가 들어갈 위험만 새로 생김).

---

## Task 1: 상수 SSOT + 스키마 컬럼 + 마이그레이션

**Files:**
- Modify: `client/src/data/customers.ts:81` (PURCHASE_METHOD_OPTIONS 아래)
- Modify: `src/db/schema.ts:18-27` (import), `:80` (컬럼), `:83-89` (CHECK)
- Create: `drizzle/0009_*.sql` (db:generate 산출)

- [ ] **Step 1: `data/customers.ts`에 상수 3개 + sentinel 추가**

`PURCHASE_METHOD_OPTIONS`/`PurchaseMethod` 정의(81-82행) **바로 아래**에 추가:

```ts
// 계약기간(need_contract_term) — 단일선택 닫힌 5종. DB CHECK·purchase-meta 공유 SSOT.
export const CONTRACT_TERM_OPTIONS: readonly string[] = ["12개월", "24개월", "36개월", "48개월", "60개월"];

// 연간 주행거리(need_annual_mileage) — 단일선택 닫힌 8종. DB CHECK·purchase-meta 공유 SSOT.
export const ANNUAL_MILEAGE_OPTIONS: readonly string[] = ["10,000km", "15,000km", "20,000km", "25,000km", "30,000km", "35,000km", "40,000km", "무제한"];

// 인도 방식(need_delivery_method) — 단일선택 닫힌 4종. DB CHECK·purchase-meta 공유 SSOT.
export const DELIVERY_METHOD_OPTIONS: readonly string[] = ["탁송 요청", "매장 출고", "직접 수령", "협의 필요"];

// 단일선택 구매조건의 "선택 해제" sentinel. DB CHECK 집합에 옵션과 함께 포함된다(선택 해제 시 저장값).
export const PURCHASE_UNSET_SENTINEL = "확인 필요";
```

- [ ] **Step 2: `schema.ts` import에 상수 4개 추가**

`schema.ts`의 `client/src/data/customers` import 블록(18-27행)에 추가:

```ts
import {
  CHANCE_OPTIONS,
  SOURCE_OPTIONS,
  DOC_TYPE_OPTIONS,
  TASK_CATEGORY_OPTIONS,
  SCHEDULE_TYPE_OPTIONS,
  PURCHASE_METHOD_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
  CONTRACT_TERM_OPTIONS,
  ANNUAL_MILEAGE_OPTIONS,
  DELIVERY_METHOD_OPTIONS,
  PURCHASE_UNSET_SENTINEL,
  customerStatusGroups,
} from "../../client/src/data/customers";
```

- [ ] **Step 3: `customers` 테이블에 7컬럼 추가**

`needMemo: text("need_memo"),`(80행) **바로 아래**에 추가:

```ts
  needContractTerm: text("need_contract_term"),
  needInitialCost: text("need_initial_cost"),
  needAnnualMileage: text("need_annual_mileage"),
  needDeliveryMethod: text("need_delivery_method"),
  needContractFocus: text("need_contract_focus"),
  needCustomerNote: text("need_customer_note"),
  needReviewNote: text("need_review_note"),
```

- [ ] **Step 4: `customers` CHECK 배열에 단일선택 3개 추가**

`customers`의 `(t) => [ ... ]` 배열(83-89행) 안, `customers_customer_type_check` 줄 아래에 추가:

```ts
  check("customers_need_contract_term_check", inListCheck(t.needContractTerm, [...CONTRACT_TERM_OPTIONS, PURCHASE_UNSET_SENTINEL])),
  check("customers_need_annual_mileage_check", inListCheck(t.needAnnualMileage, [...ANNUAL_MILEAGE_OPTIONS, PURCHASE_UNSET_SENTINEL])),
  check("customers_need_delivery_method_check", inListCheck(t.needDeliveryMethod, [...DELIVERY_METHOD_OPTIONS, PURCHASE_UNSET_SENTINEL])),
```

- [ ] **Step 5: typecheck로 스키마 정합 확인**

Run: `bun run typecheck`
Expected: 0 errors (상수 import·컬럼·CHECK 타입 정합).

- [ ] **Step 6: 마이그레이션 생성**

Run: `bun run db:generate`
Expected: `drizzle/0009_*.sql` 생성. 콘솔에 "7 columns added" 류 요약.

- [ ] **Step 7: 마이그레이션 내용 리뷰**

생성된 `drizzle/0009_*.sql`을 열어 확인:
- `ALTER TABLE "crm"."customers" ADD COLUMN "need_contract_term" text;` 등 **7개 ADD COLUMN**.
- `ADD CONSTRAINT "customers_need_contract_term_check" CHECK (... IS NULL OR ... IN ('12개월', ...))` 등 **3개 CHECK** (값이 `sql.raw` 리터럴로 inline).
- **crm 스키마만** 건드리는지(public/catalog 테이블이 없는지) 확인. 있으면 중단하고 점검.

- [ ] **Step 8: 마이그레이션 적용 (⚠️ master DB — 팀 공유)**

Run: `bun run db:migrate`
Expected: 0009 적용 성공. additive nullable + CHECK라 기존 행(전부 null) 위반 없음.
주의: `db:push` 금지. master DB 변경이므로 적용 사실을 사용자에게 알린다.

- [ ] **Step 9: 커밋**

```bash
git add client/src/data/customers.ts src/db/schema.ts drizzle/
git commit -m "feat(crm): customers 구매조건 7컬럼 + 단일선택 3 CHECK + 마이그 0009"
```

---

## Task 2: 백엔드 쓰기 경로 (Pick + zod) + 서버 테스트

**Files:**
- Modify: `src/db/queries/customers.ts` (`CustomerWritePatch` Pick)
- Modify: `src/routes/customers.ts:23-38` (`customerWriteSchema`)
- Test: `src/routes/customers.test.ts`

- [ ] **Step 1: 서버 테스트 추가 (실패 먼저)**

`src/routes/customers.test.ts`의 `customerWriteSchema` 파싱 테스트(45행 부근) 근처에 추가:

```ts
test("customerWriteSchema: 구매조건 7필드 파싱", () => {
  const r = customerWriteSchema.safeParse({
    needContractTerm: "36개월",
    needInitialCost: "보증금 30%",
    needAnnualMileage: "20,000km",
    needDeliveryMethod: "탁송 요청",
    needContractFocus: "#월 납입 최소 #총 비용 최소",
    needCustomerNote: "#카톡 선호",
    needReviewNote: null,
  });
  expect(r.success).toBe(true);
  if (r.success) {
    expect(r.data.needContractTerm).toBe("36개월");
    expect(r.data.needContractFocus).toBe("#월 납입 최소 #총 비용 최소");
  }
});

test("PATCH /api/customers/:id 구매조건 라운드트립 → 저장·복원", async () => {
  const token = await makeToken({ issuer, role: "admin", keyResolver });
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  // 저장
  const patched = await app.request(`/api/customers/${cid}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify({ needContractTerm: "36개월", needAnnualMileage: "20,000km" }),
  });
  expect(patched.status).toBe(200);
  // 확인
  const got = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { needContractTerm: string | null; needAnnualMileage: string | null };
  expect(got.needContractTerm).toBe("36개월");
  expect(got.needAnnualMileage).toBe("20,000km");
  // 복원(비파괴 — 다른 테스트 영향 차단)
  await app.request(`/api/customers/${cid}`, { method: "PATCH", headers: h, body: JSON.stringify({ needContractTerm: null, needAnnualMileage: null }) });
});
```

> 참고: `makeToken`/`createApp`/`keyResolver`/`issuer`는 이 테스트 파일 상단(13-19행)에 이미 import/정의돼 있다. 기존 PATCH 테스트(77행 "같은 값 비파괴")와 동일 패턴.

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun run test:server`
Expected: 위 2개 FAIL — 파싱 테스트는 `needContractTerm`이 `undefined`(zod strip), 라운드트립은 `needContractTerm`이 `null`(컬럼은 있으나 zod가 body에서 strip해 UPDATE 안 됨).

- [ ] **Step 3: `queries/customers.ts` `CustomerWritePatch` Pick에 7컬럼 추가**

`Pick<typeof customers.$inferInsert, ...>`의 `"needMemo"` 다음에 추가:

```ts
    | "needMemo"
    | "needContractTerm"
    | "needInitialCost"
    | "needAnnualMileage"
    | "needDeliveryMethod"
    | "needContractFocus"
    | "needCustomerNote"
    | "needReviewNote"
```

- [ ] **Step 4: `routes/customers.ts` `customerWriteSchema`에 7필드 추가**

`needMemo: z.string().nullable().optional(),`(37행) 다음에 추가:

```ts
  needContractTerm: z.string().nullable().optional(),
  needInitialCost: z.string().nullable().optional(),
  needAnnualMileage: z.string().nullable().optional(),
  needDeliveryMethod: z.string().nullable().optional(),
  needContractFocus: z.string().nullable().optional(),
  needCustomerNote: z.string().nullable().optional(),
  needReviewNote: z.string().nullable().optional(),
```

> 단일선택 3개도 `z.string`(sentinel `"확인 필요"` 통과 + 무결성은 DB CHECK 담당). 기존 `chance`/`source`가 DB CHECK인데 zod는 `z.string`인 패턴과 동일.

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `bun run test:server`
Expected: 신규 2개 포함 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/db/queries/customers.ts src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 구매조건 7필드 쓰기 경로(Pick+zod) + 서버 테스트"
```

---

## Task 3: 프론트 lib 타입 + 단위 테스트

**Files:**
- Modify: `client/src/lib/customers.ts` (Response/Data/매핑/Patch 4곳)
- Test: `client/src/lib/customers.test.ts`

- [ ] **Step 1: lib 테스트에 fixture·매핑 테스트 추가 (실패 먼저)**

`client/src/lib/customers.test.ts`의 `detailRes` fixture(72행~)에 7필드를 추가한다(`needMemo` 근처에):

```ts
  needContractTerm: "36개월",
  needInitialCost: "보증금 30%",
  needAnnualMileage: "20,000km",
  needDeliveryMethod: "탁송 요청",
  needContractFocus: "#월 납입 최소",
  needCustomerNote: "#카톡 선호",
  needReviewNote: null,
```

그리고 `describe("toCustomerDetail", ...)` 안에 테스트 추가:

```ts
  it("구매조건 7필드를 그대로 전달", () => {
    const d = toCustomerDetail(detailRes);
    expect(d.needContractTerm).toBe("36개월");
    expect(d.needInitialCost).toBe("보증금 30%");
    expect(d.needAnnualMileage).toBe("20,000km");
    expect(d.needDeliveryMethod).toBe("탁송 요청");
    expect(d.needContractFocus).toBe("#월 납입 최소");
    expect(d.needCustomerNote).toBe("#카톡 선호");
    expect(d.needReviewNote).toBeNull();
  });
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: FAIL — `detailRes`에 추가한 7필드가 `CustomerDetailResponse` 타입에 없어 **타입 에러**, 또는 `d.needContractTerm`이 타입에 없음.

- [ ] **Step 3: `CustomerDetailResponse`에 7필드 추가**

`client/src/lib/customers.ts`의 `CustomerDetailResponse` 타입(86행~)에서 `needMemo: string | null;` 다음에:

```ts
  needContractTerm: string | null;
  needInitialCost: string | null;
  needAnnualMileage: string | null;
  needDeliveryMethod: string | null;
  needContractFocus: string | null;
  needCustomerNote: string | null;
  needReviewNote: string | null;
```

- [ ] **Step 4: `CustomerDetailData` Pick에 7필드 추가**

`CustomerDetailData = Pick<CustomerDetailResponse, ...>`(111행~)에서 `| "needMemo"` 다음에:

```ts
  | "needContractTerm"
  | "needInitialCost"
  | "needAnnualMileage"
  | "needDeliveryMethod"
  | "needContractFocus"
  | "needCustomerNote"
  | "needReviewNote"
```

- [ ] **Step 5: `toCustomerDetail` 매핑에 7필드 추가**

`toCustomerDetail`(137행~)의 `needMemo: res.needMemo,` 다음에:

```ts
    needContractTerm: res.needContractTerm,
    needInitialCost: res.needInitialCost,
    needAnnualMileage: res.needAnnualMileage,
    needDeliveryMethod: res.needDeliveryMethod,
    needContractFocus: res.needContractFocus,
    needCustomerNote: res.needCustomerNote,
    needReviewNote: res.needReviewNote,
```

- [ ] **Step 6: `CustomerWritePatch`(lib)에 7필드 추가**

`export type CustomerWritePatch = { ... }`(200행~)의 `needMemo?: string | null;` 다음에:

```ts
  needContractTerm?: string | null;
  needInitialCost?: string | null;
  needAnnualMileage?: string | null;
  needDeliveryMethod?: string | null;
  needContractFocus?: string | null;
  needCustomerNote?: string | null;
  needReviewNote?: string | null;
```

- [ ] **Step 7: 테스트 실행 → 통과 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add client/src/lib/customers.ts client/src/lib/customers.test.ts
git commit -m "feat(crm): 고객 상세 lib에 구매조건 7필드 노출 + 단위 테스트"
```

---

## Task 4: purchase-meta 상수 re-export + label→key 맵

**Files:**
- Modify: `client/src/components/customer-detail/purchase-meta.ts`

- [ ] **Step 1: 상수 import + 기존 정의 교체**

`purchase-meta.ts` 상단 import에 추가:

```ts
import { ANNUAL_MILEAGE_OPTIONS, CONTRACT_TERM_OPTIONS, DELIVERY_METHOD_OPTIONS } from "@/data/customers";
import { type CustomerWritePatch } from "@/lib/customers";
```

그리고 기존 정의 3개(24·27·28행)를 SSOT re-export로 교체(나머지 옵션 상수는 그대로 둔다):

```ts
export const kimContractTermOptions = CONTRACT_TERM_OPTIONS;
export const kimAnnualMileageOptions = ANNUAL_MILEAGE_OPTIONS;
export const kimDeliveryMethodOptions = DELIVERY_METHOD_OPTIONS;
```

> `kimMethodOptions`·`kimInitialCost*`·`kimTiming*`·`kimContractFocusOptions`·`kimCustomerNoteOptions`·`kimReviewNoteOptions`·`kimPurchaseTagSelectionLimit`는 변경하지 않는다.

- [ ] **Step 2: label→컬럼키 맵 추가**

파일 하단(`parseKimInitialCost` 아래)에 추가:

```ts
// 상세 구매조건 9필드 label → crm.customers 컬럼(camelCase) 매핑.
// 초기화(detail.need*)와 savePatch가 공유하는 단일 출처. 매핑 없는 label은 영속 대상이 아니다.
export const PURCHASE_FIELD_KEY: Record<string, keyof CustomerWritePatch> = {
  "구매방식": "needMethod",
  "출고 희망 시기": "needTiming",
  "계약기간": "needContractTerm",
  "초기비용": "needInitialCost",
  "연간 주행거리": "needAnnualMileage",
  "인도 방식": "needDeliveryMethod",
  "계약 포커스": "needContractFocus",
  "고객 특이사항": "needCustomerNote",
  "심사 특이사항": "needReviewNote",
};
```

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (re-export라 소비처 `kimContractTermOptions` 등 호환 유지.)

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/customer-detail/purchase-meta.ts
git commit -m "refactor(crm): 구매조건 옵션 SSOT re-export + label→컬럼키 맵(PURCHASE_FIELD_KEY)"
```

---

## Task 5: useCustomerPurchase 영속화 (초기화 + 계약기간 단일화 + 7핸들러 savePatch)

**Files:**
- Modify: `client/src/components/customer-detail/hooks/useCustomerPurchase.ts`

- [ ] **Step 1: import에 맵 추가 + `CustomerDetailData` 인덱싱용 타입 확인**

`purchase-meta`에서 `PURCHASE_FIELD_KEY`를 import 목록(8-20행 블록)에 추가:

```ts
import {
  kimContractFocusOptions,
  kimContractTermOptions,
  kimCustomerNoteOptions,
  kimMethodOptions,
  kimMinjunPurchaseFields,
  kimPurchaseTagSelectionLimit,
  kimReviewNoteOptions,
  parseKimInitialCost,
  PURCHASE_FIELD_KEY,
  type KimInitialCostKind,
  type KimInitialCostSelection,
  type KimInitialCostUnit,
} from "../purchase-meta";
```

- [ ] **Step 2: `purchaseFields` 초기화를 9필드 detail 매핑으로 교체**

현재 초기화(45-53행)를 교체:

```ts
  const [purchaseFields, setPurchaseFields] = useState(() =>
    kimMinjunPurchaseFields.map((field) => {
      const key = PURCHASE_FIELD_KEY[field.label];
      const stored = key ? (detail as Record<string, unknown>)[key] : undefined;
      return typeof stored === "string" && stored ? { ...field, value: stored } : field;
    }),
  );
```

> `(detail as Record<string, unknown>)[key]` + `typeof stored === "string"` 런타임 가드로 안전 인덱싱. 빈/null은 기존 빈값 유지(렌더 시 "미정").

- [ ] **Step 3: `togglePurchaseTerm` → `selectPurchaseTerm`(단일선택 + savePatch)로 교체**

현재 `togglePurchaseTerm`(100-115행) 전체를 다음으로 교체:

```ts
  function selectPurchaseTerm(option: string) {
    const currentTermField = purchaseFields.find((field) => field.label === "계약기간");
    const nextValue = currentTermField?.value === option ? "확인 필요" : option;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "계약기간" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("계약기간 수정 완료");
    savePatch({ needContractTerm: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

> 연간 주행거리(`selectPurchaseAnnualMileage`)와 동일한 단일선택 토글 패턴. 선택 즉시 popover를 닫는다.

- [ ] **Step 4: `applyPurchaseInitialCost`에 savePatch 추가**

`applyPurchaseInitialCost`(143-162행)의 `setPurchaseFields` 직전에 스냅샷, 끝에 savePatch 추가. 변경 후 전체:

```ts
  function applyPurchaseInitialCost() {
    const trimmedAmount = initialCostAmount.replace(/[^\d]/g, "");
    if (initialCostKind && initialCostKind !== "무보증" && !trimmedAmount) {
      onToast("초기비용 값을 입력해 주세요.");
      return;
    }
    const formattedAmount = initialCostUnit === "금액" ? formatKimNumberWithCommas(trimmedAmount) : trimmedAmount;
    const nextValue = !initialCostKind
      ? "확인 필요"
      : initialCostKind === "무보증"
      ? "무보증"
      : `${initialCostKind} ${formattedAmount}${initialCostUnit === "%" ? "%" : "만원"}`;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "초기비용" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("초기비용 수정 완료");
    savePatch({ needInitialCost: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

- [ ] **Step 5: `selectPurchaseAnnualMileage`에 savePatch 추가**

`selectPurchaseAnnualMileage`(262-272행) 교체:

```ts
  function selectPurchaseAnnualMileage(option: string) {
    const currentMileageField = purchaseFields.find((field) => field.label === "연간 주행거리");
    const nextValue = currentMileageField?.value === option ? "확인 필요" : option;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "연간 주행거리" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("연간 주행거리 수정 완료");
    savePatch({ needAnnualMileage: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

- [ ] **Step 6: `selectPurchaseDeliveryMethod`에 savePatch 추가**

`selectPurchaseDeliveryMethod`(274-284행) 교체:

```ts
  function selectPurchaseDeliveryMethod(option: string) {
    const currentDeliveryField = purchaseFields.find((field) => field.label === "인도 방식");
    const nextValue = currentDeliveryField?.value === option ? "확인 필요" : option;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "인도 방식" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("인도 방식 수정 완료");
    savePatch({ needDeliveryMethod: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

- [ ] **Step 7: `togglePurchaseCostFocus`에 savePatch 추가**

`togglePurchaseCostFocus`(199-218행)에서 `nextValue` 계산 후, `setPurchaseFields` 직전 스냅샷 + 끝에 savePatch. 변경 부분(`const orderedFocuses ...` 이후):

```ts
    const orderedFocuses = kimContractFocusOptions.filter((focus) => selectedFocuses.has(focus));
    const nextValue = orderedFocuses.length > 0 ? orderedFocuses.map((focus) => `#${focus}`).join(" ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "계약 포커스" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("계약 포커스 수정 완료");
    savePatch({ needContractFocus: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

- [ ] **Step 8: `togglePurchaseCustomerNote`에 savePatch 추가**

`togglePurchaseCustomerNote`(220-239행) 동일 패턴. `const orderedNotes ...` 이후:

```ts
    const orderedNotes = kimCustomerNoteOptions.filter((note) => selectedNotes.has(note));
    const nextValue = orderedNotes.length > 0 ? orderedNotes.map((note) => `#${note}`).join(" ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "고객 특이사항" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("고객 특이사항 수정 완료");
    savePatch({ needCustomerNote: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

- [ ] **Step 9: `togglePurchaseReviewNote`에 savePatch 추가**

`togglePurchaseReviewNote`(241-260행) 동일 패턴. `const orderedNotes ...` 이후:

```ts
    const orderedNotes = kimReviewNoteOptions.filter((note) => selectedNotes.has(note));
    const nextValue = orderedNotes.length > 0 ? orderedNotes.map((note) => `#${note}`).join(" ") : "확인 필요";
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "심사 특이사항" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("심사 특이사항 수정 완료");
    savePatch({ needReviewNote: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }
```

- [ ] **Step 10: return의 handlers에서 `togglePurchaseTerm` → `selectPurchaseTerm`**

`return { ... handlers: { ... } }`(295-310행)에서 `togglePurchaseTerm,` → `selectPurchaseTerm,`로 변경.

- [ ] **Step 11: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: typecheck 0, lint 0 problems.

- [ ] **Step 12: 커밋**

```bash
git add client/src/components/customer-detail/hooks/useCustomerPurchase.ts
git commit -m "feat(crm): 구매조건 7필드 savePatch 영속 + 계약기간 단일선택 전환 + 초기화 detail 매핑"
```

---

## Task 6: PurchaseConditions.tsx 계약기간 단일 UI

**Files:**
- Modify: `client/src/components/customer-detail/PurchaseConditions.tsx`

- [ ] **Step 1: handlers 구조분해에서 핸들러명 교체**

`const { ... } = handlers;`(45-60행)에서 `togglePurchaseTerm,` → `selectPurchaseTerm,`로 변경.

- [ ] **Step 2: `renderPurchaseTermEditor`를 단일선택으로 교체**

현재 `renderPurchaseTermEditor`(106-127행) 전체를 교체:

```tsx
  function renderPurchaseTermEditor() {
    const currentTermField = purchaseFields.find((field) => field.label === "계약기간");
    const currentValue = currentTermField?.value ?? "확인 필요";

    return (
      <div className="kim-edit-popover purchase-term" role="dialog" aria-label="계약기간 수정">
        <div className="kim-method-segmented" role="group" aria-label="계약기간 선택">
          {kimContractTermOptions.map((option) => (
            <button
              aria-pressed={currentValue === option}
              className={currentValue === option ? "active" : ""}
              key={option}
              onClick={() => selectPurchaseTerm(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }
```

> 다중선택 `selectedTerms` Set 로직을 단일 `currentValue` 비교로 대체. 연간 주행거리(`renderPurchaseAnnualMileageEditor`)와 동일 구조.

- [ ] **Step 3: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: typecheck 0, lint 0 problems. (이제 `togglePurchaseTerm` 참조가 어디에도 없어야 한다.)

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/customer-detail/PurchaseConditions.tsx
git commit -m "feat(crm): 계약기간 편집기 다중→단일선택 UI"
```

---

## Task 7: 통합 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 검증 게이트**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`
Expected: typecheck 0 / lint 0 / test:unit 전부 PASS(+lib 신규) / test:server 전부 PASS(+2) / build OK.

- [ ] **Step 2: psql로 CHECK 거부 실측 (선택, 무결성 확인)**

Run: `psql "$DATABASE_URL" -c "update crm.customers set need_contract_term='99개월' where customer_code='CU-2605-0020';"`
Expected: CHECK 위반 에러(`customers_need_contract_term_check`) — 사전 밖 값 거부 확인. (성공하면 CHECK 누락이므로 점검.)

- [ ] **Step 3: 브라우저 검증 (사용자 — 유슨생)**

`bun run dev` 후 김민준(CU-2605-0020) 상세 → 상세 구매조건:
- 7필드 각각 값 변경 → **새로고침 → 유지** 확인.
- 계약기간이 **단일선택**으로 동작(다른 값 클릭 시 이전 선택 해제, 같은 값 재클릭 시 "미정"으로).
- 다중 태그 3개(계약 포커스·고객 특이사항·심사 특이사항)는 여전히 다중 선택·저장.
- 구매방식·출고시기 회귀 0.
- 저장 실패 시 rollback + "저장에 실패했습니다" 토스트(정상 시엔 안 뜸).

- [ ] **Step 4: 최종 — brief 갱신은 별도(분해 트랙 follow-up ③ 해소 기록), PR 생성은 사용자 지시 시.**

---

## Self-Review 체크

- **Spec coverage:** 7컬럼(Task1)·CHECK 3개(Task1)·zod/Pick(Task2)·lib 4곳(Task3)·계약기간 단일화(Task5·6)·초기화 매핑(Task5)·워크벤치 무영향(분석)·검증(Task7) — 전 항목 task 존재. `savePurchaseConditions`는 비활성 코드라 명시적 범위 밖.
- **Placeholder:** 없음(모든 step에 실제 코드/명령/기대출력).
- **Type 일관성:** `CustomerWritePatch`(lib·query 양쪽), `PURCHASE_FIELD_KEY`, `selectPurchaseTerm`(Task5 정의→Task6 소비), 컬럼명 camelCase↔snake_case 매핑 일관.
