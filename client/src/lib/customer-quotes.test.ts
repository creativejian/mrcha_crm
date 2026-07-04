import { describe, expect, it } from "vitest";

import { parseTermMonths, parseMonthlyPayment, parseInterestRate } from "./customer-quotes";

describe("parseTermMonths", () => {
  it("'60개월' → 60", () => expect(parseTermMonths("60개월")).toBe(60));
  it("'60' → 60", () => expect(parseTermMonths("60")).toBe(60));
  it("빈 문자열 → null", () => expect(parseTermMonths("")).toBeNull());
  it("'조건 미정' 같은 비숫자 → null", () => expect(parseTermMonths("조건 미정")).toBeNull());
});

describe("parseMonthlyPayment", () => {
  it("'월 2,473,200원' → '2473200'", () => expect(parseMonthlyPayment("월 2,473,200원")).toBe("2473200"));
  it("'2473200' → '2473200'", () => expect(parseMonthlyPayment("2473200")).toBe("2473200"));
  it("빈 문자열 → null", () => expect(parseMonthlyPayment("")).toBeNull());
  it("숫자 없음 → null", () => expect(parseMonthlyPayment("확인 전")).toBeNull());
});

describe("parseInterestRate", () => {
  it("소수점을 보존한다: '5.32%' → '5.32'", () => {
    expect(parseInterestRate("5.32%")).toBe("5.32");
    expect(parseInterestRate("5.32")).toBe("5.32");
  });
  it("0/빈값/숫자 아님은 null", () => {
    expect(parseInterestRate("0")).toBeNull();
    expect(parseInterestRate("")).toBeNull();
    expect(parseInterestRate("-")).toBeNull();
  });
});
