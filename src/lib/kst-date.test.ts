import { expect, test } from "bun:test";

import { dateLabelOf, kstDateOf, kstDayDiff, kstDayIndex } from "./kst-date";

test("kstDateOf: UTC 00:00~09:00 구간도 KST 달력일로 환산(CF Workers UTC 방어)", () => {
  expect(kstDateOf(new Date("2026-01-08T00:30:00Z"))).toBe("2026-01-08"); // KST 09:30
  expect(kstDateOf(new Date("2026-01-07T15:00:00Z"))).toBe("2026-01-08"); // KST 익일 00:00
  expect(kstDateOf(new Date("2026-01-07T14:59:00Z"))).toBe("2026-01-07"); // KST 23:59
});

test("dateLabelOf: 요일 병기, 파싱 불가 문자열은 원문 유지", () => {
  expect(dateLabelOf("2026-01-08")).toBe("2026-01-08(목)");
  expect(dateLabelOf("확인 필요")).toBe("확인 필요");
});

// KST 달력일 인덱스 — 경과 24h 개수가 아니라 "며칠이 바뀌었나". stale 버킷(7/15/30)이 달력일 임계라
// 목록 배지(클라)와 AI 리포트(서버)가 같은 지표를 봐야 한다(0709 감사 — 계산법 드리프트).
test("kstDayIndex: 같은 KST 달력일은 시각과 무관하게 같은 인덱스", () => {
  const dayStart = kstDayIndex(new Date("2026-01-08T00:00:00+09:00"));
  const dayEnd = kstDayIndex(new Date("2026-01-08T23:59:59+09:00"));
  expect(dayEnd).toBe(dayStart);
  expect(kstDayIndex(new Date("2026-01-09T00:00:00+09:00"))).toBe(dayStart + 1);
});

test("kstDayDiff: 달력일 차 — 경과 시간의 24h 내림이 아니다", () => {
  // 경과 6일 23시간. floor(경과/24h)=6이지만 달력일로는 7일이 지났다(1/1 → 1/8).
  expect(kstDayDiff(new Date("2026-01-01T13:00:00+09:00"), new Date("2026-01-08T12:00:00+09:00"))).toBe(7);
  // 경과 2분이지만 자정을 넘겨 달력일 1일.
  expect(kstDayDiff(new Date("2026-01-07T23:59:00+09:00"), new Date("2026-01-08T00:01:00+09:00"))).toBe(1);
  // 같은 날 → 0. 미래(음수)도 그대로 반환(클램프는 호출부 책임).
  expect(kstDayDiff(new Date("2026-01-08T09:00:00+09:00"), new Date("2026-01-08T18:00:00+09:00"))).toBe(0);
  expect(kstDayDiff(new Date("2026-01-09T09:00:00+09:00"), new Date("2026-01-08T09:00:00+09:00"))).toBe(-1);
});
