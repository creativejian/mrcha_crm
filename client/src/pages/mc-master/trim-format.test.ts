import { describe, expect, it } from "vitest";

import { discountText, fmtDate, formatThousands, manwonText, parseManwon, parseWon } from "./trim-format";

describe("fmtDate", () => {
  it("ISO 날짜를 yyyy/MM/dd로", () => {
    expect(fmtDate("2026-06-20")).toBe("2026/06/20");
  });
  it("타임스탬프는 앞 10자만 사용", () => {
    expect(fmtDate("2026-06-20T13:45:00.000Z")).toBe("2026/06/20");
  });
  it("null은 대시", () => {
    expect(fmtDate(null)).toBe("—");
  });
});

describe("discountText", () => {
  it("금액과 가격으로 비율(소수1)을 붙인다", () => {
    expect(discountText(1_000_000, 50_000_000)).toBe("1,000,000원(2.0%)");
  });
  it("금액 0/null은 대시", () => {
    expect(discountText(0, 50_000_000)).toBe("—");
    expect(discountText(null, 50_000_000)).toBe("—");
  });
  it("가격 0이면 비율 0.0%", () => {
    expect(discountText(1_000_000, 0)).toBe("1,000,000원(0.0%)");
  });
});

describe("formatThousands", () => {
  it("숫자열을 천단위 콤마로", () => {
    expect(formatThousands("1234567")).toBe("1,234,567");
  });
  it("기존 콤마/비숫자를 걷어내고 재포맷", () => {
    expect(formatThousands("1,234,567")).toBe("1,234,567");
    expect(formatThousands("12a34")).toBe("1,234");
  });
  it("빈 값/숫자 없음은 빈 문자열", () => {
    expect(formatThousands("")).toBe("");
    expect(formatThousands("abc")).toBe("");
  });
});

describe("parseWon", () => {
  it("콤마 제거 후 정수", () => {
    expect(parseWon("1,234,567")).toBe(1234567);
  });
  it("빈 값/공백은 null", () => {
    expect(parseWon("")).toBeNull();
    expect(parseWon("   ")).toBeNull();
  });
  it("0은 0(빈 값과 구분)", () => {
    expect(parseWon("0")).toBe(0);
  });
});

describe("manwonText", () => {
  it("원을 만원 단위로(천단위 콤마)", () => {
    expect(manwonText(10_000)).toBe("1만원");
    expect(manwonText(12_340_000)).toBe("1,234만원");
  });
  it("null은 대시", () => {
    expect(manwonText(null)).toBe("—");
  });
  it("0은 0만원", () => {
    expect(manwonText(0)).toBe("0만원");
  });
});

describe("parseManwon", () => {
  it("만원 입력을 원으로(×10000)", () => {
    expect(parseManwon("100")).toBe(1_000_000);
    expect(parseManwon("1,234")).toBe(12_340_000);
  });
  it("빈 값/공백은 null", () => {
    expect(parseManwon("")).toBeNull();
    expect(parseManwon("   ")).toBeNull();
  });
});
