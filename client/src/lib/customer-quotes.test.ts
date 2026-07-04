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
  it("'5.32%' → '5.32' (소수점 보존)", () => expect(parseInterestRate("5.32%")).toBe("5.32"));
  it("'5.32' → '5.32'", () => expect(parseInterestRate("5.32")).toBe("5.32"));
  it("'100' → '100' (상한 경계값 허용)", () => expect(parseInterestRate("100")).toBe("100"));
  it("'-5.32' → '5.32' (부호 스트립은 의도된 정규화)", () => expect(parseInterestRate("-5.32")).toBe("5.32"));
  it("'0' → null", () => expect(parseInterestRate("0")).toBeNull());
  it("빈 문자열 → null", () => expect(parseInterestRate("")).toBeNull());
  it("'-' 같은 비숫자 → null", () => expect(parseInterestRate("-")).toBeNull());
  it("'5,32' 콤마 오입력 → null (532%로 부풀지 않고 차단)", () => expect(parseInterestRate("5,32")).toBeNull());
  it("'1,234' → null (100 초과 차단)", () => expect(parseInterestRate("1,234")).toBeNull());
});
