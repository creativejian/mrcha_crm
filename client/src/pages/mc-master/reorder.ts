import { groupTrimsBySubline } from "./trim-grouping";

// 배열에서 from→to로 항목 이동(드래그 순서변경의 순수 로직).
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// fromKey 서브라인 그룹을 toKey 그룹 위치로 통째 이동한 새 배열(그룹 내 순서 유지) — 목록 보기
// '선택'의 그룹 드래그(이사님 요청 2026-08-03 — 구 ↑/↓ 패널은 드래그로 대체·폐기). 결과를
// reorderTrims(전체 id에 1..N 재부여)에 그대로 넘긴다. 같은 키·없는 키는 **원본 참조 그대로**
// 반환 — 호출부가 no-op을 판별해 불필요한 setState를 건너뛴다(moveItem과 같은 계약).
// 흩어진 그룹(같은 서브라인이 비연속)은 첫 등장 위치 기준으로 한 덩어리로 모인다 — 부작용이
// 아니라 정리 효과다(그룹 뷰(groupTrimsBySubline)가 이미 그렇게 묶어 보여주고 있다).
export function moveGroupToKey<T extends { trimName: string }>(list: T[], fromKey: string, toKey: string): T[] {
  if (fromKey === toKey) return list;
  const groups = groupTrimsBySubline(list);
  const from = groups.findIndex((g) => g.key === fromKey);
  const to = groups.findIndex((g) => g.key === toKey);
  if (from < 0 || to < 0) return list;
  return moveItem(groups, from, to).flatMap((g) => g.trims);
}
