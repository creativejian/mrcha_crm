import { describe, expect, it } from "vitest";

import { normalizeDateText, normalizeTimeText } from "./datetime-text";

describe("normalizeDateText", () => {
  it("하이픈 구분 정규 표기는 그대로 통과", () => {
    expect(normalizeDateText("2026-07-19")).toBe("2026-07-19");
  });
  it("점 구분·한 자리 월/일도 영패딩 정규화", () => {
    expect(normalizeDateText("2026.7.19")).toBe("2026-07-19");
  });
  it("슬래시 구분도 허용", () => {
    expect(normalizeDateText("2026/7/19")).toBe("2026-07-19");
  });
  it("무구분 8자리도 허용", () => {
    expect(normalizeDateText("20260719")).toBe("2026-07-19");
  });
  it("앞뒤 공백은 trim", () => {
    expect(normalizeDateText("  2026-07-19  ")).toBe("2026-07-19");
  });
  it("빈 값은 null", () => {
    expect(normalizeDateText("")).toBeNull();
    expect(normalizeDateText("   ")).toBeNull();
  });
  it("실존하지 않는 날짜는 null(2026-02-30)", () => {
    expect(normalizeDateText("2026-02-30")).toBeNull();
  });
  it("윤년 2월 29일은 유효(2024), 평년은 무효(2026)", () => {
    expect(normalizeDateText("2024-02-29")).toBe("2024-02-29");
    expect(normalizeDateText("2026-02-29")).toBeNull();
  });
  it("월/일 범위 밖은 null", () => {
    expect(normalizeDateText("2026-13-01")).toBeNull();
    expect(normalizeDateText("2026-00-01")).toBeNull();
    expect(normalizeDateText("2026-01-32")).toBeNull();
    expect(normalizeDateText("2026-01-00")).toBeNull();
  });
  it("형식 밖(MM/DD/YYYY 같은 로케일 오배치·자릿수 부족)은 null", () => {
    expect(normalizeDateText("07/19/2026")).toBeNull();
    expect(normalizeDateText("2026-7")).toBeNull();
    expect(normalizeDateText("not a date")).toBeNull();
  });
});

describe("normalizeTimeText", () => {
  it("HH:mm 정규 표기는 그대로 통과", () => {
    expect(normalizeTimeText("14:00")).toEqual({ ok: true, value: "14:00" });
  });
  it("한 자리 시는 영패딩", () => {
    expect(normalizeTimeText("9:30")).toEqual({ ok: true, value: "09:30" });
  });
  it("무구분 4자리도 허용", () => {
    expect(normalizeTimeText("0930")).toEqual({ ok: true, value: "09:30" });
  });
  it("빈 값(공백 포함)은 시간 없음으로 허용", () => {
    expect(normalizeTimeText("")).toEqual({ ok: true, value: null });
    expect(normalizeTimeText("   ")).toEqual({ ok: true, value: null });
  });
  it("24:00은 범위 밖이라 거부", () => {
    expect(normalizeTimeText("24:00")).toEqual({ ok: false });
  });
  it("분 60 이상은 거부", () => {
    expect(normalizeTimeText("14:60")).toEqual({ ok: false });
  });
  it("형식 밖(한글 표기·자릿수 부족)은 거부", () => {
    expect(normalizeTimeText("14시 30분")).toEqual({ ok: false });
    expect(normalizeTimeText("14")).toEqual({ ok: false });
    expect(normalizeTimeText("not a time")).toEqual({ ok: false });
  });
});
