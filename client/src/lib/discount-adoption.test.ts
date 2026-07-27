import { describe, expect, test } from "vitest";

import { proposalState } from "./discount-adoption";

describe("proposalState", () => {
  test("채택됨 — 최신 채택의 출처가 이 딜러이고 금액도 같다", () => {
    expect(proposalState({ proposalAmount: 6_500_000, adoptedAmount: 6_500_000, adoptedFromThisDealer: true })).toBe(
      "adopted",
    );
  });

  test("수정됨 — 출처는 이 딜러인데 제안 금액이 달라졌다(재채택 필요)", () => {
    expect(proposalState({ proposalAmount: 6_800_000, adoptedAmount: 6_500_000, adoptedFromThisDealer: true })).toBe(
      "changed",
    );
  });

  test("미채택 — 다른 딜러(또는 관리자 직접)가 채택된 상태", () => {
    expect(proposalState({ proposalAmount: 6_200_000, adoptedAmount: 6_500_000, adoptedFromThisDealer: false })).toBe(
      "none",
    );
  });

  test("미채택 — 아직 아무것도 채택되지 않았다", () => {
    expect(proposalState({ proposalAmount: 6_200_000, adoptedAmount: null, adoptedFromThisDealer: false })).toBe("none");
  });

  test("비움 채택도 '채택됨'이다(null == null)", () => {
    expect(proposalState({ proposalAmount: null, adoptedAmount: null, adoptedFromThisDealer: true })).toBe("adopted");
  });

  // 금액이 같더라도 출처가 다른 딜러면 "채택됨"이 아니다 — 두 딜러가 우연히 같은 금액을 제안한
  // 경우 둘 다 ✅로 보이면 이사님이 "이미 채택했다"고 오판한다(채택 버튼이 사라져 재채택 불가).
  test("우연히 금액이 같아도 출처가 이 딜러가 아니면 미채택이다", () => {
    expect(proposalState({ proposalAmount: 6_500_000, adoptedAmount: 6_500_000, adoptedFromThisDealer: false })).toBe(
      "none",
    );
  });
});
