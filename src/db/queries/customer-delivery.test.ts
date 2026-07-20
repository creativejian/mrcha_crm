import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customerDeliveries, customers, quotes, quoteScenarios } from "../schema";
import { listCustomers } from "./customers";

const db = getDefaultDb();
const suffix = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// 정리 순서 주의: quotes.customer_id FK는 cascade가 아니라(no action) 견적을 먼저 지워야 한다
// (scenarios·deliveries는 각각 quotes/customers cascade). crm 테이블만 접촉(알림 트리거 4테이블 무관 — notify 가드 불필요).
describe("listCustomers delivery·contractingQuote 파생 (출고 2단계 spec §4.1)", () => {
  const ids: string[] = [];
  afterAll(async () => {
    for (const id of ids.splice(0)) {
      await db.delete(quotes).where(eq(quotes.customerId, id));
      await db.delete(customers).where(eq(customers.id, id));
    }
  });

  async function seedCustomer(): Promise<string> {
    const [row] = await db.insert(customers).values({ customerCode: `CU-DLVI-${suffix()}`, name: "출고정보파생검증" }).returning({ id: customers.id });
    ids.push(row.id);
    return row.id;
  }

  test("customer_deliveries 행이 있으면 delivery로 동봉한다", async () => {
    const cid = await seedCustomer();
    await db.insert(customerDeliveries).values({ customerId: cid, contractVehicle: "BMW 520i", contractDate: "2026-07-15", lender: "iM캐피탈", deliveryMemo: "탁송 조율" });
    const mine = (await listCustomers(db)).find((r) => r.id === cid);
    expect(mine?.delivery).toEqual({ contractVehicle: "BMW 520i", contractDate: "2026-07-15", lender: "iM캐피탈", deliveredDate: null, deliveryMemo: "탁송 조율", sourceQuoteId: null });
  });

  test("delivery 행·contracting 견적이 없으면 둘 다 null", async () => {
    const cid = await seedCustomer();
    const mine = (await listCustomers(db)).find((r) => r.id === cid);
    expect(mine?.delivery).toBeNull();
    expect(mine?.contractingQuote).toBeNull();
  });

  test("contractingQuote = contracting 중 updated_at 최신 1건 + 대표 시나리오 lender (considering 제외)", async () => {
    const cid = await seedCustomer();
    // 구 contracting(2026-07-01) · 신 contracting(2026-07-10, 대표 시나리오 lender=iM캐피탈) · considering 1건.
    await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "제네시스", modelName: "G80", trimName: "가솔린 2.5", decisionStatus: "contracting", updatedAt: new Date("2026-07-01T00:00:00Z") });
    const [newer] = await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "BMW", modelName: "5 Series", trimName: "520i", decisionStatus: "contracting", updatedAt: new Date("2026-07-10T00:00:00Z") }).returning({ id: quotes.id });
    await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "아우디", modelName: "A6", decisionStatus: "considering", updatedAt: new Date("2026-07-15T00:00:00Z") });
    const [scenario] = await db.insert(quoteScenarios).values({ quoteId: newer.id, scenarioNo: 1, lender: "iM캐피탈" }).returning({ id: quoteScenarios.id });
    await db.update(quotes).set({ primaryScenarioId: scenario.id }).where(eq(quotes.id, newer.id));

    const mine = (await listCustomers(db)).find((r) => r.id === cid);
    expect(mine?.contractingQuote).toEqual({ id: newer.id, brandName: "BMW", modelName: "5 Series", trimName: "520i", lender: "iM캐피탈" });
  });

  test("contracting 견적에 대표 시나리오가 없으면 lender만 null", async () => {
    const cid = await seedCustomer();
    const [q] = await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "볼보", modelName: "XC60", decisionStatus: "contracting" }).returning({ id: quotes.id });
    const mine = (await listCustomers(db)).find((r) => r.id === cid);
    expect(mine?.contractingQuote).toEqual({ id: q.id, brandName: "볼보", modelName: "XC60", trimName: null, lender: null });
  });
});
