// 국산차 trim_name은 '서브라인 - 등급' 형식이다. 트림 관리 '목록 보기'에서 서브라인 단위로 묶는다.
// 그룹핑은 클라이언트 파생(별도 DB 컬럼 없음) — 앱과 동일하게 첫 ' - '를 기준으로 split한다.
const SEP = " - ";

// 서브라인(앞부분). ' - '가 없으면 '기타'.
export function trimSubline(trimName: string): string {
  const i = trimName.indexOf(SEP);
  return i >= 0 ? trimName.slice(0, i).trim() : "기타";
}

// 등급(뒷부분). ' - '가 없으면 원문 그대로.
export function trimGrade(trimName: string): string {
  const i = trimName.indexOf(SEP);
  return i >= 0 ? trimName.slice(i + SEP.length).trim() : trimName;
}

export type TrimGroup<T> = { key: string; trims: T[] };

// 도착 순서(sort_order)를 유지하며 서브라인별로 묶는다. 그룹 순서 = 첫 등장 순서.
export function groupTrimsBySubline<T extends { trimName: string }>(trims: T[]): TrimGroup<T>[] {
  const groups: TrimGroup<T>[] = [];
  const byKey = new Map<string, TrimGroup<T>>();
  for (const trim of trims) {
    const key = trimSubline(trim.trimName);
    let group = byKey.get(key);
    if (!group) {
      group = { key, trims: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.trims.push(trim);
  }
  return groups;
}
