# 출고 관리 콘솔 1단계 구현 계획 (2026-07-19)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객관리 › 출고 관리(`?view=delivery`)를 계약완료 2차 상태 파생 출고 작업 큐로 실동작화하고, 상단 "계약 / 출고" 목업(DeliveryPage)을 제거한다.

**Architecture:** 서버 변경은 ①일정 어휘 '출고' CHECK 마이그(0035) ②`listCustomers`에 `nextDeliverySchedule {id,date,time}` 상관 서브쿼리 — 단 2개. 단계 전이·일정 CRUD는 기존 라우트 재사용(변경 0). 클라는 순수 파생 계층(`delivery-console.ts`)을 신설하고 콘솔 페이지의 delivery mode만 분기 확장한다(#249 SSOT: mode 차이는 필터·행 분기 한 곳).

**Tech Stack:** Hono + drizzle(postgres-js, 실 master) / React + vitest / bun. spec = `ref/specs/2026-07-19-crm-delivery-console-design.md` (결정 D1~D9 표 참조).

**검증 공통**: DOM/TS 변경 = `bun run typecheck` · 모든 변경 = `bun run lint` 0 · 서버 = `bun run test:server`(직접 `bun test <파일>` 금지 — 게이트 3규칙) · 마지막 통합 = build까지. 커밋 메시지에 skip-ci 토큰 금지(글자로도 쓰지 말 것).

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| Create `client/src/lib/delivery-console.ts` | 순수 파생 SSOT: pill 어휘·매칭·카운트·정렬 비교기·예정일 라벨(KST)·팝오버 제출 해석 |
| Create `client/src/lib/delivery-console.test.ts` | 위 유닛(TDD) |
| Create `src/db/queries/customers.next-delivery.test.ts` | 서버 서브쿼리 테스트(실 master, `CU-DLVR-` 픽스처) |
| Create `drizzle/0035_*.sql` | `db:generate` 산출(CHECK에 '출고' 추가) |
| Modify `client/src/data/customers.ts` | `DELIVERY_SCHEDULE_TYPE`·`NextDeliverySchedule` 타입·`SCHEDULE_TYPE_OPTIONS` 9종·`Customer` 필드 2개·`customerModeMeta.delivery.desc` |
| Modify `src/db/queries/customers.ts` | `nextDeliverySchedule` 서브쿼리 + `CustomerListRow` 확장 |
| Modify `client/src/lib/customers.ts` | `CustomerRow`/`toCustomer`에 `needDeliveryMethod`·`nextDeliverySchedule` 배선 |
| Modify `client/src/pages/CustomerManagementRow.tsx` | `CustomerStageCell` `secondaryOnly` prop + `CustomerDeliveryScheduleCell` 신설 |
| Modify `client/src/pages/CustomerManagementPage.tsx` | delivery heads/columns·renderRow 분기·pill 필터·정렬·카운트 라벨·팝오버 핸들러 |
| Modify `client/src/pages/CustomerManagementPage.test.tsx` | delivery mode 테스트 추가 |
| Modify `client/src/styles/customer-console.css` | 출고 예정 셀·팝오버 스타일(신규 클래스만, 기존 규칙 불변) |
| Modify `client/src/App.tsx` | `customersLoaded` prop 전달 · ViewKey/`VIEW_TO_PATH`/`viewMeta`/Route에서 delivery 제거 · `handleViewChange` 구 "delivery" 뷰 → 출고 큐 리라우트 |
| Modify `client/src/components/Sidebar.tsx` | 상단 "계약 / 출고" 버튼·delivery 아이콘 제거 |
| Delete `client/src/pages/DeliveryPage.tsx` | 22줄 하드코딩 목업(전용 CSS 없음 — 공용 클래스만 사용해 CSS 작업 0) |
| Modify `src/test-utils/fixture-codes.ts` | `CU-DLVR-` 접두사 registry 등록 |
| Modify `ref/director-pending-confirmations.md` | 항목 13(가정 5건) 등재 |

Topbar는 **무변경** — 알림 목업의 `onNavigate("delivery")`는 App `handleViewChange`가 출고 큐로 리라우트한다(Task 8).

---

### Task 1: 브랜치 + 일정 어휘 '출고' + 마이그 0035

**Files:** Modify `client/src/data/customers.ts:95-96` · Create `drizzle/0035_*.sql`

- [ ] **Step 1: 브랜치 생성 + spec/plan 커밋**

```bash
git checkout -b feat/crm-delivery-console
git add ref/specs/2026-07-19-crm-delivery-console-design.md ref/plans/2026-07-19-crm-delivery-console.md
git commit -m "docs(crm): 출고 관리 콘솔 1단계 spec·plan"
```

- [ ] **Step 2: 어휘·타입 추가** — `client/src/data/customers.ts`의 기존 95-96행(일정 종류 주석+상수)을 아래로 교체하고, 파일 하단(SCHEDULE_TYPE_OPTIONS 근처)에 타입을 추가:

```ts
// 출고 일정 타입 값 — 출고 콘솔·서버 파생 쿼리가 공유하고, 스프레드로 닫힌 집합
// (customer_schedules_type_check) 원소임이 구조적으로 보장된다(APP_QUOTE_REQUEST_SOURCE 선례).
// 값 변경 = CHECK 마이그 동반.
export const DELIVERY_SCHEDULE_TYPE = "출고";

// 일정 종류(schedules.type) — 닫힌 9종(0035에서 '출고' 추가).
export const SCHEDULE_TYPE_OPTIONS: readonly string[] = ["재연락", "결정확인", "체크", "견적", "안내", "요청", "내부", "심사", DELIVERY_SCHEDULE_TYPE];

// 목록 파생 '다음 출고 예정' — 서버 listCustomers 서브쿼리 ↔ 클라 표시·팝오버가 공유하는 shape.
// date = 'YYYY-MM-DD'(plain date, tz 없음), time = 'HH:mm[:ss]' | null. id = 팝오버 수정/삭제 대상.
export type NextDeliverySchedule = { id: string; date: string; time: string | null };
```

- [ ] **Step 3: 마이그 생성·검사** — `bun run db:generate` 실행. `drizzle/0035_*.sql` 1개만 생성되고 내용이 `customer_schedules_type_check` DROP+ADD(9값, '출고' 포함)뿐인지 눈으로 확인. **다른 테이블 변경이 섞여 나오면 중단하고 드리프트 원인 조사**(스키마 파일 무단 변경 신호).

- [ ] **Step 4: 실 DB 적용 + 실측** — `bun run db:migrate` 후:

```bash
DBURL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')"
psql "$DBURL" -c "select pg_get_constraintdef(oid) from pg_constraint where conname='customer_schedules_type_check';"
```
Expected: 출력에 `'출고'` 포함.

- [ ] **Step 5: 검증 + 커밋** — `bun run typecheck && bun run lint` 0 확인.

```bash
git add client/src/data/customers.ts drizzle/
git commit -m "feat(crm): 일정 어휘 '출고' 추가 + 마이그 0035 — 출고 콘솔 1단계 어휘 기반"
```

### Task 2: 서버 — listCustomers nextDeliverySchedule 서브쿼리 (TDD)

**Files:** Modify `src/test-utils/fixture-codes.ts:20` 근처 · Create `src/db/queries/customers.next-delivery.test.ts` · Modify `src/db/queries/customers.ts:19-28,145-151`

- [ ] **Step 1: 픽스처 접두사 registry 선등록**(#214 규칙 — 테스트 작성 전에) — `src/test-utils/fixture-codes.ts`의 `TEST_CUSTOMER_CODE_PREFIXES` 배열, `"CU-DEL-"` 다음 줄에:

```ts
  "CU-DLVR-",       // db/queries/customers.next-delivery.test.ts — 출고 예정 파생
```

- [ ] **Step 2: 실패하는 테스트 작성** — `src/db/queries/customers.next-delivery.test.ts` 신설:

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { DELIVERY_SCHEDULE_TYPE } from "../../../client/src/data/customers";
import { getDefaultDb } from "../client";
import { customers, customerSchedules } from "../schema";
import { listCustomers } from "./customers";

const db = getDefaultDb();
const suffix = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const CODE_WITH = `CU-DLVR-${suffix()}`;
const CODE_WITHOUT = `CU-DLVR-${suffix()}`;

describe("listCustomers nextDeliverySchedule (출고 콘솔 spec §4)", () => {
  const ids: string[] = [];

  afterAll(async () => {
    // 고객 삭제 → schedules는 FK cascade. crm 테이블만 접촉(알림 트리거 무관).
    for (const id of ids) await db.delete(customers).where(eq(customers.id, id));
  });

  test("미완료 '출고' 일정 중 (date asc, time asc nulls last) 첫 행을 동봉한다", async () => {
    const [row] = await db.insert(customers).values({ customerCode: CODE_WITH, name: "출고큐파생검증" }).returning({ id: customers.id });
    ids.push(row.id);
    await db.insert(customerSchedules).values([
      { customerId: row.id, scheduledDate: "2026-08-01", scheduledTime: "10:00", type: DELIVERY_SCHEDULE_TYPE, done: false },
      { customerId: row.id, scheduledDate: "2026-07-25", scheduledTime: null, type: DELIVERY_SCHEDULE_TYPE, done: false },
      { customerId: row.id, scheduledDate: "2026-07-25", scheduledTime: "09:30", type: DELIVERY_SCHEDULE_TYPE, done: false },
      { customerId: row.id, scheduledDate: "2026-07-01", scheduledTime: "08:00", type: DELIVERY_SCHEDULE_TYPE, done: true }, // done 제외
      { customerId: row.id, scheduledDate: "2026-07-02", scheduledTime: "08:00", type: "안내", done: false }, // 타입 제외
      { customerId: row.id, scheduledDate: null, scheduledTime: null, type: DELIVERY_SCHEDULE_TYPE, done: false }, // 날짜 없음 제외
    ]);

    const mine = (await listCustomers(db)).find((r) => r.id === row.id);
    expect(mine?.nextDeliverySchedule?.date).toBe("2026-07-25");
    expect(mine?.nextDeliverySchedule?.time).toBe("09:30"); // 같은 날짜의 시간 미지정은 뒤
    expect(mine?.nextDeliverySchedule?.id).toBeTruthy();
  });

  test("미완료 '출고' 일정이 없으면 null", async () => {
    const [row] = await db.insert(customers).values({ customerCode: CODE_WITHOUT, name: "출고큐파생검증" }).returning({ id: customers.id });
    ids.push(row.id);
    const mine = (await listCustomers(db)).find((r) => r.id === row.id);
    expect(mine?.nextDeliverySchedule).toBeNull();
  });
});
```

- [ ] **Step 3: RED 확인** — `bun run test:server src/db/queries/customers.next-delivery.test.ts`
Expected: FAIL (`nextDeliverySchedule` 필드 부재 — undefined).

- [ ] **Step 4: 구현** — `src/db/queries/customers.ts`:

임포트에 추가(기존 `../public-app` 임포트 근처):
```ts
import { DELIVERY_SCHEDULE_TYPE, type NextDeliverySchedule } from "../../../client/src/data/customers";
```

`latestTaskBody` 아래에 서브쿼리 추가:
```ts
// 출고 콘솔 '출고 예정' 파생(2026-07-19 spec §4): 미완료 '출고' 일정 중 가장 이른 (날짜, 시간) 1건.
// 날짜 없는 행 제외(표시·정렬 불가) · 같은 날짜의 시간 미지정은 뒤(nulls last) · 과거 날짜도 그대로(콘솔이 "지남" 표시).
// id는 콘솔 팝오버의 수정/삭제 대상 지정용. customer_id 비교는 crm.customers.id 완전정규화(latestTaskBody와 동일 — 섀도잉 버그 클래스).
const nextDeliverySchedule = sql<NextDeliverySchedule | null>`(
  select json_build_object('id', s.id, 'date', s.scheduled_date, 'time', s.scheduled_time)
  from crm.customer_schedules s
  where s.customer_id = crm.customers.id
    and s.type = ${DELIVERY_SCHEDULE_TYPE}
    and s.done = false
    and s.scheduled_date is not null
  order by s.scheduled_date asc, s.scheduled_time asc nulls last, s.created_at asc
  limit 1
)`;
```

타입·select 확장(20행·147행):
```ts
export type CustomerListRow = typeof customers.$inferSelect & { latestTask: string | null; nextDeliverySchedule: NextDeliverySchedule | null };
```
```ts
    .select({ ...getTableColumns(customers), phone: composedPhone, latestTask: latestTaskBody, lastActivityAt: staffActivityAt, nextDeliverySchedule })
```

- [ ] **Step 5: GREEN 확인** — `bun run test:server src/db/queries/customers.next-delivery.test.ts` → 2 pass. 이어서 `bun run test:server` 전체 1회(잔재 tripwire 포함) green 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/db/queries/customers.ts src/db/queries/customers.next-delivery.test.ts src/test-utils/fixture-codes.ts
git commit -m "feat(crm): listCustomers nextDeliverySchedule 파생 — 미완료 '출고' 일정 earliest 서브쿼리"
```

### Task 3: 클라 타입·어댑터 배선

**Files:** Modify `client/src/data/customers.ts:5-39`(Customer 타입) · Modify `client/src/lib/customers.ts:6-33,53-85`

- [ ] **Step 1: Customer 타입 필드 추가** — `client/src/data/customers.ts` `Customer` 타입의 `settlementStatus?` 앞에:

```ts
  deliveryMethod?: string; // need_delivery_method 표시값 — 출고 콘솔 '인도 방식' 컬럼(편집은 상세 니즈에서)
  nextDeliverySchedule?: NextDeliverySchedule | null; // 서버 파생 다음 출고 예정(목록 전용 — 상세엔 schedules 원본이 있다)
```

- [ ] **Step 2: 어댑터 배선** — `client/src/lib/customers.ts`:

임포트 1행을 `import { type Customer, type NextDeliverySchedule } from "@/data/customers";`로. `CustomerRow`에(needModel 근처):
```ts
  needDeliveryMethod: string | null;
  nextDeliverySchedule: NextDeliverySchedule | null;
```
`toCustomer` 반환 객체에(method 근처):
```ts
    deliveryMethod: row.needDeliveryMethod ?? "",
    nextDeliverySchedule: row.nextDeliverySchedule ?? null,
```

- [ ] **Step 3: 검증 + 커밋** — `bun run typecheck && bun run lint && bun run test:unit` green.

```bash
git add client/src/data/customers.ts client/src/lib/customers.ts
git commit -m "feat(crm): 목록 어댑터에 nextDeliverySchedule·deliveryMethod 배선"
```

### Task 4: delivery-console 순수 파생 계층 (TDD)

**Files:** Create `client/src/lib/delivery-console.ts` · Create `client/src/lib/delivery-console.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `client/src/lib/delivery-console.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Customer } from "@/data/customers";
import {
  compareDeliverySchedule,
  DELIVERY_PILL_ALL,
  DELIVERY_PILL_IN_PROGRESS,
  DELIVERY_STAGE_PILLS,
  deliveryCountLabel,
  deliveryPillCounts,
  deliveryScheduleLabel,
  matchesDeliveryPill,
  resolveDeliveryScheduleSubmit,
} from "./delivery-console";

const c = (over: Partial<Customer>): Customer => ({
  no: 1, customerId: "CU-0000-0000", receivedAt: "", assignedAt: "", team: "", name: "t",
  customerType: "", customerTypeDetail: "", phone: "", vehicle: "", method: "", advisor: "미배정",
  statusGroup: "계약완료", status: "딜러사계약중", date: "", source: "", talkCount: "", priority: "",
  nextAction: "", aiSummary: "", ...over,
});

describe("pill 어휘·매칭·카운트", () => {
  it("pill 목록 = 진행 중 + 2차 5종 + 전체 (customerStatusGroups 파생 — 사본 없음)", () => {
    expect(DELIVERY_STAGE_PILLS).toEqual(["진행 중", "딜러사계약중", "대리점발주중", "특판발주중", "배정완료", "출고완료", "전체"]);
  });
  it("진행 중 = 출고완료 제외 4단계, 전체 = 모두, 단계 pill = 정확 일치", () => {
    expect(matchesDeliveryPill(DELIVERY_PILL_IN_PROGRESS, "배정완료")).toBe(true);
    expect(matchesDeliveryPill(DELIVERY_PILL_IN_PROGRESS, "출고완료")).toBe(false);
    expect(matchesDeliveryPill(DELIVERY_PILL_ALL, "출고완료")).toBe(true);
    expect(matchesDeliveryPill("배정완료", "배정완료")).toBe(true);
    expect(matchesDeliveryPill("배정완료", "출고완료")).toBe(false);
  });
  it("카운트: 실측 분포(계약중 2·배정 1·출고완료 4) 재현", () => {
    const statuses = ["딜러사계약중", "딜러사계약중", "배정완료", "출고완료", "출고완료", "출고완료", "출고완료"];
    const counts = deliveryPillCounts(statuses);
    expect(counts["진행 중"]).toBe(3);
    expect(counts["딜러사계약중"]).toBe(2);
    expect(counts["대리점발주중"]).toBe(0);
    expect(counts["출고완료"]).toBe(4);
    expect(counts["전체"]).toBe(7);
  });
  it("카운트 라벨: 진행 중 → '진행', 나머지는 pill 그대로", () => {
    expect(deliveryCountLabel(DELIVERY_PILL_IN_PROGRESS)).toBe("진행");
    expect(deliveryCountLabel(DELIVERY_PILL_ALL)).toBe("전체");
    expect(deliveryCountLabel("출고완료")).toBe("출고완료");
  });
});

describe("정렬 비교기(spec §5.5)", () => {
  const at = (date: string, time: string | null) => c({ nextDeliverySchedule: { id: "s", date, time } });
  it("날짜 오름차순, 미지정은 뒤", () => {
    expect(compareDeliverySchedule(at("2026-07-20", null), at("2026-07-25", null))).toBeLessThan(0);
    expect(compareDeliverySchedule(c({}), at("2026-07-25", null))).toBeGreaterThan(0);
    expect(compareDeliverySchedule(c({}), c({}))).toBe(0);
  });
  it("같은 날짜: 시간 오름차순, 시간 미지정은 그 날짜의 뒤", () => {
    expect(compareDeliverySchedule(at("2026-07-25", "09:00"), at("2026-07-25", "14:00"))).toBeLessThan(0);
    expect(compareDeliverySchedule(at("2026-07-25", null), at("2026-07-25", "09:00"))).toBeGreaterThan(0);
    expect(compareDeliverySchedule(at("2026-07-25", "09:00"), at("2026-07-25", "09:00"))).toBe(0);
  });
});

describe("예정일 라벨(KST 지남 판정 — 브라우저 tz 무관 산술)", () => {
  // now = 2026-07-19 16:00Z = 2026-07-20 01:00 KST → KST 오늘 = 07-20 (UTC 날짜 07-19와 다름 = KST semantics 단언)
  const now = new Date("2026-07-19T16:00:00Z");
  it("KST 오늘 이전이면 overdue, 오늘·미래는 아님", () => {
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-19", time: null }, now)?.overdue).toBe(true);
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-20", time: null }, now)?.overdue).toBe(false);
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-21", time: null }, now)?.overdue).toBe(false);
  });
  it("표시 = M/D (요일) [HH:mm]", () => {
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-24", time: "14:00" }, now)?.text).toBe("7/24 (금) 14:00");
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-25", time: null }, now)?.text).toBe("7/25 (토)");
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-24", time: "14:00:00" }, now)?.text).toBe("7/24 (금) 14:00");
    expect(deliveryScheduleLabel(null, now)).toBeNull();
  });
});

describe("팝오버 제출 해석(spec §5.4)", () => {
  it("날짜 없음 = invalid", () => {
    expect(resolveDeliveryScheduleSubmit(null, { date: " ", time: "" }).kind).toBe("invalid");
  });
  it("대표 일정 없음 = '출고' 일정 생성(type·done 고정)", () => {
    expect(resolveDeliveryScheduleSubmit(null, { date: "2026-07-24", time: "14:00" })).toEqual({
      kind: "create",
      body: { scheduledDate: "2026-07-24", scheduledTime: "14:00", type: "출고", done: false },
    });
    expect(resolveDeliveryScheduleSubmit(null, { date: "2026-07-24", time: " " })).toMatchObject({
      body: { scheduledTime: null },
    });
  });
  it("대표 일정 있음 = 그 id PATCH(날짜·시간만)", () => {
    expect(resolveDeliveryScheduleSubmit({ id: "sch-1", date: "2026-07-20", time: null }, { date: "2026-07-24", time: "" })).toEqual({
      kind: "update", id: "sch-1", body: { scheduledDate: "2026-07-24", scheduledTime: null },
    });
  });
});
```

- [ ] **Step 2: RED 확인** — `bun run test:unit client/src/lib/delivery-console.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `client/src/lib/delivery-console.ts`:

```ts
import { customerStatusGroups, DELIVERY_SCHEDULE_TYPE, type Customer, type NextDeliverySchedule } from "@/data/customers";

// ── 출고 작업 큐 파생(2026-07-19 spec §5) — 전부 순수 함수. ──

// 출고 단계 = 계약완료 2차 상태(customerStatusGroups SSOT) 파생 — 어휘 사본을 만들지 않는다.
// (모듈 밖에선 DELIVERY_STAGE_PILLS만 쓰므로 아래 3개는 비공개 — knip baseline 오염 방지.)
const DELIVERY_STAGES: readonly string[] = customerStatusGroups["계약완료"];
const DELIVERY_DONE_STAGE = "출고완료";
const DELIVERY_IN_PROGRESS_STAGES: readonly string[] = DELIVERY_STAGES.filter((s) => s !== DELIVERY_DONE_STAGE);

// pill 어휘. 기본 = 진행 중 — 업무함은 소진되는 큐(#260 선례, spec D8).
export const DELIVERY_PILL_IN_PROGRESS = "진행 중";
export const DELIVERY_PILL_ALL = "전체";
export const DELIVERY_STAGE_PILLS: readonly string[] = [DELIVERY_PILL_IN_PROGRESS, ...DELIVERY_STAGES, DELIVERY_PILL_ALL];

export function matchesDeliveryPill(pill: string, status: string): boolean {
  if (pill === DELIVERY_PILL_ALL) return true;
  if (pill === DELIVERY_PILL_IN_PROGRESS) return DELIVERY_IN_PROGRESS_STAGES.includes(status);
  return status === pill;
}

export function deliveryPillCounts(statuses: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const pill of DELIVERY_STAGE_PILLS) counts[pill] = 0;
  for (const status of statuses) {
    for (const pill of DELIVERY_STAGE_PILLS) if (matchesDeliveryPill(pill, status)) counts[pill] += 1;
  }
  return counts;
}

// 헤드바 카운트 라벨 — 기본 필터(진행 중)에 "전체 N명" 고정 라벨을 쓰면 오독(spec §5.1).
export function deliveryCountLabel(pill: string): string {
  return pill === DELIVERY_PILL_IN_PROGRESS ? "진행" : pill;
}

// 정렬: 예정일 오름차순 · 미지정 뒤 · 같은 날짜의 시간 미지정 뒤 · 동률 0(sort 안정성으로 기존 순서 유지).
export function compareDeliverySchedule(a: Customer, b: Customer): number {
  const sa = a.nextDeliverySchedule ?? null;
  const sb = b.nextDeliverySchedule ?? null;
  if (!sa && !sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;
  if (sa.date !== sb.date) return sa.date < sb.date ? -1 : 1;
  if (sa.time === sb.time) return 0;
  if (sa.time == null) return 1;
  if (sb.time == null) return -1;
  return sa.time < sb.time ? -1 : 1;
}

const KST_OFFSET_MS = 9 * 3_600_000;

// KST 오늘 날짜 문자열(YYYY-MM-DD). 지남 판정에 브라우저 로컬 tz 금지(#204 파리티 부류) —
// getTime+toISOString 산술이라 실행 환경 tz에 전혀 의존하지 않는다. (라벨 함수 내부 전용 — 비공개.)
function kstTodayDateString(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 셀 표시 라벨: "M/D (요일)" + 시간(있을 때만 HH:mm). 미완료 대표 일정이 KST 오늘 이전이면 overdue("지남").
export function deliveryScheduleLabel(
  schedule: NextDeliverySchedule | null | undefined,
  now: Date,
): { text: string; overdue: boolean } | null {
  if (!schedule) return null;
  const [y, m, d] = schedule.date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const weekday = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const time = schedule.time ? ` ${schedule.time.slice(0, 5)}` : "";
  return { text: `${m}/${d} (${weekday})${time}`, overdue: schedule.date < kstTodayDateString(now) };
}

// 팝오버 제출 해석: 대표 일정 있으면 그 행 PATCH, 없으면 '출고' 일정 생성. 날짜 필수(fail-loud).
export type DeliveryScheduleSubmit =
  | { kind: "create"; body: { scheduledDate: string; scheduledTime: string | null; type: string; done: false } }
  | { kind: "update"; id: string; body: { scheduledDate: string; scheduledTime: string | null } }
  | { kind: "invalid"; reason: string };

export function resolveDeliveryScheduleSubmit(
  existing: NextDeliverySchedule | null | undefined,
  draft: { date: string; time: string },
): DeliveryScheduleSubmit {
  const date = draft.date.trim();
  if (!date) return { kind: "invalid", reason: "날짜를 선택해 주세요." };
  const time = draft.time.trim() ? draft.time.trim() : null;
  if (existing) return { kind: "update", id: existing.id, body: { scheduledDate: date, scheduledTime: time } };
  return { kind: "create", body: { scheduledDate: date, scheduledTime: time, type: DELIVERY_SCHEDULE_TYPE, done: false } };
}
```

- [ ] **Step 4: GREEN 확인** — `bun run test:unit client/src/lib/delivery-console.test.ts` → 전부 pass. `bun run typecheck && bun run lint` 0.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/delivery-console.ts client/src/lib/delivery-console.test.ts
git commit -m "feat(crm): delivery-console 순수 파생 계층 — pill·정렬·KST 라벨·제출 해석 (TDD)"
```

### Task 5: 콘솔 컬럼·단계 전이 셀 (delivery renderRow 분기)

**Files:** Modify `client/src/pages/CustomerManagementRow.tsx:109-216` · Modify `client/src/pages/CustomerManagementPage.tsx:55,64,814-829` · Modify `client/src/pages/CustomerManagementPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성** — `CustomerManagementPage.test.tsx`에 추가(파일의 기존 render 헬퍼·쿼리 관례를 따른다. mock initialCustomers에 계약완료 3명 존재: 최유진 출고완료·한지훈 배정완료·김도현 없음 — 5월 시드 기준은 최유진·한지훈):

```tsx
describe("출고 관리(delivery) 콘솔", () => {
  it("헤더 = 선택/고객/차량/출고 단계/출고 예정/인도 방식/담당/관리", () => {
    render(<CustomerManagementPage mode="delivery" />);
    const heads = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(heads).toEqual(["선택", "고객", "차량", "출고 단계", "출고 예정", "인도 방식", "담당", "관리"]);
  });

  it("출고 단계 셀 = 2차 상태 버튼(1차 버튼 없음), 팝오버 옵션 = 계약완료 2차 5종", async () => {
    render(<CustomerManagementPage mode="delivery" />);
    // 전체 pill로 전환해 출고완료 포함 전 행 노출(Task 6 이후 기본 = 진행 중)
    const stageButton = screen.getByRole("button", { name: "진행 2단계 변경: 배정완료" });
    expect(screen.queryByRole("button", { name: "진행 1단계 변경: 계약완료" })).toBeNull();
    fireEvent.click(stageButton);
    const listbox = screen.getByRole("listbox", { name: "진행 2단계 선택" });
    const options = within(listbox).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["딜러사계약중", "대리점발주중", "특판발주중", "배정완료", "출고완료"]);
  });
});
```
(주의: Task 6 이전엔 기본 pill 미구현이라 두 번째 테스트의 "전체 전환" 주석은 해당 없음 — Task 6에서 이 describe에 pill 테스트를 추가하며 정합화한다.)

- [ ] **Step 2: RED 확인** — `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx`
Expected: FAIL (헤더가 구 배열, 1차 버튼 존재).

- [ ] **Step 3: heads/columns 교체** — `CustomerManagementPage.tsx:55,64`:

```ts
  delivery: ["선택", "고객", "차량", "출고 단계", "출고 예정", "인도 방식", "담당", "관리"],
```
```ts
  delivery: ["select", "customer", "vehicle", "stage", "schedule", "method", "advisor", "actions"],
```

- [ ] **Step 4: CustomerStageCell `secondaryOnly` prop** — `CustomerManagementRow.tsx:109-216`: props에 `secondaryOnly = false`(타입 `secondaryOnly?: boolean`) 추가, 1차 컨트롤+커넥터를 게이트:

```tsx
      <div className="stage-two-step-stack" ref={pickerLevel ? stagePickerRef : undefined}>
        {!secondaryOnly && (
          <>
            <div className="stage-control">
              {/* …기존 1차 버튼+primary 팝오버 블록 그대로… */}
            </div>
            <span aria-hidden="true" className="stage-step-connector">›</span>
          </>
        )}
        <div className="stage-control">
          {/* …기존 2차 버튼+secondary 팝오버 블록 그대로(무수정) — 옵션은 statusGroup(계약완료) 종속 5종이 자동 */}
        </div>
      </div>
```

- [ ] **Step 5: renderRow delivery 분기 신설** — `CustomerManagementPage.tsx`의 settlement 분기(:798-812) 바로 뒤에(generic 분기 앞). 출고 예정 셀은 이 단계에선 **표시 전용**(팝오버는 Task 7):

```tsx
    if (mode === "delivery") {
      const scheduleLabel = deliveryScheduleLabel(customer.nextDeliverySchedule, new Date());
      return (
        <tr key={customer.no} {...rowProps}>
          {check}
          {customerCell}
          {vehicleCell}
          <CustomerStageCell customer={customer} onChangePrimary={changeTwoStepPrimaryStage} onChangeSecondary={changeTwoStepSecondaryStage} onOpenPicker={openTwoStepStagePicker} pickerLevel={twoStepPickerOpen} secondaryOnly stagePickerRef={stagePickerRef} />
          <td>{scheduleLabel ? scheduleLabel.text : <span className="table-note">미지정</span>}</td>
          <td>{customer.deliveryMethod || "—"}</td>
          {showAdvisorColumn && <td><strong>{customer.advisor}</strong><span className="table-note">{customer.team}</span></td>}
          {actions}
        </tr>
      );
    }
```
페이지 임포트에 `import { deliveryScheduleLabel } from "@/lib/delivery-console";` 추가(다음 태스크들이 같은 모듈에서 추가 심볼을 가져온다).

- [ ] **Step 6: GREEN + 기존 정합 테스트 확인** — `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx` 전체 pass(#248 헤더=바디 정합 포함 — delivery 분기 셀 수 = 헤더 수, advisor 필터 대칭 유지).

- [ ] **Step 7: 검증 + 커밋** — `bun run typecheck && bun run lint` 0.

```bash
git add client/src/pages/CustomerManagementRow.tsx client/src/pages/CustomerManagementPage.tsx client/src/pages/CustomerManagementPage.test.tsx
git commit -m "feat(crm): 출고 콘솔 컬럼·단계 전이 셀 — CustomerStageCell secondaryOnly 재사용"
```

### Task 6: 출고 단계 필터 pill·정렬·카운트 라벨

**Files:** Modify `client/src/pages/CustomerManagementPage.tsx:26-38(props),113-119(state),176-205(rows),904-969(toolbar)` · Modify `client/src/App.tsx:325-341` · Modify `client/src/data/customers.ts:144` · Modify `client/src/pages/CustomerManagementPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성** — Task 5의 describe에 추가:

```tsx
  it("기본 pill = 진행 중: 출고완료(최유진) 미노출, 배정완료(한지훈) 노출", () => {
    render(<CustomerManagementPage mode="delivery" />);
    expect(screen.getByText("한지훈")).toBeInTheDocument();
    expect(screen.queryByText("최유진")).toBeNull();
  });

  it("출고완료 pill 클릭 시 출고완료만 노출 + 카운트 라벨 전환", () => {
    render(<CustomerManagementPage mode="delivery" />);
    fireEvent.click(screen.getByRole("button", { name: /^출고완료 \d+$/ }));
    expect(screen.getByText("최유진")).toBeInTheDocument();
    expect(screen.queryByText("한지훈")).toBeNull();
    expect(screen.getByText("출고완료", { selector: ".total-count" })).toBeInTheDocument();
  });

  it("delivery mode에선 mock 뷰 select 3개가 렌더되지 않는다", () => {
    render(<CustomerManagementPage mode="delivery" />);
    expect(screen.queryByRole("button", { name: /담당자별 보기/ })).toBeNull();
  });
```
(총 카운트 단언 selector는 파일 기존 관례에 맞춰 조정 — `.total-count` 텍스트가 "진행 N명"→"출고완료 N명"으로 바뀌는 것을 잠근다.)

- [ ] **Step 2: RED 확인** — `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx` FAIL.

- [ ] **Step 3: 구현** — `CustomerManagementPage.tsx`:

props 타입에 `customersLoaded?: boolean;` 추가, 구조분해에 `customersLoaded`(기본값 없음) 추가 후 `const loaded = customersLoaded ?? true;`(#287 폴리시 — 미전달(스토리·테스트)은 true).

임포트 확장:
```ts
import { compareDeliverySchedule, DELIVERY_PILL_IN_PROGRESS, DELIVERY_STAGE_PILLS, deliveryCountLabel, deliveryPillCounts, deliveryScheduleLabel, matchesDeliveryPill } from "@/lib/delivery-console";
```

state 추가(:119 근처): `const [deliveryPill, setDeliveryPill] = useState<string>(DELIVERY_PILL_IN_PROGRESS);`

rows 재구성(:176-205) — 기존 `rows` useMemo를 `baseRows`로 리네임하고 아래를 추가(이후 참조는 전부 `rows` 그대로):
```ts
  const rows = useMemo(() => {
    if (mode !== "delivery") return baseRows;
    // pill 필터 + 예정일 정렬. filter가 새 배열이라 sort in-place 안전, 동률은 sort 안정성으로 baseRows 순서(receivedAt desc) 유지.
    return baseRows.filter((customer) => matchesDeliveryPill(deliveryPill, customer.status)).sort(compareDeliverySchedule);
  }, [baseRows, deliveryPill, mode]);
  // pill 카운트는 pill 적용 전(검색·담당 등 다른 필터는 적용 후) 집합 기준 — 분포와 현재 선택이 함께 보인다.
  const deliveryCounts = useMemo(() => (mode === "delivery" ? deliveryPillCounts(baseRows.map((c) => c.status)) : null), [baseRows, mode]);
```

toolbar total-count(:909) 교체:
```tsx
            <div className="total-count">{mode === "delivery" ? deliveryCountLabel(deliveryPill) : "전체"} <strong className="num">{loaded ? rows.length : ""}</strong><span>명</span></div>
```

list-view-controls(:941-969)의 비-all 분기를 3갈래로:
```tsx
              {isAllMode ? (
                <>{/* …기존 chance/finalUpdate pill 그대로… */}</>
              ) : mode === "delivery" ? (
                <>
                  {/* 출고 단계 필터 pill — no-op 뷰 select 대체(spec D4·D8). 다른 mode의 mock 뷰는 불변. */}
                  {DELIVERY_STAGE_PILLS.map((pill) => (
                    <button
                      aria-pressed={deliveryPill === pill}
                      className={filterSelectClass(deliveryPill === pill, "view-select filter-compact")}
                      key={pill}
                      onClick={() => { setDeliveryPill(pill); setCurrentPage(1); }}
                      type="button"
                    >
                      <span>{loaded && deliveryCounts ? `${pill} ${deliveryCounts[pill] ?? 0}` : pill}</span>
                    </button>
                  ))}
                </>
              ) : (
                <>{/* …기존 mock 뷰 select 3개 그대로… */}</>
              )}
```

- [ ] **Step 4: App 배선 + 서브타이틀** — `App.tsx` `/customers` Route의 `CustomerManagementPage`에 `customersLoaded={customersLoaded}` 추가. `data/customers.ts:144`:
```ts
  delivery: { title: "출고 관리", desc: "계약완료 고객의 발주·배정·출고 일정을 단계별로 처리합니다." },
```

- [ ] **Step 5: GREEN 확인** — 페이지 테스트 전체 + `bun run test:unit` green(다른 mode 카운트 문구 "전체 N명" 불변 — 기존 테스트가 지킨다).

- [ ] **Step 6: 검증 + 커밋** — `bun run typecheck && bun run lint` 0.

```bash
git add client/src/pages/CustomerManagementPage.tsx client/src/pages/CustomerManagementPage.test.tsx client/src/App.tsx client/src/data/customers.ts
git commit -m "feat(crm): 출고 단계 필터 pill·예정일 정렬·카운트 라벨 — 기본 진행 중 업무함"
```

### Task 7: 출고 예정 팝오버 (생성/수정/삭제)

**Files:** Modify `client/src/pages/CustomerManagementRow.tsx`(셀 컴포넌트 신설) · Modify `client/src/pages/CustomerManagementPage.tsx`(state·핸들러·외부닫기·renderRow 셀 교체·`isTableControlTarget`) · Modify `client/src/styles/customer-console.css` · Modify `client/src/pages/CustomerManagementPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성** — 페이지 테스트에 추가. `customer-children`을 모킹하고 controlled customers(목업 행엔 id가 없어 저장이 방어됨)로 렌더:

```tsx
vi.mock("@/lib/customer-children", () => ({
  addSchedule: vi.fn().mockResolvedValue({ id: "sch-new", createdAt: "2026-07-19T00:00:00Z" }),
  updateSchedule: vi.fn().mockResolvedValue(undefined),
  deleteSchedule: vi.fn().mockResolvedValue(undefined),
}));
// (파일 상단 관례 위치에. 기존 다른 mock과 형식을 맞춘다.)

  it("미지정 클릭 → 팝오버에서 날짜 저장 = '출고' 일정 생성 호출", async () => {
    const { addSchedule } = await import("@/lib/customer-children");
    const customers = [{
      ...initialCustomers[4], // 한지훈(배정완료) 형태 복제
      id: "cid-1", no: 90001, customerId: "CU-2605-9001", name: "출고팝오버검증",
      statusGroup: "계약완료", status: "배정완료", nextDeliverySchedule: null,
    }];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^출고 예정 입력:/ }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-07-24" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(addSchedule).toHaveBeenCalledWith("cid-1", { scheduledDate: "2026-07-24", scheduledTime: null, type: "출고", done: false });
    });
  });

  it("대표 일정 있는 행 = 라벨 표시 + 저장 시 그 id PATCH", async () => {
    const { updateSchedule } = await import("@/lib/customer-children");
    const customers = [{
      ...initialCustomers[4],
      id: "cid-2", no: 90002, customerId: "CU-2605-9002", name: "출고팝오버수정",
      statusGroup: "계약완료", status: "배정완료",
      nextDeliverySchedule: { id: "sch-1", date: "2026-07-24", time: "14:00" },
    }];
    render(<CustomerManagementPage customers={customers} mode="delivery" onCustomersChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^출고 예정 7\/24/ }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-07-31" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith("cid-2", "sch-1", { scheduledDate: "2026-07-31", scheduledTime: "14:00" });
    });
  });
```

- [ ] **Step 2: RED 확인** — 해당 테스트 FAIL(팝오버 미구현 — Task 5의 표시 전용 셀).

- [ ] **Step 3: 셀 컴포넌트 구현** — `CustomerManagementRow.tsx`에 추가(파일 임포트에 `useState`, `deliveryScheduleLabel`, `type NextDeliverySchedule` 추가):

```tsx
export function CustomerDeliveryScheduleCell({
  customer,
  notice,
  open,
  popoverRef,
  saving,
  onDelete,
  onSave,
  onToggle,
}: {
  customer: Customer;
  notice: string | null;
  open: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  saving: boolean;
  onDelete: () => void;
  onSave: (draft: { date: string; time: string }) => void;
  onToggle: () => void;
}) {
  const schedule = customer.nextDeliverySchedule ?? null;
  const label = deliveryScheduleLabel(schedule, new Date());
  return (
    <td className="delivery-schedule-cell">
      <div className="delivery-schedule-wrap" ref={open ? popoverRef : undefined}>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={label ? `출고 예정 ${label.text}: ${customer.name}` : `출고 예정 입력: ${customer.name}`}
          className={["delivery-schedule-btn", label ? "" : "empty", label?.overdue ? "overdue" : ""].filter(Boolean).join(" ")}
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
          onPointerDown={stopTableControlPointer}
          type="button"
        >
          <span>{label ? label.text : "+ 미지정"}</span>
          {label?.overdue && <span className="delivery-overdue-badge">지남</span>}
        </button>
        {open && (
          <DeliverySchedulePopover key={schedule?.id ?? "new"} initial={schedule} notice={notice} saving={saving} onDelete={onDelete} onSave={onSave} />
        )}
      </div>
    </td>
  );
}

// 팝오버 본문 — key(schedule id)로 리마운트해 draft를 대표 일정 값으로 재시드. date/time input이라 Safari select 함정 무관.
function DeliverySchedulePopover({ initial, notice, saving, onDelete, onSave }: {
  initial: NextDeliverySchedule | null;
  notice: string | null;
  saving: boolean;
  onDelete: () => void;
  onSave: (draft: { date: string; time: string }) => void;
}) {
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time?.slice(0, 5) ?? "");
  return (
    <div aria-label="출고 예정 편집" className="delivery-schedule-popover" onClick={(event) => event.stopPropagation()} role="dialog">
      <label><span>날짜</span><input onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
      <label><span>시간</span><input onChange={(event) => setTime(event.target.value)} type="time" value={time} /></label>
      {notice && <p className="delivery-schedule-notice" role="alert">{notice}</p>}
      <div className="delivery-schedule-actions">
        {initial && <button className="danger" disabled={saving} onClick={onDelete} type="button">삭제</button>}
        <button disabled={saving} onClick={() => onSave({ date, time })} type="button">{saving ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 페이지 state·핸들러·외부닫기** — `CustomerManagementPage.tsx`:

임포트: `import { addSchedule, deleteSchedule, updateSchedule } from "@/lib/customer-children";` + delivery-console 임포트에 `resolveDeliveryScheduleSubmit` 추가 + `import type { NextDeliverySchedule } from "@/data/customers";` + Row 임포트에 `CustomerDeliveryScheduleCell`.

state/ref(:119·:128 근처):
```ts
  const [openDeliveryScheduleFor, setOpenDeliveryScheduleFor] = useState<number | null>(null);
  const [savingDeliveryFor, setSavingDeliveryFor] = useState<number | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const deliverySchedulePopoverRef = useRef<HTMLDivElement>(null);
```

`isTableControlTarget`(:254)의 closest 셀렉터에 `.delivery-schedule-wrap` 추가:
```ts
    return target instanceof Element && Boolean(target.closest(".stage-control, .chance-control, .extra-count-pill, .final-update-control, .delivery-schedule-wrap"));
```

외부닫기 effect — 기존 `closeStagePicker` effect(:259-293)와 **동일 형태**(suppressOutsideClickRef + isTableControlTarget + Escape)로 `openDeliveryScheduleFor` 대상 effect를 그 옆에 추가:
```ts
  useEffect(() => {
    if (openDeliveryScheduleFor === null) return;

    function closeDeliverySchedule(event: PointerEvent) {
      if (deliverySchedulePopoverRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenDeliveryScheduleFor(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeDeliveryScheduleByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenDeliveryScheduleFor(null);
    }

    document.addEventListener("pointerdown", closeDeliverySchedule, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeDeliveryScheduleByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeDeliverySchedule, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeDeliveryScheduleByKeyboard);
    };
  }, [openDeliveryScheduleFor]);
```

토글(다른 행 popover들과 배타 — `toggleExtraPopover` 문법 미러) + 다른 popover 토글 4곳(`openTwoStepStagePicker`·`toggleChancePopover`·`toggleExtraPopover`·`toggleFinalUpdatePopover`)에도 `setOpenDeliveryScheduleFor(null)` 한 줄씩 추가:
```ts
  function toggleDeliverySchedulePopover(customerNo: number) {
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor(null);
    setDeliveryNotice(null);
    setOpenDeliveryScheduleFor((current) => (current === customerNo ? null : customerNo));
  }
```

저장/삭제(낙관 갱신 + fail-loud. `customer-children`이 상세 캐시 무효화를 이미 수행 — 드로어 정합 자동):
```ts
  async function saveDeliverySchedule(customer: Customer, draft: { date: string; time: string }) {
    const submit = resolveDeliveryScheduleSubmit(customer.nextDeliverySchedule ?? null, draft);
    if (submit.kind === "invalid") { setDeliveryNotice(submit.reason); return; }
    if (!customer.id) { setDeliveryNotice("목업 행에는 저장할 수 없습니다."); return; }
    const cid = customer.id;
    setSavingDeliveryFor(customer.no);
    setDeliveryNotice(null);
    try {
      let next: NextDeliverySchedule;
      if (submit.kind === "create") {
        const created = await addSchedule(cid, submit.body);
        next = { id: created.id, date: submit.body.scheduledDate, time: submit.body.scheduledTime };
      } else {
        await updateSchedule(cid, submit.id, submit.body);
        next = { id: submit.id, date: submit.body.scheduledDate, time: submit.body.scheduledTime };
      }
      updateCustomers((current) => current.map((c) => (c.no === customer.no ? { ...c, nextDeliverySchedule: next } : c)));
      setOpenDeliveryScheduleFor(null);
    } catch {
      setDeliveryNotice("출고 예정 저장에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setSavingDeliveryFor(null);
    }
  }

  async function deleteDeliverySchedule(customer: Customer) {
    const schedule = customer.nextDeliverySchedule;
    if (!schedule || !customer.id) return;
    setSavingDeliveryFor(customer.no);
    setDeliveryNotice(null);
    try {
      await deleteSchedule(customer.id, schedule.id);
      // 대표 1건 통로(spec §5.4): 다른 미완료 '출고' 일정이 있으면 다음 서버 리로드에서 그 행이 대표로 승계.
      updateCustomers((current) => current.map((c) => (c.no === customer.no ? { ...c, nextDeliverySchedule: null } : c)));
      setOpenDeliveryScheduleFor(null);
    } catch {
      setDeliveryNotice("출고 예정 삭제에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setSavingDeliveryFor(null);
    }
  }
```

renderRow delivery 분기의 표시 전용 `<td>`를 셀 컴포넌트로 교체:
```tsx
          <CustomerDeliveryScheduleCell
            customer={customer}
            notice={openDeliveryScheduleFor === customer.no ? deliveryNotice : null}
            open={openDeliveryScheduleFor === customer.no}
            popoverRef={deliverySchedulePopoverRef}
            saving={savingDeliveryFor === customer.no}
            onDelete={() => void deleteDeliverySchedule(customer)}
            onSave={(draft) => void saveDeliverySchedule(customer, draft)}
            onToggle={() => toggleDeliverySchedulePopover(customer.no)}
          />
```
(Task 5에서 넣은 `deliveryScheduleLabel` 직접 호출·`scheduleLabel` 변수는 셀 컴포넌트로 이동했으므로 제거.)

- [ ] **Step 5: CSS** — `client/src/styles/customer-console.css` 끝에(신규 클래스만 — 기존 규칙 불변, 캐스케이드 영향 0):

```css
/* 출고 예정 셀(delivery mode) — 값/미지정/지남 버튼 + 편집 팝오버 (2026-07-19 출고 콘솔 1단계) */
.delivery-schedule-wrap { position: relative; display: inline-flex; }
.delivery-schedule-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 9px; border-radius: 6px;
  border: 1px solid #dededb; background: #fff; font-size: 12px; color: #3f4750;
  box-shadow: 0 1px 1.5px rgba(15, 20, 25, 0.06); cursor: pointer;
}
.delivery-schedule-btn.empty { border-style: dashed; color: #9aa1a9; }
.delivery-schedule-btn.overdue { border-color: #f3c1c1; background: #fdf0f0; color: #c0392b; }
.delivery-schedule-btn:hover { border-color: rgba(88, 54, 255, 0.34); }
.delivery-overdue-badge { font-size: 10px; font-weight: 700; }
.delivery-schedule-popover {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 60;
  display: grid; gap: 8px; min-width: 220px; padding: 12px;
  background: #fff; border: 1px solid var(--line, #dededb); border-radius: 12px;
  box-shadow: 0 12px 28px rgba(15, 20, 25, 0.16);
}
.delivery-schedule-popover label { display: grid; gap: 4px; font-size: 11px; color: #6b7280; }
.delivery-schedule-popover input { height: 28px; border: 1px solid #dededb; border-radius: 6px; padding: 0 8px; font-size: 12px; }
.delivery-schedule-notice { margin: 0; font-size: 11px; color: #c0392b; }
.delivery-schedule-actions { display: flex; justify-content: flex-end; gap: 6px; }
.delivery-schedule-actions button { height: 26px; padding: 0 10px; border-radius: 6px; border: 1px solid #dededb; background: #fff; font-size: 12px; cursor: pointer; }
.delivery-schedule-actions button.danger { color: #c0392b; border-color: #f3c1c1; }
```
(픽셀 톤은 스모크에서 이웃 팝오버(advisor-change-confirm·stage popover)와 눈 대조 — 과도 편차만 보정.)

- [ ] **Step 6: GREEN 확인** — `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx` 전부 pass.

- [ ] **Step 7: 검증 + 커밋** — `bun run typecheck && bun run lint && bun run test:unit` green.

```bash
git add client/src/pages/CustomerManagementRow.tsx client/src/pages/CustomerManagementPage.tsx client/src/pages/CustomerManagementPage.test.tsx client/src/styles/customer-console.css
git commit -m "feat(crm): 출고 예정 팝오버 — 일정 '출고' 생성/수정/삭제(콘솔 통로, 기존 CRUD 재사용)"
```

### Task 8: "계약 / 출고" 목업(B) 제거 — 진입점 단일화

**Files:** Modify `client/src/App.tsx:34,45(VIEW_TO_PATH),69(viewMeta),205-208,365(Route)` · Modify `client/src/components/Sidebar.tsx:25,55,231` · Delete `client/src/pages/DeliveryPage.tsx`

- [ ] **Step 1: App 정리** — `ViewKey` 유니온에서 `"delivery"` 제거 → 컴파일러가 나머지 지점을 전부 가리킨다: `VIEW_TO_PATH`의 `delivery: "/delivery",` 삭제 · `viewMeta`의 `delivery: [...]` 삭제 · `<Route path="/delivery" .../>` 삭제 · `DeliveryPage` 임포트 삭제. `handleViewChange`(:205)는 구 문자열을 출고 큐로 리라우트(spec §5.6 — Topbar 알림 목업 "계약/출고"가 이 뷰 키를 보낸다, Topbar 무변경):

```ts
  function handleViewChange(view: string) {
    setCustomerDetailEditorOpen(false);
    // 구 "계약 / 출고" 뷰(알림 목업 이동처) — DeliveryPage 제거 후 출고 큐로 보낸다(2026-07-19 spec §5.6).
    if (view === "delivery") { navigate(customerListPath("delivery")); return; }
    navigate(VIEW_TO_PATH[view as ViewKey] ?? "/");
  }
```

- [ ] **Step 2: Sidebar 정리** — `:231` "계약 / 출고" 버튼 삭제 · `MenuIconName` 유니온에서 `"delivery"` 제거 · `:55` delivery 아이콘 분기 삭제. `grep -n "delivery" client/src/components/Sidebar.tsx`로 잔여 0 확인(고객 관리 서브메뉴는 `customerModeMeta` 파생이라 무관).

- [ ] **Step 3: 파일 삭제 + 잔여 참조 0 확인**

```bash
git rm client/src/pages/DeliveryPage.tsx
grep -rn "DeliveryPage\|\"/delivery\"" client/src/ ; echo "exit=$?"
```
Expected: 매치 0(exit=1). `/delivery` 직접 접근 = 기존 catch-all 홈 폴백(#259 선례 — 추가 코드 0).

- [ ] **Step 4: 검증 + 커밋** — `bun run typecheck && bun run lint && bun run test:unit && bun run build` green + `bunx knip`이 기존 baseline(unused export 7·type 9) 대비 신규 0 확인.

```bash
git add -A client/src
git commit -m "feat(crm): 상단 '계약 / 출고' 목업 제거 — 출고 진입점을 고객관리 출고 큐로 단일화"
```

### Task 9: pending 항목 13 등재

**Files:** Modify `ref/director-pending-confirmations.md`

- [ ] **Step 1: 파일을 읽고 기존 항목 서식에 맞춰** 항목 13 추가(아래 내용, 번호·헤더 서식은 파일 관례를 따른다. PR 번호는 Task 10에서 PR 생성 후 실제 번호로 채운다):

> **13. 출고 관리 콘솔 1단계 — 유슨생 주도 구현 가정 5건 (2026-07-19, spec `ref/specs/2026-07-19-crm-delivery-console-design.md`)**
> 이사님 브레인스토밍 대기 해제 합의에 따른 대체 가정(전부 가역): ①출고 큐 = 계약완료 2차 상태 파생(별도 출고 레코드·DV 채번 없음 — DV는 미개봉 유지) ②출고 예정일 = 일정 어휘 '출고'(새 컬럼 아님, 마이그 0035) ③기본 필터 = 진행 중(출고완료 제외, pill로 조회) ④상단 메뉴 "계약 / 출고"(하드코딩 목업) 제거 — 진입점 = 고객 관리 › 출고 관리 단일화 ⑤delivery 목록 "출고 업무"(AI 힌트 평문) 컬럼 → 관리 컬럼 AI 버튼으로 흡수. 2단계(계약일·금융사 등 얇은 테이블·DV 채번)는 이사님 브레인스토밍 후.

- [ ] **Step 2: 커밋**

```bash
git add ref/director-pending-confirmations.md
git commit -m "docs(crm): 이사님 확인 대기 항목 13 — 출고 콘솔 1단계 가정 5건"
```

### Task 10: 통합 검증 + 격리 스택 스모크 + PR

- [ ] **Step 1: 통합 검증**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun run build && bun run test:server
```
Expected: 전부 green(unit 852+신규 · server 582+2).

- [ ] **Step 2: 격리 스택 스모크**(사용자 dev 불가침 — #158 선례: 임시 포트 API + vite. 부작용 게이트 off로 띄운다):

```bash
EMBED_ON_WRITE=off AI_HINT_ON_WRITE=off PUSH_NOTIFY=off PORT=8799 bun run src/local-dev.ts   # 백그라운드
# vite는 임시 config로 5174 + /api 프록시 8799 (tools/ 임시 config — 종료 후 삭제)
```
magiclink admin 세션(브리프 "로컬 브라우저 스모크 로그인 우회" 절차)으로:
1. 고객관리 › 출고 관리 진입 → pill 카운트를 psql `select status, count(*) from crm.customers where status_group='계약완료' group by 1;`과 대조.
2. `[+ 고객 등록]`으로 스모크 고객 생성(이름 `CU-SMOKE` 규칙 무관 — 코드는 실채번이므로 **UI 삭제로 원복**하는 전제) → 전체보기에서 진행 상태를 계약완료/딜러사계약중으로 전이 → 출고 관리에 노출 확인.
3. 그 행에서 단계 전이 딜러사계약중 → 배정완료 → psql `status` 대조. pill 카운트 즉시 갱신 확인.
4. 출고 예정 팝오버로 날짜+시간 저장 → psql `select scheduled_date, scheduled_time, type, done from crm.customer_schedules where customer_id='<id>';` 대조 → 상세 드로어 일정 섹션에 '출고' 일정 동시 표시 확인 → 정렬(그 행이 예정일 순서 자리로 이동) 확인 → "지남" 표시는 과거 날짜로 수정해 확인.
5. 사이드바에 "계약 / 출고" 부재 + `/delivery` 직접 접근 홈 폴백 + Topbar 알림 "계약/출고" 행 클릭 → 출고 관리 도착 확인.
6. **원복**: 스모크 고객 UI 하드 삭제(admin — cascade로 일정·임베딩 소멸) → `bun run check:residue` 0 확인. 실 고객(김민준·한지훈 등)은 일절 건드리지 않는다.

- [ ] **Step 3: PR 생성** — squash 전제, 본문에 **[skip ci] 금지**:

```bash
git push -u origin feat/crm-delivery-console
gh pr create --title "feat(crm): 출고 관리 콘솔 1단계 — 계약완료 2차 상태 작업 큐 실동작화" --body "$(cat <<'EOF'
## 요약
- 고객관리 › 출고 관리를 출고 작업 큐로 실동작화: 단계 필터 pill(기본 진행 중)·단계 전이(기존 컨트롤 재사용)·출고 예정 팝오버(일정 어휘 '출고', 마이그 0035)·인도 방식 표시·예정일 정렬.
- 서버 변경 2개뿐: listCustomers nextDeliverySchedule 서브쿼리 + CHECK 마이그(전이·일정 CRUD는 기존 라우트 재사용).
- 상단 "계약 / 출고" 하드코딩 목업(DeliveryPage) 제거 — 진입점 단일화(알림 목업은 출고 큐로 리라우트).

## 🟡 행위 변경(이사님 사후 공유 — pending 항목 13)
가정 5건: 2차 상태 파생 큐(DV 미개봉)·예정일=일정 어휘·기본 필터 진행 중·"계약 / 출고" 메뉴 제거·"출고 업무" 컬럼 → AI 버튼 흡수.

## 검증
typecheck 0 · lint 0 · unit(신규: delivery-console 유닛·페이지 delivery 테스트) · server(신규: next-delivery 2) · build · 격리 스택 브라우저 스모크(전이·팝오버 psql 대조·원복·잔재 0).

spec: ref/specs/2026-07-19-crm-delivery-console-design.md
plan: ref/plans/2026-07-19-crm-delivery-console.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: pending 항목 13에 실제 PR 번호 기입 커밋** 후 유슨생 최종 확인 → 지시 시 squash 머지(+브랜치 삭제).

---

## 알려진 함정 체크리스트 (실행자 필독)

- **`db:push` 금지** — 마이그는 `db:generate` → `db:migrate`만(crm schemaFilter).
- **서버 테스트는 `bun run test:server [파일]`** — 직접 `bun test` 금지(게이트 3규칙: 실 Gemini·실 알림 위험).
- **픽스처 registry 선등록**(`CU-DLVR-`) — Task 2 Step 1이 테스트 작성보다 먼저.
- **drizzle 상관 서브쿼리 완전정규화** — `crm.customers.id` 리터럴(`${customers.id}` 보간 금지 — #154 섀도잉).
- **커밋·PR 어디에도 skip-ci 토큰 금지**(설명 문장에 글자로 적어도 CF가 substring으로 잡는다).
- **스모크 원복** — 스모크 고객은 UI 하드 삭제(psql 직삭제 금지 — 임베딩 고아), 실 고객 7명 불가침.
- **Safari select 함정 무관** — 이 슬라이스의 신규 입력은 date/time input과 버튼뿐(select 신설 0). 기존 select를 건드리게 되면 `bindSelect` 필수.
