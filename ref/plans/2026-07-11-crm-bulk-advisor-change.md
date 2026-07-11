# 일괄 담당자 변경 구현 계획 (2026-07-11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 목록 헤드바 `[🔄 담당자 변경]` 목업 버튼을 실동작으로 — 선택 고객 N명의 담당자를 팝오버 select 한 번으로 변경.

**Architecture:** 서버 변경 0. 선택 고객마다 기존 `PATCH /api/customers/:id`를 순차 호출(`customer-bulk-delete.ts` 미러 — 건별 독립·실패 목록 수집). 배정 규칙(실변경 시만 assignedAt 스탬프·advisorId 동봉·self 알림 skip·동일 담당자 no-op)은 서버 PATCH 기존재분이 건별로 그대로 성립. 완료 후 App `reloadCustomers`로 서버 리로드.

**Tech Stack:** React + vitest(클라 유닛만 — 서버 테스트 신규 없음).

**Spec:** `ref/specs/2026-07-11-crm-bulk-advisor-change-design.md` (충돌 시 spec 우선)

**브랜치:** `feat/crm-bulk-advisor-change` (생성됨, spec 커밋 `6527fc7`)

**⚠️ 공통 함정:**
- 커밋 메시지에 `[skip ci]` 계열 토큰 절대 금지.
- controlled `<select>`는 반드시 `bindSelect`(Safari onChange 유실 — CLAUDE.md 규칙).
- 실 master DB — 이 슬라이스의 클라 유닛은 fetch를 주입 fake로 대체하므로 DB 접점 0.

---

## 파일 구조

| 파일 | 역할 | 작업 |
|---|---|---|
| `client/src/lib/customer-bulk-advisor.ts` | 일괄 배정 오케스트레이션(순수·주입형) | Task 1 |
| `client/src/lib/customer-bulk-advisor.test.ts` | 유닛(TDD) | Task 1 |
| `client/src/lib/customer-bulk-delete.ts` | `formatDeleteTargetNames` → `formatBulkTargetNames` 리네임(공용화) | Task 1 |
| `client/src/lib/customer-bulk-delete.test.ts` | 리네임 반영 | Task 1 |
| `client/src/pages/CustomerManagementPage.tsx` | 팝오버 + 상태 + `onCustomerListChanged` prop | Task 2 |
| `client/src/styles/customer-console.css` | `.advisor-change-*` 스타일(bulk-delete 미러) | Task 2 |
| `client/src/App.tsx` | `onCustomerListChanged={reloadCustomers}` 배선 | Task 3 |

---

### Task 1: 오케스트레이션 lib + 대상 이름 포매터 공용화

**Files:**
- Create: `client/src/lib/customer-bulk-advisor.ts`
- Create: `client/src/lib/customer-bulk-advisor.test.ts`
- Modify: `client/src/lib/customer-bulk-delete.ts` (리네임)
- Modify: `client/src/lib/customer-bulk-delete.test.ts` (리네임 반영)
- Modify: `client/src/pages/CustomerManagementPage.tsx` (import·사용처 리네임만 — 팝오버는 Task 2)

- [ ] **Step 1: 실패하는 테스트 작성** — `client/src/lib/customer-bulk-advisor.test.ts` 생성:

