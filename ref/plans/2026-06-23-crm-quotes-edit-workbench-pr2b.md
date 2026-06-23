# 견적 수정 워크벤치 일원화 — PR2b (picker 초기선택 복원 prop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `OptionPicker`/`VehiclePicker`에 초기 선택 복원 prop을 추가해, PR2c의 워크벤치 수정모드가 기존 견적의 옵션/차량을 picker에 복원할 수 있게 한다.

**Architecture:** 두 picker 모두 자체 state를 관리하는 uncontrolled 컴포넌트다. `OptionPicker`는 `useState` lazy init으로 `initialSelectedIds`를 1회 반영(effect-setState 회피, 트림 변경 시 부모가 `key`로 재마운트). `VehiclePicker`는 마운트 effect를 `initialTrimId` 분기로 확장 — 있으면 `fetchTrimDetail`(PR2a로 brandId/modelId/brandName/modelName 노출)로 brand/model/trim을 역추적해 brands/models/trims 목록과 선택 상태를 복원하고 `onChange`로 상위에 전달. prop이 없으면 기존 동작 그대로(신규 작성 무해). `ColorPicker`는 이미 `value` controlled라 변경 없음.

**Tech Stack:** React, TypeScript, Vitest + @testing-library/react + user-event.

---

## File Structure

- **Modify** `client/src/components/OptionPicker.tsx` — `initialSelectedIds?: number[]` prop, `useState(() => new Set(initialSelectedIds))`
- **Modify** `client/src/components/OptionPicker.test.tsx` — 초기선택 복원 테스트 1건
- **Modify** `client/src/components/VehiclePicker.tsx` — `initialTrimId?: number` prop, 마운트 effect를 복원 분기로 확장
- **Modify** `client/src/components/VehiclePicker.test.tsx` — fetch mock에 trim detail 추가 + 복원 테스트 1건
- **변경 없음** `client/src/components/ColorPicker.tsx` (이미 `value` controlled)

---

## Task 1: OptionPicker 초기선택 복원

**Files:** Modify `client/src/components/OptionPicker.tsx:9-17`, `client/src/components/OptionPicker.test.tsx`

- [ ] **Step 1: 복원 테스트 작성 (RED)**

`client/src/components/OptionPicker.test.tsx`의 `describe("OptionPicker", ...)` 안에 추가한다(기존 `options` 상수 재사용):

```typescript
  it("initialSelectedIds로 초기 선택을 복원한다", () => {
    render(<OptionPicker options={options} relations={[]} initialSelectedIds={[2]} />);
    // 닫힌 상태 버튼 라벨에 선택 개수·합산이 반영(선루프 id 2 = 1,500,000)
    expect(screen.getByRole("button", { name: /1개 선택/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1,500,000원/ })).toBeInTheDocument();
  });
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun run test:unit client/src/components/OptionPicker.test.tsx`
Expected: FAIL — `initialSelectedIds` prop이 없어 선택 0개("선택" 라벨), "1개 선택" 매칭 실패.

- [ ] **Step 3: prop + lazy init 구현 (GREEN)**

`client/src/components/OptionPicker.tsx`의 `OptionPickerProps`(line 9-13)와 함수 시그니처(line 15)·`selectedIds` 초기화(line 17)를 교체한다:

```typescript
type OptionPickerProps = {
  options: TrimOption[];
  relations: TrimOptionRelation[];
  initialSelectedIds?: number[];
  onChange?: (next: { selectedIds: number[]; total: number }) => void;
};

export function OptionPicker({ options, relations, initialSelectedIds, onChange }: OptionPickerProps) {
  // 트림이 바뀌면 부모가 key로 재마운트 → 선택은 자연히 초기화(effect 내 setState 회피).
  // 수정모드 진입 시 부모가 initialSelectedIds로 기존 옵션을 복원(lazy init이라 1회).
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(initialSelectedIds));
```

