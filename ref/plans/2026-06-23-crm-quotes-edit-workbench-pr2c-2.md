# 견적 수정 워크벤치 일원화 — PR2c-2 (비교카드 기간 입력화 + 시나리오 복원/편집) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 수정 시 기존 금융 시나리오(비교카드)를 복원해 편집할 수 있게 하고, 저장 시 `scenarios` 전체 교체로 보낸다. 더불어 비교카드의 기간(termMonths)을 입력 가능하게 한다.

**Architecture:** 비교카드의 데이터 소스를 정적 상수(`kimManualQuoteConditionCards`)에서 `manualQuoteCards` state로 바꿔, 수정 진입 시 `editPrefill.scenarios`(round→카드 매핑)로 채운다. 기간은 현재 60개월 hardcoded라 `manualTermMonths` state로 controlled화한다. 저장 추출(`builtScenarios`)을 `extractWorkbenchScenarios` 헬퍼로 빼서 INSERT/UPDATE가 공유하고 termMonths를 포함시킨다. PR2c-1의 UPDATE 분기는 `scenarios` 미전송이었는데, 여기서 `extractWorkbenchScenarios()`를 `patch.scenarios`로 전송(PR2a `updateQuote`가 전체 교체). 자동차세/보조금은 저장 경로 미노출이라 범위 외(YAGNI). 복원/포맷은 비결정적은 아니나 디테일이 많아 브라우저 실측이 필수.

**Tech Stack:** React, TypeScript, Vitest(회귀), `bun test`(서버 회귀).

---

## File Structure

- **Modify** `client/src/pages/CustomerDetailPage.tsx`
  - `manualTermMonths` state(기간 controlled) + 비교카드 기간 버튼 wiring
  - `manualQuoteCards` state(비교카드 데이터 소스) + `kimManualQuoteConditionCards` map → state map
  - `KimEditScenario` 타입 + `KimEditPrefill.scenarios`
  - `buildManualCardsFromScenarios` 헬퍼(round→카드)
  - 견적 수정 진입 onClick: editPrefill.scenarios 구성 + 비교카드/모드/기간 state 복원
  - `extractWorkbenchScenarios` 헬퍼(기존 INSERT의 builtScenarios 추출 + termMonths) — INSERT/UPDATE 공유
  - `saveQuoteFromWorkbench` UPDATE 분기에 `scenarios: extractWorkbenchScenarios()` 추가
  - `resetQuoteWorkbench`/워크벤치 "+" 열기: `manualQuoteCards`/`manualTermMonths` 초기화

기존 참조: `savedManualQuoteConditionIds`/`manualDepositModes`/`manualDownPaymentModes`/`manualResidualModes`/`manualMileageModes`/`manualMileageValues`(state), `saveManualQuoteCondition`(line 1161)/`editManualQuoteCondition`(1168), `CustomerDetailScenario`(lib/kim-quote.ts), `ScenarioInput`(lib/customer-quotes.ts), `QuoteWritePatch.scenarios`(PR2a).

---

## Task 1: 비교카드 기간(termMonths) 입력화

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (state ~line 900대, 기간 JSX line ~5171)

- [ ] **Step 1: `manualTermMonths` state 추가**

`const [savedManualQuoteConditionIds, setSavedManualQuoteConditionIds] = useState<string[]>([]);`(line 900) **다음 줄**에 추가한다:

```typescript
  const [manualTermMonths, setManualTermMonths] = useState<Record<string, number>>({});
```

- [ ] **Step 2: 기간 setter 추가**

`setManualMileageMode` 함수(line ~1357) **다음**에 추가한다:

```typescript
  function setManualTermMonthsFor(conditionId: string, months: number) {
    setManualTermMonths((current) => ({ ...current, [conditionId]: months }));
    markQuoteDraftChanged();
  }
```

- [ ] **Step 3: 비교카드 기간 버튼 controlled화**

