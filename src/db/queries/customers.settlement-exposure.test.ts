import { expect, test } from "bun:test";

import { createApp } from "../../app";
import { makeTestAuth } from "../../auth/test-jwt";
import { listCustomers } from "./customers";
import { getDefaultDb } from "../client";

// ── 정산 노출 tripwire (2026-08-03 신설 → 2026-08-05 라우트 레벨로 이전) ────────────
// 정산(입금일·실입금액·비용·단계)은 **admin 전용**인데 `crm.customer_deliveries`라는 같은 행에 산다.
// 화면에 안 보여도 응답 본문에 실리면 노출이다(DevTools로 보인다).
//
// ⚠️ **검사 지점이 바뀌었다.** 구 버전은 `listCustomers`가 정산을 아예 안 뽑는 것을 단언했는데,
// 정산 목록 컬럼(2026-08-05)을 위해 **쿼리는 항상 뽑고 라우트가 비우는** 구조로 갔다
// (층 분리: 필터=쿼리 WHERE / 가시성=lib/settlement-visibility. catalog `visibleTrimsFor`와 동형).
// 그래서 쿼리 레벨 단언은 이제 거짓이고, 진짜 계약은 **라우트 응답**에 있다.
//
// 구 주석의 "레포에 필드 단위 마스킹 선례가 없다"는 **사실이 아니었다**(2026-08-05 확인) —
// `src/lib/dealer-visibility.ts`(2026-07-27)가 이미 같은 패턴이고, 새 패턴이 아니라 그 미러링이다.
//
// 2층 구조: 마스킹 **로직**은 `src/lib/settlement-visibility.test.ts`(순수·CI)가, **배선**은
// 이 파일이 잠근다(dealer-visibility.test.ts + dealer.role-gate.test.ts와 같은 짝).

const db = getDefaultDb();

async function listFor(role: "admin" | "manager" | "staff" | "dealer") {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const res = await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return (await res.json()) as { settlement: unknown }[];
}

// ⚠️ **manager도 막힌다** — scope는 "전체"라 고객은 다 보지만 정산만 못 본다(정산 라우트의
// requireRoles(["admin"])와 같은 축). 이 둘이 갈리면 "목록엔 보이는데 팝오버는 403"이 된다.
test("비admin 목록 응답에는 정산이 실리지 않는다(manager 포함)", async () => {
  for (const role of ["manager", "staff", "dealer"] as const) {
    const rows = await listFor(role);
    // staff·dealer는 scope 때문에 0건일 수 있다 — 그건 이 그물의 관심사가 아니다(0건이면 샐 것도 없다).
    for (const row of rows) expect(row.settlement).toBeNull();
  }
});

test("admin 목록 응답에는 정산이 실린다 — 마스킹이 admin까지 삼키면 화면이 빈다", async () => {
  const rows = await listFor("admin");
  expect(rows.length).toBeGreaterThan(0); // 표본 0이면 이 그물이 아무것도 못 잡는다
  // 출고 행이 있는 고객이 하나도 없는 환경이면 검증 불가(정산은 그 행에 산다).
  const withSettlement = rows.find((row) => row.settlement);
  if (!withSettlement) return;
  expect(Object.keys(withSettlement.settlement as object).sort()).toEqual(
    ["costs", "feeAmount", "settledAt", "status"].sort(),
  );
});

// 출고 정보(전 역할 공개)와 정산(admin 전용)이 **같은 테이블**이라 가장 샐 만한 자리다.
// 서브쿼리를 합치면 여기로 새므로 분리를 유지한다.
test("출고 정보 객체는 기대한 7필드만 가진다 — 정산이 그리로 섞여드는 것도 잡는다", async () => {
  const rows = await listCustomers(db, "all");
  const withDelivery = rows.find((row) => row.delivery);
  if (!withDelivery?.delivery) return; // 출고 행이 없는 환경에서는 검증 불가

  expect(Object.keys(withDelivery.delivery).sort()).toEqual(
    ["contractDate", "contractVehicle", "contractConfirmedDate", "deliveredDate", "deliveryMemo", "lender", "sourceQuoteId"].sort(),
  );
});

// 고객 행 **최상위**로 새는 경로(전체 컬럼 spread 등)는 마스킹이 못 잡는다 — `settlement` 키만
// 비우기 때문이다. 그래서 최상위에 정산 컬럼명이 뜨는지는 따로 본다.
test("고객 행 최상위에는 정산 컬럼이 없다(마스킹이 커버하지 못하는 경로)", async () => {
  for (const role of ["manager", "staff"] as const) {
    const rows = await listFor(role);
    for (const row of rows) {
      for (const key of ["settledAt", "feeAmount", "settled_at", "fee_amount", "settlementCosts", "settlementStatus"]) {
        expect(row).not.toHaveProperty(key);
      }
    }
  }
});
