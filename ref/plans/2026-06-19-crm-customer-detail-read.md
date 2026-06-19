# 고객 상세 읽기 연결 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 김민준(`CU-2605-0020`) 고객 상세 화면(`KimMinjunDetailContent`)의 in-scope 섹션(헤더·상태·니즈·구매조건 일부·고객메모·할일·일정·서류)을 하드코딩 const에서 `GET /api/customers/:id` 실데이터로 전환한다.

**Architecture:** 백엔드(`getCustomer`/라우트)는 #46에서 완성 — 변경 없음. 프론트 lib에 타입드 `fetchCustomerDetail`+순수 `toCustomerDetail` 어댑터 추가, `CustomerDetailPage`(외곽)가 `customer.id`로 상세를 자체 fetch해 `KimMinjunDetailContent`에 `detail` prop으로 주입, 컴포넌트의 `useState` 초기값을 const→`detail` 파생으로 교체. 읽기 데모가 의미 있도록 김민준 풀세트(메모3·할일4·일정1·서류2·니즈상세)를 시드로 멱등 삽입.

**Tech Stack:** React 19 + TypeScript 6.0.3, Hono(백엔드, 무변경), Drizzle(시드), vitest(단위테스트), bun.

연계 스펙: `ref/specs/2026-06-19-crm-customer-detail-read-design.md`

---

## File Structure

- `client/src/data/customers.ts` — `Customer` 타입에 `id?: string` 추가(상세 fetch 키).
- `client/src/lib/customers.ts` — 상세 응답/데이터 타입 + 순수 `toCustomerDetail` + `fetchCustomerDetail`. `toCustomer`가 `id` 전달. 미사용 `fetchCustomer` 제거.
- `client/src/lib/customers.test.ts` — `toCustomerDetail`·`formatActivity`·`toCustomer.id` 테스트 추가(기존 파일 확장).
- `scripts/seed-customers.ts` — 김민준 풀세트 전용 블록(컬럼 update + 자식 delete→insert).
- `client/src/pages/CustomerDetailPage.tsx` — 외곽 컴포넌트 상세 fetch+렌더 게이팅, `KimMinjunDetailContent` `detail` prop + 초기값 파생, `KimMinjunDetailHeader` 텍스트 prop화, const 6개 제거.
- `client/src/index.css` — `.kim-detail-loading` 로딩 placeholder 스타일.

---

## Task 1: lib 어댑터 + 타입 + 단위테스트 (TDD)

**Files:**
- Modify: `client/src/data/customers.ts:5-30`(Customer 타입)
- Modify: `client/src/lib/customers.ts`(toCustomer + 상세 타입/어댑터)
- Test: `client/src/lib/customers.test.ts`(확장)

- [ ] **Step 1: 실패하는 테스트 작성**

`client/src/lib/customers.test.ts`를 아래로 **전체 교체**한다(기존 toCustomer 테스트 보존 + 신규 추가):

