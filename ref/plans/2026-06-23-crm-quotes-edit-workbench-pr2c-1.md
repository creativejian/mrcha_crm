# 견적 수정 워크벤치 일원화 — PR2c-1 (통합: 수정 진입 + 차량/옵션/색상/가격 prefill + UPDATE 저장) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "견적 수정"을 composer 대신 솔루션 워크벤치로 열어 기존 견적의 차량/옵션/색상/가격을 prefill하고, 저장 시 INSERT 대신 UPDATE(재발송)로 보낸다. 시나리오는 건드리지 않아(미전송→기존 보존) 손실이 없다.

**Architecture:** 수정 진입 시 `detail.quotes`(CustomerDetailQuote, 가격 스냅샷·colorId·options 보유)에서 `editPrefill`을 구성하고 워크벤치를 edit 모드로 연다. `VehiclePicker`는 `initialTrimId`(PR1·PR2b)로 차량을 복원하며 `onChange`→`applyTrimToPricing`을 트리거하고, `applyTrimToPricing`은 `editPrefill`이 있으면 옵션/색상/가격을 리셋 대신 기존 값으로 채운 뒤 prefill을 1회 소비한다. 저장은 `saveQuoteFromWorkbench`에 `editingQuoteId` 분기를 추가해 `apiUpdateQuote`(PR2a 확장본)로 보낸다. prefill은 비결정적 타이밍이라 단위테스트로 통합 검증이 어렵고 브라우저 실측이 핵심이다.

**Tech Stack:** React, TypeScript, Vitest(회귀), `bun test`(서버 회귀).

---

## File Structure

- **Modify** `client/src/pages/CustomerDetailPage.tsx` (전부 이 파일)
  - `KimEditPrefill` 타입 + `editPrefill` state 신설
  - "견적 수정" 버튼 onClick을 워크벤치 edit 진입으로 교체
  - `applyTrimToPricing`에 `editPrefill` 적용 분기
  - 워크벤치 JSX: `VehiclePicker initialTrimId/key`, `OptionPicker initialSelectedIds`
  - `saveQuoteFromWorkbench`에 `editingQuoteId` UPDATE 분기
  - 워크벤치 헤더 카피/저장 버튼 edit 분기

기존 참조: `editingQuoteId`(state, line 900), `editingQuote`(파생, line 979), `detail.quotes`(prop, CustomerDetailQuote[]), `apiUpdateQuote`(이미 import, composer에서 사용 중), `QuoteWritePatch`(PR2a 확장됨).

---

## Task 1: editPrefill state + 견적 수정 진입을 워크벤치 edit로 교체

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (타입 정의부 ~line 88, state ~line 900, 진입 onClick ~line 4536)

- [ ] **Step 1: `KimEditPrefill` 타입 추가**

`client/src/pages/CustomerDetailPage.tsx`의 `type KimRecognizedQuoteFile = ...`(line 88) **다음 줄**에 추가한다:

```typescript
type KimEditPrefill = {
  optionIds: number[];
  exteriorColorId: number | null;
  interiorColorId: number | null;
  pricing: { base: number; option: number; discount: number; acquisitionTax: number; bond: number; delivery: number; incidental: number };
};
```

- [ ] **Step 2: `editPrefill` state 추가**

`const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);`(line 900) **다음 줄**에 추가한다:

```typescript
  const [editPrefill, setEditPrefill] = useState<KimEditPrefill | null>(null);
```

- [ ] **Step 3: "견적 수정" 진입을 워크벤치 edit로 교체**

`client/src/pages/CustomerDetailPage.tsx`의 "견적 수정" 버튼 onClick(line ~4536-4544, `setEditingQuoteId(openQuoteAction.id);`부터 `setConfirmingQuoteContractId(null);`까지 — `decisionStatus === "contracting"` early-return 블록은 유지)을 다음으로 교체한다:

```typescript
              const dq = detail.quotes.find((q) => q.id === openQuoteAction.id);
              setEditPrefill(dq ? {
                optionIds: dq.options?.map((o) => o.id) ?? [],
                exteriorColorId: dq.exteriorColorId,
                interiorColorId: dq.interiorColorId,
                pricing: {
                  base: Number(dq.basePrice ?? 0),
                  option: Number(dq.optionTotal ?? 0),
                  discount: Number(dq.finalDiscount ?? 0),
                  acquisitionTax: Number(dq.acquisitionTax ?? 0),
                  bond: Number(dq.bond ?? 0),
                  delivery: Number(dq.delivery ?? 0),
                  incidental: Number(dq.incidental ?? 0),
                },
              } : null);
              setEditingQuoteId(openQuoteAction.id);
              setSolutionWorkbenchPurchaseMethod(normalizeKimQuotePurchaseMethod(openQuoteAction.financeType));
              setSolutionWorkbenchEntryMode(openQuoteAction.source === "solution" ? "solution" : openQuoteAction.source === "original" ? "original" : "manual");
              setSolutionWorkbenchModeMenu(null);
              setRecognizedQuoteFile(null);
              setQuoteComposerMode(null);
              setIsQuoteSolutionWorkbenchOpen(true);
              setOpenQuoteActionId(null);
              setQuoteActionFrame(null);
              setConfirmingQuoteSendId(null);
              setConfirmingQuoteDeleteId(null);
              setConfirmingQuoteContractId(null);
```

