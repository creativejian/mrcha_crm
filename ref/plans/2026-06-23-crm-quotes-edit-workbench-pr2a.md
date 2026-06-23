# 견적 수정 워크벤치 일원화 — PR2a (백엔드 updateQuote 확장 + vehicles ancestry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 `updateQuote`를 가격/색상/옵션 스냅샷 + 다중 시나리오 교체까지 받도록 확장하고, `getTrimDetail`에 brand/model ancestry를 추가해 PR2c의 워크벤치 수정 저장·차량 복원 데이터 경로를 깐다.

**Architecture:** 백엔드 중심, UI 변화 없음. `updateQuote`(현재 헤더+단일 시나리오만)에 스냅샷 컬럼 set과 시나리오 delete+re-insert 교체를 추가한다. 시나리오 insert는 `createQuote`와 중복되므로 공용 헬퍼 `insertScenarios`로 추출(DRY). `getTrimDetail`은 `modelId`만 주므로 catalog 조인으로 `brandId`/`brandName`/`modelName`을 추가(VehiclePicker 복원 전제). 라우트는 둘 다 결과를 변형 없이 반환하므로 무변, zod·프론트 타입만 동형 확장.

**Tech Stack:** TypeScript, drizzle-orm, Hono + zod, `bun test`(서버 통합, 실 DB `--env-file=.env.local`), Vitest.

---

## File Structure

- **Modify** `src/db/queries/customer-quotes.ts`
  - `insertScenarios(ex, quoteId, inputs)` 헬퍼 신설 → `{ primaryId: string | null }`
  - `createQuote`가 헬퍼 사용(동작보존 리팩토링)
  - `QuoteHeaderPatch`에 스냅샷 컬럼 추가, `headerSet`에 set 추가
  - `QuotePatch`에 `scenarios?: ScenarioInput[]` 추가, `updateQuote`에 시나리오 교체 분기
- **Modify** `src/routes/customers.ts` — `quotePatchBody` zod에 스냅샷 컬럼 + `scenarios` 추가
- **Modify** `client/src/lib/customer-quotes.ts` — `QuoteWritePatch`에 스냅샷 컬럼 + `scenarios` 추가
- **Modify** `src/db/queries/vehicles.ts` — `getTrimDetail` 첫 쿼리에 `modelsInCatalog`/`brandsInCatalog` leftJoin + `brandId`/`brandName`/`modelName` select
- **Modify** `client/src/lib/vehicles.ts` — `TrimDetail`에 `brandId`/`brandName`/`modelName`
- **Modify** `src/routes/customers.test.ts` — updateQuote 스냅샷/시나리오 교체 테스트
- **Modify** `src/db/queries/vehicles.test.ts` 또는 `src/routes/vehicles.test.ts` — getTrimDetail ancestry 테스트

---

## Task 1: createQuote 시나리오 insert 헬퍼 추출 (동작보존 리팩토링)

**Files:** Modify `src/db/queries/customer-quotes.ts:219-248`

- [ ] **Step 1: `insertScenarios` 헬퍼 추가**

`src/db/queries/customer-quotes.ts`의 `createQuote` 함수 **위**(line 173 `// 새 견적 INSERT` 주석 앞)에 헬퍼를 추가한다:

```typescript
// 시나리오 N건 insert + 대표(scenario_no 최소) id 반환. createQuote/updateQuote 공용.
async function insertScenarios(
  ex: Executor,
  quoteId: string,
  inputs: ScenarioInput[],
): Promise<{ primaryId: string | null }> {
  const inserted: { id: string; scenarioNo: number }[] = [];
  for (const sc of inputs) {
    const scenarioNo = sc.scenarioNo ?? 1;
    const [s] = await ex.insert(quoteScenarios).values({
      quoteId,
      scenarioNo,
      isSaved: sc.isSaved ?? false,
      savedAt: sc.isSaved ? new Date() : null,
      purchaseMethod: sc.purchaseMethod ?? null,
      termMonths: sc.termMonths ?? null,
      monthlyPayment: sc.monthlyPayment ?? null,
      lender: sc.lender ?? null,
      depositMode: sc.depositMode ?? null,
      depositValue: sc.depositValue ?? null,
      downPaymentMode: sc.downPaymentMode ?? null,
      downPaymentValue: sc.downPaymentValue ?? null,
      residualMode: sc.residualMode ?? null,
      residualValue: sc.residualValue ?? null,
      mileageMode: sc.mileageMode ?? null,
      mileageValue: sc.mileageValue ?? null,
    }).returning({ id: quoteScenarios.id });
    inserted.push({ id: s.id, scenarioNo });
  }
  const primary = inserted.length
    ? inserted.reduce((m, x) => (x.scenarioNo < m.scenarioNo ? x : m))
    : null;
  return { primaryId: primary?.id ?? null };
}
```

