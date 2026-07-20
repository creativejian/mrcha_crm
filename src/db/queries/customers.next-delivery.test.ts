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
const CODE_TIE = `CU-DLVR-${suffix()}`;

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

  // 배치 10 A#4: 3차 tie-break(created_at asc) 잠금 — 대표 id는 팝오버 수정/삭제 대상이라
  // 동일 (date,time) 2행에서 어느 행이 PATCH되는지가 행위다(드로어 type select에 '출고'가
  // 있어 중복 생성 경로 실재). created_at은 defaultNow()에 맡기지 않고 명시 주입해
  // **물리 삽입 순서(heap)와 created_at 순서를 엇갈리게** 한다 — 정렬의 3차 키가 사라지면
  // 잔여 순서(heap seq scan)가 먼저 삽입된 newer를 뽑아 변이가 검출된다(defaultNow() 의존이면
  // 삽입 순서 = created_at 순서라 3차 키 제거가 무증상 — 2026-07-20 1차 픽스처에서 실측).
  // 이 엇갈림 픽스처로 3차 키 제거 변이 검출 실관찰 성공. ⚠️단 잔여 순서가 인덱스
  // (customer_id, created_at) 스캔을 타면 무증상일 수 있는 플랜 종속 그물임은 유의.
  test("동일 (date,time) 2행이면 created_at이 오래된 행이 대표(3차 tie-break)", async () => {
    const [row] = await db.insert(customers).values({ customerCode: CODE_TIE, name: "출고큐파생검증" }).returning({ id: customers.id });
    ids.push(row.id);
    const [newerInsertedFirst] = await db.insert(customerSchedules)
      .values({ customerId: row.id, scheduledDate: "2026-07-28", scheduledTime: "11:00", type: DELIVERY_SCHEDULE_TYPE, done: false, createdAt: new Date("2026-07-20T10:00:00Z") })
      .returning({ id: customerSchedules.id });
    const [olderInsertedSecond] = await db.insert(customerSchedules)
      .values({ customerId: row.id, scheduledDate: "2026-07-28", scheduledTime: "11:00", type: DELIVERY_SCHEDULE_TYPE, done: false, createdAt: new Date("2026-07-20T09:00:00Z") })
      .returning({ id: customerSchedules.id });

    const mine = (await listCustomers(db)).find((r) => r.id === row.id);
    expect(mine?.nextDeliverySchedule?.id).toBe(olderInsertedSecond.id);
    expect(mine?.nextDeliverySchedule?.id).not.toBe(newerInsertedFirst.id);
  });
});
