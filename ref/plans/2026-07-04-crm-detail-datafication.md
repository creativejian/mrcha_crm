# 고객 상세 데이터화 마감 + kim 리네임 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 상세의 잔여 mock 4곳(관리 상태·타임라인·가짜 첨부·D-6 배지)을 실데이터화/제거(PR1)하고, kim 접두 심볼·파일명을 범용명으로 정리(PR2)한다.

**Architecture:** PR1 — 서버가 목록·상세 응답의 `lastActivityAt`을 `GREATEST(customers.updated_at, 자식 max(created_at))` 파생값으로 대체하고, 프론트 순수 lib이 관리 상태 버킷을 계산(목록·상세 공용). 타임라인은 합성 행 + `consultations` 병합. PR2 — TS 심볼+파일명만 word-boundary 치환(CSS 클래스 불가침), typecheck가 잔여 참조를 강제 검출.

**Tech Stack:** Hono + drizzle(bun:test, 실 master DB) / React + vitest / spec: `ref/specs/2026-07-04-crm-detail-datafication-design.md`

**스펙 편차(구현 조사에서 확정, 코드 블록보다 이 노트 우선):** 자식 4테이블(memos/tasks/schedules/documents)에는 `updated_at` 컬럼이 **없다**(스키마 실측 — updatedAt 보유는 customers/quotes/quote_scenarios/embeddings뿐). 파생은 자식 `created_at`(추가 시각) 근사를 쓴다. 자식 행 **수정**은 파생에 안 잡히는 허용 한계(일 단위 버킷에서 지배 신호는 본체 PATCH+자식 추가). 자식 updated_at 컬럼 추가는 follow-up.

---

## PR1 — mock→DB 마감 (브랜치 `feat/crm-detail-mock-to-db`)

### Task 0: 브랜치 생성 + 스펙 편차 보정

**Files:**
- Modify: `ref/specs/2026-07-04-crm-detail-datafication-design.md`

- [ ] **Step 1: 브랜치 생성**

```bash
git checkout main && git pull && git checkout -b feat/crm-detail-mock-to-db
```

- [ ] **Step 2: 스펙의 GREATEST 서술 보정**

스펙 파일에서 `GREATEST(customers.updated_at, max(자식 updated_at))` 두 곳(실태 요약 표의 "자식 CRUD" 행은 그대로)을 아래로 교체:

- `## PR1` 섹션: `GREATEST(customers.updated_at, max(자식 created_at))` — 자식 테이블에 updated_at 없음(실측), 자식 수정 미반영은 허용 근사, 컬럼 추가는 follow-up.
- `## 확정 결정` 2번 항목 문구는 유지(방식 자체는 불변).

- [ ] **Step 3: 커밋**

```bash
git add ref/specs/2026-07-04-crm-detail-datafication-design.md
git commit -m "docs(crm): 데이터화 spec 보정 — 자식 테이블 updated_at 부재, created_at 근사로 확정"
```

### Task 1: 관리 상태 파생 lib (TDD)