- [ ] **Step 2: `createQuote`가 헬퍼를 쓰도록 교체**

`createQuote`의 시나리오 insert 블록(현 line 219-247, `const inserted...`부터 `if (primary) await ex.update...`까지)을 다음으로 교체한다:

```typescript
  const { primaryId } = await insertScenarios(ex, q.id, scenarioInputs);
  if (primaryId) await ex.update(quotes).set({ primaryScenarioId: primaryId }).where(eq(quotes.id, q.id));
  return q;
```

(`scenarioInputs` 계산 라인 214-217은 그대로 둔다.)

- [ ] **Step 3: 회귀 확인 — 기존 서버 테스트 통과**

Run: `bun run test:server`
Expected: PASS (createQuote 동작 불변 — 기존 견적 생성/시나리오 테스트 그대로).

- [ ] **Step 4: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

---

## Task 2: updateQuote 확장 테스트 작성 (TDD RED)

**Files:** Modify `src/routes/customers.test.ts`

- [ ] **Step 1: 스냅샷 + 시나리오 교체 테스트 추가**

`src/routes/customers.test.ts`에 새 테스트를 추가한다. **기존 견적 테스트의 setup 패턴**(app·token·고객 cid 생성, `Authorization: Bearer ${token}` 헤더, `app.request`로 `POST /api/customers/:id/quotes` 생성 후 `GET /api/customers/:id`로 조회)을 그대로 따른다. 핵심 흐름과 assertion:

```typescript
it("PATCH가 가격 스냅샷 + trimId + 색상 + 시나리오 교체를 반영한다", async () => {
  // (기존 패턴) app/token/cid 준비 + 견적 생성: scenarios 2건으로 POST
  const createRes = await app.request(`/api/customers/${cid}/quotes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      entryMode: "manual", brandName: "벤츠", modelName: "S", trimName: "S 500",
      scenarios: [
        { scenarioNo: 1, purchaseMethod: "운용리스", monthlyPayment: "2000000" },
        { scenarioNo: 2, purchaseMethod: "운용리스", monthlyPayment: "2100000" },
      ],
    }),
  });
  const { id: quoteId } = (await createRes.json()) as { id: string };

  // PATCH: 스냅샷 + 시나리오 1건으로 교체
  const patchRes = await app.request(`/api/customers/${cid}/quotes/${quoteId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      basePrice: "243000000", finalVehiclePrice: "236500000",
      exteriorColorName: "옵시디언 블랙",
      options: [{ id: 1, name: "옵션A", price: 1000000 }],
      scenarios: [{ scenarioNo: 1, purchaseMethod: "장기렌트", monthlyPayment: "1900000" }],
    }),
  });
  expect(patchRes.status).toBe(200);

  // 조회: 스냅샷·색상·시나리오 교체 확인
  const detail = (await (await app.request(`/api/customers/${cid}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json()) as { quotes: { id: string; basePrice: string | null; finalVehiclePrice: string | null; exteriorColorName: string | null; options: unknown[] | null; scenarios: { purchaseMethod: string | null }[] }[] };
  const q = detail.quotes.find((x) => x.id === quoteId)!;
  expect(q.basePrice).toBe("243000000");
  expect(q.finalVehiclePrice).toBe("236500000");
  expect(q.exteriorColorName).toBe("옵시디언 블랙");
  expect(q.options?.length).toBe(1);
  expect(q.scenarios.length).toBe(1);           // 2건 → 1건 교체
  expect(q.scenarios[0].purchaseMethod).toBe("장기렌트");
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun run test:server`
Expected: FAIL — `basePrice`가 안 바뀜(zod가 미지원 키 strip, `headerSet`이 스냅샷 미처리) 그리고 `scenarios.length`가 2(교체 미구현).

---

## Task 3: updateQuote 백엔드 구현 (TDD GREEN)

**Files:** Modify `src/db/queries/customer-quotes.ts`, `src/routes/customers.ts`, `client/src/lib/customer-quotes.ts`

- [ ] **Step 1: 서버 `QuoteHeaderPatch`에 스냅샷 컬럼 추가**

`src/db/queries/customer-quotes.ts`의 `QuoteHeaderPatch`(line 7-20)에서 `bumpRevision?: boolean;` **앞**에 추가한다:

```typescript
  // PR2a: 워크벤치 수정용 가격/색상/옵션 스냅샷(보낸 것만 갱신)
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
  acquisitionTax?: string | null;
  acquisitionTaxMode?: string | null;
  bond?: string | null;
  delivery?: string | null;
  incidental?: string | null;
  finalVehiclePrice?: string | null;
  acquisitionCost?: string | null;
  exteriorColorId?: number | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  interiorColorId?: number | null;
  interiorColorName?: string | null;
  interiorColorHex?: string | null;
  bumpRevision?: boolean;
