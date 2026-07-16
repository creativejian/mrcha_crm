import { describe, expect, it } from "vitest";

import { formatContentDate } from "./content";

describe("formatContentDate", () => {
  it("returns empty string for null", () => {
    expect(formatContentDate(null)).toBe("");
  });

  // 인사이트·지식베이스가 서로 다른 연도 자릿수(4자리 vs 2자리)를 쓰던 드리프트 해소 — 4자리로 통일.
  it("formats an ISO date with a 4-digit year and zero-padded month/day", () => {
    expect(formatContentDate("2026-07-05T09:30:00+09:00")).toBe("2026.07.05");
  });
});
