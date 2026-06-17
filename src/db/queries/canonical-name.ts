// 트림 canonical_name 파생 — 앱 caller(mr-cha-app: show_add_panel.dart)와 동일 규칙.
// 국산: "{brand} {model} {trimName}", 수입: "{brand} {model} {modelYear} {fuelType} {trimName}".
// 다중 공백을 1칸으로 접고 앞뒤 공백 제거(빈 brand/model 방어).
export function buildCanonicalName(input: {
  brand: string;
  model: string;
  isDomestic: boolean;
  modelYear: number;
  fuelType: string;
  trimName: string;
}): string {
  const parts = input.isDomestic
    ? [input.brand, input.model, input.trimName]
    : [input.brand, input.model, String(input.modelYear), input.fuelType, input.trimName];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
