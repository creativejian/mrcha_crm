# 견적 워크벤치 저장/발송 흐름 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크벤치의 "작성완료"를 진짜 DB 저장(발송 안 함)으로, "수정 후 발송"을 저장+발송으로 만들어, "저장 눌렀는데 리로드하면 사라진다"는 UX 함정을 없앤다.

**Architecture:** 기존 `saveQuoteFromWorkbench`(저장+발송)와 `saveQuoteDetailDraft`(검증만)를 하나의 `persistWorkbenchQuote({ send })`로 통합한다. `send:false`=작성완료(DB 저장, 발송 안 함, 워크벤치 유지), `send:true`=발송(저장+`appStatus="sent"`+재발송, 워크벤치 닫기). 신규는 첫 INSERT 후 반환 id를 `editingQuoteId`로 세팅해 이후 UPDATE(중복 INSERT 방지). 전부 `client/src/pages/CustomerDetailPage.tsx` 한 파일.

**Tech Stack:** React, TypeScript. 검증=typecheck/lint/test:unit/test:server/build + 브라우저 실측(카카오 세션). 마이그레이션 없음.

**Context (compact 대비):** spec=`ref/specs/2026-06-24-crm-quote-workbench-save-flow-design.md`. main 기준(견적 수정 워크벤치화 #92~#98 머지 완료, composer 제거됨). 합의: 작성완료=저장(발송X) / 수정 후 발송=저장+발송 / 조건 저장=프론트 슬롯(토스트 "담았습니다") / 재입력 죽은버튼 제거 / 미리보기는 작성완료(저장) 후 활성 / 발송 버튼은 게이트 독립.

**기존 코드 위치(main, 라인은 편집 중 shift되니 grep으로 재확인):**
- `validateQuoteDetailDraft`(~1346), `saveQuoteDetailDraft`(~1364), `guardQuoteDraftOutput`(~1375), `saveQuoteFromWorkbench`(~2191), `extractWorkbenchScenarios`(~2160), `saveManualQuoteCondition`(~1134, 토스트 "${round}번 조건을 저장했습니다."), `resetQuoteWorkbench`(~2355), `quoteDraftReady`(~998).
- 워크벤치 헤더 버튼: 초기화(`resetQuoteWorkbench`)/작성완료(`saveQuoteDetailDraft`, 라벨 "작성완료")/견적서보기(`guardQuoteDraftOutput("견적서 보기")`)/앱카드보기(`guardQuoteDraftOutput("앱카드 보기")`)/저장발송(`saveQuoteFromWorkbench`, 라벨 `editingQuoteId ? "수정 후 발송" : "견적함에 저장"`, className `primary${quoteDraftReady ? "" : " is-disabled"}`).
- 비교카드 "재입력" 버튼: `<button type="button">재입력</button>` (onClick 없는 죽은 버튼).

---

## Task 1: persistWorkbenchQuote 헬퍼 + 두 함수 통합

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: `persistWorkbenchQuote` 헬퍼 추가**

`saveQuoteFromWorkbench` 함수 **앞**에 추가한다(grep `function saveQuoteFromWorkbench`로 위치 확인). 기존 `saveQuoteFromWorkbench`의 입력추출·낙관·API 로직을 흡수하고 `send` 분기를 둔다:

```typescript
  // 워크벤치 견적 영속. send=false: 작성완료(DB 저장, 발송X, 워크벤치 유지). send=true: 발송(저장+sent, 닫기).
  // 신규는 첫 INSERT 후 반환 id를 editingQuoteId로 세팅 → 이후 UPDATE(중복 INSERT 방지).
  function persistWorkbenchQuote({ send }: { send: boolean }) {
    const missing = validateQuoteDetailDraft();
    if (missing.length > 0) { onToast(missing.slice(0, 3).join(" ")); return; }

    const source: KimQuoteItem["source"] = solutionWorkbenchEntryMode === "solution" ? "solution" : solutionWorkbenchEntryMode === "original" ? "original" : "manual";
    const sourceLabel = source === "solution" ? "솔루션 조회 조건" : source === "original" ? "원본 인식 후 보정" : "수기 입력 조건";
    const savedAt = formatKoreanShortTime();
    const root = pricingPanelRef.current;
    const inputs = root ? readPricingInputs(root) : null;
    const brandName = workbenchVehicle?.brand?.name ?? null;
    const modelName = workbenchVehicle?.model?.name ?? null;
    const trimName = trimDetail?.trimName ?? trimDetail?.name ?? null;
    const selectedOptions = trimDetail
      ? trimDetail.options.filter((o) => selectedWorkbenchOptionIds.includes(o.id)).map((o) => ({ id: o.id, name: o.name, price: o.price }))
      : [];
    const vehicleName = [brandName, modelName, trimName].filter(Boolean).join(" ") || "차량 미선택";
    const num = (n: number | undefined | null) => (n == null ? null : String(n));

    // UPDATE patch / INSERT payload 공유 스냅샷 컬럼
    const snapshot = {
      brandName, modelName, trimName,
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
    };
    const scenarioField = savedManualQuoteConditionIds.length ? { scenarios: extractWorkbenchScenarios() } : {};
    const optimisticVehicle = {
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
      trimId: trimDetail?.id ?? undefined,
      exteriorColorId: exteriorColor?.id ?? undefined,
      interiorColorId: interiorColor?.id ?? undefined,
    };

    if (editingQuoteId) {
      const prevQuotes = quotes;
      setQuotes((current) => current.map((q) => (q.id === editingQuoteId ? {
        ...q,
        ...optimisticVehicle,
        ...(send
          ? { status: "고객 확인 전", appStatus: "sent" as const, revision: (q.revision ?? 1) + 1, meta: `${savedAt} · 수정 후 재발송` }
          : { meta: `${savedAt} · 저장` }),
      } : q)));
      if (customer.id && !editingQuoteId.startsWith("kim-")) {
        const patch: QuoteWritePatch = {
          entryMode: source,
          ...snapshot,
          ...scenarioField,
          ...(send ? { status: "고객 확인 전", appStatus: "sent", bumpRevision: true } : {}),
        };
        void apiUpdateQuote(customer.id, editingQuoteId, patch).catch(() => { setQuotes(prevQuotes); onToast(send ? "발송에 실패했습니다." : "저장에 실패했습니다."); });
      }
    } else {
      const tempId = `kim-quote-workbench-${nowMs()}`;
      const tempQuoteCode = createKimQuoteCode(quotes);
      setQuotes((current) => [...current, {
        id: tempId,
        quoteCode: tempQuoteCode,
        title: vehicleName,
        meta: `${savedAt} · ${sourceLabel}`,
        status: "작성중",
        ...optimisticVehicle,
        appStatus: send ? "sent" : "draft",
        quoteRound: "1차",
        financeType: solutionWorkbenchPurchaseMethod,
        term: "조건 미정",
        lender: "금융사 미정",
        stockStatus: "재고확인중",
        note: sourceLabel,
        decisionStatus: "none",
        ...(recognizedQuoteFile ? { fileName: recognizedQuoteFile.fileName, fileSize: recognizedQuoteFile.fileSize, mimeType: recognizedQuoteFile.mimeType, file: recognizedQuoteFile.file } : {}),
      }]);
      if (customer.id) {
        const builtScenarios = extractWorkbenchScenarios();
        const payload: QuoteCreatePayload = {
          entryMode: source,
          status: "작성중",
          quoteRound: "1차",
          stockStatus: "재고확인중",
          note: sourceLabel,
          ...snapshot,
          ...(builtScenarios.length ? { scenarios: builtScenarios } : { scenario: { purchaseMethod: solutionWorkbenchPurchaseMethod } }),
        };
        void apiCreateQuote(customer.id, payload)
          .then(({ id, quoteCode }) => {
            setQuotes((current) => current.map((q) => (q.id === tempId ? { ...q, id, quoteCode } : q)));
            setEditingQuoteId(id); // 이후 작성완료/발송은 같은 견적 UPDATE
            if (send && !id.startsWith("kim-")) {
              void apiUpdateQuote(customer.id, id, { status: "고객 확인 전", appStatus: "sent", bumpRevision: true }).catch(() => onToast("발송에 실패했습니다."));
            }
          })
          .catch(() => { setQuotes((current) => current.filter((q) => q.id !== tempId)); onToast("저장에 실패했습니다."); });
      }
    }

    setIsQuoteDraftSaved(true);
    setIsQuoteDraftDirty(false);
    setRecognizedQuoteFile(null);
    markRecentUpdate("견적함");
    if (send) {
      setIsQuoteSolutionWorkbenchOpen(false);
      setSolutionWorkbenchModeMenu(null);
      setEditingQuoteId(null);
      setEditPrefill(null);
    }
    onToast(send ? "저장하고 고객 앱으로 발송했습니다." : "견적을 저장했습니다.");
  }
```

- [ ] **Step 2: `saveQuoteDetailDraft`("작성완료")를 wrapper로 교체**

기존 `saveQuoteDetailDraft` 함수 본문(grep `function saveQuoteDetailDraft`)을 교체:

```typescript
  function saveQuoteDetailDraft() {
    persistWorkbenchQuote({ send: false });
  }
```

- [ ] **Step 3: `saveQuoteFromWorkbench`("발송")를 wrapper로 교체**

기존 `saveQuoteFromWorkbench` 함수 전체(현 2191~2353)를 교체:

```typescript
  function saveQuoteFromWorkbench() {
    persistWorkbenchQuote({ send: true });
  }
```

- [ ] **Step 4: typecheck + lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0.
실패 시: `appStatus: "sent" as const` 누락(union 좁히기), 미사용 변수(`sourceLabel`은 신규 분기에서 사용) 확인.

---

## Task 2: 발송 버튼 게이트 독립 + 라벨, 미리보기 게이트 유지

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (워크벤치 헤더 버튼 JSX)

- [ ] **Step 1: 발송 버튼 — 라벨 + 게이트 독립**

저장/발송 버튼(grep `onClick={saveQuoteFromWorkbench}`)에서: 라벨 `editingQuoteId ? "수정 후 발송" : "견적함에 저장"` → `editingQuoteId ? "수정 후 발송" : "작성 후 발송"`, 그리고 `quoteDraftReady ? "" : " is-disabled"` 클래스를 **제거**(항상 활성, `persistWorkbenchQuote`가 자체 검증). 해당 버튼의 `className`을 다음으로:

```tsx
                        className="kim-quote-workbench-action primary"
```

라벨 텍스트:

```tsx
                        {editingQuoteId ? "수정 후 발송" : "작성 후 발송"}
```

- [ ] **Step 2: 미리보기 게이트 유지 확인 (변경 없음)**

견적서 보기·앱카드 보기 버튼의 `guardQuoteDraftOutput(...)`는 **그대로 둔다**(작성완료=저장 후 활성). `guardQuoteDraftOutput`의 미저장 토스트 문구만 명확화 — grep `먼저 세부 견적을 저장해 주세요` → `${outputLabel} 전에 먼저 "작성완료"로 저장해 주세요.`:

```typescript
    onToast(`${outputLabel} 전에 먼저 "작성완료"로 저장해 주세요.`);
```

- [ ] **Step 3: typecheck + lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0.

---

## Task 3: 조건 저장 토스트 + 재입력 죽은 버튼 제거

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: 조건 저장 토스트 명확화**

`saveManualQuoteCondition`(grep `function saveManualQuoteCondition`)의 토스트를 교체:

```typescript
    onToast(`${conditionRound}번 조건을 담았습니다. "작성완료"를 누르면 저장됩니다.`);
```

- [ ] **Step 2: 비교카드 "재입력" 죽은 버튼 제거**

grep `<button type="button">재입력</button>` 으로 찾아 그 한 줄을 삭제한다(편집은 옆의 "수정" 버튼=`editManualQuoteCondition`가 담당).

- [ ] **Step 3: typecheck + lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0.

---

## Task 4: 전체 검증 + 커밋 + PR

**Files:** 없음(검증·커밋만)

- [ ] **Step 1: 검증 4종 + build**

Run: `bun run typecheck` → 0 · `bun run lint` → 0 · `bun run test:unit` → PASS(224 유지) · `bun run test:server` → PASS(62 유지) · `bun run build` → OK.

- [ ] **Step 2: 브랜치 + 커밋(spec·plan 동봉)**

```bash
git checkout -b feat/crm-quote-workbench-save-flow
git add client/src/pages/CustomerDetailPage.tsx \
  ref/specs/2026-06-24-crm-quote-workbench-save-flow-design.md \
  ref/plans/2026-06-24-crm-quote-workbench-save-flow.md
git commit -m "$(cat <<'EOF'
feat(crm): 견적 워크벤치 "작성완료=저장 / 발송=저장+발송" 흐름 재설계

- persistWorkbenchQuote({send}) 헬퍼로 saveQuoteFromWorkbench+saveQuoteDetailDraft 통합
- "작성완료" = DB 저장(전체: 차량/옵션/색상/가격/시나리오, 발송X, 워크벤치 유지). 신규 첫 INSERT 후 editingQuoteId 세팅→이후 UPDATE(중복 INSERT 방지)
- "수정 후 발송"/"작성 후 발송" = 저장 + appStatus=sent + 재발송. 게이트 독립(자체 검증)
- "조건 저장" 토스트 "담았습니다"로 명확화(프론트 슬롯 유지). "재입력" 죽은 버튼 제거
- 미리보기(견적서/앱카드)는 작성완료(저장) 후 활성 유지
- 근본원인: "작성완료/조건저장"이 DB 저장 아닌 프론트 게이트였던 UX 함정(systematic-debugging)

검증: typecheck 0 · lint 0 · test:unit 224 · test:server 62 · build OK
브라우저 실측(카카오 세션) — 작성완료 저장/리로드 유지·발송·신규 INSERT→UPDATE

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: push + PR**

```bash
git push -u origin feat/crm-quote-workbench-save-flow
gh pr create --base main --head feat/crm-quote-workbench-save-flow \
  --title "feat(crm): 견적 워크벤치 작성완료=저장 / 발송=저장+발송 흐름 재설계" \
  --body "<spec 링크 + 변경 요약 + 브라우저 실측 체크리스트. skip-ci 토큰 금지>"
```

---

## 검증 한계 / 캐비엇

- `persistWorkbenchQuote`는 DOM(`readPricingInputs`/`extractWorkbenchScenarios`)+state 의존이라 단위테스트로 통합 검증이 어렵다. typecheck/lint/build/회귀는 보장하지만 **실제 동작은 브라우저 실측(카카오 세션, 배포본) 필수**: ①수정 진입→변경→"작성완료"→리로드 유지(발송 안 됨) ②"수정 후 발송"→발송+유지 ③신규 작성→"작성완료"(INSERT)→재"작성완료"(UPDATE, 중복 견적 없음) ④"조건 저장"은 작성완료 전엔 DB 미반영 ⑤"재입력" 버튼 사라짐 ⑥미리보기는 작성완료 후 활성.
- **race 캐비엇**: 신규 첫 "작성완료"는 `apiCreateQuote.then`에서 `setEditingQuoteId`(비동기). 그 사이 "작성완료" 연타 시 중복 INSERT 가능(드묾). 필요 시 저장 중 버튼 disable로 보강(후속).
- 상세 캐시 불변식: `apiUpdateQuote`/`apiCreateQuote`가 내부에서 `invalidateCustomerDetail` 호출(기존 lib 패턴) → 추가 조치 불필요.

## Self-Review (작성자 체크 결과)

- **Spec coverage:** spec 결정 1~6 전부 커버(작성완료=저장·발송=저장+sent·조건저장 프론트·재입력 제거·미리보기 게이트·신규수정 일관). ✅
- **Placeholder scan:** 모든 코드 스텝 실제 코드. PR 본문만 실행 시 채움. ✅
- **Type consistency:** `persistWorkbenchQuote({ send })` 시그니처를 `saveQuoteDetailDraft`(false)·`saveQuoteFromWorkbench`(true)가 일관 호출. `QuoteWritePatch`/`QuoteCreatePayload` 필드는 기존(PR2a/2c) 그대로. `appStatus: "sent" as const`로 union 좁힘. ✅
- **주의:** "작성완료"(send:false)는 워크벤치 유지 + `editingQuoteId` 유지(신규는 INSERT 후 세팅), "발송"(send:true)은 닫기 + `editingQuoteId` 클리어. 미리보기 게이트(`quoteDraftReady`)는 `persistWorkbenchQuote`가 `isQuoteDraftSaved=true`로 열어줌.
