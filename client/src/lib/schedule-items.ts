// 김민준 고객 상세의 메모·해야 할 일(체크)·예정 일정 도메인 타입과 표시 정렬 규칙.
// 정렬은 저장/추가 순서와 별개인 "화면 표시 규칙"이다(2026-06-11 합의):
//   - 메모: 작성일(시:분) 오름차순
//   - 해야 할 일: 완료 항목 먼저, 그다음 미완료를 급함→오늘→내일→이번 주→지정 순
//   - 예정 일정: 날짜+시간 오름차순
import { kimCheckDueDateRank, kimCheckDueRank, kimTimeLabelMinutes } from "./detail-utils";

export type KimScheduleItem = {
  id: string;
  date: string;
  time: string;
  type: string;
  memo: string;
};

export type KimCheckItem = {
  id: string;
  category: string;
  due: string;
  body: string;
};

export type KimCustomerMemoItem = {
  id: string;
  body: string;
  createdAt: string;
};

export function scheduleRecordKey(item: KimScheduleItem) {
  return item.id;
}

export function sortKimCustomerMemosByCreatedAt(items: KimCustomerMemoItem[]) {
  return [...items].sort((left, right) => {
    const minuteDiff = kimTimeLabelMinutes(left.createdAt) - kimTimeLabelMinutes(right.createdAt);
    if (minuteDiff !== 0) return minuteDiff;
    return left.id.localeCompare(right.id);
  });
}

export function sortKimCheckItemsByWorkRule(items: KimCheckItem[], completedItemIds: string[]) {
  const completedSet = new Set(completedItemIds);
  return [...items].sort((left, right) => {
    const leftCompleted = completedSet.has(left.id);
    const rightCompleted = completedSet.has(right.id);
    if (leftCompleted !== rightCompleted) return leftCompleted ? -1 : 1;
    if (leftCompleted && rightCompleted) return items.indexOf(left) - items.indexOf(right);
    const dueDiff = kimCheckDueRank(left.due) - kimCheckDueRank(right.due);
    if (dueDiff !== 0) return dueDiff;
    const dateDiff = kimCheckDueDateRank(left.due) - kimCheckDueDateRank(right.due);
    if (dateDiff !== 0) return dateDiff;
    return items.indexOf(left) - items.indexOf(right);
  });
}

export function kimScheduleSortValue(item: KimScheduleItem) {
  const dateValue = item.date || "9999-12-31";
  const timeValue = item.time || "23:59";
  return `${dateValue}T${timeValue}`;
}

export function sortKimSchedulesByDateTime(items: KimScheduleItem[]) {
  return [...items].sort((left, right) => {
    const dateTimeDiff = kimScheduleSortValue(left).localeCompare(kimScheduleSortValue(right));
    if (dateTimeDiff !== 0) return dateTimeDiff;
    return items.indexOf(left) - items.indexOf(right);
  });
}
