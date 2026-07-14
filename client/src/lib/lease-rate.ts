// client/src/lib/lease-rate.ts
// 리스 실질(내재) 금리 + 비교카드 결과 4필드 파생(스펙 개정 1 R3). 부작용 0 순수 모듈.
// calculateRate 원본 = mr-cha-app `supabase/functions/ai-analyst/utils/lease_calc.ts`
// — 앱 리스계산기와 동기. 수학 수정 금지(Excel RATE, Newton-Raphson secant).

import { parseMoney, parsePercentInput, percentToWon } from "./quote-pricing";

export function calculateRate(
  periods: number,
  payment: number,
  present: number,
  future: number = 0,
  type: number = 0,
  guess: number = 0.01,
): number {
  const epsMax = 1e-10;
  const iterMax = 20;

  const calculateY = (r: number) => {
    if (Math.abs(r) < epsMax) {
      return present * (1 + periods * r) + payment * (1 + r * type) * periods + future;
    } else {
      const f_inner = Math.exp(periods * Math.log(1 + r));
      return present * f_inner + payment * (1 / r + type) * (f_inner - 1) + future;
    }
  };

  // 원본의 "선언 0 초기화 후 재대입" 패턴만 lint(no-useless-assignment) 맞춰 선언+초기값으로 합침 — 값 흐름 동일.
  let rate = guess;
  let y0 = present + payment * periods + future;
  let y1 = calculateY(rate);
  let x0 = 0;
  let x1 = rate;

  let i = 0;
  while (Math.abs(y0 - y1) > epsMax && i < iterMax) {
    rate = (y1 * x0 - y0 * x1) / (y1 - y0);
    x0 = x1;
    x1 = rate;
    y0 = y1;
    y1 = calculateY(rate);
    i++;
  }

  return rate;
}

export type DeriveCardResultsArgs = {
  monthly: number; // 월납입 원
  termMonths: number;
  downPayment: number; // 선수금 원(모드 환산 후)
  deposit: number; // 보증금 원(모드 환산 후)
  residualAmount: number | null; // 해석된 잔가 금액(null = 미정)
  otherCost: number; // 기타비용(탁송료+부대비용 — quote-pricing otherCost)
  acquisitionCost: number; // 취득원가(quote-pricing SSOT)
};

export type DerivedCardResults = {
  totalReturn: number | null; // 월납입×기간 + 선수금
  totalTakeover: number | null; // 월납입×기간 + 잔가 + 선수금(잔가 미정 → null)
  dueAtDelivery: number | null; // 보증금 + 선수금 + 기타비용
  ratePct: number | null; // RATE 역산 연이율 %(소수 2자리 반올림 표시)
};

// 결과 4필드 파생(유슨생 확정 산식). 월 납입금이 결정되면(솔루션 조회든 수기든) 채워지는 형태 —
// monthly<=0이면 전 필드 균일 공란.
// ⚠️ 금리 PV = -(취득원가 - 선수금): 선수금만 차감하고 보증금은 PV 미포함(앱 lease_calc 의도적 비대칭 —
// 보증금은 월납입 PV에 반영하지 않는다). 의미론 = 실질(내재) 금리 — 금융사 표면금리(제프 응답 5.32%류)와
// 다른 값(스펙 개정 1 박제).
export function deriveCardResults(args: DeriveCardResultsArgs): DerivedCardResults {
  if (args.monthly <= 0) return { totalReturn: null, totalTakeover: null, dueAtDelivery: null, ratePct: null };
  const paymentsTotal = args.monthly * args.termMonths;
  const totalReturn = paymentsTotal + args.downPayment;
  const totalTakeover = args.residualAmount != null ? paymentsTotal + args.residualAmount + args.downPayment : null;
  const dueAtDelivery = args.deposit + args.downPayment + args.otherCost;
  let ratePct: number | null = null;
  if (args.acquisitionCost > 0 && args.residualAmount != null) {
    // 앱 calculateLeaseDetails 관례 미러: guess 0.0001, 연이율 = 월이율 × 1200. 비유한/비양수/100% 초과 = 공란.
    const monthlyRate = calculateRate(args.termMonths, args.monthly, -(args.acquisitionCost - args.downPayment), args.residualAmount, 0, 0.0001);
    const annual = monthlyRate * 1200;
    ratePct = Number.isFinite(annual) && annual > 0 && annual <= 100 ? Math.round(annual * 100) / 100 : null;
  }
  return { totalReturn, totalTakeover, dueAtDelivery, ratePct };
}

// 잔존가치 금액 해석(개정 1 R3): 금액 = 입력값 / % = 할인 전 차량가(base+option — 솔루션 입력 환산과 동일
// 기준) / 최대 = 솔루션 조회가 채운 실채택 잔가(조회 전 "-"/빈값 = 미정 → null → 인수·금리 공란).
// %는 0·NaN·100 초과를 null(빌더 wonOf의 콤마 오입력 fail-loud 상한 미러 — "45,5" → 455%).
export function residualAmountOf(mode: "max" | "amount" | "percent", raw: string, baseAndOption: number): number | null {
  if (mode === "percent") {
    const pct = parsePercentInput(raw); // 파생·전송·할인 % 공유 파서(0 보장 → NaN 체크 불필요)
    if (pct <= 0 || pct > 100) return null;
    const amount = percentToWon(baseAndOption, pct);
    return amount > 0 ? amount : null;
  }
  const amount = parseMoney(raw);
  return amount > 0 ? amount : null;
}