**Files:**
- Create: `client/src/lib/manage-status.ts`
- Test: `client/src/lib/manage-status.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// client/src/lib/manage-status.test.ts
import { describe, expect, test } from "vitest";

import { finalUpdateStatus } from "./customer-table";
import { deriveFinalUpdateInfo } from "./manage-status";

const NOW = new Date("2026-07-04T12:00:00+09:00");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const base = { recontacted: false, statusGroup: "상담중", status: "차량상담중" };

describe("deriveFinalUpdateInfo", () => {
  test("경과일 버킷 경계: 6=정상, 7=확인필요, 14=확인필요, 15=지연, 29=지연, 30=장기방치", () => {
    const labelAt = (days: number) =>
      finalUpdateStatus(deriveFinalUpdateInfo({ ...base, lastActivityAt: daysAgo(days) }, NOW)!).label;
    expect(labelAt(0)).toBe("정상");
    expect(labelAt(6)).toBe("정상");
    expect(labelAt(7)).toBe("확인필요");
    expect(labelAt(14)).toBe("확인필요");
    expect(labelAt(15)).toBe("지연");
    expect(labelAt(29)).toBe("지연");
    expect(labelAt(30)).toBe("장기방치");
  });

  test("recontacted면 기간 무관 재문의", () => {
    const info = deriveFinalUpdateInfo({ ...base, recontacted: true, lastActivityAt: daysAgo(40) }, NOW)!;
    expect(finalUpdateStatus(info).label).toBe("재문의");
  });

  test("신규+상담접수(액션 전)는 null → 공백", () => {
    expect(deriveFinalUpdateInfo({ ...base, statusGroup: "신규", status: "상담접수", lastActivityAt: daysAgo(1) }, NOW)).toBeNull();
  });

  test("lastActivityAt 없음/파싱 불가면 null", () => {
    expect(deriveFinalUpdateInfo({ ...base, lastActivityAt: null }, NOW)).toBeNull();
    expect(deriveFinalUpdateInfo({ ...base, lastActivityAt: "not-a-date" }, NOW)).toBeNull();
  });

  test("label은 기존 mock 포맷('N월 N일 HH:mm') — 목록 응답 SLA 파서 호환", () => {
    const info = deriveFinalUpdateInfo({ ...base, lastActivityAt: "2026-07-01T09:05:00+09:00" }, NOW)!;
    expect(info.label).toBe("7월 1일 09:05");
    expect(info.days).toBe(3);
  });

  test("미래 시각(시계 오차)은 days 0으로 클램프", () => {
    const info = deriveFinalUpdateInfo({ ...base, lastActivityAt: daysAgo(-1) }, NOW)!;
    expect(info.days).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/manage-status.test.ts`
Expected: FAIL — `Cannot find module './manage-status'`

- [ ] **Step 3: 구현**

```typescript
// client/src/lib/manage-status.ts
import type { FinalUpdateInfo } from "./customer-table";

// 목록 Customer·상세 훅이 구조적 타이핑으로 그대로 넘길 수 있는 최소 입력.
// lastActivityAt = 서버 파생 GREATEST(customers.updated_at, 자식 max(created_at)) ISO.
export type ManageStatusSource = {
  lastActivityAt?: string | null;
  recontacted?: boolean;
  statusGroup: string;
  status: string;
};

// mock initialFinalUpdateByCustomerId를 대체하는 실데이터 파생.
// - 신규·상담접수(아직 담당자 액션 없음) → null(목록/상세 공백 규칙 유지)
// - recontacted → customerRecontacted(버킷 판정은 finalUpdateStatus 소관 — 재문의 우선)
// - label은 "N월 N일 HH:mm" — customer-table.operationDateValue가 파싱하는 기존 포맷 유지(응답 SLA 표시 호환)
export function deriveFinalUpdateInfo(source: ManageStatusSource, now: Date = new Date()): FinalUpdateInfo | null {
  if (source.statusGroup === "신규" && source.status === "상담접수") return null;
  if (!source.lastActivityAt) return null;
  const at = new Date(source.lastActivityAt);
  if (Number.isNaN(at.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    action: "최근 활동 업데이트",
    field: "최근 활동",
    label: `${at.getMonth() + 1}월 ${at.getDate()}일 ${p(at.getHours())}:${p(at.getMinutes())}`,
    days: Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000)),
    customerRecontacted: source.recontacted || undefined,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/lib/manage-status.test.ts`
Expected: PASS 6건

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/manage-status.ts client/src/lib/manage-status.test.ts
git commit -m "feat(crm): 관리 상태 실데이터 파생 lib — 버킷 경계·재문의·공백 규칙 유닛 고정"
```

### Task 2: Customer 타입 + 매퍼에 raw 필드 추가

**Files:**
- Modify: `client/src/data/customers.ts` (Customer 타입, ~line 5)
- Modify: `client/src/lib/customers.ts` (CustomerRow ~line 27, toCustomer ~line 49)

- [ ] **Step 1: Customer 타입 확장** — `aiSummary: string;` 아래에 추가:

```typescript
  lastActivityAt?: string | null; // 서버 파생 최근 담당자 활동(ISO) — 관리 상태 계산 입력
  recontacted?: boolean;
```

- [ ] **Step 2: CustomerRow·toCustomer 확장** — CustomerRow의 `lastActivityAt: string | null;` 다음 줄에 `recontacted: boolean | null;` 추가. toCustomer의 `aiSummary` 매핑 아래에 추가:

```typescript
    lastActivityAt: row.lastActivityAt,
    recontacted: row.recontacted ?? false,
