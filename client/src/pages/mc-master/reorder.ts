import { groupTrimsBySubline } from "./trim-grouping";

// 배열에서 from→to로 항목 이동(드래그 순서변경의 순수 로직).
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// 서브라인 그룹을 통째로 앞/뒤 그룹과 자리바꿈한 새 배열(그룹 내 순서 유지) — 순서 관리의
// 그룹 단위 이동(이사님 요청 2026-08-03). 결과를 reorderTrims(전체 id에 1..N 재부여)에 그대로
// 넘긴다. 이동 불가(끝 그룹·없는 키)는 **원본 참조 그대로** 반환 — 호출부가 no-op을 판별해
// 불필요한 API 호출을 건너뛴다(moveItem과 같은 계약).
// 흩어진 그룹(같은 서브라인이 비연속)은 첫 등장 위치 기준으로 한 덩어리로 모인다 — 부작용이
// 아니라 정리 효과다(그룹 뷰(groupTrimsBySubline)가 이미 그렇게 묶어 보여주고 있다).
export function moveGroupBySubline<T extends { trimName: string }>(list: T[], key: string, dir: -1 | 1): T[] {
  const groups = groupTrimsBySubline(list);
  const from = groups.findIndex((g) => g.key === key);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= groups.length) return list;
  const reordered = moveItem(groups, from, to);
  return reordered.flatMap((g) => g.trims);
}
