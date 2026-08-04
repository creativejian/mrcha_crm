import { describe, expect, it } from "vitest";

import { SETTLEMENT_COST_KINDS, SETTLEMENT_STATUS_OPTIONS, type SettlementCost, type SettlementCostKind } from "@/data/customers";
import { formatSettlementMargin, resolveSettlementCosts, settlementMargin, sumSettlementCosts } from "./settlement";

const cost = (kind: SettlementCostKind, amount: number, label: string | null = null): SettlementCost => ({ kind, label, amount });

describe("정산 비용 어휘(이사님 확정 2026-08-04)", () => {
  it("항목은 썬팅·블랙박스·탁송·페이백·직접입력 5종이다", () => {
    // 시공비는 썬팅/블랙박스로 나눠 담기로 확정했고(이사님), 광택·언더코팅·PPF 등은 별도 칸을
    // 만들지 않고 "직접입력"으로 흡수한다. 이 배열이 저장값의 닫힌 집합이라 DB CHECK와 한 쌍이다.
    expect([...SETTLEMENT_COST_KINDS]).toEqual(["썬팅", "블랙박스", "탁송", "페이백", "직접입력"]);
  });

  it("정산 단계는 미정산·정산요청·정산완료 3단계다", () => {
    // 정산요청 = 담당자가 관리자에게 / 정산완료 = 관리자가 입금 확인 후(이사님 확정).
    expect([...SETTLEMENT_STATUS_OPTIONS]).toEqual(["미정산", "정산요청", "정산완료"]);
  });
});

describe("sumSettlementCosts", () => {
  it("비용을 전부 더한다", () => {
    expect(sumSettlementCosts([cost("썬팅", 300_000), cost("탁송", 150_000)])).toBe(450_000);
  });

  it("**페이백도 비용으로 더한다**(이사님 확정) — 고객에게 돌려준 돈이라 마진을 줄인다", () => {
    // 부호를 뒤집어 빼면 마진이 실제보다 커진다. 이 케이스가 그 실수를 잡는다.
    expect(sumSettlementCosts([cost("썬팅", 300_000), cost("페이백", 500_000)])).toBe(800_000);
  });

  it("직접입력도 같은 비용이다(라벨은 집계에 영향 없음)", () => {
    expect(sumSettlementCosts([cost("직접입력", 120_000, "광택")])).toBe(120_000);
  });

  it("비용이 없으면 0", () => {
    expect(sumSettlementCosts([])).toBe(0);
  });
});

describe("settlementMargin", () => {
  it("마진 = 실입금액 − 비용합", () => {
    expect(settlementMargin(2_000_000, [cost("썬팅", 300_000), cost("페이백", 500_000)])).toBe(1_200_000);
  });

  it("비용이 실입금액을 넘으면 음수 마진을 그대로 낸다(0으로 깎지 않는다)", () => {
    // 역마진은 실제로 생길 수 있는 상태다 — 0으로 숨기면 화면이 손실을 감춘다.
    expect(settlementMargin(300_000, [cost("페이백", 500_000)])).toBe(-200_000);
  });

  it("실입금액 미입력(null)이면 마진도 null — 0이 아니다", () => {
    // 0으로 내면 "마진 0원"과 "아직 모른다"가 화면에서 구분되지 않는다.
    expect(settlementMargin(null, [cost("썬팅", 300_000)])).toBeNull();
  });

  it("실입금액만 있고 비용이 없으면 마진 = 실입금액", () => {
    expect(settlementMargin(2_000_000, [])).toBe(2_000_000);
  });
});

// ── 입력 폼 → 저장 body 변환(2026-08-04 2단계 UI) ──────────────────────────
// 비용 행은 화면에서 **문자열 금액**으로 들고 있다가(입력 중 콤마·빈 칸을 그대로 두려고) 저장
// 시점에 한 번 파싱한다. 서버 zod가 최종 게이트지만, 여기서 걸러야 사용자가 즉시 사유를 본다.
describe("resolveSettlementCosts", () => {
  it("문자열 금액을 숫자로 바꾸고 콤마를 지운다", () => {
    const r = resolveSettlementCosts([{ kind: "썬팅", label: null, amountText: "300,000" }]);
    expect(r).toEqual({ kind: "ok", costs: [{ kind: "썬팅", label: null, amount: 300_000 }] });
  });

  it("빈 금액 행은 **저장에서 제외**한다(추가만 하고 안 채운 행)", () => {
    // 0원으로 저장하면 "비용 0원 항목"이 쌓여 정산 화면이 지저분해진다.
    const r = resolveSettlementCosts([
      { kind: "썬팅", label: null, amountText: "300000" },
      { kind: "탁송", label: null, amountText: "" },
    ]);
    expect(r).toEqual({ kind: "ok", costs: [{ kind: "썬팅", label: null, amount: 300_000 }] });
  });

  it("직접입력인데 항목명이 비면 거부한다", () => {
    const r = resolveSettlementCosts([{ kind: "직접입력", label: "  ", amountText: "120000" }]);
    expect(r.kind).toBe("invalid");
  });

  it("고정 항목의 항목명은 **버린다**(서버 zod가 null을 요구한다)", () => {
    // 사용자가 직접입력으로 이름을 쓰다가 종류를 바꾼 경우 — 라벨이 남으면 400이 난다.
    const r = resolveSettlementCosts([{ kind: "썬팅", label: "예전에 쓴 이름", amountText: "300000" }]);
    expect(r).toEqual({ kind: "ok", costs: [{ kind: "썬팅", label: null, amount: 300_000 }] });
  });

  it("숫자가 아니면 거부한다", () => {
    expect(resolveSettlementCosts([{ kind: "탁송", label: null, amountText: "십만원" }]).kind).toBe("invalid");
  });
});

describe("formatSettlementMargin", () => {
  it("실입금액 − 비용합을 원 단위로 낸다", () => {
    expect(formatSettlementMargin("2,000,000", [{ kind: "썬팅", label: null, amountText: "300000" }])).toBe("1,700,000원");
  });

  it("실입금액이 비면 '—'(0원으로 단정하지 않는다)", () => {
    expect(formatSettlementMargin("", [{ kind: "썬팅", label: null, amountText: "300000" }])).toBe("—");
  });

  it("비용 행이 아직 오류면 '—'(계산 불가를 숫자로 보여주지 않는다)", () => {
    expect(formatSettlementMargin("2000000", [{ kind: "직접입력", label: "", amountText: "120000" }])).toBe("—");
  });

  it("역마진도 그대로 보여준다", () => {
    expect(formatSettlementMargin("300000", [{ kind: "페이백", label: null, amountText: "500000" }])).toBe("-200,000원");
  });
});
