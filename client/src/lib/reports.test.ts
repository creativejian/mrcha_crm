import { describe, expect, it } from "vitest";

import { formatMonthLabel, recentMonthOptions } from "./reports";

describe("recentMonthOptions", () => {
  it("기준 월부터 과거로 내림차순", () => {
    expect(recentMonthOptions("2026-08", 3)).toEqual(["2026-08", "2026-07", "2026-06"]);
  });

  it("연 경계를 넘어간다", () => {
    expect(recentMonthOptions("2026-02", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });

  it("12월 기준도 어긋나지 않는다 — 월 인덱스 0/12 혼동 회귀", () => {
    expect(recentMonthOptions("2026-12", 2)).toEqual(["2026-12", "2026-11"]);
    expect(recentMonthOptions("2026-01", 2)).toEqual(["2026-01", "2025-12"]);
  });

  it("형식 이탈은 그대로 1개만 — 선택지를 지어내지 않는다", () => {
    expect(recentMonthOptions("bogus")).toEqual(["bogus"]);
  });
});

describe("formatMonthLabel", () => {
  it("YYYY년 M월 — 0 패딩 없이", () => {
    expect(formatMonthLabel("2026-08")).toBe("2026년 8월");
    expect(formatMonthLabel("2026-12")).toBe("2026년 12월");
  });
});