```ts
import { describe, expect, it } from "vitest";

import { changeAdvisorBulk } from "./customer-bulk-advisor";
import type { CustomerWritePatch } from "./customers";

const ADVISOR = { id: "3f6a7f7e-90d1-4f7a-b6a1-000000000001", name: "강현준" };

describe("changeAdvisorBulk", () => {
  it("전건 성공 — 건별로 advisorName+advisorId 정확히 두 필드만 보낸다(team 미포함 잠금)", async () => {
    const calls: { id: string; patch: CustomerWritePatch }[] = [];
    const result = await changeAdvisorBulk(
      [{ id: "a", name: "김민준" }, { id: "b", name: "박서연" }],
      ADVISOR,
      async (id, patch) => { calls.push({ id, patch }); },
    );
    expect(result).toEqual({ changedIds: ["a", "b"], failed: [] });
    expect(calls).toEqual([
      { id: "a", patch: { advisorName: "강현준", advisorId: ADVISOR.id } },
      { id: "b", patch: { advisorName: "강현준", advisorId: ADVISOR.id } },
    ]);
  });

  it("일부 실패 — 서버 한글 사유를 수집하고 나머지 건은 계속 진행한다", async () => {
    const result = await changeAdvisorBulk(
      [{ id: "a", name: "김민준" }, { id: "b", name: "박서연" }, { id: "c", name: "최유진" }],
      ADVISOR,
      async (id) => {
        if (id === "b") throw new Error("고객을 찾을 수 없습니다.");
      },
    );
    expect(result.changedIds).toEqual(["a", "c"]);
    expect(result.failed).toEqual([{ name: "박서연", reason: "고객을 찾을 수 없습니다." }]);
  });

  it("id 없는 목업/미저장 행은 호출 없이 실패 목록으로", async () => {
    let called = 0;
    const result = await changeAdvisorBulk(
      [{ name: "목업행" }],
      ADVISOR,
      async () => { called += 1; },
    );
    expect(called).toBe(0);
    expect(result.changedIds).toEqual([]);
    expect(result.failed).toEqual([{ name: "목업행", reason: "저장되지 않은 행이라 변경할 수 없습니다." }]);
  });

  it("Error가 아닌 throw는 기본 문구로", async () => {
    const result = await changeAdvisorBulk(
      [{ id: "a", name: "김민준" }],
      ADVISOR,
      async () => { throw "boom"; },
    );
    expect(result.failed).toEqual([{ name: "김민준", reason: "변경에 실패했습니다." }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/customer-bulk-advisor.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `client/src/lib/customer-bulk-advisor.ts` 생성:

```ts
import { updateCustomer, type CustomerWritePatch } from "./customers";

export type BulkAdvisorTarget = { id?: string; name: string };
export type BulkAdvisorResult = {
  changedIds: string[];
  failed: { name: string; reason: string }[];
};