- [ ] **Step 4: typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (이 시점엔 워크벤치가 열리지만 prefill/저장 분기 전이라 차량 빈 채로 열림.)

---

## Task 2: applyTrimToPricing editPrefill 적용 + picker props

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (`applyTrimToPricing` line ~1277, 워크벤치 picker JSX line ~5069-5073)

- [ ] **Step 1: `applyTrimToPricing`에 editPrefill 분기 적용**

`applyTrimToPricing`(line 1277-1304)의 본문 `try { ... }`를 다음으로 교체한다(차량/trimDetail 로드는 동일, 옵션/색상/가격을 editPrefill 유무로 분기):

```typescript
    try {
      const detail = await fetchTrimDetail(trim.id);
      const prefill = editPrefill;
      setTrimDetail(detail);
      setWorkbenchVehicle(selection);
      setSelectedWorkbenchOptionIds(prefill ? prefill.optionIds : []);
      setExteriorColor(prefill ? detail.colors.find((c) => c.id === prefill.exteriorColorId) ?? null : null);
      setInteriorColor(prefill ? detail.colors.find((c) => c.id === prefill.interiorColorId) ?? null : null);
      const root = pricingPanelRef.current;
      if (!root) { setEditPrefill(null); return; }
      const setInput = (key: string, value: number) => {
        const el = root.querySelector<HTMLInputElement>(`input[data-pricing="${key}"]`);
        if (el) el.value = formatMoney(value);
      };
      if (prefill) {
        setInput("base", prefill.pricing.base);
        setInput("option", prefill.pricing.option);
        setInput("discount", prefill.pricing.discount);
        setInput("acquisitionTax", prefill.pricing.acquisitionTax);
        setInput("bond", prefill.pricing.bond);
        setInput("delivery", prefill.pricing.delivery);
        setInput("incidental", prefill.pricing.incidental);
        const pd = root.querySelector<HTMLInputElement>('input[data-discount-primary="true"]');
        if (pd) pd.value = formatMoney(prefill.pricing.discount);
      } else {
        setInput("base", detail.price);
        setInput("option", 0);
        setInput("discount", detail.financialDiscountAmount ?? 0);
        const pd = root.querySelector<HTMLInputElement>('input[data-discount-primary="true"]');
        if (pd) pd.value = formatMoney(detail.financialDiscountAmount ?? 0);
      }
      setPrimaryDiscountUnit("amount");
      recomputePricing();
      markQuoteDraftChanged();
      setEditPrefill(null);
    } catch (error) {
      console.warn("트림 상세 로드 실패", error);
    }
```

- [ ] **Step 2: VehiclePicker에 initialTrimId + key, OptionPicker에 initialSelectedIds 전달**

워크벤치 picker JSX(line 5069, 5073)를 교체한다:

```tsx
                      <VehiclePicker key={editingQuoteId ?? "new"} initialTrimId={editingQuoteId ? openQuoteActionTrimId() : undefined} onChange={(selection) => { void applyTrimToPricing(selection); }} />
```

```tsx
                      <OptionPicker key={trimDetail?.id ?? "none"} options={trimDetail?.options ?? []} relations={trimDetail?.optionRelations ?? []} initialSelectedIds={selectedWorkbenchOptionIds} onChange={applyOptionTotal} />
```

- [ ] **Step 3: `openQuoteActionTrimId` 헬퍼 추가(수정 대상 견적의 trimId)**

`applyOptionTotal` 함수(line 1306-1314) **다음**에 추가한다. `editingQuoteId`로 `quotes`에서 trimId를 찾는다(KimQuoteItem.trimId, PR1):

```typescript
  function openQuoteActionTrimId(): number | undefined {
    if (!editingQuoteId) return undefined;
    return quotes.find((q) => q.id === editingQuoteId)?.trimId;
  }
```

- [ ] **Step 4: typecheck + 단위테스트 회귀**

Run: `bun run typecheck` → 0.
Run: `bun run test:unit` → PASS(기존 224 유지; 이 변경은 워크벤치 prefill로 단위테스트 비대상).

---

