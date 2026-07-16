import { describe, expect, it } from "vitest";

import { financeListPath, financeModeFromSearch } from "./finance-route";

describe("financeModeFromSearch", () => {
  it("?view= 값을 FinanceMode로 반환", () => {
    expect(financeModeFromSearch("?view=revenue")).toBe("revenue");
    expect(financeModeFromSearch("?view=payroll")).toBe("payroll");
  });
  it("view가 없으면 stats(기본)", () => {
    expect(financeModeFromSearch("")).toBe("stats");
  });
  it("?view=stats 도 stats", () => {
    expect(financeModeFromSearch("?view=stats")).toBe("stats");
  });
  it("알 수 없는 view 값은 stats로 폴백", () => {
    expect(financeModeFromSearch("?view=bogus")).toBe("stats");
  });
});

describe("financeListPath", () => {
  it("stats(기본)는 파라미터 없는 /finance", () => {
    expect(financeListPath("stats")).toBe("/finance");
  });
  it("비-stats는 ?view= 부착", () => {
    expect(financeListPath("revenue")).toBe("/finance?view=revenue");
    expect(financeListPath("expense")).toBe("/finance?view=expense");
  });
});