비교카드의 기간 `<label>`(line ~5171, `<span>기간</span>` 줄)을 교체한다. 현재 5개 버튼(12/24/36/48/60)은 onClick 없이 60만 active다. controlled로:

```tsx
                                <label><span>기간</span><div className="kim-jeff-segment wide">{[12, 24, 36, 48, 60].map((m) => { const cur = manualTermMonths[condition.id] ?? 60; return <button key={m} className={cur === m ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualTermMonthsFor(condition.id, m)} type="button">{m}개월</button>; })}</div></label>
```

- [ ] **Step 4: typecheck**

Run: `bun run typecheck` → 0.
(이 시점엔 기간 선택이 state로 동작하지만 아직 저장 추출엔 미반영 — Task 4에서.)

---

## Task 2: extractWorkbenchScenarios 헬퍼(DRY + termMonths)

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (`saveQuoteFromWorkbench` 내부 builtScenarios 로직)

- [ ] **Step 1: `extractWorkbenchScenarios` 헬퍼 추가**

`saveQuoteFromWorkbench` 함수 **앞**(같은 컴포넌트 스코프)에 헬퍼를 추가한다. 기존 INSERT 경로의 `builtScenarios` 로직(현 `saveQuoteFromWorkbench` 내 `const compareForm = ...; const builtScenarios = savedManualQuoteConditionIds.map(...)`)과 동일하되 **termMonths를 추가**한다:

```typescript
  function extractWorkbenchScenarios(): ScenarioInput[] {
    const compareForm = quoteDetailFormRef.current;
    return savedManualQuoteConditionIds.map((condId) => {
      const card = compareForm?.querySelector<HTMLElement>(`[data-scenario-card="${condId}"]`);
      const fieldVal = (f: string) => card?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-sc-field="${f}"]`)?.value ?? null;
      const constCard = manualQuoteCards.find((c) => c.id === condId);
      const depositMode = manualDepositModes[condId] ?? constCard?.depositMode ?? null;
      const downPaymentMode = manualDownPaymentModes[condId] ?? constCard?.downPaymentMode ?? null;
      const residualMode = manualResidualModes[condId] ?? constCard?.residualMode ?? null;
      const mileageMode = manualMileageModes[condId] ?? "basic";
      const mileageValue = mileageMode === "basic" ? "20,000km / 년" : (manualMileageValues[condId] ?? "20,000km / 년");
      const lenderRaw = fieldVal("lender");
      return {
        scenarioNo: Number(constCard?.round ?? 1),
        isSaved: true,
        purchaseMethod: solutionWorkbenchPurchaseMethod,
        termMonths: manualTermMonths[condId] ?? 60,
        lender: lenderRaw && lenderRaw !== "미선택" ? lenderRaw : null,
        monthlyPayment: parseMonthlyPayment(fieldVal("monthly") ?? ""),
        depositMode,
        depositValue: depositMode === "none" ? null : parseMonthlyPayment(fieldVal("deposit") ?? ""),
        downPaymentMode,
        downPaymentValue: downPaymentMode === "none" ? null : parseMonthlyPayment(fieldVal("downPayment") ?? ""),
        residualMode,
        residualValue: residualMode === "max" ? null : parseMonthlyPayment(fieldVal("residual") ?? ""),
        mileageMode,
        mileageValue,
      };
    });
  }
```

- [ ] **Step 2: INSERT 경로가 헬퍼를 쓰도록 교체**

`saveQuoteFromWorkbench`의 INSERT 경로에 있는 `const compareForm = ...;`부터 `const builtScenarios = savedManualQuoteConditionIds.map((condId) => { ... });` 블록을 다음으로 교체한다:

```typescript
      const builtScenarios = extractWorkbenchScenarios();
