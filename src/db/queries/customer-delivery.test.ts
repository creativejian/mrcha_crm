import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customerDeliveries, customers, quotes, quoteScenarios } from "../schema";
import { staffActivityAt } from "./activity";
import { upsertCustomerDelivery } from "./customer-delivery";
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
    // 신 contracting(2026-07-10)·구 contracting(2026-07-01)·considering 1건. **물리 삽입 순서를 updated_at과
    // 엇갈리게**(신 먼저·구 나중 — 배치 11 A#4): created_at은 defaultNow라 삽입 순서를 따라가므로, 같은
    // 방향이면 `updated_at desc`→`created_at desc` 축 변이가 무증상 통과한다(배치 10 A#4와 동일 그물 설계).
    const [newer] = await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "BMW", modelName: "5 Series", trimName: "520i", decisionStatus: "contracting", updatedAt: new Date("2026-07-10T00:00:00Z") }).returning({ id: quotes.id });
    await db.insert(quotes).values({ customerId: cid, quoteCode: `QT-DLVI-${suffix()}`, brandName: "제네시스", modelName: "G80", trimName: "가솔린 2.5", decisionStatus: "contracting", updatedAt: new Date("2026-07-01T00:00:00Z") });
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

  // 배치 11 A#1: 출고 정보 저장은 담당자 액션 — 활동 파생(staffActivityAt) 합집합에 편입돼야
  // 관리 상태 배지·AI stale/delivery_risk 리포트가 "무활동" 오답을 내지 않는다(#180 자식 집합 부류.
  // delivery_risk는 계약완료만 조회 = 출고 정보를 저장하는 바로 그 모집단이라 자기모순이었다).
  test("출고 정보 upsert가 활동 파생(staffActivityAt)에 반영된다", async () => {
    const cid = await seedCustomer();
    const activityOf = async () => {
      const [row] = await db.select({ at: staffActivityAt }).from(customers).where(eq(customers.id, cid));
      return row.at ? new Date(row.at).getTime() : 0;
    };
    const before = await activityOf();
    const saved = await upsertCustomerDelivery(cid, { contractVehicle: "활동편입검증", contractDate: null, lender: null, deliveredDate: null, deliveryMemo: null, sourceQuoteId: null }, db);
    expect(saved.kind).toBe("saved");
    expect(await activityOf()).toBeGreaterThan(before);
  });
});