```

- [ ] **Step 2: `QuotePatch`에 scenarios 추가**

같은 파일 `QuotePatch`(line 27)를 교체:

```typescript
export type QuotePatch = QuoteHeaderPatch & { scenario?: QuoteScenarioPatch; scenarios?: ScenarioInput[] };
```

- [ ] **Step 3: `headerSet`에 스냅샷 set 추가**

`headerSet`(line 43-60)의 `if (p.bumpRevision)` **앞**에 추가한다:

```typescript
  if (p.trimId !== undefined) set.trimId = p.trimId;
  if (p.basePrice !== undefined) set.basePrice = p.basePrice;
  if (p.optionTotal !== undefined) set.optionTotal = p.optionTotal;
  if (p.options !== undefined) set.options = p.options;
  if (p.finalDiscount !== undefined) set.finalDiscount = p.finalDiscount;
  if (p.acquisitionTax !== undefined) set.acquisitionTax = p.acquisitionTax;
  if (p.acquisitionTaxMode !== undefined) set.acquisitionTaxMode = p.acquisitionTaxMode;
  if (p.bond !== undefined) set.bond = p.bond;
  if (p.delivery !== undefined) set.delivery = p.delivery;
  if (p.incidental !== undefined) set.incidental = p.incidental;
  if (p.finalVehiclePrice !== undefined) set.finalVehiclePrice = p.finalVehiclePrice;
  if (p.acquisitionCost !== undefined) set.acquisitionCost = p.acquisitionCost;
  if (p.exteriorColorId !== undefined) set.exteriorColorId = p.exteriorColorId;
  if (p.exteriorColorName !== undefined) set.exteriorColorName = p.exteriorColorName;
  if (p.exteriorColorHex !== undefined) set.exteriorColorHex = p.exteriorColorHex;
  if (p.interiorColorId !== undefined) set.interiorColorId = p.interiorColorId;
  if (p.interiorColorName !== undefined) set.interiorColorName = p.interiorColorName;
  if (p.interiorColorHex !== undefined) set.interiorColorHex = p.interiorColorHex;
```

- [ ] **Step 4: `updateQuote`에 시나리오 교체 분기 추가**

`updateQuote`에서 대표 시나리오 1건 갱신 블록(현 line 104-110 `// 대표 시나리오 1건 갱신` ~ `}` )의 **앞**에 시나리오 교체 분기를 넣는다(scenarios 제공 시 전체 교체, 미제공 시 기존 단수 경로 유지):

```typescript
  // PR2a: scenarios(복수) 제공 시 전체 교체(delete→insert). 대표 재계산.
  if (patch.scenarios) {
    await ex.delete(quoteScenarios).where(eq(quoteScenarios.quoteId, quoteId));
    const { primaryId } = await insertScenarios(ex, quoteId, patch.scenarios);
    await ex.update(quotes).set({ primaryScenarioId: primaryId }).where(eq(quotes.id, quoteId));
    return { id: row.id };
  }

  // 대표 시나리오 1건 갱신(헤더 PATCH와 함께 온 경우) — 갱신된 대표 기준.
```

`insertScenarios`/`quoteScenarios`/`eq`는 이미 import/정의됨. `needScenarios`(line 88)는 단수 경로 전용이라 그대로 둔다(scenarios 분기는 그 위에서 early-return).

- [ ] **Step 5: zod `quotePatchBody` 확장**

`src/routes/customers.ts`의 `quotePatchBody`(line 103-117)에서 `bumpRevision: z.boolean().optional(),` **다음**에 추가한다:

```typescript
  // PR2a: 워크벤치 수정용 스냅샷 + 다중 시나리오 교체
  trimId: z.number().int().nullable().optional(),
  basePrice: z.string().nullable().optional(),
  optionTotal: z.string().nullable().optional(),
  options: z.array(z.object({ id: z.number().int(), name: z.string(), price: z.number().nullable() })).nullable().optional(),
  finalDiscount: z.string().nullable().optional(),
  acquisitionTax: z.string().nullable().optional(),
  acquisitionTaxMode: z.enum(["normal", "hybrid", "electric", "manual"]).nullable().optional(),
  bond: z.string().nullable().optional(),
  delivery: z.string().nullable().optional(),
  incidental: z.string().nullable().optional(),
  finalVehiclePrice: z.string().nullable().optional(),
  acquisitionCost: z.string().nullable().optional(),
  exteriorColorId: z.number().int().nullable().optional(),
  exteriorColorName: z.string().nullable().optional(),
  exteriorColorHex: z.string().nullable().optional(),
  interiorColorId: z.number().int().nullable().optional(),
  interiorColorName: z.string().nullable().optional(),
  interiorColorHex: z.string().nullable().optional(),
  scenarios: z.array(quoteScenarioBody).max(3).optional(),
```

- [ ] **Step 6: 프론트 `QuoteWritePatch` 확장**

`client/src/lib/customer-quotes.ts`의 `QuoteWritePatch`(line 22-41)에서 `scenario?: {...};` **앞**에 추가한다:

