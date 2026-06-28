# 고객 상세 레이아웃 전체 고객 일반화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `isKimMinjun` 하드코딩 게이트를 제거해 모든 고객이 `KimMinjunDetailContent`(표준 상세) 단일 경로를 쓰도록 일반화하고, 하드코딩 텍스트/mock을 정리하고 빈 섹션 안내를 추가하며 legacy 레이아웃을 제거한다.

**Architecture:** `CustomerDetailPage`에서 김민준 전용 분기를 제거하고 모든 고객에 detail fetch + `KimMinjunDetailContent`를 렌더. 컴포넌트 내부의 "김민준"/"CU-2605-0020" 하드코딩 9곳을 `customer` prop으로, 데이터 소스 없는 mock(구매조건·Maybach 가격)을 빈값/0으로 교체. 빈 list 섹션 4곳에 안내 추가. legacy JSX·CSS 삭제. 이름(`KimMinjun*`/`kim*`)은 이번엔 유지(리네임은 후속).

**Tech Stack:** React + react-router, TypeScript strict, vitest(단위), 거대 컴포넌트라 typecheck/lint/build + 수동 검증 위주.

**Spec:** `ref/specs/2026-06-28-crm-customer-detail-generalize-design.md`

> ⚠️ 전 작업 공통: 거대 파일(`client/src/pages/CustomerDetailPage.tsx` ~5700줄). 각 task는 **해당 region을 먼저 읽고** 적용. `editPrefill`/견적 워크벤치 동작 로직은 건드리지 말 것. `bun run typecheck`로 참조 정합, `bun run lint` 0 problems 유지. **김민준(CU-2605-0020) 회귀 없어야 함**(풀데이터 정상 표시).

---

## File Structure

| 파일 | 변경 |
|---|---|
| `client/src/pages/CustomerDetailPage.tsx` | 게이트 제거·legacy JSX 제거·detail fetch 일반화(Task 1) / 하드코딩 9곳(Task 2) / mock 빈값(Task 3) / 빈 안내 4곳(Task 4) |
| `client/src/index.css` | legacy 전용 CSS 제거(Task 5) + 공용 빈안내 클래스(Task 4) |
| `ref/active-session-brief.md`, 메모리 | 갱신(Task 6) |

---

## Task 1: 게이트 제거 + legacy 레이아웃 제거 + detail fetch 일반화

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx` (약 5324~5430)

먼저 `5324`~`5440` region을 읽어 현재 구조 확인. 현재:
- `5339`: `const isKimMinjun = customer.customerId === "CU-2605-0020";`
- `5342~5355`: detail fetch effect — `if (!isKimMinjun || !customer.id) return;`
- `5366`: `<div className={`customer-detail-console-page ${drawerMode ? "drawer" : ""} ${isKimMinjun ? "kim-detail-mode" : ""}`}>`
- `5367~5414`: `{isKimMinjun ? null : (<>...legacy summary/action-rail...</>)}` 블록
- `5416~`: `{isKimMinjun ? ( detailError ? ... : detail ? <KimMinjunDetailContent/> : <로딩> ) : null}`

- [ ] **Step 1: `isKimMinjun` 상수 삭제 + detail fetch 가드 일반화**

`5339` 줄 삭제. detail fetch effect의 가드를 `if (!customer.id) return;`로, deps `[isKimMinjun, customer.id]` → `[customer.id]`로 변경.

- [ ] **Step 2: legacy JSX 블록 제거 + 렌더 무조건화**

- 컨테이너 className에서 `${isKimMinjun ? "kim-detail-mode" : ""}` → `"kim-detail-mode"`(항상 적용): `<div className={`customer-detail-console-page ${drawerMode ? "drawer" : ""} kim-detail-mode`}>`.
- `{isKimMinjun ? null : (<>...legacy...</>)}` 블록(약 5367~5414 전체) **삭제**.
- `{isKimMinjun ? ( ... ) : null}` 삼항(약 5416~)을 무조건 렌더로: `detailError ? <에러> : detail ? <KimMinjunDetailContent .../> : <로딩>` 형태로 `isKimMinjun ?`와 `: null` 제거.

- [ ] **Step 3: legacy 전용 import 정리**

legacy JSX에서만 쓰던 아이콘 import(예: `Phone`, `UserRound`, `CalendarClock`, `ArrowLeft`, `X`, `Maximize2`, `RefreshCcw`, `MessageSquareText`, `Send`, `FileText` 등)가 **다른 곳에서도 쓰이는지 `grep`로 확인**하고, legacy에서만 쓰던 것만 제거. (대부분 KimMinjunDetailContent에서도 쓰이므로 `bun run lint`의 unused 경고로 최종 확인 — 경고 0 유지.)

- [ ] **Step 4: 검증**

Run: `bun run typecheck && bun run lint`
Expected: typecheck 0(참조 정합 — `isKimMinjun` 잔존 참조 없음), lint 0 problems.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 고객 상세 isKimMinjun 게이트 제거 + legacy 레이아웃 제거"
```

