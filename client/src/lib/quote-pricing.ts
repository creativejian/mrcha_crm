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

// percent 입력 파싱 SSOT — 파생(보증금/선수금/잔가 %)·전송(솔루션 조회)·할인 행 %가 공유.
// digits+최초 소수점만 유효(여분 소수점은 흡수 — "4.5.5"→4.55), 비유한은 0(할인 payload NaN 오염 차단).
// 콤마 오입력("10,5")은 콤마가 제거돼 "105"→105가 되고, 상한 소비처(wonOf 등)가 >100 fail-loud로 차단한다.
export function parsePercentInput(raw: string): number {
  const normalized = raw.replace(/[^\d.]/g, "");
  const [head = "", ...rest] = normalized.split(".");
  const n = Number(rest.length ? `${head}.${rest.join("")}` : head);
  return Number.isFinite(n) ? n : 0;
}

// percent → 원 환산 코어 산술 SSOT. 환산 기준(basis) 대비 pct%를 원화로(반올림).
// 파싱·상한(null/0)은 소비처가 각자 래핑 — discountLineWon(quote-workbench-meta)·
// wonOf(solution-quote)·residualAmountOf(lease-rate) 3소비처가 이 코어를 공유(순환 없는 leaf).
export function percentToWon(basis: number, pct: number): number {
  return Math.round(basis * pct / 100);
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