```typescript
  // PR2a: 워크벤치 수정용 스냅샷 + 다중 시나리오 교체
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
  acquisitionTax?: string | null;
  acquisitionTaxMode?: "normal" | "hybrid" | "electric" | "manual" | null;
  bond?: string | null;
  delivery?: string | null;
  incidental?: string | null;
  finalVehiclePrice?: string | null;
  acquisitionCost?: string | null;
  exteriorColorId?: number | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  interiorColorId?: number | null;
  interiorColorName?: string | null;
  interiorColorHex?: string | null;
  scenarios?: ScenarioInput[];
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `bun run test:server`
Expected: PASS (Task 2 테스트 포함 전부 통과).

---

## Task 4: vehicles getTrimDetail ancestry 보강

**Files:** Modify `src/db/queries/vehicles.ts:73-97`, `client/src/lib/vehicles.ts:52-61`, vehicles 테스트

- [ ] **Step 1: ancestry 테스트 작성 (RED)**

`src/db/queries/vehicles.test.ts`(또는 `src/routes/vehicles.test.ts`의 trim detail 케이스)에 기존 패턴을 따라 추가한다. 핵심 assertion(실 catalog의 한 trimId로 상세 조회 → ancestry 필드 존재):

```typescript
it("getTrimDetail이 brand/model ancestry를 포함한다", async () => {
  // 기존 패턴: 임의 brand→model→trim을 catalog에서 골라 trimId 확보
  const detail = await getTrimDetail(someTrimId, db);
  expect(detail).not.toBeNull();
  expect(typeof detail!.brandId).toBe("number");
  expect(detail!.brandName.length).toBeGreaterThan(0);
  expect(detail!.modelName.length).toBeGreaterThan(0);
});
```

Run: `bun run test:server`
Expected: FAIL — `brandId`/`brandName`/`modelName`가 결과에 없음(타입/런타임).

- [ ] **Step 2: `getTrimDetail` 쿼리에 조인 + select 추가**

`src/db/queries/vehicles.ts`의 `getTrimDetail` 첫 쿼리(line 74-97)에서 select 객체에 ancestry를 추가하고 from에 leftJoin을 건다. `modelsInCatalog`/`brandsInCatalog`는 이미 import됨(line 4-11). select에 추가:

```typescript
      financialDiscountAmount: trimsInCatalog.financialDiscountAmount,
      partnerDiscountAmount: trimsInCatalog.partnerDiscountAmount,
      cashDiscountAmount: trimsInCatalog.cashDiscountAmount,
      brandId: brandsInCatalog.id,
      brandName: brandsInCatalog.name,
      modelName: modelsInCatalog.name,
    })
    .from(trimsInCatalog)
    .leftJoin(modelsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
    .leftJoin(brandsInCatalog, eq(modelsInCatalog.brandId, brandsInCatalog.id))
    .where(eq(trimsInCatalog.id, trimId));
```

(기존 `.from(trimsInCatalog).where(...)`를 위 join 포함 형태로 교체.)

- [ ] **Step 3: 프론트 `TrimDetail` 타입에 ancestry 추가**

`client/src/lib/vehicles.ts`의 `TrimDetail`(line 52-61)에서 `noOptions:` **앞**에 추가한다:

```typescript
  brandId: number;
  brandName: string;
  modelName: string;
  noOptions: { note: string | null; checkedAt: string } | null;
```

- [ ] **Step 4: 테스트 통과 + typecheck**

Run: `bun run test:server`
Expected: PASS.
Run: `bun run typecheck`
Expected: 0 errors.

---

## Task 5: 전체 검증 + 커밋 + PR

**Files:** 없음(검증·커밋만)

- [ ] **Step 1: typecheck / lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0.

- [ ] **Step 2: 단위 + 서버 테스트**

Run: `bun run test:unit` → PASS · `bun run test:server` → PASS(신규 2건 포함).

- [ ] **Step 3: build**

Run: `bun run build`
Expected: OK.

- [ ] **Step 4: 브랜치 + 커밋(spec·plan 동봉)**

```bash
git checkout -b feat/crm-quotes-edit-workbench-pr2a
git add src/db/queries/customer-quotes.ts src/routes/customers.ts src/routes/customers.test.ts \
  src/db/queries/vehicles.ts client/src/lib/customer-quotes.ts client/src/lib/vehicles.ts \
  src/db/queries/vehicles.test.ts \
  ref/specs/2026-06-23-crm-quotes-edit-via-workbench-design.md \
  ref/plans/2026-06-23-crm-quotes-edit-workbench-pr2a.md
git commit -m "$(cat <<'EOF'
feat(crm): 견적 updateQuote 스냅샷+시나리오 교체 확장 + vehicles ancestry (수정 워크벤치화 PR2a)

- updateQuote: 가격/색상/옵션 스냅샷 컬럼 + scenarios[] 전체 교체(delete→insert, 대표 재계산)
- createQuote 시나리오 insert를 insertScenarios 헬퍼로 추출(공용·DRY)
- quotePatchBody zod + QuoteWritePatch(프론트) 동형 확장
- getTrimDetail에 brand/model ancestry(brandId·brandName·modelName) 조인 — VehiclePicker 복원 전제
- 서버테스트 2건(스냅샷+시나리오 교체 / trim ancestry). UI 변화 없음 · 마이그레이션 없음

검증: typecheck 0 · lint 0 · test:unit · test:server · build OK

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: push + PR**

```bash
git push -u origin feat/crm-quotes-edit-workbench-pr2a
gh pr create --base main --head feat/crm-quotes-edit-workbench-pr2a \
  --title "feat(crm): updateQuote 스냅샷+시나리오 교체 확장 + vehicles ancestry (수정 워크벤치화 PR2a)" \
  --body "<spec 링크 + 변경 요약 + 검증 결과. skip-ci 토큰 금지>"
```

---

## Self-Review (작성자 체크 결과)

- **Spec coverage:** spec "PR2a — 백엔드 updateQuote 확장 + vehicles ancestry 보강" 전 항목 커버(헬퍼 추출·스냅샷·시나리오 교체·zod·프론트 타입·ancestry 조인·테스트). ✅
- **Placeholder scan:** 구현 코드 스텝 모두 실제 코드. 서버 테스트는 기존 통합 setup(app/token/cid) 재사용 지시 + 핵심 assertion 완전 제공(통합 setup 전체 복제는 DRY 위배라 패턴 참조). PR 본문만 실행 시 채움. ✅
- **Type consistency:** 스냅샷 컬럼명이 서버 `QuoteHeaderPatch` / zod `quotePatchBody` / 프론트 `QuoteWritePatch` 3곳 동일(`quoteCreateBody`와 동형). `insertScenarios` 반환 `{ primaryId }`를 createQuote·updateQuote 동일 사용. `getTrimDetail` ancestry 키(`brandId`/`brandName`/`modelName`)가 쿼리 select와 `TrimDetail` 타입 일치. ✅
- **주의:** `updateQuote`의 scenarios 분기는 early-return이라 기존 단수 `scenario`/`primaryScenarioId` 경로와 상호배타(둘 다 오면 scenarios 우선). 트랜잭션은 라우트(`customers.ts:164`)가 이미 감쌈.