```

(이후 `builtScenarios.length ? { scenarios: builtScenarios } : { scenario: {...} }` 사용부는 그대로.)

- [ ] **Step 3: typecheck + 서버 회귀**

Run: `bun run typecheck` → 0.
Run: `bun run test:server` → PASS(서버 무변, createQuote scenarios 라운드트립 유지).

---

## Task 3: editPrefill.scenarios + 비교카드 복원

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (`KimEditPrefill` 타입, `manualQuoteCards` state, 비교카드 map, 수정 진입 onClick, reset/신규)

- [ ] **Step 1: `KimEditScenario` 타입 + `KimEditPrefill.scenarios` 추가**

`type KimEditPrefill = { ... };`(PR2c-1에서 추가)을 다음으로 교체한다:

```typescript
type KimEditScenario = {
  scenarioNo: number;
  lender: string;
  monthlyPayment: string;
  termMonths: number;
  depositMode: KimManualDepositMode;
  depositValue: string;
  downPaymentMode: KimManualDepositMode;
  downPaymentValue: string;
  residualMode: KimManualResidualMode;
  residualValue: string;
  mileageMode: KimManualMileageMode;
  mileageValue: string;
};
type KimEditPrefill = {
  optionIds: number[];
  exteriorColorId: number | null;
  interiorColorId: number | null;
  pricing: { base: number; option: number; discount: number; acquisitionTax: number; bond: number; delivery: number; incidental: number };
  scenarios: KimEditScenario[];
};
```

- [ ] **Step 2: `manualQuoteCards` state 추가**

`const [manualTermMonths, ...]`(Task 1 Step 1) **다음 줄**에 추가한다:

```typescript
  const [manualQuoteCards, setManualQuoteCards] = useState(kimManualQuoteConditionCards);
```

- [ ] **Step 3: `buildManualCardsFromScenarios` 헬퍼 추가**

`saveManualQuoteCondition` 함수(line ~1161) **앞**에 추가한다. scenario를 정적 카드 골격에 덮어쓴다(빈 슬롯은 기본):

```typescript
  function buildManualCardsFromScenarios(scenarios: KimEditScenario[]): typeof kimManualQuoteConditionCards {
    return kimManualQuoteConditionCards.map((base) => {
      const sc = scenarios.find((s) => String(s.scenarioNo) === base.round);
      if (!sc) return base;
      return {
        ...base,
        lender: sc.lender || "미선택",
        monthlyPayment: sc.monthlyPayment ? formatMoney(Number(sc.monthlyPayment)) : "0",
        depositMode: sc.depositMode,
        depositValue: sc.depositMode === "percent" ? sc.depositValue : (sc.depositValue ? formatMoney(Number(sc.depositValue)) : "0"),
        downPaymentMode: sc.downPaymentMode,
        downPaymentValue: sc.downPaymentMode === "percent" ? sc.downPaymentValue : (sc.downPaymentValue ? formatMoney(Number(sc.downPaymentValue)) : "0"),
        residualMode: sc.residualMode,
        residualValue: sc.residualMode === "max" ? "-" : (sc.residualMode === "percent" ? sc.residualValue : (sc.residualValue ? formatMoney(Number(sc.residualValue)) : "0")),
      };
    });
  }
