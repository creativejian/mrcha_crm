import { test, expect } from "bun:test";

import { currentMonthKey, isMonthKey, monthRangeDate, monthRangeUtc, prevMonthKey } from "./report-month";

test("isMonthKey: YYYY-MM만 통과 — 형식 이탈은 라우트 400의 근거", () => {
  expect(isMonthKey("2026-07")).toBe(true);
  expect(isMonthKey("2026-12")).toBe(true);
  expect(isMonthKey("2026-00")).toBe(false);
  expect(isMonthKey("2026-13")).toBe(false);
  expect(isMonthKey("2026-7")).toBe(false);
  expect(isMonthKey("202607")).toBe(false);
  expect(isMonthKey("2026-07-01")).toBe(false);
  expect(isMonthKey("")).toBe(false);
});

test("currentMonthKey: KST 기준 — UTC 월말 15:00(=KST 익월 1일 00:00)부터 익월", () => {
  expect(currentMonthKey(new Date("2026-07-31T14:59:59Z"))).toBe("2026-07");
  expect(currentMonthKey(new Date("2026-07-31T15:00:00Z"))).toBe("2026-08");
  expect(currentMonthKey(new Date("2026-08-02T03:00:00Z"))).toBe("2026-08");
});

test("currentMonthKey: 연 경계 — 12/31 15:00Z는 다음해 01", () => {
  expect(currentMonthKey(new Date("2026-12-31T14:59:59Z"))).toBe("2026-12");
  expect(currentMonthKey(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01");
});

test("prevMonthKey: 전월 — 1월은 전년 12월", () => {
  expect(prevMonthKey("2026-08")).toBe("2026-07");
  expect(prevMonthKey("2026-01")).toBe("2025-12");
});

test("monthRangeUtc: KST 월 경계를 UTC 시각으로 — [start, end)", () => {
  const { start, end } = monthRangeUtc("2026-07");
  // KST 2026-07-01 00:00 = UTC 2026-06-30 15:00
  expect(start.toISOString()).toBe("2026-06-30T15:00:00.000Z");
  // KST 2026-08-01 00:00 = UTC 2026-07-31 15:00 (상한 배타)
  expect(end.toISOString()).toBe("2026-07-31T15:00:00.000Z");
});

test("monthRangeUtc: 12월은 다음 해로 넘어간다", () => {
  const { start, end } = monthRangeUtc("2026-12");
  expect(start.toISOString()).toBe("2026-11-30T15:00:00.000Z");
  expect(end.toISOString()).toBe("2026-12-31T15:00:00.000Z");
});

test("monthRangeDate: date 컬럼용 경계 — 다음 달 1일이 상한(배타)", () => {
  expect(monthRangeDate("2026-07")).toEqual({ start: "2026-07-01", end: "2026-08-01" });
  expect(monthRangeDate("2026-12")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  expect(monthRangeDate("2026-01")).toEqual({ start: "2026-01-01", end: "2026-02-01" });
});

test("monthRangeUtc: 경계 시각이 정확히 한 달만 덮는다(월말 23:59:59 KST 포함·익월 00:00 제외)", () => {
  const { start, end } = monthRangeUtc("2026-07");
  const lastMomentOfJuly = new Date("2026-07-31T14:59:59Z"); // KST 7/31 23:59:59
  const firstMomentOfAugust = new Date("2026-07-31T15:00:00Z"); // KST 8/1 00:00
  expect(lastMomentOfJuly >= start && lastMomentOfJuly < end).toBe(true);
  expect(firstMomentOfAugust < end).toBe(false);
});
