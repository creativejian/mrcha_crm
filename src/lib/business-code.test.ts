import { test, expect } from "bun:test";

import { nextSequenceCode, yymmKstOf } from "./business-code";

test("yymmKstOf: KST 기준 YYMM — UTC 월말 15:00(=KST 익월 1일 00:00)부터 익월", () => {
  expect(yymmKstOf(new Date("2026-06-30T14:59:59Z"))).toBe("2606");
  expect(yymmKstOf(new Date("2026-06-30T15:00:00Z"))).toBe("2607"); // CF Workers(UTC)에서 전월 채번되던 창
  expect(yymmKstOf(new Date("2026-07-05T12:00:00Z"))).toBe("2607");
});

test("yymmKstOf: 연 경계 — 12/31 15:00Z는 다음해 01", () => {
  expect(yymmKstOf(new Date("2026-12-31T14:59:59Z"))).toBe("2612");
  expect(yymmKstOf(new Date("2026-12-31T15:00:00Z"))).toBe("2701");
});

test("nextSequenceCode: 기존 최대 시퀀스 +1 (4자리 패딩)", () => {
  expect(nextSequenceCode("QT-2607-", ["QT-2607-0001", "QT-2607-0012", "QT-2607-0007"])).toBe("QT-2607-0013");
});

test("nextSequenceCode: 매칭 없음/형식 이탈은 무시하고 0001부터", () => {
  expect(nextSequenceCode("CU-2607-", [])).toBe("CU-2607-0001");
  expect(nextSequenceCode("CU-2607-", ["CU-2607-abc", "broken"])).toBe("CU-2607-0001");
});