(나머지 본문은 그대로.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/components/OptionPicker.test.tsx`
Expected: PASS (기존 4건 + 신규 1건).

---

## Task 2: VehiclePicker 초기선택(trimId) 복원

**Files:** Modify `client/src/components/VehiclePicker.tsx:11-28`, `client/src/components/VehiclePicker.test.tsx`

- [ ] **Step 1: fetch mock에 trim detail 추가 + 복원 테스트 작성 (RED)**

`client/src/components/VehiclePicker.test.tsx`의 `beforeEach` fetch stub에서, trims 분기가 detail(`/trims/:id`)과 목록(`/trims?modelId=`)을 구분하도록 detail 케이스를 **trims 목록 분기보다 먼저** 넣는다. 기존 `if (url.startsWith("/api/vehicles/trims")) {` **앞**에 추가:

```typescript
      if (url.includes("/api/vehicles/trims/")) {
        // fetchTrimDetail(trimId): PR2a ancestry(brandId/brandName/modelName) 포함
        return new Response(
          JSON.stringify({ id: 100, modelId: 10, name: "Exclusive", trimName: "Exclusive", canonicalName: null, price: 50000000, specs: null, fuelType: null, displacementCc: null, modelYear: null, driveSystem: null, transmissionType: null, bodyStyle: null, seatingCapacity: null, status: "판매중", sortOrder: 1, financialDiscountAmount: null, partnerDiscountAmount: null, cashDiscountAmount: null, brandId: 1, brandName: "현대", modelName: "팰리세이드", options: [], optionRelations: [], colors: [], noOptions: null }),
          { status: 200 },
        );
      }
```

그리고 `describe("VehiclePicker", ...)` 안에 복원 테스트를 추가한다:

```typescript
  it("initialTrimId로 brand/model/trim 선택을 복원하고 onChange 통지", async () => {
    const onChange = vi.fn();
    render(<VehiclePicker initialTrimId={100} onChange={onChange} />);
    expect(await screen.findByRole("button", { name: /현대/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /팰리세이드/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exclusive/ })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: expect.objectContaining({ id: 1 }),
        model: expect.objectContaining({ id: 10 }),
        trim: expect.objectContaining({ id: 100 }),
      }),
    );
  });
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun run test:unit client/src/components/VehiclePicker.test.tsx`
Expected: FAIL — `initialTrimId` prop이 무시되어 brand/model/trim 버튼이 "선택"으로 남고 `onChange` 미호출.

- [ ] **Step 3: prop + 복원 effect 구현 (GREEN)**

`client/src/components/VehiclePicker.tsx`의 import에 `fetchTrimDetail`을 추가한다(line 5):

```typescript
import { fetchBrands, fetchModels, fetchTrims, fetchTrimDetail, type Brand, type Model, type Trim } from "@/lib/vehicles";
```

함수 시그니처(line 11)를 교체한다:

```typescript
export function VehiclePicker({ initialTrimId, onChange }: { initialTrimId?: number; onChange?: (selection: VehicleSelection) => void }) {
```

마운트 effect(현 line 23-28, `useEffect(() => { fetchBrands()... }, [])`)를 다음으로 교체한다:

```typescript
  useEffect(() => {
    let cancelled = false;
    // 신규: 브랜드 목록만 로드.
    if (initialTrimId == null) {
      fetchBrands()
        .then((data) => { if (!cancelled) setBrands(data); })
        .catch(() => { if (!cancelled) setErrored("brand"); })
        .finally(() => { if (!cancelled) setLoading(null); });
      return () => { cancelled = true; };
    }
    // 수정모드: trimId → trim 상세(ancestry)로 brand/model/trim과 목록을 복원.
    setLoading("brand");
    (async () => {
      try {
        const detail = await fetchTrimDetail(initialTrimId);
        const [brandList, modelList, trimList] = await Promise.all([
          fetchBrands(),
          fetchModels(detail.brandId),
          fetchTrims(detail.modelId),
        ]);
        if (cancelled) return;
        setBrands(brandList);
        setModels(modelList);
        setTrims(trimList);
        const b = brandList.find((x) => x.id === detail.brandId);
        const m = modelList.find((x) => x.id === detail.modelId);
        const t = trimList.find((x) => x.id === detail.id);
        if (b) setBrand(b);
        if (m) setModel(m);
        if (t) setTrim(t);
        if (b && m && t) onChange?.({ brand: b, model: m, trim: t });
      } catch {
        if (!cancelled) setErrored("brand");
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트/initialTrimId 변경 시 1회 복원. onChange는 의도적 제외(부모 재생성 시 재실행 방지).
  }, [initialTrimId]);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/components/VehiclePicker.test.tsx`
Expected: PASS (기존 2건 + 신규 1건; 기존 "브랜드 선택→…"은 `initialTrimId` 미전달이라 그대로 동작).

---

## Task 3: 전체 검증 + 커밋 + PR

**Files:** 없음(검증·커밋만)

- [ ] **Step 1: typecheck / lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0.
(lint 주의: VehiclePicker effect의 `eslint-disable-next-line react-hooks/exhaustive-deps`가 사유와 함께 들어갔는지 확인.)

- [ ] **Step 2: 단위 테스트 전체**

Run: `bun run test:unit`
Expected: PASS (직전 222 + 신규 2 = 224).

- [ ] **Step 3: build**

Run: `bun run build`
Expected: OK.

- [ ] **Step 4: 브랜치 + 커밋(spec·plan 동봉)**

```bash
git checkout -b feat/crm-quotes-edit-workbench-pr2b
git add client/src/components/OptionPicker.tsx client/src/components/OptionPicker.test.tsx \
  client/src/components/VehiclePicker.tsx client/src/components/VehiclePicker.test.tsx \
  ref/plans/2026-06-23-crm-quotes-edit-workbench-pr2b.md
git commit -m "$(cat <<'EOF'
feat(crm): picker 초기선택 복원 prop (견적 수정 워크벤치화 PR2b)

- OptionPicker initialSelectedIds: useState lazy init으로 기존 옵션 복원(트림 변경 시 부모 key 재마운트)
- VehiclePicker initialTrimId: fetchTrimDetail ancestry로 brand/model/trim + 목록 복원 후 onChange 통지
- prop 미전달 시 기존 동작(신규 작성 무해). ColorPicker는 value controlled라 무변
- 단위테스트 2건. 마이그레이션 없음. PR2c가 이 prop들을 소비

검증: typecheck 0 · lint 0 · test:unit 224 · build OK

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: push + PR**

```bash
git push -u origin feat/crm-quotes-edit-workbench-pr2b
gh pr create --base main --head feat/crm-quotes-edit-workbench-pr2b \
  --title "feat(crm): picker 초기선택 복원 prop (견적 수정 워크벤치화 PR2b)" \
  --body "<spec 링크 + 변경 요약 + 검증 결과. skip-ci 토큰 금지>"
```

---

## Self-Review (작성자 체크 결과)

- **Spec coverage:** spec "PR2b — picker 초기선택 복원 prop" 전 항목 커버(OptionPicker initialSelectedIds·VehiclePicker initialTrimId 복원·ColorPicker 무변·신규 무해). ✅
- **Placeholder scan:** 모든 코드 스텝 실제 코드. PR 본문만 실행 시 채움. ✅
- **Type consistency:** `initialSelectedIds?: number[]`(OptionPicker), `initialTrimId?: number`(VehiclePicker). 복원에 쓰는 `detail.brandId`/`detail.modelId`/`detail.id`는 PR2a 확장된 `TrimDetail`(brandId:number, modelId:number via Trim, id:number)과 일치. `onChange` 시그니처 `VehicleSelection` 불변. ✅
- **주의:** VehiclePicker fetch mock에서 `/trims/:id`(detail) 분기를 `/trims`(목록) 분기보다 **먼저** 둬야 detail이 목록 mock에 가로채이지 않음(plan Step에 명시). 기존 테스트("브랜드 선택→…")는 `initialTrimId` 미전달이라 신규 경로로 회귀 없음.