```

- [ ] **Step 4: 비교카드 map 소스를 state로 교체 + key에 editingQuoteId**

비교카드 렌더(line ~5149) `{kimManualQuoteConditionCards.map((condition) => {`를 `{manualQuoteCards.map((condition) => {`로 교체하고, 각 카드 `<section ... key={condition.id}>`(line ~5158)의 key를 `key={`${editingQuoteId ?? "new"}-${condition.id}`}`로 교체한다(수정 진입 시 defaultValue 재적용 위해 재마운트).

- [ ] **Step 5: 견적 수정 진입에 시나리오 복원 추가**

견적 수정 진입 onClick(PR2c-1, `const dq = detail.quotes.find(...)` 블록)에서 `setEditPrefill(dq ? {...} : null);` 호출의 객체에 `scenarios`를 추가하고, 그 **다음**에 비교카드/모드/기간 복원을 넣는다. `dq.scenarios`(CustomerDetailScenario[])를 변환:

```typescript
              const editScenarios: KimEditScenario[] = (dq?.scenarios ?? []).map((s) => ({
                scenarioNo: s.scenarioNo ?? 1,
                lender: s.lender ?? "미선택",
                monthlyPayment: s.monthlyPayment ?? "",
                termMonths: s.termMonths ?? 60,
                depositMode: (s.depositMode as KimManualDepositMode) ?? "none",
                depositValue: s.depositValue ?? "0",
                downPaymentMode: (s.downPaymentMode as KimManualDepositMode) ?? "none",
                downPaymentValue: s.downPaymentValue ?? "0",
                residualMode: (s.residualMode as KimManualResidualMode) ?? "max",
                residualValue: s.residualValue ?? "-",
                mileageMode: (s.mileageMode as KimManualMileageMode) ?? "basic",
                mileageValue: s.mileageValue ?? "20,000km / 년",
              }));
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
                scenarios: editScenarios,
              } : null);
              // 비교카드 복원: 카드 데이터 + 저장됨 표시 + mode/기간 state
              setManualQuoteCards(editScenarios.length ? buildManualCardsFromScenarios(editScenarios) : kimManualQuoteConditionCards);
              setSavedManualQuoteConditionIds(editScenarios.map((s) => `manual-condition-${s.scenarioNo}`));
              setManualDepositModes(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.depositMode])));
              setManualDownPaymentModes(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.downPaymentMode])));
              setManualResidualModes(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.residualMode])));
              setManualMileageModes(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.mileageMode])));
              setManualMileageValues(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.mileageValue])));
              setManualTermMonths(Object.fromEntries(editScenarios.map((s) => [`manual-condition-${s.scenarioNo}`, s.termMonths])));
```

(기존 `setEditPrefill(dq ? {...} : null);` 한 줄은 위 블록으로 대체됨. `setManualDepositModes` 등 setter 이름은 state 선언과 일치해야 함 — 선언부에서 확인.)

- [ ] **Step 6: 신규/리셋 시 비교카드 state 초기화**

워크벤치 "+" 열기 onClick(`setIsQuoteSolutionWorkbenchOpen(true)` 직전, PR2c-1 진입과 별개의 "+" 버튼)과 `resetQuoteWorkbench`(`setSavedManualQuoteConditionIds([]);` 줄 옆)에 추가한다:

```typescript
    setManualQuoteCards(kimManualQuoteConditionCards);
    setManualTermMonths({});
```

(두 위치 모두. 신규 작성이 수정 잔여 state를 물려받지 않도록.)

- [ ] **Step 7: typecheck**

Run: `bun run typecheck` → 0.

---

## Task 4: saveQuoteFromWorkbench UPDATE 분기에 scenarios 전송

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (PR2c-1 UPDATE 분기 patch)

- [ ] **Step 1: UPDATE patch에 scenarios 추가**

PR2c-1이 만든 UPDATE 분기 patch에서 `// scenarios 미전송 — ...` 주석 줄을 다음으로 교체한다:

```typescript
          scenarios: extractWorkbenchScenarios(),
```

이로써 수정 저장이 비교카드 시나리오를 전체 교체(PR2a `updateQuote`)한다. 저장된 비교카드가 없으면 빈 배열 → `updateQuote`가 `if (patch.scenarios)` 분기로 들어가 시나리오 전부 삭제됨에 주의 — **저장된 카드가 0건이면 scenarios를 보내지 않도록** 가드한다:

```typescript
          ...(savedManualQuoteConditionIds.length ? { scenarios: extractWorkbenchScenarios() } : {}),
```

(즉 위 한 줄을 patch 객체에 넣는다. 저장 카드 0건이면 미전송 → 기존 보존, PR2c-1과 동일 안전.)

- [ ] **Step 2: typecheck / lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0.

---

## Task 5: 전체 검증 + 커밋 + PR

**Files:** 없음(검증·커밋만)

- [ ] **Step 1: 검증 4종 + build**

