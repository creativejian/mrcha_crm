// 견적 가격 패널 순수 계산. DOM/React 비의존 — 단위 테스트 가능.
// 합산 공식(1단계, 포함/불포함 분류는 정적): ref/specs/2026-06-15-quote-price-injection-design.md

export function parseMoney(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  if (digits === "") return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export type PricingInputs = {
  basePrice: number;
  optionPrice: number;
  discount: number;
  acquisitionTax: number;
  bond: number;
  delivery: number;
  incidental: number;
};

export type PricingResult = {
  finalVehiclePrice: number;
  registrationCost: number;
  otherCost: number;
  acquisitionCost: number;
};

export function computePricing(inputs: PricingInputs): PricingResult {
  const finalVehiclePrice = inputs.basePrice + inputs.optionPrice - inputs.discount;
  const registrationCost = inputs.acquisitionTax + inputs.bond;
  const otherCost = inputs.delivery + inputs.incidental;
  const acquisitionCost = finalVehiclePrice + registrationCost;
  return { finalVehiclePrice, registrationCost, otherCost, acquisitionCost };
}