## Task 3: saveQuoteFromWorkbench UPDATE 분기

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (`saveQuoteFromWorkbench` line ~2314)

- [ ] **Step 1: UPDATE 분기 삽입**

`saveQuoteFromWorkbench`에서 입력 추출이 끝난 직후(현 line 2330 `const num = ...;` **다음**, INSERT용 `const tempId = ...`(line 2332) **앞**)에 editingQuoteId 분기를 삽입한다:

```typescript
    const num = (n: number | undefined | null) => (n == null ? null : String(n));

    // PR2c-1: 수정모드 — INSERT 대신 UPDATE(재발송). scenarios 미전송 → 기존 시나리오 보존.
    if (editingQuoteId) {
      const prevQuotes = quotes;
      setQuotes((current) => current.map((q) => (q.id === editingQuoteId ? {
        ...q,
        source,
        brand: brandName ?? undefined,
        model: modelName ?? undefined,
        trim: trimName ?? undefined,
        vehicleName,
        finalVehiclePrice: pricing.finalVehiclePrice,
        exteriorColorName: exteriorColor?.name,
        exteriorColorHex: exteriorColor?.hexValue ?? undefined,
        interiorColorName: interiorColor?.name,
        interiorColorHex: interiorColor?.hexValue ?? undefined,
        trimId: trimDetail?.id ?? q.trimId,
        exteriorColorId: exteriorColor?.id ?? undefined,
        interiorColorId: interiorColor?.id ?? undefined,
        status: "고객 확인 전",
        appStatus: "sent",
        revision: (q.revision ?? 1) + 1,
        meta: `${savedAt} · 수정 후 재발송`,
      } : q)));
      if (customer.id && !editingQuoteId.startsWith("kim-")) {
        const patch: QuoteWritePatch = {
          status: "고객 확인 전",
          entryMode: source,
          appStatus: "sent",
          bumpRevision: true,
          brandName,
          modelName,
          trimName,
          trimId: trimDetail?.id ?? null,
          basePrice: inputs ? num(inputs.basePrice) : null,
          optionTotal: inputs ? num(inputs.optionPrice) : null,
          options: selectedOptions.length ? selectedOptions : null,
          finalDiscount: inputs ? num(inputs.discount) : null,
          acquisitionTax: inputs ? num(inputs.acquisitionTax) : null,
          acquisitionTaxMode,
          bond: inputs ? num(inputs.bond) : null,
          delivery: inputs ? num(inputs.delivery) : null,
          incidental: inputs ? num(inputs.incidental) : null,
          finalVehiclePrice: num(pricing.finalVehiclePrice),
          acquisitionCost: num(pricing.acquisitionCost),
          exteriorColorId: exteriorColor?.id ?? null,
          exteriorColorName: exteriorColor?.name ?? null,
          exteriorColorHex: exteriorColor?.hexValue ?? null,
          interiorColorId: interiorColor?.id ?? null,
          interiorColorName: interiorColor?.name ?? null,
          interiorColorHex: interiorColor?.hexValue ?? null,
          // scenarios 미전송 — PR2a updateQuote가 기존 시나리오 보존(편집은 PR2c-2)
        };
        void apiUpdateQuote(customer.id, editingQuoteId, patch).catch(() => { setQuotes(prevQuotes); onToast("견적 수정에 실패했습니다."); });
      }
      setIsQuoteSolutionWorkbenchOpen(false);
      setSolutionWorkbenchModeMenu(null);
      setRecognizedQuoteFile(null);
      setEditingQuoteId(null);
      setEditPrefill(null);
      markRecentUpdate("견적함");
      onToast("수정 견적을 견적함에 저장하고 앱으로 재발송했습니다.");
      return;
    }

    const tempId = `kim-quote-workbench-${nowMs()}`;
```

(`brandName`/`modelName`/`trimName`/`vehicleName`/`selectedOptions`/`inputs`/`pricing`/`savedAt`/`source`는 위쪽 입력 추출에서 이미 정의됨. `apiUpdateQuote`/`QuoteWritePatch`는 이미 import.)

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

---

## Task 4: 워크벤치 헤더/저장 버튼 edit 분기

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (워크벤치 헤더 strong line ~4906, 저장 버튼 line ~5037)

- [ ] **Step 1: 헤더 카피 분기**

워크벤치 헤더의 `<strong>새 견적 작성</strong>`(line ~4906)을 교체한다:

```tsx
                  <strong>{editingQuoteId ? "견적 수정" : "새 견적 작성"}</strong>
```

- [ ] **Step 2: 저장 버튼 라벨 분기**

"견적함에 저장" 버튼(line ~5037-5044)의 라벨 텍스트 `견적함에 저장`을 교체한다(아이콘/클래스/onClick은 유지):

