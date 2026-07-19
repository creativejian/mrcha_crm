import { describe, expect, it } from "vitest";

import type { Customer } from "@/data/customers";
import {
  compareDeliverySchedule,
  DELIVERY_PILL_ALL,
  DELIVERY_PILL_IN_PROGRESS,
  DELIVERY_STAGE_PILLS,
  deliveryCountLabel,
  deliveryPillCounts,
  deliveryScheduleLabel,
  matchesDeliveryPill,
  resolveDeliveryScheduleSubmit,
} from "./delivery-console";

const c = (over: Partial<Customer>): Customer => ({
  no: 1, customerId: "CU-0000-0000", receivedAt: "", assignedAt: "", team: "", name: "t",
  customerType: "", customerTypeDetail: "", phone: "", vehicle: "", method: "", advisor: "미배정",
  statusGroup: "계약완료", status: "딜러사계약중", date: "", source: "", talkCount: "", priority: "",
  nextAction: "", aiSummary: "", ...over,
});

describe("pill 어휘·매칭·카운트", () => {
  it("pill 목록 = 진행 중 + 2차 5종 + 전체 (customerStatusGroups 파생 — 사본 없음)", () => {
    expect(DELIVERY_STAGE_PILLS).toEqual(["진행 중", "딜러사계약중", "대리점발주중", "특판발주중", "배정완료", "출고완료", "전체"]);
  });
  it("진행 중 = 출고완료 제외 4단계, 전체 = 모두, 단계 pill = 정확 일치", () => {
    expect(matchesDeliveryPill(DELIVERY_PILL_IN_PROGRESS, "배정완료")).toBe(true);
    expect(matchesDeliveryPill(DELIVERY_PILL_IN_PROGRESS, "출고완료")).toBe(false);
    expect(matchesDeliveryPill(DELIVERY_PILL_ALL, "출고완료")).toBe(true);
    expect(matchesDeliveryPill("배정완료", "배정완료")).toBe(true);
    expect(matchesDeliveryPill("배정완료", "출고완료")).toBe(false);
  });
  it("카운트: 실측 분포(계약중 2·배정 1·출고완료 4) 재현", () => {
    const statuses = ["딜러사계약중", "딜러사계약중", "배정완료", "출고완료", "출고완료", "출고완료", "출고완료"];
    const counts = deliveryPillCounts(statuses);
    expect(counts["진행 중"]).toBe(3);
    expect(counts["딜러사계약중"]).toBe(2);
    expect(counts["대리점발주중"]).toBe(0);
    expect(counts["출고완료"]).toBe(4);
    expect(counts["전체"]).toBe(7);
  });
  it("카운트 라벨: 진행 중 → '진행', 나머지는 pill 그대로", () => {
    expect(deliveryCountLabel(DELIVERY_PILL_IN_PROGRESS)).toBe("진행");
    expect(deliveryCountLabel(DELIVERY_PILL_ALL)).toBe("전체");
    expect(deliveryCountLabel("출고완료")).toBe("출고완료");
  });
  it("빈 배열 카운트 = 7키 전부 0", () => {
    const counts = deliveryPillCounts([]);
    expect(Object.values(counts)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("정렬 비교기(spec §5.5)", () => {
  const at = (date: string, time: string | null) => c({ nextDeliverySchedule: { id: "s", date, time } });
  it("날짜 오름차순, 미지정은 뒤", () => {
    expect(compareDeliverySchedule(at("2026-07-20", null), at("2026-07-25", null))).toBeLessThan(0);
    expect(compareDeliverySchedule(c({}), at("2026-07-25", null))).toBeGreaterThan(0);
    expect(compareDeliverySchedule(c({}), c({}))).toBe(0);
  });
  it("같은 날짜: 시간 오름차순, 시간 미지정은 그 날짜의 뒤", () => {
    expect(compareDeliverySchedule(at("2026-07-25", "09:00"), at("2026-07-25", "14:00"))).toBeLessThan(0);
    expect(compareDeliverySchedule(at("2026-07-25", null), at("2026-07-25", "09:00"))).toBeGreaterThan(0);
    expect(compareDeliverySchedule(at("2026-07-25", "09:00"), at("2026-07-25", "09:00"))).toBe(0);
  });
  it("반대칭: compare(b,a) === -compare(a,b) (시간 null 분기 교차 포함)", () => {
    const pairs: [Customer, Customer][] = [
      [at("2026-07-25", null), at("2026-07-25", "09:00")],
      [at("2026-07-20", null), at("2026-07-25", null)],
      [c({}), at("2026-07-25", null)],
    ];
    for (const [a, b] of pairs) expect(compareDeliverySchedule(b, a)).toBe(-compareDeliverySchedule(a, b));
  });
});

describe("예정일 라벨(KST 지남 판정 — 브라우저 tz 무관 산술)", () => {
  // now = 2026-07-19 16:00Z = 2026-07-20 01:00 KST → KST 오늘 = 07-20 (UTC 날짜 07-19와 다름 = KST semantics 단언)
  const now = new Date("2026-07-19T16:00:00Z");
  it("KST 오늘 이전이면 overdue, 오늘·미래는 아님", () => {
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-19", time: null }, now)?.overdue).toBe(true);
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-20", time: null }, now)?.overdue).toBe(false);
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-21", time: null }, now)?.overdue).toBe(false);
  });
  it("비패딩 날짜도 overdue를 정확 판정한다(파싱값 재조립 비교)", () => {
    expect(deliveryScheduleLabel({ id: "s", date: "2026-7-5", time: null }, now)?.overdue).toBe(true);
  });
  it("표시 = M/D (요일) [HH:mm]", () => {
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-24", time: "14:00" }, now)?.text).toBe("7/24 (금) 14:00");
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-25", time: null }, now)?.text).toBe("7/25 (토)");
    expect(deliveryScheduleLabel({ id: "s", date: "2026-07-24", time: "14:00:00" }, now)?.text).toBe("7/24 (금) 14:00");
    expect(deliveryScheduleLabel(null, now)).toBeNull();
  });
});

describe("팝오버 제출 해석(spec §5.4 — 날짜/시간 텍스트 입력, 2026-07-19 유연 정규화)", () => {
  it("날짜 없음 = invalid", () => {
    expect(resolveDeliveryScheduleSubmit(null, { date: " ", time: "" }).kind).toBe("invalid");
  });
  it("대표 일정 없음 = '출고' 일정 생성(type·done 고정)", () => {
    expect(resolveDeliveryScheduleSubmit(null, { date: "2026-07-24", time: "14:00" })).toEqual({
      kind: "create",
      body: { scheduledDate: "2026-07-24", scheduledTime: "14:00", type: "출고", done: false },
    });
    expect(resolveDeliveryScheduleSubmit(null, { date: "2026-07-24", time: " " })).toMatchObject({
      body: { scheduledTime: null },
    });
  });
  it("대표 일정 있음 = 그 id PATCH(날짜·시간만)", () => {
    expect(resolveDeliveryScheduleSubmit({ id: "sch-1", date: "2026-07-20", time: null }, { date: "2026-07-24", time: "" })).toEqual({
      kind: "update", id: "sch-1", body: { scheduledDate: "2026-07-24", scheduledTime: null },
    });
  });
  it("유연한 날짜 입력(점 구분·무구분)도 YYYY-MM-DD로 정규화해 저장", () => {
    expect(resolveDeliveryScheduleSubmit(null, { date: "2026.7.24", time: "" })).toMatchObject({
      body: { scheduledDate: "2026-07-24" },
    });
    expect(resolveDeliveryScheduleSubmit(null, { date: "20260724", time: "" })).toMatchObject({
      body: { scheduledDate: "2026-07-24" },
    });
  });
  it("유연한 시간 입력(무구분 4자리)도 HH:mm으로 정규화", () => {
    expect(resolveDeliveryScheduleSubmit(null, { date: "2026-07-24", time: "0930" })).toMatchObject({
      body: { scheduledTime: "09:30" },
    });
  });
  it("날짜 형식이 틀리면 invalid + 안내 문구(년-월-일)", () => {
    const result = resolveDeliveryScheduleSubmit(null, { date: "0724", time: "" });
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.reason).toMatch(/년-월-일/);
  });
  it("실존하지 않는 날짜(2026-02-30)는 invalid", () => {
    expect(resolveDeliveryScheduleSubmit(null, { date: "2026-02-30", time: "" }).kind).toBe("invalid");
  });
  it("시간 형식이 틀리면 invalid + 안내 문구(24시간)", () => {
    const result = resolveDeliveryScheduleSubmit(null, { date: "2026-07-24", time: "14시 30분" });
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.reason).toMatch(/24시간/);
  });
});
