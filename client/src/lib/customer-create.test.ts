import { describe, expect, it } from "vitest";

import { findPhoneDuplicate, sanitizePhoneDigits } from "./customer-create";

describe("sanitizePhoneDigits", () => {
  it("하이픈·공백·문자를 걷어내고 숫자만 남긴다", () => {
    expect(sanitizePhoneDigits("010-9588-0812")).toBe("01095880812");
    expect(sanitizePhoneDigits(" 010 9588 0812 ")).toBe("01095880812");
    expect(sanitizePhoneDigits("")).toBe("");
  });
});

describe("findPhoneDuplicate", () => {
  const rows = [
    { name: "김민준", customerId: "CU-2605-0020", phone: "010-9588-0812" },
    { name: "박서연", customerId: "CU-2605-0019", phone: "010-9588-0813" },
  ];

  it("포맷이 달라도 숫자 기준으로 같은 번호 첫 고객을 찾는다", () => {
    expect(findPhoneDuplicate(rows, "01095880812")).toEqual({ name: "김민준", customerId: "CU-2605-0020" });
    expect(findPhoneDuplicate(rows, "010-9588-0813")).toEqual({ name: "박서연", customerId: "CU-2605-0019" });
  });

  it("일치가 없으면 null", () => {
    expect(findPhoneDuplicate(rows, "010-0000-0000")).toBeNull();
  });

  it("숫자 10자리 미만은 null — 타이핑 중 조기 경고 방지", () => {
    expect(findPhoneDuplicate(rows, "010-9588")).toBeNull();
    expect(findPhoneDuplicate(rows, "")).toBeNull();
  });

  it("빈 목록이면 null", () => {
    expect(findPhoneDuplicate([], "010-9588-0812")).toBeNull();
  });
});