Run: `bun run typecheck` → 0 · `bun run lint` → 0 · `bun run test:unit` → PASS(224 유지) · `bun run test:server` → PASS(62 유지) · `bun run build` → OK.

- [ ] **Step 2: 브랜치 + 커밋(spec·plan 동봉)**

```bash
git checkout -b feat/crm-quotes-edit-workbench-pr2c-2
git add client/src/pages/CustomerDetailPage.tsx \
  ref/specs/2026-06-23-crm-quotes-edit-via-workbench-design.md \
  ref/plans/2026-06-23-crm-quotes-edit-workbench-pr2c-2.md
git commit -m "$(cat <<'EOF'
feat(crm): 견적 수정 시 비교카드 시나리오 복원/편집 + 기간 입력화 (PR2c-2)

- 비교카드 데이터 소스를 정적 상수 → manualQuoteCards state(수정 진입 시 scenario round→카드 매핑 복원)
- 기간(termMonths) 입력화: manualTermMonths state + 비교카드 기간 버튼 controlled
- extractWorkbenchScenarios 헬퍼(builtScenarios + termMonths) INSERT/UPDATE 공유
- saveQuoteFromWorkbench UPDATE 분기에 scenarios 전송(저장 카드 0건이면 미전송=보존)
- 자동차세/보조금은 저장 경로 미노출이라 범위 외(YAGNI)

검증: typecheck 0 · lint 0 · test:unit 224 · test:server 62 · build OK
브라우저 실측(카카오 세션) 필수 — 비교카드 복원/포맷/저장 교체

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: push + PR**

```bash
git push -u origin feat/crm-quotes-edit-workbench-pr2c-2
gh pr create --base main --head feat/crm-quotes-edit-workbench-pr2c-2 \
  --title "feat(crm): 견적 수정 비교카드 시나리오 복원/편집 + 기간 입력화 (PR2c-2)" \
  --body "<spec 링크 + 변경 요약 + 검증 + 브라우저 실측 체크리스트. skip-ci 토큰 금지>"
```

---

## 검증 한계

비교카드 복원은 **defaultValue + key 재마운트 + 포맷 변환(formatMoney/percent)** 이 얽혀, 단위테스트로 통합 검증이 어렵다. typecheck/lint/build/회귀는 자동 통과를 보장하지만, **실제 복원 값·기간 선택·저장 교체·새로고침 유지는 브라우저 실측(카카오 세션, 배포본)으로 사용자가 확인**해야 한다. 특히 deposit/downPayment/residual의 amount↔percent 포맷, monthlyPayment 콤마 포맷이 화면과 맞는지 확인.

## Self-Review (작성자 체크 결과)

- **Spec coverage:** spec "PR2c-2"(비교카드 controlled화·시나리오 전체 복원·저장 교체) 커버. 자동차세/보조금은 저장 경로 미노출이라 YAGNI 제외(spec의 "입력 불가 mock 입력화"를 저장 가능 컬럼=기간으로 한정). ✅
- **Placeholder scan:** 코드 스텝 실제 코드. 단, 비교카드 복원의 state setter 이름(`setManualDepositModes` 등)은 선언부와 일치 확인 필요(Step 5 주의 명시). PR 본문만 실행 시 채움. ✅
- **Type consistency:** `KimEditScenario` 필드가 `buildManualCardsFromScenarios`/복원/`CustomerDetailScenario` 매핑과 일치. `extractWorkbenchScenarios(): ScenarioInput[]`가 `QuoteWritePatch.scenarios`(PR2a) 타입과 일치. `manualQuoteCards` state 타입 = `typeof kimManualQuoteConditionCards`. ✅
- **주의:** UPDATE에서 저장 카드 0건이면 `scenarios` 미전송(스프레드 가드)으로 기존 보존 — `updateQuote`의 `if (patch.scenarios)` 전체삭제 함정 회피. 신규/리셋 시 `manualQuoteCards`/`manualTermMonths` 초기화로 수정 잔여 누수 방지.
