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