```tsx
                  {editingQuoteId ? "수정 후 발송" : "견적함에 저장"}
```

- [ ] **Step 3: typecheck / lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0.

---

## Task 5: 전체 검증 + 커밋 + PR

**Files:** 없음(검증·커밋만)

- [ ] **Step 1: 검증 4종 + build**

Run: `bun run typecheck` → 0 · `bun run lint` → 0 · `bun run test:unit` → PASS(224 유지) · `bun run test:server` → PASS(62 유지) · `bun run build` → OK.

- [ ] **Step 2: 브랜치 + 커밋(spec·plan 동봉)**

```bash
git checkout -b feat/crm-quotes-edit-workbench-pr2c-1
git add client/src/pages/CustomerDetailPage.tsx \
  ref/specs/2026-06-23-crm-quotes-edit-via-workbench-design.md \
  ref/plans/2026-06-23-crm-quotes-edit-workbench-pr2c-1.md
git commit -m "$(cat <<'EOF'
feat(crm): 견적 수정을 워크벤치 edit로 + 차량/옵션/색상/가격 prefill·UPDATE 저장 (PR2c-1)

- "견적 수정" 진입을 composer 대신 솔루션 워크벤치 edit로 교체
- editPrefill state: detail.quotes(스냅샷·colorId·options)에서 구성
- VehiclePicker initialTrimId로 차량 복원 → applyTrimToPricing이 editPrefill로 옵션/색상/가격 채움(1회 소비)
- OptionPicker initialSelectedIds로 옵션 복원, ColorPicker value로 색상 복원
- saveQuoteFromWorkbench editingQuoteId 분기 → apiUpdateQuote(스냅샷+재발송, scenarios 미전송=기존 보존) + 낙관/롤백
- 헤더/버튼 edit 분기. legacy(trimId 없음)=차량 빈 채 열림
- 시나리오 편집은 PR2c-2(비교카드 controlled화)

검증: typecheck 0 · lint 0 · test:unit 224 · test:server 62 · build OK
브라우저 실측(카카오 세션, 배포본)은 수동 — prefill 타이밍 통합 검증

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: push + PR**

```bash
git push -u origin feat/crm-quotes-edit-workbench-pr2c-1
gh pr create --base main --head feat/crm-quotes-edit-workbench-pr2c-1 \
  --title "feat(crm): 견적 수정 워크벤치 edit + 차량/옵션/색상/가격 prefill·UPDATE 저장 (PR2c-1)" \
  --body "<spec 링크 + 변경 요약 + 검증 결과 + 브라우저 실측 체크리스트. skip-ci 토큰 금지>"
```

---

## 검증 한계 (중요)

prefill은 **비결정적 타이밍**(워크벤치 열림 → VehiclePicker가 `initialTrimId`로 trimDetail 비동기 로드 → `onChange`→`applyTrimToPricing` → OptionPicker 재마운트 → 색상/가격 DOM set)이라 단위테스트로 통합 검증이 어렵다. typecheck/lint/build/회귀는 자동 통과를 보장하지만, **실제 prefill 동작·UPDATE 저장·재발송·새로고침 유지는 브라우저 실측(카카오 로그인 세션, 배포본)으로 사용자가 확인**해야 한다. `editPrefill` state 클로저가 비동기 `onChange` 시점에 stale이면(드묾), `editPrefill`을 `useRef`로 바꿔 확정한다.

## Self-Review (작성자 체크 결과)

- **Spec coverage:** spec "PR2c-1" 전 항목 커버(editPrefill 구성·진입 교체·applyTrimToPricing 분기·picker props·UPDATE 저장·헤더 분기·legacy·시나리오 보존). ✅
- **Placeholder scan:** 모든 코드 스텝 실제 코드. PR 본문만 실행 시 채움. ✅
- **Type consistency:** `KimEditPrefill.optionIds: number[]`/`pricing` 키가 `applyTrimToPricing` setInput 키(base/option/discount/acquisitionTax/bond/delivery/incidental)와 일치. `QuoteWritePatch` 필드(PR2a 확장)와 patch 구성 일치. `openQuoteActionTrimId()`가 `quotes`(KimQuoteItem.trimId, PR1)에서 조회. `apiUpdateQuote`/`QuoteWritePatch` 기존 import. ✅
- **주의:** `applyTrimToPricing`이 `editPrefill`을 1회 소비(`setEditPrefill(null)`) → 두 번째 차량 변경은 정상 리셋. OptionPicker는 `selectedWorkbenchOptionIds` 경유라 editPrefill 클리어와 무관(setTrimDetail+setSelectedWorkbenchOptionIds 같은 배치로 재마운트 시 새 값).
