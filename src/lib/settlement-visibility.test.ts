import { expect, test } from "bun:test";

import { visibleSettlementFor } from "./settlement-visibility";

// 정산 목록 노출 마스킹(2026-08-05) — `dealer-visibility.ts`와 같은 축·같은 2층 구조다
// (순수 로직은 이 파일이, 라우트 배선은 customers.settlement-exposure.test.ts가 잠근다).
//
// ⚠️ 이 마스킹이 뚫리면 회사 수입(실입금액·비용·마진)이 전 직원 응답 본문에 실린다. 화면에서
// 안 보여도 DevTools로 보이므로 **서버가 비우는 것**이 유일한 실효 차단이다.

const ROW = (settlement: unknown) => ({ id: "c1", name: "홍길동", settlement });
const SETTLEMENT = { settledAt: "2026-09-10", feeAmount: 1180000, costs: [], status: "정산완료" };

test("admin은 정산을 그대로 받는다", () => {
  const rows = visibleSettlementFor("admin", [ROW(SETTLEMENT)]);
  expect(rows[0].settlement).toEqual(SETTLEMENT);
});

// manager(팀장)도 막는다 — 경영 리포트·정산 라우트(requireRoles(["admin"]))와 같은 축이다.
// 여기가 갈리면 "목록으로는 보이는데 팝오버는 403"이라는 앞뒤 안 맞는 화면이 된다.
test.each(["manager", "staff", "dealer", "unknown"])("%s는 정산이 null로 비워진다", (role) => {
  const rows = visibleSettlementFor(role, [ROW(SETTLEMENT)]);
  expect(rows[0].settlement).toBeNull();
});

// ⚠️ **키를 지우지 않고 null로 비운다**(dealer-visibility.ts와 같은 규칙) — 응답 형태가 role에
// 따라 갈리면 클라 파싱이 두 갈래가 된다. 클라는 항상 `settlement` 키를 기대할 수 있어야 한다.
test("마스킹은 키를 제거하지 않는다 — 값만 null", () => {
  const rows = visibleSettlementFor("staff", [ROW(SETTLEMENT)]);
  expect("settlement" in rows[0]).toBe(true);
});

// 정산 외 필드는 손대지 않는다 — 마스킹이 다른 축을 건드리면 목록 전체가 조용히 망가진다.
test("정산 외 필드는 그대로 둔다", () => {
  const rows = visibleSettlementFor("staff", [ROW(SETTLEMENT)]);
  expect(rows[0]).toMatchObject({ id: "c1", name: "홍길동" });
});

// 원본 배열·행을 변형하지 않는다(순수) — 같은 행을 다른 소비처가 참조하면 그쪽까지 비워진다.
test("원본을 변형하지 않는다", () => {
  const original = ROW(SETTLEMENT);
  visibleSettlementFor("staff", [original]);
  expect(original.settlement).toEqual(SETTLEMENT);
});

// 출고 행이 없는 고객은 정산도 null — admin이라도 없는 것은 없는 것이다(빈 객체를 만들지 않는다).
test("정산이 없는 행은 admin에게도 null 그대로", () => {
  const rows = visibleSettlementFor("admin", [ROW(null)]);
  expect(rows[0].settlement).toBeNull();
});
