import { describe, expect, it } from "vitest";

import { auditSummary, availabilityBadge, parseWeekSchedule, scheduleDraftErrors, type WeekSchedule } from "./handoff-settings";

// 운영 설정은 공유 master의 singleton 행이고 schedule은 jsonb다. DB CHECK + RPC가 형식을
// 지키지만, 클라는 "그럼에도 이상한 값이 오면 휴무로 읽는" 방어 파싱을 유지한다 —
// 깨진 값이 폼에 NaN/undefined로 번지면 저장 한 번에 계약 위반 payload가 되기 때문.

const FULL_WEEK: WeekSchedule = {
  mon: { start: "09:00", end: "18:00" },
  tue: { start: "09:00", end: "18:00" },
  wed: { start: "09:00", end: "18:00" },
  thu: { start: "09:00", end: "18:00" },
  fri: { start: "09:00", end: "18:00" },
  sat: null,
  sun: null,
};

describe("parseWeekSchedule", () => {
  it("시드 형태(월~금 운영·주말 null)를 그대로 파싱한다", () => {
    expect(
      parseWeekSchedule({
        mon: { start: "09:00", end: "18:00" },
        tue: { start: "09:00", end: "18:00" },
        wed: { start: "09:00", end: "18:00" },
        thu: { start: "09:00", end: "18:00" },
        fri: { start: "09:00", end: "18:00" },
        sat: null,
        sun: null,
      }),
    ).toEqual(FULL_WEEK);
  });

  it("객체가 아니면 전 요일 휴무로 읽는다(fail-safe)", () => {
    const closed = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
    expect(parseWeekSchedule(null)).toEqual(closed);
    expect(parseWeekSchedule("broken")).toEqual(closed);
  });

  it("요일 키 누락·형식 이탈은 그 요일만 휴무로 읽는다", () => {
    const parsed = parseWeekSchedule({
      mon: { start: "09:00", end: "18:00" },
      tue: { start: "09:00" }, // end 누락
      wed: { start: 9, end: 18 }, // 숫자
      // thu 키 자체 누락
      fri: { start: "9:00", end: "18:00" }, // HH:MM 이탈(한 자리 시)
      sat: null,
      sun: null,
    });
    expect(parsed.mon).toEqual({ start: "09:00", end: "18:00" });
    expect(parsed.tue).toBeNull();
    expect(parsed.wed).toBeNull();
    expect(parsed.thu).toBeNull();
    expect(parsed.fri).toBeNull();
  });

  it("자정 넘김(start>end)·24시간(start==end)은 유효한 값으로 보존한다", () => {
    const parsed = parseWeekSchedule({ ...FULL_WEEK, fri: { start: "22:00", end: "02:00" }, sat: { start: "00:00", end: "00:00" } });
    expect(parsed.fri).toEqual({ start: "22:00", end: "02:00" });
    expect(parsed.sat).toEqual({ start: "00:00", end: "00:00" });
  });
});

describe("scheduleDraftErrors", () => {
  it("정상 draft는 에러 0", () => {
    expect(scheduleDraftErrors(FULL_WEEK)).toEqual([]);
  });

  it("빈 시각·HH:MM 이탈을 요일 라벨과 함께 보고한다", () => {
    const errors = scheduleDraftErrors({ ...FULL_WEEK, tue: { start: "", end: "18:00" }, fri: { start: "25:00", end: "18:00" } });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("화");
    expect(errors[1]).toContain("금");
  });
});

describe("availabilityBadge", () => {
  it("automatic 운영시간 내 = 상담 접수 중(on)", () => {
    expect(availabilityBadge({ available: true, mode: "automatic", reason: "available" })).toEqual({
      label: "상담 접수 중",
      tone: "on",
    });
  });

  it("force_on = 강제 ON임을 구분 표시(on)", () => {
    expect(availabilityBadge({ available: true, mode: "force_on", reason: "available" })).toEqual({
      label: "강제 ON · 상담 접수 중",
      tone: "on",
    });
  });

  it("운영시간 외 = outside 톤", () => {
    expect(availabilityBadge({ available: false, mode: "automatic", reason: "outside_hours" })).toEqual({
      label: "운영시간 외 · 접수 중지",
      tone: "outside",
    });
  });

  it("force_off = off 톤(운영시간과 무관한 전면 차단)", () => {
    expect(availabilityBadge({ available: false, mode: "force_off", reason: "force_off" })).toEqual({
      label: "강제 OFF · 접수 차단",
      tone: "off",
    });
  });
});

describe("auditSummary", () => {
  // old/new는 감사 행의 설정 행 전체 스냅샷(jsonb) — DB 컬럼명(snake_case) 그대로 온다.
  const base = {
    mode: "automatic",
    timezone: "Asia/Seoul",
    schedule: { mon: { start: "09:00", end: "18:00" }, sat: null },
    force_message: "A",
    outside_hours_message: "B",
  };

  it("모드 전이는 한글 라벨 화살표로 요약한다", () => {
    expect(auditSummary(base, { ...base, mode: "force_off" })).toBe("운영시간 적용 → 강제 OFF");
  });

  it("스케줄·문구 변경을 항목별로 병기한다", () => {
    expect(
      auditSummary(base, { ...base, schedule: { ...base.schedule, sat: { start: "10:00", end: "14:00" } }, force_message: "A2" }),
    ).toBe("운영시간 변경 · 안내 문구 변경");
  });

  it("차이가 없으면 '변경 없음'", () => {
    expect(auditSummary(base, { ...base })).toBe("변경 없음");
  });

  it("모드 값이 어휘 밖이어도 죽지 않는다(방어)", () => {
    expect(auditSummary({ ...base, mode: "legacy" }, { ...base, mode: "force_on" })).toBe("legacy → 강제 ON");
  });
});
