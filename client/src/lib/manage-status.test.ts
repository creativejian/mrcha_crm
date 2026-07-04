import { describe, expect, test } from "vitest";

import { finalUpdateStatus } from "./customer-table";
import { deriveFinalUpdateInfo } from "./manage-status";

const NOW = new Date("2026-07-04T12:00:00+09:00");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const base = { recontacted: false, statusGroup: "상담중", status: "차량상담중" };

describe("deriveFinalUpdateInfo", () => {
  test("경과일 버킷 경계: 6=정상, 7=확인필요, 14=확인필요, 15=지연, 29=지연, 30=장기방치", () => {
    const labelAt = (days: number) =>
      finalUpdateStatus(deriveFinalUpdateInfo({ ...base, lastActivityAt: daysAgo(days) }, NOW)!).label;
    expect(labelAt(0)).toBe("정상");
    expect(labelAt(6)).toBe("정상");
    expect(labelAt(7)).toBe("확인필요");
    expect(labelAt(14)).toBe("확인필요");
    expect(labelAt(15)).toBe("지연");
    expect(labelAt(29)).toBe("지연");
    expect(labelAt(30)).toBe("장기방치");
  });

  test("recontacted면 기간 무관 재문의", () => {
    const info = deriveFinalUpdateInfo({ ...base, recontacted: true, lastActivityAt: daysAgo(40) }, NOW)!;
    expect(finalUpdateStatus(info).label).toBe("재문의");
  });

  test("신규+상담접수(액션 전)는 null → 공백", () => {
    expect(deriveFinalUpdateInfo({ ...base, statusGroup: "신규", status: "상담접수", lastActivityAt: daysAgo(1) }, NOW)).toBeNull();
  });

  test("lastActivityAt 없음/파싱 불가면 null", () => {
    expect(deriveFinalUpdateInfo({ ...base, lastActivityAt: null }, NOW)).toBeNull();
    expect(deriveFinalUpdateInfo({ ...base, lastActivityAt: "not-a-date" }, NOW)).toBeNull();
  });

  test("label은 기존 mock 포맷('N월 N일 HH:mm') — 목록 응답 SLA 파서 호환", () => {
    const info = deriveFinalUpdateInfo({ ...base, lastActivityAt: "2026-07-01T09:05:00+09:00" }, NOW)!;
    expect(info.label).toBe("7월 1일 09:05");
    expect(info.days).toBe(3);
  });

  test("미래 시각(시계 오차)은 days 0으로 클램프", () => {
    const info = deriveFinalUpdateInfo({ ...base, lastActivityAt: daysAgo(-1) }, NOW)!;
    expect(info.days).toBe(0);
  });
});
