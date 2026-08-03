import { expect, test } from "bun:test";

import { listCustomers } from "./customers";
import { getDefaultDb } from "../client";

// ── 정산 미노출 tripwire (2026-08-03) ─────────────────────────────────────
// 정산(입금일·실입금액)은 **admin 전용**인데 `crm.customer_deliveries`라는 같은 행에 산다.
// 지금은 고객 목록이 출고 정보를 **필드 명시 조립**(queries/customers.ts deliveryInfo)해서 안전하지만,
// 나중에 누가 편의를 위해 전체 컬럼을 뽑는 식으로 바꾸면 **정산이 전 역할에게 조용히 샌다** —
// 화면에 안 보여도 응답 본문에 실리면 노출이다.
//
// 이 테스트는 그 순간을 시끄럽게 만든다. 정산을 목록에 실어야 할 정당한 이유가 생기면
// 이 파일을 지우는 게 아니라 **역할별 응답 분기를 먼저 설계**해야 한다(레포에 필드 단위 마스킹 선례가
// 없어서 새 패턴이 된다 — spec 2026-08-03 §6).

const db = getDefaultDb();
const SETTLEMENT_KEYS = ["settledAt", "feeAmount", "settled_at", "fee_amount"];

test("고객 목록 응답에 정산 필드가 실리지 않는다", async () => {
  const rows = await listCustomers(db, "all");
  expect(rows.length).toBeGreaterThan(0); // 표본 0이면 이 그물이 아무것도 못 잡는다

  for (const row of rows) {
    // 출고 정보 객체 안(가장 샐 만한 자리 — 같은 테이블에서 조립된다)
    const delivery = row.delivery as Record<string, unknown> | null;
    if (delivery) {
      for (const key of SETTLEMENT_KEYS) expect(delivery).not.toHaveProperty(key);
    }
    // 고객 행 최상위(전체 컬럼 spread 경로로 새는 경우)
    for (const key of SETTLEMENT_KEYS) expect(row).not.toHaveProperty(key);
  }
});

test("출고 정보 객체는 기대한 7필드만 가진다 — 새 필드가 조용히 끼어드는 것도 잡는다", async () => {
  const rows = await listCustomers(db, "all");
  const withDelivery = rows.find((row) => row.delivery);
  if (!withDelivery?.delivery) return; // 출고 행이 없는 환경에서는 검증 불가

  expect(Object.keys(withDelivery.delivery).sort()).toEqual(
    ["contractDate", "contractVehicle", "contractConfirmedDate", "deliveredDate", "deliveryMemo", "lender", "sourceQuoteId"].sort(),
  );
});