// 일괄 담당자 변경 오케스트레이션 — customer-bulk-delete.ts 미러(건별 독립·순차).
// 서버 변경 0: 배정 규칙(실변경 시만 assignedAt 스탬프·advisorId 동봉·self 알림 skip·
// 동일 담당자 재배정 no-op)은 개별 PATCH가 이미 처리한다(spec 확정 결정 1).
// 알림은 고객당 1건 = 개별 배정 N번과 동일 의미론(spec 확정 결정 2 — 묶음 알림은 follow-up).
export async function changeAdvisorBulk(
  targets: readonly BulkAdvisorTarget[],
  advisor: { id: string; name: string },
  updateOne: (id: string, patch: CustomerWritePatch) => Promise<void> = updateCustomer,
): Promise<BulkAdvisorResult> {
  const changedIds: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const target of targets) {
    if (!target.id) {
      failed.push({ name: target.name, reason: "저장되지 않은 행이라 변경할 수 없습니다." });
      continue;
    }
    try {
      // advisorId 동봉 필수 — 이름만 보내면 서버 방어선이 id를 비워 역할 scope가 깨진다(#176).
      await updateOne(target.id, { advisorName: advisor.name, advisorId: advisor.id });
      changedIds.push(target.id);
    } catch (e) {
      failed.push({ name: target.name, reason: e instanceof Error ? e.message : "변경에 실패했습니다." });
    }
  }
  return { changedIds, failed };
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/lib/customer-bulk-advisor.test.ts`
Expected: PASS 4건.

- [ ] **Step 5: 포매터 리네임(공용화)** — 3파일 기계 치환:

`client/src/lib/customer-bulk-delete.ts`의 함수 주석·이름 교체:

```ts
// 확인창에 "누구를" 조작하는지 보여준다 — 일괄 삭제·일괄 배정 공용. 선택(selected)은
// 페이지·필터를 넘어 유지되므로 "고객 5명"만 뜨면 화면에 안 보이는 대상이 섞여 있어도 알 수 없다.
export function formatBulkTargetNames(names: readonly string[]): string {
```

(함수 본문 무변경. 기존 주석의 "되돌릴 수 없는 조작에서…" 문장은 삭제 확인창 전용 서술이라 위 공용 서술로 교체.)

`client/src/lib/customer-bulk-delete.test.ts`: import·describe·호출 6곳 `formatDeleteTargetNames` → `formatBulkTargetNames`.

`client/src/pages/CustomerManagementPage.tsx`: import(11행)·사용처(929행) 동일 치환.

- [ ] **Step 6: 검증 + 커밋**

Run: `bun run test:unit client/src/lib/customer-bulk-delete.test.ts client/src/lib/customer-bulk-advisor.test.ts && bun run typecheck && bun run lint`
Expected: 전부 green.

```bash
git add client/src/lib/customer-bulk-advisor.ts client/src/lib/customer-bulk-advisor.test.ts client/src/lib/customer-bulk-delete.ts client/src/lib/customer-bulk-delete.test.ts client/src/pages/CustomerManagementPage.tsx
git commit -m "feat(crm): 일괄 담당자 변경 오케스트레이션 lib + 대상 이름 포매터 공용화"
```

---

### Task 2: 팝오버 폼 — `[🔄 담당자 변경]` 버튼 실동작

**Files:**
- Modify: `client/src/pages/CustomerManagementPage.tsx`
- Modify: `client/src/styles/customer-console.css`

- [ ] **Step 1: 상태·핸들러·prop 추가**

① import에 `changeAdvisorBulk` 추가(Task 1의 리네임 import 근처):

```ts
import { changeAdvisorBulk } from "@/lib/customer-bulk-advisor";
```

② props 타입(`CustomerManagementPageProps`)에 추가 — `onCustomerCreated` 아래:

```ts
  // 일괄 담당자 변경 성공 후 App이 목록을 서버에서 리로드한다(assignedAt 등 서버 스탬프가 진실).
  onCustomerListChanged?: () => void;
```

구조분해에도 `onCustomerListChanged,` 추가(`onCustomerCreated,` 뒤).

③ `useStaffDirectory` 소비를 목록 재사용 형태로 교체 — 기존(91행):

```ts
  const staffNames = useStaffDirectory().staff.map((s) => s.name);
```

를 아래로:

```ts
  const { staff: staffDirectory } = useStaffDirectory();
  const staffNames = staffDirectory.map((s) => s.name);
```

④ 상태 — 등록 폼 상태 블록(`createError`) 뒤에 추가:

```ts
  // 일괄 담당자 변경 — 노출은 담당 컬럼 기준(관리자/팀장)과 정합. 서버는 개별 PATCH 그대로라
  // 추가 게이트 없음(개별 배정과 동일 권한 의미 — 숨김은 UX 보조).
  const [changingAdvisorOpen, setChangingAdvisorOpen] = useState(false);
  const [advisorPick, setAdvisorPick] = useState("");
  const [changingAdvisor, setChangingAdvisor] = useState(false);
  const [advisorNotice, setAdvisorNotice] = useState<string | null>(null);
```

⑤ 핸들러 — `submitCreateCustomer` 뒤에 추가:

```ts
  // select 미조작 시 첫 직원이 기본값 — 디렉토리 미로드면 빈 문자열(버튼 disabled가 막는다).
  const advisorPickId = advisorPick || (staffDirectory[0]?.id ?? "");

  async function submitAdvisorChange() {
    if (changingAdvisor) return;
    const picked = staffDirectory.find((s) => s.id === advisorPickId);
    if (!picked) return; // 디렉토리 미로드 — disabled가 막지만 이중 방어
    const targets = selectedCustomers.map((customer) => ({ id: customer.id, name: customer.name }));
    setChangingAdvisor(true);
    const { changedIds, failed } = await changeAdvisorBulk(targets, { id: picked.id, name: picked.name });
    setChangingAdvisor(false);
    setChangingAdvisorOpen(false);
    setAdvisorPick("");
    setAdvisorNotice(
      failed.length
        ? `${failed.length}명 변경 실패 — ${failed.map((f) => `${f.name}: ${f.reason}`).join(" / ")}`
        : null,
    );
    // 성공한 건이 있으면 서버 리로드(assignedAt 스탬프 반영) + 선택 해제.
    if (changedIds.length) {
      setSelected([]);
      onCustomerListChanged?.();
    }
  }
```

- [ ] **Step 2: 버튼 JSX 교체** — 기존(910-913행):

```tsx
              <button aria-label="선택 고객 배정 변경" className="btn advisor-change-btn" disabled={selected.length === 0} type="button">
                <RefreshCcw aria-hidden="true" size={12} strokeWidth={2.25} />
                <span>담당자 변경</span>
              </button>
```

을 아래로 교체(노출 게이트 + 팝오버):

```tsx
              {showAdvisorColumn ? (
                <div className="advisor-change-wrap">
                  <button
                    aria-label="선택 고객 배정 변경"
                    className="btn advisor-change-btn"
                    disabled={selected.length === 0 || changingAdvisor}
                    onClick={() => { setAdvisorNotice(null); setChangingAdvisorOpen((open) => !open); }}
                    type="button"
                  >
                    <RefreshCcw aria-hidden="true" size={12} strokeWidth={2.25} />
                    <span>{selected.length ? `${selected.length}명 담당자 변경` : "담당자 변경"}</span>
                  </button>
                  {changingAdvisorOpen && selected.length > 0 ? (
                    <div aria-label="담당자 일괄 변경" className="advisor-change-confirm" role="dialog">
                      <strong>고객 {selected.length}명 담당자 변경</strong>
                      <p className="advisor-change-targets">{formatBulkTargetNames(selectedCustomers.map((customer) => customer.name))}</p>
                      <label>
                        <span>담당자</span>
                        <select disabled={!staffDirectory.length} {...bindSelect(advisorPickId, setAdvisorPick)}>
                          {staffDirectory.length
                            ? staffDirectory.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                            : <option value="">직원 목록 불러오는 중…</option>}
                        </select>
                      </label>
                      <p>같은 담당자인 고객은 배정시각이 바뀌지 않고, 새 담당자에게는 고객당 1건씩 알림이 갑니다.</p>
                      <div>
                        <button disabled={changingAdvisor} onClick={() => setChangingAdvisorOpen(false)} type="button">취소</button>
                        <button className="primary-action" disabled={changingAdvisor || !staffDirectory.length} onClick={submitAdvisorChange} type="button">
                          {changingAdvisor ? "변경 중…" : "변경"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {advisorNotice ? (
                    <div className="advisor-change-notice" role="status">
                      <span>{advisorNotice}</span>
                      <button onClick={() => setAdvisorNotice(null)} type="button">닫기</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
```

(`showAdvisorColumn`·`bindSelect`·`selectedCustomers`는 기존재. 삭제 확인창의 targets 클래스도
`bulk-delete-targets` 그대로 유지 — 삭제는 경고 빨강, 배정은 중립색이라 클래스를 공유하지 않는다.)

- [ ] **Step 3: CSS 추가** — `client/src/styles/customer-console.css`의 `.customer-create-form .kim-phone-prefix` 블록 뒤에:

```css
/* 일괄 담당자 변경 팝오버 — 삭제 확인창(.bulk-delete-confirm)과 같은 문법.
   삭제와 달리 되돌릴 수 있는 조작이라 대상 이름은 경고색이 아니라 중립색이다. */
.customer-console-headbar .advisor-change-wrap {
  position: relative;
  display: inline-flex;
}

.customer-console-headbar .advisor-change-confirm,
.customer-console-headbar .advisor-change-notice {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 320px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 12px 28px rgba(16, 24, 40, 0.14);
  padding: 12px 13px;
  text-align: left;
}

.customer-console-headbar .advisor-change-confirm strong {
  display: block;
  font-size: 12.5px;
  font-weight: 650;
  color: #1f2933;
}

.customer-console-headbar .advisor-change-confirm p {
  margin: 5px 0 10px;
  font-size: 11.5px;
  line-height: 1.55;
  color: #5f6872;
}

.customer-console-headbar .advisor-change-confirm p.advisor-change-targets {
  margin: 4px 0 8px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.5;
  color: #3f474f;
  word-break: keep-all;
}

.customer-console-headbar .advisor-change-confirm label {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 11.5px;
  color: #5f6872;
}

.customer-console-headbar .advisor-change-confirm select {
  height: 28px;
  padding: 0 8px;
  border: 1px solid #dededb;
  border-radius: 6px;
  background: #fbfbfa;
  font-size: 12px;
  color: #1f2933;
}

.customer-console-headbar .advisor-change-confirm select:focus {
  outline: none;
  border-color: rgba(var(--brand-rgb), 0.34);
  box-shadow: 0 0 0 3px rgba(var(--brand-rgb), 0.12);
}

.customer-console-headbar .advisor-change-confirm > div {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.customer-console-headbar .advisor-change-confirm button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #dededb;
  border-radius: 6px;
  background: #fbfbfa;
  font-size: 11.5px;
  font-weight: 550;
  color: #4f5a64;
  cursor: pointer;
}

.customer-console-headbar .advisor-change-confirm button.primary-action {
  border-color: var(--brand);
  background: var(--brand);
  color: #fff;
}

.customer-console-headbar .advisor-change-confirm button:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 실패 안내 — 건별 사유를 그대로 보여준다. 자동으로 사라지지 않는다(삭제 notice와 동일). */
.customer-console-headbar .advisor-change-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.55;
  color: #b42318;
}

.customer-console-headbar .advisor-change-notice button {
  flex: none;
  border: 0;
  background: none;
  font-size: 11.5px;
  color: #7f858c;
  cursor: pointer;
}
```

- [ ] **Step 4: 검증 + 커밋**

Run: `bun run typecheck && bun run lint && bun run test:unit client/src/pages/CustomerManagementPage.test.tsx && bun run build`
Expected: 전부 green (기존 페이지 테스트는 담당자 변경 버튼을 직접 단언하지 않음 — 실패 시 원인 확인 후 버튼 존재만 보던 단언이면 갱신).

```bash
git add client/src/pages/CustomerManagementPage.tsx client/src/styles/customer-console.css
git commit -m "feat(crm): 일괄 담당자 변경 팝오버 — 대상 미리보기 + 직원 select + 실패 목록 (헤드바 마지막 목업 해소)"
```

---

### Task 3: App 배선

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: prop 전달** — `/customers` Route의 `<CustomerManagementPage>`에 추가(`onCustomerCreated={handleCustomerCreated}` 근처, props 순서 관례 유지):

```tsx
              onCustomerListChanged={reloadCustomers}
```

(`reloadCustomers`는 `Promise<boolean>` 반환이지만 prop 타입 `() => void`에 적법 할당 — AppRequestsPage 선례와 동일.)

- [ ] **Step 2: 검증 + 커밋**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run build`
Expected: 전부 green.

```bash
git add client/src/App.tsx
git commit -m "feat(crm): 일괄 담당자 변경 후 목록 서버 리로드 배선"
```

---

### Task 4: 통합 검증 + 브라우저 스모크 (메인 세션 수행 — subagent 위임 금지)

- [ ] **Step 1: 전체 검증**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build && bun run check:residue
```

Expected: typecheck 0 · lint 0 · unit 전부 PASS(505+신규 4) · server 467 · build · 잔재 0.

- [ ] **Step 2: 브라우저 스모크** — 격리 스택(API 8799 `PUSH_NOTIFY=off EMBED_ON_WRITE=off` + vite 5174 임시 config) + magiclink admin:

1. **스모크 전 원값 기록**: `select id, customer_code, name, advisor_id, advisor_name, assigned_at from crm.customers order by received_at desc limit 3;` — 대상 2명 원값 저장.
2. 고객 2명 선택 → `2명 담당자 변경` 버튼 → 팝오버(대상 이름 미리보기 확인) → 담당자 선택 → 변경.
3. 목록 담당 셀이 새 담당자로 갱신됐는지(서버 리로드) + 선택 해제 확인.
4. psql 대조: 두 고객의 `advisor_id`/`advisor_name`/`assigned_at` 갱신 확인.
5. **원복**: UI 재배정이 아니라 psql로 세 컬럼 원값 복원(재배정도 "실변경"이라 assigned_at이 새로 찍히기 때문 — #202 선례):
   `update crm.customers set advisor_id=<원값>, advisor_name=<원값>, assigned_at=<원값> where id=<대상>;`
6. `bun run check:residue` → 잔재 0. 임시 config 삭제·스택 종료.

- [ ] **Step 3: 브리프 갱신 + PR**

- `ref/active-session-brief.md`: 헤드바 목업 전량 해소 기록(다음 착수 항목 갱신).
- push 후 PR 생성(본문: spec/plan 링크·검증·스모크 기록·follow-up = 묶음 알림). squash 머지는 사용자 지시 후.

---

## Self-Review 결과

- **Spec 커버리지**: 확정 결정 1(A안·건별 독립)=Task 1 / 결정 2(알림 N개·팝오버 안내 문구)=Task 1 주석+Task 2 문구 / 결정 3(관리자·팀장 노출)=Task 2 `showAdvisorColumn` 게이트 / 결정 4(서버 리로드+선택 해제)=Task 2 핸들러+Task 3 배선 / 포매터 공용화=Task 1 Step 5 / 스모크 원복 규칙=Task 4. 전 항목 매핑 완료.
- **타입 일관성**: `changeAdvisorBulk(targets, advisor, updateOne)` 시그니처가 테스트·페이지 호출부와 일치. `BulkAdvisorTarget.id?`가 `Customer.id?: string`과 호환.
- **플레이스홀더**: 없음.