---

## Task 2: 하드코딩 텍스트 9곳 → customer prop

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

`KimMinjunDetailContent`는 `customer: Customer` prop을 받는다(`customer.name`, `customer.customerId` 사용 가능). 아래 9곳을 교체.

- [ ] **Step 1: 발송 토스트 + 모달 + 헤더 + 파일명**

- `2552`: `onToast(`김민준 고객 앱 견적함으로 발송했습니다. 대상: CU-2605-0020`);` → ``onToast(`${customer.name} 고객 앱 견적함으로 발송했습니다. 대상: ${customer.customerId}`);``
- `2762`: `anchor.download = "김민준-서류.pdf";` → ``anchor.download = `${customer.name}-서류.pdf`;``
- `4439`: `<p>김민준(CU-2605-0020) 고객에게 견적을 보내고 푸시알림을 발송합니다.</p>` → ``<p>{customer.name}({customer.customerId}) 고객에게 견적을 보내고 푸시알림을 발송합니다.</p>``
- `4714-4715`: `<span>김민준</span>` / `<em className="num">CU-2605-0020</em>` → `<span>{customer.name}</span>` / `<em className="num">{customer.customerId}</em>`

- [ ] **Step 2: aria-label 4곳**

- `3691`: `aria-label="김민준 업무 상태"` → ``aria-label={`${customer.name} 업무 상태`}``
- `3740`: `aria-label="김민준 실무 영역"` → ``aria-label={`${customer.name} 실무 영역`}``
- `3741`: `aria-label="김민준 구매조건과 고객 메모"` → ``aria-label={`${customer.name} 구매조건과 고객 메모`}``
- `3938`: `aria-label="김민준 고객 운영 기능"` → ``aria-label={`${customer.name} 고객 운영 기능`}``

- [ ] **Step 3: 누락 확인**

Run: `grep -n "김민준\|CU-2605-0020" client/src/pages/CustomerDetailPage.tsx`
Expected: **출력 없음**(전부 교체됨).

- [ ] **Step 4: 검증 + Commit**

Run: `bun run typecheck && bun run lint`
Expected: 0/0.

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 고객 상세 김민준 하드코딩 텍스트 9곳 customer prop화"
```

---

## Task 3: mock 빈값/0 정리 (구매조건 + Maybach 가격)

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

데이터 소스가 없는 mock 고정값을 빈값/0으로. 구매방식·출고시기는 `detail`로 채우는 기존 로직(약 767~772) 유지.

- [ ] **Step 1: `kimMinjunPurchaseFields` 비데이터 필드 빈값화**

`282~292` 상수의 데이터 소스 없는 필드 value를 빈 문자열로 교체(구매방식·출고 희망 시기는 어차피 `detail.needMethod`/`detail.needTiming`로 덮어쓰므로 value는 fallback일 뿐 — 빈값으로):

```typescript
const kimMinjunPurchaseFields = [
  { label: "구매방식", value: "" },
  { label: "계약기간", value: "" },
  { label: "초기비용", value: "" },
  { label: "연간 주행거리", value: "" },
  { label: "인도 방식", value: "" },
  { label: "출고 희망 시기", value: "" },
  { label: "계약 포커스", value: "" },
  { label: "고객 특이사항", value: "" },
  { label: "심사 특이사항", value: "" },
];
```

그 후 `purchaseFields` 렌더 부분(이 chip들이 그려지는 JSX)을 `grep "purchaseFields"`로 찾아, **value가 빈 문자열인 chip은 "미정"으로 표시하거나 숨김** 처리(빈 chip이 어색하지 않게). 현재 렌더가 빈 value를 어떻게 그리는지 확인 후, 빈값이면 `field.value || "미정"` 또는 빈 chip 비표시 중 화면 톤에 맞게 적용. (김민준도 동일하게 "미정"/숨김 — 이 값들은 원래 mock이라 실데이터 아님.)

- [ ] **Step 2: Maybach pricing mock → 0**

`214~222` `kimMaybachQuotePricingMock`의 값을 0으로:

```typescript
const kimMaybachQuotePricingMock: PricingInputs = {
  basePrice: 0,
  optionPrice: 0,
  discount: 0,
  acquisitionTax: 0,
  bond: 0,
  delivery: 0,
  incidental: 0,
};
```

> `223` `kimMaybachQuotePricingResult = computePricing(...)`은 그대로(이제 0 기반 결과). `863-864` 초기 state·`4907`/`4928`/`4929` defaultValue는 이 상수를 참조하므로 자동으로 0/빈값이 된다. 워크벤치에서 차량 선택 시 `applyTrimToPricing`이 catalog 값으로 채우는 흐름은 불변(신규 워크벤치는 차량 선택부터). 상수명(`kimMaybach*`)은 후속 리네임 대상이라 유지.

- [ ] **Step 3: 검증 + Commit**

Run: `bun run typecheck && bun run lint`
Expected: 0/0. (구매조건 chip이 "미정"/숨김으로 뜨고 Maybach 243백만이 사라지는지는 Task 6 수동 검증.)

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 고객 상세 데이터 없는 mock(구매조건·Maybach 가격) 빈값/0화"
```