```

- [ ] **Step 3: 검증·커밋**

Run: `bun run typecheck` Expected: 0 errors

```bash
git add client/src/data/customers.ts client/src/lib/customers.ts
git commit -m "feat(crm): Customer에 lastActivityAt·recontacted raw 필드 전달"
```

### Task 3: 백엔드 lastActivityAt 파생 (TDD)

**Files:**
- Modify: `src/db/queries/customers.ts` (listCustomers ~line 87, getCustomer ~line 107)
- Test: `src/routes/customers.test.ts` (기존 파일에 테스트 추가)

- [ ] **Step 1: 실패하는 테스트 추가** — `src/routes/customers.test.ts` 맨 끝에:

```typescript
test("lastActivityAt 파생: 자식(메모) 추가 시각이 customers.updated_at보다 새로우면 그 시각", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;

  const created = await app.request(`/api/customers/${cid}/memos`, { method: "POST", headers: h, body: JSON.stringify({ body: "파생 검증 메모" }) });
  expect(created.status).toBe(201);
  const memo = (await created.json()) as { id: string; createdAt: string };

  // 상세: 파생값 = 방금 만든 메모 created_at (이 고객의 최신 활동)
  const got = (await (await app.request(`/api/customers/${cid}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { lastActivityAt: string | null };
  expect(new Date(got.lastActivityAt ?? 0).getTime()).toBe(new Date(memo.createdAt).getTime());

  // 목록도 동일 파생
  const list2 = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; lastActivityAt: string | null }>;
  expect(new Date(list2.find((c) => c.id === cid)?.lastActivityAt ?? 0).getTime()).toBe(new Date(memo.createdAt).getTime());

  // 정리(공유 master 비파괴)
  await app.request(`/api/customers/${cid}/memos/${memo.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server src/routes/customers.test.ts`
Expected: 새 테스트 FAIL — 현재 lastActivityAt은 시드값/NULL(파생 없음)이라 메모 created_at과 불일치

- [ ] **Step 3: 파생 SQL 구현** — `src/db/queries/customers.ts`의 `latestTaskBody` 정의 아래에 추가:

```typescript
// 목록·상세가 공유하는 "마지막 담당자 액션" 파생 — 관리 상태(정상/확인필요/지연/장기방치)의 입력.
// customers.updated_at(본체 PATCH 스탬프) + 자식 추가 시각 max(created_at). 자식 테이블엔 updated_at이
// 없어 수정은 못 잡는다(허용 근사 — 컬럼 추가는 follow-up). last_activity_at 컬럼(시드 후 미갱신·죽은 값)은
// 이 파생값으로 응답에서 대체된다(컬럼 자체는 불변, drop은 follow-up).
const staffActivityAt = sql<Date | null>`greatest(
  ${customers.updatedAt},
  (select max(m.created_at) from crm.customer_memos m where m.customer_id = ${customers.id}),
  (select max(t.created_at) from crm.customer_tasks t where t.customer_id = ${customers.id}),
  (select max(s.created_at) from crm.customer_schedules s where s.customer_id = ${customers.id}),
  (select max(d.created_at) from crm.customer_documents d where d.customer_id = ${customers.id})
)`;
```

listCustomers의 select를 교체(뒤 키가 spread의 lastActivityAt 컬럼을 덮는다):

```typescript
    .select({ ...getTableColumns(customers), latestTask: latestTaskBody, lastActivityAt: staffActivityAt })
```

getCustomer의 본체 조회를 교체:

```typescript
  const [customer] = await executor
    .select({ ...getTableColumns(customers), lastActivityAt: staffActivityAt })
    .from(customers)
    .where(eq(customers.id, id));
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:server src/routes/customers.test.ts`
Expected: 전체 PASS(기존 + 신규 1)

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 목록·상세 lastActivityAt을 GREATEST 파생으로 대체 — 본체 PATCH+자식 추가 반영"
```

### Task 4: 목록·상세 배선 교체 + mock 맵 삭제

**Files:**
- Modify: `client/src/components/customer-detail/hooks/useCustomerWorkflow.ts` (~lines 5, 35-41, 82, 100)
- Modify: `client/src/pages/CustomerManagementPage.tsx` (~lines 4, 139, 586)
- Modify: `client/src/lib/customer-table.ts` (initialFinalUpdateByCustomerId 삭제, lines 30-43)

- [ ] **Step 1: useCustomerWorkflow 교체**

import 수정(line 5): `initialFinalUpdateByCustomerId` 제거, `deriveFinalUpdateInfo` 추가:

```typescript
import { finalUpdateStatus, resolveChance } from "@/lib/customer-table";
import { deriveFinalUpdateInfo } from "@/lib/manage-status";
```

`resolveKimManageStatus`(lines 35-41)를 교체:

```typescript
// 상세 관리 상태 = 목록과 동일 규칙. override(워크플로우 변경) 있으면 그것, 없으면 서버 파생
// lastActivityAt 기반 계산, 파생 불가(신규·상담접수/활동 없음)면 ""(목록처럼 공백). 무조건 "정상" 폴백 금지.
function resolveManageStatus(override: CustomerManageStatus | undefined, customer: Customer): CustomerManageStatus | "" {
  if (override) return override;
  const info = deriveFinalUpdateInfo(customer);
  return info ? (finalUpdateStatus(info).label as CustomerManageStatus) : "";
}
```

호출부 2곳 교체 — line 82: `resolveManageStatus(manageStatusOverride, customer)`, line 100(effect): 동일 + 의존성 `[manageStatusOverride, customer]`.

- [ ] **Step 2: CustomerManagementPage 교체**

line 4 import에서 `initialFinalUpdateByCustomerId` 제거 + `import { deriveFinalUpdateInfo } from "@/lib/manage-status";` 추가.

line 139와 586의 동일 패턴 2곳 교체:

```typescript
      const updateInfo = finalUpdateOverrides[customer.no] ?? deriveFinalUpdateInfo(customer);
```

(기존 `?? null`은 deriveFinalUpdateInfo가 null을 반환하므로 불필요)

- [ ] **Step 3: mock 맵 삭제** — `customer-table.ts` lines 30-43 `initialFinalUpdateByCustomerId` 블록 전체 삭제.

- [ ] **Step 4: 검증**

Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors / 전체 PASS (CustomerManagementPage.test.tsx는 관리 상태 라벨을 단언하지 않음 — 헤더 문자열만. 실패 시 mock 데이터 `initialCustomers`에 lastActivityAt 부재로 공백이 된 케이스이므로 단언 쪽을 실데이터 전제로 수정)

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/customer-detail/hooks/useCustomerWorkflow.ts client/src/pages/CustomerManagementPage.tsx client/src/lib/customer-table.ts
git commit -m "feat(crm): 관리 상태를 mock 맵에서 서버 파생+bucketing으로 교체 — initialFinalUpdateByCustomerId 삭제"
```

### Task 5: 타임라인 consultations 하이브리드 병합 (TDD)

**Files:**
- Modify: `client/src/lib/customers.ts` (CustomerDetailResponse ~line 89, CustomerDetailData ~line 123, toCustomerDetail ~line 158)
- Modify: `client/src/components/customer-detail/hooks/useCustomerWorkflow.ts` (timelineRows ~line 26, 호출 ~line 85)
- Test: `client/src/components/customer-detail/hooks/build-timeline-rows.test.ts`

- [ ] **Step 1: 타입·매퍼 연결** — `client/src/lib/customers.ts`:

line 83 주석 "consultations는 이번 범위 외라 생략" 문장 삭제. line 87 아래에 타입 추가:

```typescript
export type CustomerDetailConsultation = { id: string; channel: string | null; summary: string | null; status: string | null; occurredAt: string | null; advisorId: string | null; createdAt: string | null };
```

`CustomerDetailResponse`에 `consultations: CustomerDetailConsultation[];` 추가(quotes 위), `CustomerDetailData` Pick 유니온에 `| "consultations"` 추가, `toCustomerDetail`에 `consultations: res.consultations ?? [],` 추가.

- [ ] **Step 2: 실패하는 테스트 작성**

```typescript
// client/src/components/customer-detail/hooks/build-timeline-rows.test.ts
import { describe, expect, test } from "vitest";

import type { Customer } from "@/data/customers";
import { buildTimelineRows } from "./useCustomerWorkflow";

const customer = {
  no: 20, customerId: "CU-2605-0020", receivedAt: "26/05/14 12:56", assignedAt: "26/05/14 13:04",
  team: "인천본사", name: "김민준", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-1234-5678",
  vehicle: "Maybach S-Class", method: "운용리스", advisor: "김지안", statusGroup: "견적", status: "견적발송",
  date: "26/07/01 09:00", source: "앱 견적비교", talkCount: "", priority: "높음", nextAction: "재견적", aiSummary: "",
} as Customer;

const consultation = (id: string, occurredAt: string | null, summary: string, createdAt = "2026-06-01T10:00:00+09:00") =>
  ({ id, channel: "전화", summary, status: null, occurredAt, advisorId: null, createdAt });

describe("buildTimelineRows", () => {
  test("consultations 0행이면 기존 합성 4행 그대로(현행 렌더 무변화)", () => {
    const rows = buildTimelineRows(customer, []);
    expect(rows.map((r) => r.kind)).toEqual(["접수", "배정", "상태", "메모"]);
  });

  test("consultations는 배정 다음·상태 앞에 occurred_at 오름차순으로 삽입", () => {
    const rows = buildTimelineRows(customer, [
      consultation("b", "2026-06-20T10:00:00+09:00", "2차 상담"),
      consultation("a", "2026-06-10T10:00:00+09:00", "1차 상담"),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["접수", "배정", "상담", "상담", "상태", "메모"]);
    expect(rows[2].body).toBe("1차 상담");
    expect(rows[3].body).toBe("2차 상담");
  });

  test("occurred_at 없으면 created_at 폴백으로 정렬·표시", () => {
    const rows = buildTimelineRows(customer, [consultation("a", null, "시각 미기록", "2026-06-15T09:30:00+09:00")]);
    expect(rows[2].kind).toBe("상담");
    expect(rows[2].meta).toBe("26/06/15 09:30");
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `bun run test:unit client/src/components/customer-detail/hooks/build-timeline-rows.test.ts`
Expected: FAIL — `buildTimelineRows` export 없음

- [ ] **Step 4: 구현** — `useCustomerWorkflow.ts`의 `timelineRows`(lines 26-33)를 교체:

```typescript
export type TimelineRow = { kind: string; title: string; meta: string; body: string };

// 합성 행(접수/배정=실 DB 사실, 상태/메모=현재값 재표현) 사이에 실 상담 이력(consultations)을 병합.
// consultations는 occurred_at(없으면 created_at) 오름차순으로 배정 다음·상태 앞 — 접수/배정은 항상
// 이력의 시작이고 상태/메모는 "현재"의 재표현이라 문자열 시각 파싱 없이도 순서가 성립한다.
export function buildTimelineRows(customer: Customer, consultations: CustomerDetailData["consultations"]): TimelineRow[] {
  const consultationRows = [...consultations]
    .sort((a, b) => new Date(a.occurredAt ?? a.createdAt ?? 0).getTime() - new Date(b.occurredAt ?? b.createdAt ?? 0).getTime())
    .map((row) => ({
      kind: "상담",
      title: row.channel ? `${row.channel} 상담` : "상담 기록",
      meta: formatActivity(row.occurredAt ?? row.createdAt),
      body: row.summary ?? "",
    }));
  return [
    { kind: "접수", title: `${sourceType(customer.source)} 접수`, meta: customer.receivedAt, body: `${customer.source} 경로로 고객 문의가 들어왔습니다.` },
    { kind: "배정", title: `${customer.advisor} 상담사 배정`, meta: customer.assignedAt, body: `${customer.team} 기준으로 담당자를 배정했습니다.` },
    ...consultationRows,
    { kind: "상태", title: `${customer.statusGroup} > ${customer.status}`, meta: customer.date, body: "전체 보기의 진행 상태 컬럼과 동일한 업무 단계입니다." },
    { kind: "메모", title: "상담 메모 업데이트", meta: "최근", body: customer.nextAction },
  ];
}
```

훅 본문(line 85) 교체: `const timelineItems = buildTimelineRows(customer, detail.consultations);`
(formatActivity는 이미 line 4에서 import 중 — `type CustomerDetailData`도 동일 import에 있음)

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `bun run test:unit client/src/components/customer-detail/hooks/build-timeline-rows.test.ts && bun run typecheck`
Expected: PASS 3건 / 0 errors

```bash
git add client/src/lib/customers.ts client/src/components/customer-detail/hooks/useCustomerWorkflow.ts client/src/components/customer-detail/hooks/build-timeline-rows.test.ts
git commit -m "feat(crm): 상담 타임라인에 consultations 하이브리드 병합 — 프론트 타입 연결(백엔드 기반환)"
```

### Task 6: 장식 mock 2곳 제거

**Files:**
- Modify: `client/src/components/customer-detail/StatusWorkflow.tsx` (lines 6, 9, 195-212)
- Modify: `client/src/components/customer-detail/status-meta.ts` (lines 54-57 삭제)
- Modify: `client/src/lib/kim-status-fields.ts` (hasKimQuoteAttachments 삭제, ~line 88)
- Modify: `client/src/components/KimAppCardPreview.tsx` (lines 5, 10-13)

- [ ] **Step 1: 가짜 첨부 버튼 제거** — StatusWorkflow.tsx에서 line 6 import의 `hasKimQuoteAttachments` 제거(`hasKimAppSourceQueue`는 유지), line 9 import의 `kimMockQuoteAttachments` 제거, lines 195-212의 `{hasKimQuoteAttachments(...) ? (...) : null}` JSX 블록 전체 삭제. status-meta.ts의 `kimMockQuoteAttachments` 상수 삭제. kim-status-fields.ts의 `hasKimQuoteAttachments` 함수 삭제.

- [ ] **Step 2: D-6/미확인 배지 제거** — KimAppCardPreview.tsx lines 10-13 삭제:

```tsx
        <div className="kim-app-card-status">
          <strong>🔔 미확인 견적</strong>
          <span>● D-6</span>
        </div>
```

line 5 주석의 `주의: D-6 / "미확인 견적"은 발송 상태값(미리보기 맥락)이라 현행 mock 유지.` 문장 삭제.

- [ ] **Step 3: 잔여 참조 확인 + 검증**

Run: `grep -rn "kimMockQuoteAttachments\|hasKimQuoteAttachments\|미확인 견적" client/src --include="*.ts*"` Expected: 0건
Run: `bun run typecheck && bun run lint && bun run test:unit` Expected: 전부 green

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/customer-detail/StatusWorkflow.tsx client/src/components/customer-detail/status-meta.ts client/src/lib/kim-status-fields.ts client/src/components/KimAppCardPreview.tsx
git commit -m "feat(crm): 장식성 mock 제거 — 가짜 견적서 첨부 버튼·D-6/미확인 배지(대응 기능 슬라이스에서 실데이터로)"
```

### Task 7: PR1 통합 검증·브라우저 스모크·PR

- [ ] **Step 1: 전체 검증**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`
Expected: 전부 green

- [ ] **Step 2: dev 서버 재시작(dev:api는 watch 없음 — 필수) 후 브라우저 스모크** (agent-browser, admin magiclink 세션)

확인 항목: ①목록 관리 상태 뱃지가 실데이터 기반(방금 수정한 고객=정상, 오래된 고객=지연/장기방치) ②김민준 상세 워크플로우 카드 관리 상태 동일 ③타임라인 합성 4행 현행 유지(consultations 0행) ④"디엘(견적서)" 첨부 버튼 부재 ⑤워크벤치 미리보기 D-6/미확인 배지 부재·레이아웃 정상 ⑥앱 유입 고객 상세 정상 렌더. 스모크로 만든 데이터는 원복.

- [ ] **Step 3: PR 생성**

```bash
git push -u origin feat/crm-detail-mock-to-db
gh pr create --title "feat(crm): 고객 상세 데이터화 마감 — 관리 상태 파생·타임라인 consultations·장식 mock 제거" --body "(스펙 링크 + 검증 결과 + 스모크 증거)"
```

머지는 사용자 확인 후. **머지 후 PR2 착수.**

---

## PR2 — kim 리네임 (브랜치 `refactor/crm-kim-rename`, PR1 머지 후)

기능 무변경 · CSS 클래스(`kim-*`) 불가침 · `data/customers.ts` 옵션 SSOT·`data/prototype.ts`·`QuotesPage.tsx` "김민준" 문자열 불가침. 검증은 typecheck가 주 무기(잔여 참조 강제 검출).

### Task 8: 파일 이동(리네임)만 — 심볼 불변 커밋

**Files:** `client/src/lib/kim-*.ts` 6종 + `client/src/components/KimAppCardPreview.tsx` + 이들의 import 경로 전 소비처

- [ ] **Step 1: git mv + import 경로 치환**

```bash
git checkout main && git pull && git checkout -b refactor/crm-kim-rename
git mv client/src/lib/kim-detail-utils.ts client/src/lib/detail-utils.ts
git mv client/src/lib/kim-status-fields.ts client/src/lib/status-fields.ts
git mv client/src/lib/kim-schedule.ts client/src/lib/schedule-items.ts
git mv client/src/lib/kim-popover-frames.ts client/src/lib/popover-frames.ts
git mv client/src/lib/kim-quote.ts client/src/lib/quote-items.ts
git mv client/src/lib/kim-app-card.ts client/src/lib/app-card.ts
git mv client/src/components/KimAppCardPreview.tsx client/src/components/AppCardPreview.tsx
grep -rl '@/lib/kim-detail-utils' client/src | xargs sed -i '' 's|@/lib/kim-detail-utils|@/lib/detail-utils|g'
grep -rl '@/lib/kim-status-fields' client/src | xargs sed -i '' 's|@/lib/kim-status-fields|@/lib/status-fields|g'
grep -rl '@/lib/kim-schedule' client/src | xargs sed -i '' 's|@/lib/kim-schedule|@/lib/schedule-items|g'
grep -rl '@/lib/kim-popover-frames' client/src | xargs sed -i '' 's|@/lib/kim-popover-frames|@/lib/popover-frames|g'
grep -rl '@/lib/kim-quote' client/src | xargs sed -i '' 's|@/lib/kim-quote|@/lib/quote-items|g'
grep -rl '@/lib/kim-app-card' client/src | xargs sed -i '' 's|@/lib/kim-app-card|@/lib/app-card|g'
grep -rl 'components/KimAppCardPreview\|\./KimAppCardPreview' client/src | xargs sed -i '' -e 's|components/KimAppCardPreview|components/AppCardPreview|g' -e 's|\./KimAppCardPreview|./AppCardPreview|g'
```

- [ ] **Step 2: 검증·커밋** — Run: `bun run typecheck` Expected: 0

```bash
git add -A && git commit -m "refactor(crm): kim-* lib 파일명 리네임(이동만, 심볼 불변 — git rename 감지 보존)"
```

### Task 9: 심볼 리네임 — 충돌 사전 점검 + 배치 치환

- [ ] **Step 1: 충돌 사전 점검** — 새 이름이 이미 존재하는지 확인(0건이어야 치환, 있으면 `customer` 접두 대안 사용):

```bash
grep -rnE '\b(CustomerDetailContent|AppCardPreview|QuoteItem|toQuoteItem|statusFieldMeta|workflowMeta|purchaseFieldScaffold|emptyQuotePricing|emptyQuoteConditionCards|OpenEditor|editorMatches|StatusFieldKey|WorkflowKey|AdvisorTeam)\b' client/src --include="*.ts*" | grep -v "OpenEditorState"
```

- [ ] **Step 2: 대표 심볼 배치 치환** — 아래 맵을 한 심볼당 한 명령으로(word-boundary, 테스트 파일 포함):

```bash
r() { grep -rlE "\b$1\b" client/src --include="*.ts*" --include="*.tsx" | xargs -r sed -i '' "s/\b$1\b/$2/g"; }
r KimMinjunDetailContent CustomerDetailContent
r KimAppCardPreview AppCardPreview
r KimOpenEditor OpenEditorState        # 별칭 제거 — 원 타입 직사용
r kimEditorMatches editorMatches
r kimMinjunStatusFieldMeta statusFieldMeta
r kimMinjunWorkflowMeta workflowMeta
r kimMinjunPurchaseFields purchaseFieldScaffold
r kimMaybachQuotePricingMock emptyQuotePricing
r kimManualQuoteConditionCards emptyQuoteConditionCards
r KimStatusFieldKey StatusFieldKey
r KimWorkflowKey WorkflowKey
r KimQuoteItem QuoteItem
r toKimQuoteItem toQuoteItem
r KimCustomerType CustomerTypeValue
r KimAdvisorTeam AdvisorTeam
r KIM_NEEDS_COLOR_PLACEHOLDER NEEDS_COLOR_PLACEHOLDER
r KimNeedsState NeedsState
```

(`KimOpenEditor` 치환으로 `type OpenEditorState = OpenEditorState` 자기참조 별칭이 남으면 그 줄 삭제)

- [ ] **Step 3: 검증·커밋** — Run: `bun run typecheck && bun run lint` Expected: 0 / 0

```bash
git add -A && git commit -m "refactor(crm): kim 대표 심볼 리네임 — 컴포넌트·타입·메타 상수(기능 무변경)"
```

### Task 10: 심볼 리네임 — formatKim*/parseKim*/kim*Options 일괄

- [ ] **Step 1: 잔여 kim 심볼 인벤토리**

```bash
grep -rhoE '\b(format|parse|sort|calculate|classify|normalize|primary|create|is|has)Kim[A-Za-z]*\b|\bkim[A-Z][A-Za-z]*\b' client/src --include="*.ts*" | sort -u
```

- [ ] **Step 2: 인벤토리의 각 심볼을 Kim/kim 접두만 벗겨 치환** — 규칙: `formatKimX`→`formatX`, `parseKimX`→`parseX`, `sortKimX`→`sortX`, `calculateKimX`→`calculateX`, `classifyKimX`→`classifyX`, `normalizeKimX`→`normalizeX`, `primaryKimX`→`primaryX`, `createKimX`→`createX`, `isKimX`→`isX`, `hasKimX`→`hasX`, `kimXyz`→`xyz`(lowerCamel 유지). Task 9의 `r` 헬퍼로 심볼당 1치환. 각 치환 전 새 이름 충돌을 `grep -rnE "\b<새이름>\b"`로 확인, 충돌 시 `customer` 접두(`customerCheckDueOptions` 등).

주의: CSS 클래스 문자열(`"kim-..."`)은 하이픈이라 word-boundary `\bkim[A-Z]` 패턴에 안 걸림 — 불가침 유지. `data/customers.ts`·`data/prototype.ts`·`QuotesPage.tsx`는 kim 심볼 소비가 없어 자연 제외되나 diff에서 재확인.

- [ ] **Step 3: 검증·커밋** — Run: `bun run typecheck && bun run lint && bun run test:unit` Expected: 전부 green

```bash
git add -A && git commit -m "refactor(crm): kim 유틸·옵션 심볼 접두 제거 — 범용명으로(기능 무변경)"
```

### Task 11: 주석 정리 + 최종 검증·스모크·PR

- [ ] **Step 1: "김민준 전용" 주석 갱신** — `grep -rn "김민준" client/src/lib client/src/components/customer-detail client/src/components/AppCardPreview.tsx` 결과에서 파일 헤더/설명 주석의 "김민준 (고객 상세) 전용" 서술을 "고객 상세" 범용 서술로 수정(코드 값·목업 문자열은 불변).

- [ ] **Step 2: 전체 검증**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`
Expected: 전부 green. 추가로 `grep -rnE "\bKim|\bkim[A-Z]" client/src --include="*.ts*" | grep -v "kim-"` 로 잔여 심볼 0건 확인.

- [ ] **Step 3: 브라우저 스모크 1회** — 고객 상세 열기(김민준+타 고객), 견적 워크벤치·앱 카드 미리보기 렌더 확인(기능 무변경 확인용).

- [ ] **Step 4: PR 생성·(머지 후) brief 갱신**

```bash
git push -u origin refactor/crm-kim-rename
gh pr create --title "refactor(crm): kim 심볼·파일명 리네임 — 범용명 정리(기능 무변경, CSS 클래스 보류)" --body "(스펙 링크 + 검증 + 불가침 목록 확인)"
```

머지 후 `ref/active-session-brief.md`의 이 슬라이스 항목을 완료로 갱신(main docs 커밋).
