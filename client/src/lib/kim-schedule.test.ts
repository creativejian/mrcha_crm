import { describe, expect, it } from "vitest";

import {
  kimScheduleSortValue,
  scheduleRecordKey,
  sortKimCheckItemsByWorkRule,
  sortKimCustomerMemosByCreatedAt,
  sortKimSchedulesByDateTime,
  type KimCheckItem,
  type KimCustomerMemoItem,
  type KimScheduleItem,
} from "./kim-schedule";

describe("scheduleRecordKey", () => {
  it("일정의 id를 키로 반환한다", () => {
    expect(scheduleRecordKey({ id: "s1", date: "", time: "", type: "", memo: "" })).toBe("s1");
  });
});

describe("sortKimCustomerMemosByCreatedAt", () => {
  it("작성 시각(시:분) 오름차순으로 정렬한다", () => {
    const memos: KimCustomerMemoItem[] = [
      { id: "a", body: "오후", createdAt: "26/05/14 16:08" },
      { id: "b", body: "오전", createdAt: "26/05/14 09:30" },
      { id: "c", body: "점심", createdAt: "26/05/14 13:18" },
    ];
    expect(sortKimCustomerMemosByCreatedAt(memos).map((m) => m.id)).toEqual(["b", "c", "a"]);
  });
  it("같은 시각이면 id로 안정 정렬한다", () => {
    const memos: KimCustomerMemoItem[] = [
      { id: "z", body: "", createdAt: "26/05/14 10:00" },
      { id: "a", body: "", createdAt: "26/05/14 10:00" },
    ];
    expect(sortKimCustomerMemosByCreatedAt(memos).map((m) => m.id)).toEqual(["a", "z"]);
  });
  it("원본 배열을 변형하지 않는다(불변)", () => {
    const memos: KimCustomerMemoItem[] = [
      { id: "a", body: "", createdAt: "26/05/14 16:00" },
      { id: "b", body: "", createdAt: "26/05/14 09:00" },
    ];
    sortKimCustomerMemosByCreatedAt(memos);
    expect(memos.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("sortKimCheckItemsByWorkRule", () => {
  const items: KimCheckItem[] = [
    { id: "week", category: "", due: "이번 주", body: "" },
    { id: "today", category: "", due: "오늘", body: "" },
    { id: "urgent", category: "", due: "급함", body: "" },
    { id: "tomorrow", category: "", due: "내일", body: "" },
  ];
  it("미완료는 급함→오늘→내일→이번 주 순", () => {
    expect(sortKimCheckItemsByWorkRule(items, []).map((i) => i.id)).toEqual([
      "urgent",
      "today",
      "tomorrow",
      "week",
    ]);
  });
  it("완료 항목을 미완료보다 위로 올린다", () => {
    expect(sortKimCheckItemsByWorkRule(items, ["week"]).map((i) => i.id)).toEqual([
      "week",
      "urgent",
      "today",
      "tomorrow",
    ]);
  });
  it("지정 날짜(M/D)는 같은 due 랭크 내에서 날짜 오름차순", () => {
    const dated: KimCheckItem[] = [
      { id: "late", category: "", due: "5/20", body: "" },
      { id: "early", category: "", due: "5/10", body: "" },
    ];
    expect(sortKimCheckItemsByWorkRule(dated, []).map((i) => i.id)).toEqual(["early", "late"]);
  });
});

describe("kimScheduleSortValue / sortKimSchedulesByDateTime", () => {
  it("빈 날짜/시간은 맨 뒤로 가는 fallback 값", () => {
    expect(kimScheduleSortValue({ id: "x", date: "", time: "", type: "", memo: "" })).toBe("9999-12-31T23:59");
    expect(kimScheduleSortValue({ id: "y", date: "2026-05-14", time: "09:00", type: "", memo: "" })).toBe("2026-05-14T09:00");
  });
  it("날짜+시간 오름차순으로 정렬한다", () => {
    const schedules: KimScheduleItem[] = [
      { id: "b", date: "2026-05-14", time: "16:00", type: "", memo: "" },
      { id: "a", date: "2026-05-14", time: "09:00", type: "", memo: "" },
      { id: "c", date: "2026-05-15", time: "08:00", type: "", memo: "" },
    ];
    expect(sortKimSchedulesByDateTime(schedules).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
