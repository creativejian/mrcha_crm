// 트림 canonical_name 파생 — 구 앱 caller(mr-cha-app: show_add_panel.dart, 2026-06-18 read-only
// 전환으로 삭제)와 동일 규칙. 국산: "{brand} {model} {trimName}", 수입: "{brand} {model}
// {modelYear} {fuelType} {trimName}". 다중 공백을 1칸으로 접고 앞뒤 공백 제거(빈 brand/model 방어).
// modelYear/fuelType null은 그 부분 생략 — 구 앱도 `?.toString() ?? ''`로 빈칸 처리했다(DB 컬럼이
// nullable이라 수정·이동 재계산 경로는 null을 만날 수 있다).
export function buildCanonicalName(input: {
  brand: string;
  model: string;
  isDomestic: boolean;
  modelYear: number | null;
  fuelType: string | null;
  trimName: string;
}): string {
  const parts = input.isDomestic
    ? [input.brand, input.model, input.trimName]
    : [input.brand, input.model, input.modelYear?.toString() ?? "", input.fuelType ?? "", input.trimName];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