---

## Task 4: 빈 섹션 안내 (할일·메모·일정·견적)

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`, `client/src/index.css`

서류 섹션은 이미 빈상태 처리됨(`5153` `documents.length === 0 ? <div className="kim-doc-empty">...`). 같은 패턴을 나머지 4개 list 섹션에 적용. 각 섹션의 `.map`을 `length === 0 && !adding... ? <빈안내> : <map>`으로 감싼다(추가 폼이 열려 있으면 안내 숨김).

- [ ] **Step 1: 공용 빈 안내 CSS 추가**

`client/src/index.css`의 기존 `.kim-doc-empty` 규칙 근처에 공용 클래스 추가(톤 일치):

```css
.kim-list-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--muted, #8a8f98);
  text-align: center;
}
```

- [ ] **Step 2: 메모 빈 안내** (`3842` `sortedCustomerMemos.map`)

`<div ...>{sortedCustomerMemos.map(...)}</div>` 구조에서 map을 가드로 감싼다:

```jsx
{sortedCustomerMemos.length === 0 && !addingCustomerMemo ? (
  <div className="kim-list-empty">등록된 메모가 없습니다.</div>
) : sortedCustomerMemos.map((item, index) => {
  /* 기존 본문 그대로 */
```
(닫는 `})}` 위치 유지 — map 콜백 본문은 변경 없음.)

- [ ] **Step 3: 할일 빈 안내** (`3962` `sortedCheckItems.map`)

```jsx
{sortedCheckItems.length === 0 && !addingCheckItem ? (
  <div className="kim-list-empty">등록된 할 일이 없습니다.</div>
) : sortedCheckItems.map((item, index) => {
  /* 기존 본문 그대로 */
```

- [ ] **Step 4: 일정 빈 안내** (`4102` `sortedSchedules.map`)

```jsx
{sortedSchedules.length === 0 && !addingScheduleItem ? (
  <div className="kim-list-empty">예정된 일정이 없습니다.</div>
) : sortedSchedules.map((schedule, index) => {
  /* 기존 본문 그대로 */
```

- [ ] **Step 5: 견적 빈 안내** (`4220` `quotes.map`)

견적은 `adding` 상태가 없으니 length만 가드:

```jsx
{quotes.length === 0 ? (
  <div className="kim-list-empty">작성된 견적이 없습니다.</div>
) : quotes.map((quote) => {
  /* 기존 본문 그대로 */
```

> 각 섹션은 `.map` 콜백이 길다(수십~수백 줄). **닫는 괄호 짝**에 주의 — `{list.map((x) => { ... })}` 를 `{cond ? (<div/>) : list.map((x) => { ... })}` 로 바꿀 때 여는 `{` 와 닫는 `}` 정합을 typecheck로 확인. region을 읽고 정확히 감싸라.

- [ ] **Step 6: 검증 + Commit**

Run: `bun run typecheck && bun run lint`
Expected: 0/0(JSX 괄호 정합).

```bash
git add client/src/pages/CustomerDetailPage.tsx client/src/index.css
git commit -m "feat(crm): 고객 상세 빈 섹션 안내(할일·메모·일정·견적)"
```

---

## Task 5: legacy 전용 CSS 제거

**Files:** Modify `client/src/index.css`

Task 1에서 legacy JSX를 지웠으므로 그 전용 클래스가 죽은 코드가 됐다. 각 클래스가 **다른 곳에서 안 쓰이는지 확인 후** 제거.

- [ ] **Step 1: 사용처 확인**

각 후보 클래스를 `client/src/` 전체에서 grep:

```bash
for c in customer-detail-summary customer-detail-identity customer-detail-avatar customer-detail-name-row customer-detail-contact-row customer-detail-status-strip detail-stage-pill detail-chance-pill detail-manage-pill customer-detail-action-rail customer-detail-panel-controls customer-detail-action-group detail-back-button; do
  echo "== $c =="; grep -rn "$c" client/src/ | grep -v index.css
done
```

- [ ] **Step 2: 미사용 클래스만 제거**

위 grep에서 `index.css` 외 사용처가 **없는** 클래스의 규칙만 `index.css`에서 삭제. (예: `detail-back-button`이 다른 화면에서도 쓰이면 보존.) 공유 클래스는 남긴다.

- [ ] **Step 3: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: 0/0/OK.

```bash
git add client/src/index.css
git commit -m "feat(crm): 미사용 legacy 상세 CSS 제거"
```

---

## Task 6: 전체 검증 + brief/메모리 갱신

**Files:** Modify `ref/active-session-brief.md`, 메모리(별도)

- [ ] **Step 1: 전체 검증**

Run:
```bash
bun run typecheck && bun run lint && bun run test:unit && bun run build
```
Expected: typecheck 0, lint 0, test:unit 전부 PASS(회귀 없음 — 기존 단위테스트 그대로), build OK.

- [ ] **Step 2: 브라우저 수동 검증 안내 (사용자=유슨생)**

코드로는 검증 불가(인증 세션 필요). 사용자에게 3종 고객 확인 요청을 보고에 포함:
- 김지안(CU-2606-0001, 빈): 새 레이아웃·크래시 없음·빈 안내·오표시(김민준/Maybach) 없음.
- 김민준(CU-2605-0020, 풀): **회귀 없음**(니즈·메모·할일·일정·서류·견적 기존대로).
- 중간 데이터 고객: 채운 섹션 정상 + 빈 안내 혼재.

- [ ] **Step 3: brief 갱신 + Commit**

`ref/active-session-brief.md` 최상단에 일반화 섹션 추가(60줄 이하): 게이트 제거·하드코딩·mock 빈값·빈안내·legacy 제거·검증 수치·⚠️전체 고객 영향+브라우저 검증 게이트·후속(리네임/분해/구매조건 데이터화).

```bash
git add ref/active-session-brief.md
git commit -m "docs(crm): brief에 고객 상세 일반화 반영"
```

- [ ] **Step 4: 메모리 갱신**

리팩토링 로드맵 메모리(`crm-refactoring-roadmap.md`)의 "본체 일반화" 항목을 "게이트 제거+안전화 완료, 다음=kim 리네임→영역 분해→구매조건 데이터화"로 갱신.

---

## Self-Review (작성자 체크)

**Spec coverage:**
- 게이트 제거 + 모든 고객 detail fetch + 렌더 → Task 1 ✓
- 하드코딩 9곳 → Task 2 ✓
- mock 빈값(구매조건 + Maybach) → Task 3 ✓
- 빈 섹션 안내(섹션 유지 + 안내 + 추가버튼) → Task 4 ✓ (서류는 기존, 4곳 추가)
- legacy 제거(JSX Task 1 + CSS Task 5) ✓
- kim 리네임 범위 밖 → 미포함 ✓
- 브라우저 검증 게이트 → Task 6 ✓

**Placeholder scan:** Task 3 Step 1의 "미정/숨김 화면 톤에 맞게"와 Task 1 Step 3 import 정리는 구현자가 region 확인 후 적용하는 부분 — 거대 컴포넌트 특성상 패턴+위치+검증(typecheck/lint)으로 가드. 그 외 placeholder 없음.

**Type consistency:** `customer.name`/`customer.customerId`(Customer 타입), `addingCustomerMemo`/`addingCheckItem`/`addingScheduleItem`(기존 state), `sortedCustomerMemos`/`sortedCheckItems`/`sortedSchedules`/`quotes`(기존 파생/state) — 모두 기존 식별자 재사용. `.kim-list-empty`(Task4 신규, 4곳 공용).

**리스크:** 거대 컴포넌트 JSX 괄호 정합(Task 4) + 전체 고객 영향(Task 6 수동 검증 게이트). 김민준 회귀 = mock 빈값화로 "60개월"/Maybach가 "미정"/0이 되지만 spec 합의(원래 mock).