```ts
import { describe, expect, it } from "vitest";

import { formatActivity, toCustomer, toCustomerDetail, type CustomerDetailResponse, type CustomerRow } from "./customers";

const row: CustomerRow = {
  id: "11111111-1111-1111-1111-111111111111",
  customerCode: "CU-2605-0020",
  name: "김민준",
  phone: "010-9588-0812",
  customerType: "개인",
  customerTypeDetail: "4대보험",
  team: "인천본사",
  source: "디엘(견적서)",
  statusGroup: "견적",
  status: "발송완료",
  priority: "긴급",
  aiSummary: "요약",
  needModel: "Maybach S-Class",
  needMethod: "운용리스",
  receivedAt: "2026-05-14T12:56:00+09:00",
  assignedAt: "2026-05-14T13:04:00+09:00",
  lastActivityAt: "2026-05-14T14:20:00+09:00",
  latestTask: "GLC 재고 확인",
};

describe("toCustomer", () => {
  it("customerCode를 customerId로, 숫자부분을 no로 파생", () => {
    const c = toCustomer(row);
    expect(c.customerId).toBe("CU-2605-0020");
    expect(c.no).toBe(26050020);
  });
  it("needModel/needMethod를 vehicle/method로, latestTask를 nextAction으로", () => {
    const c = toCustomer(row);
    expect(c.vehicle).toBe("Maybach S-Class");
    expect(c.method).toBe("운용리스");
    expect(c.nextAction).toBe("GLC 재고 확인");
  });
  it("advisor는 미배정 폴백, null 필드는 빈 문자열", () => {
    const c = toCustomer({ ...row, latestTask: null, phone: null });
    expect(c.advisor).toBe("미배정");
    expect(c.nextAction).toBe("");
    expect(c.phone).toBe("");
  });
  it("id(uuid)를 그대로 전달", () => {
    expect(toCustomer(row).id).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("formatActivity", () => {
  it("null/빈값은 빈 문자열", () => {
    expect(formatActivity(null)).toBe("");
    expect(formatActivity("")).toBe("");
  });
  it("잘못된 값은 빈 문자열", () => {
    expect(formatActivity("nope")).toBe("");
  });
  it("타임스탬프를 YY/MM/DD HH:mm 형태로 (TZ 무관)", () => {
    expect(formatActivity("2026-05-14T13:18:00+09:00")).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  });
});

const detailRes: CustomerDetailResponse = {
  id: "uuid-1",
  customerCode: "CU-2605-0020",
  name: "김민준",
  phone: "010-9588-0812",
  residence: "인천광역시",
  customerType: "개인",
  customerTypeDetail: "4대보험",
  source: "디엘(견적서)",
  assignedAt: null,
  receivedAt: "2026-05-14T12:56:00+09:00",
  needModel: "Maybach S-Class",
  needTrim: "S 500 4M Long",
  needColors: "외장 컬러 미정 · 내장 컬러 미정",
  needMethod: "운용리스",
  needTiming: "좋은 조건 즉시",
  needMemo: "비교 정리 필요",
  tasks: [{ id: "t1", category: "체크", due: "오늘", body: "GLC 재고", done: false }],
  schedules: [{ id: "s1", scheduledDate: "2026-05-26", scheduledTime: "16:00", type: "견적", memo: "재발송" }],
  memos: [{ id: "m1", body: "메모1", createdAt: "2026-05-14T13:18:00+09:00" }],
  documents: [{ id: "d1", title: "주민등록등본", docType: "자동인식", fileName: "f.pdf", fileSize: 100, fileMime: "application/pdf" }],
};

describe("toCustomerDetail", () => {
  it("고객 본체 필드와 니즈 상세를 전달", () => {
    const d = toCustomerDetail(detailRes);
    expect(d.name).toBe("김민준");
    expect(d.needTrim).toBe("S 500 4M Long");
    expect(d.needTiming).toBe("좋은 조건 즉시");
    expect(d.residence).toBe("인천광역시");
  });
  it("자식 배열(tasks/schedules/memos/documents)을 전달", () => {
    const d = toCustomerDetail(detailRes);
    expect(d.tasks).toHaveLength(1);
    expect(d.schedules[0].scheduledDate).toBe("2026-05-26");
    expect(d.memos[0].body).toBe("메모1");
    expect(d.documents[0].docType).toBe("자동인식");
  });
  it("자식 배열 누락 시 빈 배열로 방어", () => {
    const partial = { ...detailRes, tasks: undefined } as unknown as CustomerDetailResponse;
    expect(toCustomerDetail(partial).tasks).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: FAIL — `toCustomerDetail`/`CustomerDetailResponse`가 export되지 않아 import 에러, `c.id`/`id` 단언 실패.

- [ ] **Step 3: Customer 타입에 id 추가**

`client/src/data/customers.ts`의 `Customer` 타입(라인 5)에서 `no: number;` 바로 아래에 `id?: string;`를 추가한다:

```ts
export type Customer = {
  id?: string;
  no: number;
  customerId: string;
```

- [ ] **Step 4: lib에 어댑터/타입 구현**

`client/src/lib/customers.ts`에서:

(4a) `toCustomer` 반환 객체 맨 앞에 `id` 추가 — 기존 `return {` 바로 다음 줄에 한 줄 삽입:

```ts
export function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    no: Number(row.customerCode.replace(/\D/g, "")),
```

(4b) 파일 끝의 기존 `fetchCustomer` 함수(아래)를 **삭제**한다:

```ts
export async function fetchCustomer(id: string): Promise<CustomerRow & Record<string, unknown>> {
  const res = await apiFetch(`/api/customers/${id}`);
  if (!res.ok) throw new Error(`고객 상세 실패: ${res.status}`);
  return (await res.json()) as CustomerRow & Record<string, unknown>;
}
```

(4c) 같은 자리(파일 끝)에 상세 타입 + 어댑터를 추가한다:

```ts
// ── 고객 상세(GET /api/customers/:id = getCustomer) ─────────────────────────────
// 백엔드는 drizzle camelCase 그대로 반환(자식 배열 포함). consultations는 이번 범위 외라 생략.
export type CustomerDetailTask = { id: string; category: string | null; due: string | null; body: string | null; done: boolean };
export type CustomerDetailSchedule = { id: string; scheduledDate: string | null; scheduledTime: string | null; type: string | null; memo: string | null };
export type CustomerDetailMemo = { id: string; body: string | null; createdAt: string | null };
export type CustomerDetailDocument = { id: string; title: string | null; docType: string | null; fileName: string | null; fileSize: number | null; fileMime: string | null };

export type CustomerDetailResponse = {
  id: string;
  customerCode: string;
  name: string;
  phone: string | null;
  residence: string | null;
  customerType: string | null;
  customerTypeDetail: string | null;
  source: string | null;
  assignedAt: string | null;
  receivedAt: string | null;
  needModel: string | null;
  needTrim: string | null;
  needColors: string | null;
  needMethod: string | null;
  needTiming: string | null;
  needMemo: string | null;
  tasks: CustomerDetailTask[];
  schedules: CustomerDetailSchedule[];
  memos: CustomerDetailMemo[];
  documents: CustomerDetailDocument[];
};

export type CustomerDetailData = Pick<
  CustomerDetailResponse,
  | "id"
  | "customerCode"
  | "name"
  | "phone"
  | "residence"
  | "customerType"
  | "customerTypeDetail"
  | "source"
  | "assignedAt"
  | "receivedAt"
  | "needModel"
  | "needTrim"
  | "needColors"
  | "needMethod"
  | "needTiming"
  | "needMemo"
  | "tasks"
  | "schedules"
  | "memos"
  | "documents"
>;

export function toCustomerDetail(res: CustomerDetailResponse): CustomerDetailData {
  return {
    id: res.id,
    customerCode: res.customerCode,
    name: res.name,
    phone: res.phone,
    residence: res.residence,
    customerType: res.customerType,
    customerTypeDetail: res.customerTypeDetail,
    source: res.source,
    assignedAt: res.assignedAt,
    receivedAt: res.receivedAt,
    needModel: res.needModel,
    needTrim: res.needTrim,
    needColors: res.needColors,
    needMethod: res.needMethod,
    needTiming: res.needTiming,
    needMemo: res.needMemo,
    tasks: res.tasks ?? [],
    schedules: res.schedules ?? [],
    memos: res.memos ?? [],
    documents: res.documents ?? [],
  };
}

export async function fetchCustomerDetail(id: string): Promise<CustomerDetailData> {
  const res = await apiFetch(`/api/customers/${id}`);
  if (!res.ok) throw new Error(`고객 상세 실패: ${res.status}`);
  return toCustomerDetail((await res.json()) as CustomerDetailResponse);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: PASS (toCustomer 4 + formatActivity 3 + toCustomerDetail 3).

- [ ] **Step 6: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors, 0 problems.

- [ ] **Step 7: 커밋**

```bash
git add client/src/data/customers.ts client/src/lib/customers.ts client/src/lib/customers.test.ts
git commit -m "feat(crm): 고객 상세 fetch 어댑터(fetchCustomerDetail/toCustomerDetail) + Customer.id"
```

---

## Task 2: 김민준 풀세트 시드 확장

**Files:**
- Modify: `scripts/seed-customers.ts`

- [ ] **Step 1: import + 비-null 타임스탬프 헬퍼 추가**

`scripts/seed-customers.ts` 상단 import를 교체한다:

```ts
import { eq } from "drizzle-orm";

import { initialCustomers } from "../client/src/data/customers";
import { getDefaultDb } from "../src/db/client";
import { customerDocuments, customerMemos, customers, customerSchedules, customerTasks } from "../src/db/schema";
```

`toTimestamp` 함수 정의 바로 아래에 비-null 헬퍼를 추가한다(`!` 비-null 단언 회피):

```ts
// 시드 고정 문자열 전용: 반드시 Date를 돌려준다(파싱 실패는 시드 버그).
function ts(s: string): Date {
  const d = toTimestamp(s);
  if (!d) throw new Error(`시드 타임스탬프 파싱 실패: ${s}`);
  return d;
}
```

- [ ] **Step 2: 김민준 전용 블록 추가**

`scripts/seed-customers.ts`의 `main()` 안, `console.log(...)` 직전에 아래 블록을 삽입한다:

```ts
  // ── 김민준(CU-2605-0020) 상세 풀세트 (멱등: 컬럼 update + 자식 delete→insert) ──
  const [kim] = await db.select({ id: customers.id }).from(customers).where(eq(customers.customerCode, "CU-2605-0020"));
  if (kim) {
    await db
      .update(customers)
      .set({
        residence: "인천광역시",
        needTrim: "S 500 4M Long",
        needColors: "외장 컬러 미정 · 내장 컬러 미정",
        needTiming: "좋은 조건 즉시",
        needMemo: "월 납입액, 총비용, 중도해지 조건 차이를 비교하고 싶어함. GLC 재고 확인 후 X3 조건과 함께 다시 정리 필요.",
      })
      .where(eq(customers.id, kim.id));

    await db.delete(customerTasks).where(eq(customerTasks.customerId, kim.id));
    await db.insert(customerTasks).values([
      { customerId: kim.id, category: "체크", due: "오늘", body: "GLC 재고 가능 여부 확인", done: false },
      { customerId: kim.id, category: "견적", due: "오늘", body: "X3 조건과 총비용 비교", done: false },
      { customerId: kim.id, category: "체크", due: "내일", body: "보험 포함 여부 확인", done: false },
      { customerId: kim.id, category: "안내", due: "이번 주", body: "중도해지 조건 설명", done: false },
    ]);

    await db.delete(customerMemos).where(eq(customerMemos.customerId, kim.id));
    await db.insert(customerMemos).values([
      { customerId: kim.id, body: "기존 고객 재구매 혜택 적용 가능성 확인 필요", createdAt: ts("오늘 13:18") },
      { customerId: kim.id, body: "가족과 최종 조건을 상의한 뒤 진행 예정", createdAt: ts("오늘 13:42") },
      { customerId: kim.id, body: "카톡 선호, 통화는 오후 시간대가 비교적 수월함", createdAt: ts("오늘 14:05") },
    ]);

    await db.delete(customerSchedules).where(eq(customerSchedules.customerId, kim.id));
    await db.insert(customerSchedules).values([
      { customerId: kim.id, scheduledDate: "2026-05-26", scheduledTime: "16:00", type: "견적", memo: "GLC 재고 확인 후 X3 조건과 총비용 비교 견적 재발송" },
    ]);

    await db.delete(customerDocuments).where(eq(customerDocuments.customerId, kim.id));
    await db.insert(customerDocuments).values([
      { customerId: kim.id, title: "주민등록등본", docType: "자동인식", fileName: "등본_함승우.pdf", fileSize: 962512, fileMime: "application/pdf", sortOrder: 0 },
      { customerId: kim.id, title: "사업자등록증", docType: "자동인식", fileName: "사업자등록증_크리에이티브지안.png", fileSize: 7031251, fileMime: "image/png", sortOrder: 1 },
    ]);
    console.log("seeded 김민준(CU-2605-0020) detail: tasks 4 / memos 3 / schedules 1 / documents 2");
  }
```

> 참고: `customerDocuments.docType`에 "자동인식"(인식 상태)을 넣는 건 read 데모용 단순화다(`status` 전용 컬럼 없음). 쓰기 단계에서 정식 상태 컬럼/enum으로 재정리한다.

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: 시드 실행(멱등) 확인**

Run: `bun run seed:customers`
Expected: 첫 줄에 `seeded N customers (skipped ...)`, 마지막 줄에 `seeded 김민준(...) detail: tasks 4 / memos 3 / schedules 1 / documents 2`. 에러 없이 종료.

다시 한 번 실행해 멱등 확인:

Run: `bun run seed:customers`
Expected: customers는 모두 skip, 김민준 블록은 다시 실행(중복 자식 없음). 자식 건수 검증:

Run:
```bash
psql "$DATABASE_URL" -c "select (select count(*) from crm.customer_tasks t join crm.customers c on c.id=t.customer_id where c.customer_code='CU-2605-0020') tasks, (select count(*) from crm.customer_memos m join crm.customers c on c.id=m.customer_id where c.customer_code='CU-2605-0020') memos, (select count(*) from crm.customer_schedules s join crm.customers c on c.id=s.customer_id where c.customer_code='CU-2605-0020') schedules, (select count(*) from crm.customer_documents d join crm.customers c on c.id=d.customer_id where c.customer_code='CU-2605-0020') docs;"
```
Expected: `tasks=4, memos=3, schedules=1, docs=2` (재실행해도 동일 = 멱등).

> `$DATABASE_URL`이 셸에 없으면: `set -a; source .env.local; set +a` 후 실행.

- [ ] **Step 5: 커밋**

```bash
git add scripts/seed-customers.ts
git commit -m "feat(crm): 김민준 상세 풀세트 시드(메모3/할일4/일정1/서류2/니즈상세, 멱등)"
```

---

## Task 3: KimMinjunDetailContent detail prop + 초기값 파생 + 헤더 prop화

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

> 라인 번호는 현재 파일 기준이며 편집으로 이동한다. 각 단계는 고유 문자열로 찾아 교체한다.

- [ ] **Step 1: lib import 추가**

`client/src/pages/CustomerDetailPage.tsx` 라인 3 import 다음 줄에 추가:

```ts
import { customerStatusGroups, type Customer, type CustomerChanceOption, type CustomerManageStatus } from "@/data/customers";
import { fetchCustomerDetail, formatActivity, type CustomerDetailData } from "@/lib/customers";
```

- [ ] **Step 2: 미사용 될 const 6개 제거**

아래 6개 const 정의를 삭제한다(각각 Task 3 Step 3~6에서 파생으로 대체되므로 미사용이 됨):
- `kimMinjunInitialStatusValues`(현 328~335)
- `kimInitialNeeds`(현 388~394)
- `kimMinjunDocumentVault`(현 467~484)
- `kimMinjunCheckItems`(현 517~522)
- `kimInitialCustomerMemos`(현 524~528)
- `kimInitialSchedules`(현 530~532)

(`kimMinjunPurchaseFields`(307)는 `solutionWorkbenchPurchaseMethod`에서 계속 쓰이므로 **유지**.)

- [ ] **Step 3: KimMinjunDetailHeader 텍스트 prop화**

`function KimMinjunDetailHeader(...)` 시그니처와 본문을 교체한다:

```tsx
function KimMinjunDetailHeader({ now, recentUpdate, name, customerCode, receivedLabel }: { now: number; recentUpdate: KimRecentUpdate; name: string; customerCode: string; receivedLabel: string }) {
  return (
    <section className="customer-detail-summary kim-detail-summary">
      <div className="kim-header-main">
        <div className="kim-header-read">
          <div className="kim-header-primary">
            <h2 className="kim-header-breadcrumb">
              <span>고객 관리</span>
              <ChevronRight size={18} strokeWidth={2.2} />
              <span>{name}</span>
              <em className="kim-header-code-text num">{customerCode}</em>
              <em className="kim-header-received-text num">{receivedLabel ? `· ${receivedLabel} 접수` : ""}</em>
            </h2>
            <p>
              {formatKimRecentUpdateTime(recentUpdate.updatedAt, now)}{" "}
              <span className="kim-header-update-mark">{recentUpdate.section} 업데이트</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: KimMinjunDetailContent에 detail prop 추가**

`function KimMinjunDetailContent({ ... })` 구조분해·타입에 `detail`을 추가한다:

```tsx
function KimMinjunDetailContent({
  chanceOverride,
  customer,
  detail,
  manageStatusOverride,
  onEditorOpenChange,
  onToast,
  onWorkflowChange,
}: {
  chanceOverride?: CustomerChanceOption;
  customer: Customer;
  detail: CustomerDetailData;
  manageStatusOverride?: CustomerManageStatus;
  onEditorOpenChange?: CustomerDetailPageProps["onEditorOpenChange"];
  onToast: (message: string) => void;
  onWorkflowChange?: CustomerDetailPageProps["onWorkflowChange"];
}) {
```

- [ ] **Step 5: in-scope useState 초기값을 detail 파생으로 교체**

각 라인을 아래로 교체한다(고유 좌변으로 찾기).

`const [statusValues, setStatusValues] = useState(kimMinjunInitialStatusValues);` →
```tsx
  const [statusValues, setStatusValues] = useState<Record<KimStatusFieldKey, string>>(() => ({
    phone: detail.phone ?? "미입력",
    job: formatKimJobValue((detail.customerType as KimCustomerType) ?? "개인", detail.customerTypeDetail ?? ""),
    location: detail.residence ?? "확인 필요",
    source: detail.source ?? "미입력",
    advisor: "미배정",
    assignedAt: detail.assignedAt ? formatActivity(detail.assignedAt) : "미배정",
  }));
```

`const [needs, setNeeds] = useState<KimNeedsState>(kimInitialNeeds);` →
```tsx
  const [needs, setNeeds] = useState<KimNeedsState>(() => ({
    model: detail.needModel ?? "",
    trim: detail.needTrim ?? "",
    colors: detail.needColors ?? "외장 컬러 미정 · 내장 컬러 미정",
    method: detail.needMethod ?? "",
    memo: detail.needMemo ?? "",
  }));
```

`const [purchaseFields, setPurchaseFields] = useState(kimMinjunPurchaseFields);` →
```tsx
  const [purchaseFields, setPurchaseFields] = useState(() =>
    kimMinjunPurchaseFields.map((field) =>
      field.label === "구매방식"
        ? { ...field, value: detail.needMethod ?? field.value }
        : field.label === "출고 희망 시기"
          ? { ...field, value: detail.needTiming ?? field.value }
          : field,
    ),
  );
```

`const [schedules, setSchedules] = useState<KimScheduleItem[]>(kimInitialSchedules);` →
```tsx
  const [schedules, setSchedules] = useState<KimScheduleItem[]>(() =>
    detail.schedules.map((s) => ({
      id: s.id,
      date: s.scheduledDate ?? "",
      time: s.scheduledTime ?? "",
      type: s.type ?? "",
      memo: s.memo ?? "",
    })),
  );
```

`const [checkItems, setCheckItems] = useState<KimCheckItem[]>(kimMinjunCheckItems);` →
```tsx
  const [checkItems, setCheckItems] = useState<KimCheckItem[]>(() =>
    detail.tasks.map((t) => ({
      id: t.id,
      category: t.category ?? "",
      due: t.due ?? "",
      body: t.body ?? "",
    })),
  );
```

`const [completedCheckItems, setCompletedCheckItems] = useState<string[]>([]);` →
```tsx
  const [completedCheckItems, setCompletedCheckItems] = useState<string[]>(() =>
    detail.tasks.filter((t) => t.done).map((t) => t.id),
  );
```

`const [customerMemos, setCustomerMemos] = useState<KimCustomerMemoItem[]>(kimInitialCustomerMemos);` →
```tsx
  const [customerMemos, setCustomerMemos] = useState<KimCustomerMemoItem[]>(() =>
    detail.memos.map((m) => ({
      id: m.id,
      body: m.body ?? "",
      createdAt: formatActivity(m.createdAt),
    })),
  );
```

`const [documents, setDocuments] = useState<KimDocumentItem[]>(kimMinjunDocumentVault);` →
```tsx
  const [documents, setDocuments] = useState<KimDocumentItem[]>(() =>
    detail.documents.map((d) => ({
      id: d.id,
      title: d.title ?? "",
      status: d.docType ?? "수동입력",
      fileName: d.fileName ?? undefined,
      fileSize: d.fileSize ?? undefined,
      mimeType: d.fileMime ?? undefined,
    })),
  );
```

- [ ] **Step 6: 헤더 렌더에 prop 전달**

`<KimMinjunDetailHeader now={recentUpdateNow} recentUpdate={recentUpdate} />` →
```tsx
        <KimMinjunDetailHeader now={recentUpdateNow} recentUpdate={recentUpdate} name={detail.name} customerCode={detail.customerCode} receivedLabel={formatActivity(detail.receivedAt)} />
```

- [ ] **Step 7: typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (Task 4에서 `detail` prop을 넘기기 전까지 `<KimMinjunDetailContent>` 호출부에 `detail` 누락 에러가 날 수 있음 — Task 4와 한 묶음으로 본다. typecheck는 Task 4 Step 3 후 통과.)

---

## Task 4: 외곽 CustomerDetailPage 상세 fetch + 렌더 게이팅 + 로딩 CSS

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`(외곽 `CustomerDetailPage`)
- Modify: `client/src/index.css`

- [ ] **Step 1: 상세 fetch 상태 + 이펙트 추가**

`export function CustomerDetailPage(...)` 본문에서 `const isKimMinjun = customer.customerId === "CU-2605-0020";` 바로 다음 줄에 추가:

```tsx
  const isKimMinjun = customer.customerId === "CU-2605-0020";
  const [detail, setDetail] = useState<CustomerDetailData | null>(null);
  const [detailError, setDetailError] = useState(false);
  useEffect(() => {
    if (!isKimMinjun || !customer.id) return;
    let cancelled = false;
    fetchCustomerDetail(customer.id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetailError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isKimMinjun, customer.id]);
```

- [ ] **Step 2: 렌더 분기 교체(로딩/에러 게이팅)**

기존:
```tsx
      {isKimMinjun ? (
        <KimMinjunDetailContent
          chanceOverride={chanceOverride}
          customer={customer}
          manageStatusOverride={manageStatusOverride}
          onEditorOpenChange={onEditorOpenChange}
          onToast={onToast}
          onWorkflowChange={onWorkflowChange}
        />
      ) : (
```
→
```tsx
      {isKimMinjun ? (
        detailError ? (
          <div className="kim-detail-loading">고객 정보를 불러오지 못했습니다.</div>
        ) : detail ? (
          <KimMinjunDetailContent
            key={customer.id}
            detail={detail}
            chanceOverride={chanceOverride}
            customer={customer}
            manageStatusOverride={manageStatusOverride}
            onEditorOpenChange={onEditorOpenChange}
            onToast={onToast}
            onWorkflowChange={onWorkflowChange}
          />
        ) : (
          <div className="kim-detail-loading">고객 정보를 불러오는 중…</div>
        )
      ) : (
```

- [ ] **Step 3: 로딩 placeholder 스타일 추가**

`client/src/index.css` 맨 끝에 추가:

```css
.kim-detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  color: #6b7280;
  font-size: 13px;
}
```

- [ ] **Step 4: typecheck + lint + build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: 0 errors, 0 problems, build OK.

- [ ] **Step 5: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx client/src/index.css
git commit -m "feat(crm): 김민준 상세 화면 DB 읽기 연결(헤더/상태/니즈/메모/할일/일정/서류)"
```

---

## Task 5: 통합 검증 (수동/스크린샷)

**Files:** 없음(검증만)

- [ ] **Step 1: 전체 검증 스위트**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run build`
Expected: typecheck 0 · lint 0 · test:unit 전부 통과(기존 99 + 신규 10 = ~109) · build OK.

- [ ] **Step 2: 시드 적용 확인(Task 2에서 실행 안 했으면)**

Run: `bun run seed:customers`
Expected: 김민준 detail 시드 로그 출력.

- [ ] **Step 3: 김민준 drawer 수동/스크린샷 검증**

dev 서버(`bun run dev` 또는 기존 5173)에서 고객 관리 전체 보기 → 김민준(CU-2605-0020) 행 클릭 → drawer 확인:
- 헤더: 김민준 · CU-2605-0020 · 접수시각이 시드값으로 표시
- 상태필드: 연락처 010-9588-0812 · 직군 개인 · 4대보험 · 거주지 인천광역시 · 상담경로 디엘(견적서)
- 니즈: Maybach S-Class / S 500 4M Long / 운용리스
- 고객 메모 3건(시간 오름차순), 할일 4건, 예정 일정 1건, 서류함 2건이 시드 데이터로 표시
- 견적함은 기존 하드코딩(범위 외) 그대로 표시

Playwright 스크린샷(기존 스펙 재사용):
Run: `bunx playwright test tools/customer-detail-screenshot.spec.ts --project=chromium`
Expected: PASS. 캡처를 기존 목업 대비 시각 패리티로 확인.

- [ ] **Step 4: brief/메모리 갱신 + 최종 커밋**

`ref/active-session-brief.md`의 Current Focus/완료/Next를 "고객 상세 읽기 연결 완료, 다음=고객 쓰기"로 갱신.

```bash
git add ref/active-session-brief.md
git commit -m "docs: active-session-brief 갱신 — 고객 상세 읽기 연결 완료 [skip ci]"
```

---

## Self-Review 메모

- **스펙 커버리지**: 헤더(T3-S3,S6)·상태(T3-S5)·니즈(T3-S5)·구매조건 구매방식/출고시기(T3-S5 purchaseFields)·고객메모(T3-S5)·할일(T3-S5)·일정(T3-S5)·서류(T3-S5) 전부 태스크 존재. 시드(T2). lib 어댑터(T1). 제외 항목(견적함/견적성 구매조건)은 손대지 않음(const 유지). ✅
- **플레이스홀더 스캔**: 모든 코드 단계 실제 코드 포함, "적절히 처리" 류 없음. ✅
- **타입 일관성**: `CustomerDetailData`/`CustomerDetailResponse`/`fetchCustomerDetail`/`toCustomerDetail` 명칭이 T1 정의와 T3·T4 사용처에서 동일. 자식 형태(`scheduledDate`/`docType`/`fileMime`/`done`)가 시드 컬럼·페이지 매핑과 일치. ✅
- **알려진 가정**: 목록 행은 항상 `id`(uuid)를 운반(seed+listCustomers). `customer.id` 없으면 로딩 무한 — 실 경로(목록 클릭)에선 발생 안 함. `customerDocuments.docType`에 인식상태를 담는 건 read 데모 단순화(쓰기 단계에서 정식화).
