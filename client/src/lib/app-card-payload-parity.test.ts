import { describe, expect, it } from "vitest";

import type { QuoteGuidance } from "@/data/quote-guidance";

import {
  buildAdvisorQuotePayload,
  type AdvisorPayloadQuoteRow,
  type AdvisorPayloadScenarioRow,
  type AdvisorQuotePayload,
} from "../../../src/lib/app-card-payload";
import { buildAppCardModel, type AppCardModel, type AppCardModelInput } from "./app-card";
import type { ScenarioInput } from "./customer-quotes";
import { computePricing } from "./quote-pricing";

// ⚠️ 파리티 가드: 클라 app-card.ts(buildAppCardModel) ↔ 서버 src/lib/app-card-payload.ts(buildAdvisorQuotePayload)
// 라벨 로직·문구·포맷은 복제 재현 관계다. 이 테스트가 드리프트를 기계적으로 잡는다
// (doc-type-parity/roles-parity와 같은 tripwire 패턴). red가 나면(=클라 카드 라벨/필드 변경) 갱신 대상은 3곳:
//   ① 서버 조립기 src/lib/app-card-payload.ts — payload 스냅샷 생산
//   ② 인계문 payload 계약표 ref/2026-07-05-app-advisor-quotes-handoff.md 2절 — Flutter가 소비하는 계약 SSOT
//   ③ Flutter 앱(mr-cha-app) 렌더 위젯 — payload 소비자
// 비교 계약: payload = 클라 모델 − {statusLabel, ddayLabel}(앱이 컬럼에서 계산) + payloadVersion.

// 앱이 viewed_at/valid_until 컬럼으로 계산하는 클라 전용 표시 필드(스냅샷하면 "D-7" 박제 버그 — 스펙 결정 2).
const CLIENT_ONLY_KEYS = ["statusLabel", "ddayLabel"];

// footerStampLabel은 값 비교에서 제외한다. 서버는 KST(+9) 고정 환산, 클라 formatActivity는 브라우저 로컬 TZ —
// 프로덕션(상담사 브라우저=KST)에선 일치하지만, 비-KST 테스트 러너에서는 시각이 어긋나 스퓨리어스 실패한다.
// 대신 양쪽 모두 "YY/MM/DD HH:mm" 포맷을 assert해 포맷 드리프트만 가드한다.
const STAMP_FORMAT = /^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/;

const SENT_AT_ISO = "2026-07-05T03:04:00.000Z";
const QUOTE_CODE = "QT-2607-0001";
const MODEL_YEAR = 2026;

// 견적 원시 금액(원) — 양쪽 픽스처의 단일 의미 소스. 서버 numeric 컬럼은 string, 클라 입력은 number.
const PRICES = {
  basePrice: 74_300_000,
  optionTotal: 1_000_000,
  discount: 1_000_000,
  acquisitionTax: 5_200_000,
  bond: 300_000,
  delivery: 0,
  incidental: 100_000,
};

// 클라 파생가는 서버 재계산과 같은 공식(quote-pricing.ts computePricing)으로 산출해야 동치가 성립한다:
// fvp = base + option − discount, reg = tax + bond, acq = fvp + reg.
const pricing = computePricing({
  basePrice: PRICES.basePrice,
  optionPrice: PRICES.optionTotal,
  discount: PRICES.discount,
  acquisitionTax: PRICES.acquisitionTax,
  bond: PRICES.bond,
  delivery: PRICES.delivery,
  incidental: PRICES.incidental,
});

// guidance는 non-null로 고정 — 서버의 null guidance 폴백(빈 guidance)은 클라 DEFAULT_QUOTE_GUIDANCE
// 시드 폴백과 의도적으로 다른 이탈(제안문 발송 방지)이라 파리티 비교 대상이 아니다.
const guidance: QuoteGuidance = {
  deliveryComment: "이 차량은 1주일 내 출고 가능해요",
  stockNotice: "즉시 출고 가능",
  expectedDelivery: "1주일 이내",
  customerRegion: "인천",
  keyPoints: [" 잔존가치 최대 조건 ", "", "초기 부담 최소"],
  recommendReason: "이유1\n 이유2 \n\n",
  services: ["썬팅: 후퍼옵틱 KBR", "블랙박스 기본", " "],
};

// 케이스 1 — 운용리스: 보증금 percent 병기 경로(환산 기준=finalVehiclePrice).
const leaseScenario: AdvisorPayloadScenarioRow = {
  purchaseMethod: "운용리스",
  lender: "BMW파이낸셜",
  termMonths: 48,
  depositMode: "percent",
  depositValue: "30",
  downPaymentMode: "none",
  downPaymentValue: "0",
  residualMode: "percent",
  residualValue: "58",
  mileageValue: "20,000km / 년",
  carTaxIncluded: true,
  subsidyApplicable: false,
  subsidyAmount: "0",
  monthlyPayment: "2398000",
  totalReturnCost: "12345678",
  totalTakeoverCost: "23456789",
  dueAtDelivery: "5500000",
  interestRate: "5.3",
};

// 케이스 2 — 할부: 선납금(amount 모드) 경로(downPaymentRowLabel 분기).
const installmentScenario: AdvisorPayloadScenarioRow = {
  ...leaseScenario,
  purchaseMethod: "할부",
  lender: "현대캐피탈",
  depositMode: "none",
  depositValue: "0",
  downPaymentMode: "amount",
  downPaymentValue: "10000000",
  residualMode: "amount",
  residualValue: "43094000",
};

// 동일 의미 픽스처 2벌을 한 시나리오 행에서 조립한다(null = 대표 시나리오 없는 견적).
// 서버 행(AdvisorPayloadScenarioRow)은 클라 ScenarioInput의 구조적 부분집합이라 그대로 재사용 —
// 값 대응(운용리스 "30" ↔ "30" 등)을 손으로 두 벌 쓰다 어긋나는 실수를 원천 차단한다.
function buildBoth(scenario: AdvisorPayloadScenarioRow | null): { clientModel: AppCardModel; payload: AdvisorQuotePayload } {
  const serverQuote: AdvisorPayloadQuoteRow = {
    quoteCode: QUOTE_CODE,
    brandName: "BMW",
    modelName: "5 Series",
    trimName: "520i M Sport",
    basePrice: String(PRICES.basePrice),
    optionTotal: String(PRICES.optionTotal),
    options: [{ trim_option_id: 101, name: "썬루프", price: PRICES.optionTotal }],
    discountLines: [{ label: "프로모션", amount: PRICES.discount, unit: "amount" }],
    finalDiscount: String(PRICES.discount),
    acquisitionTax: String(PRICES.acquisitionTax),
    acquisitionTaxMode: "normal",
    bond: String(PRICES.bond),
    delivery: String(PRICES.delivery),
    incidental: String(PRICES.incidental),
    exteriorColorName: "알파인 화이트",
    interiorColorName: "블랙",
    guidance,
  };

  const clientScenario: ScenarioInput | null = scenario;
  const clientInput: AppCardModelInput = {
    brandName: "BMW",
    modelName: "5 Series",
    trimName: "520i M Sport",
    modelYear: MODEL_YEAR,
    basePrice: PRICES.basePrice,
    optionTotal: PRICES.optionTotal,
    optionNames: ["썬루프"],
    discount: PRICES.discount,
    discountLabels: ["프로모션"],
    finalVehiclePrice: pricing.finalVehiclePrice,
    acquisitionTax: PRICES.acquisitionTax,
    acquisitionTaxMode: "normal",
    bond: PRICES.bond,
    delivery: PRICES.delivery,
    incidental: PRICES.incidental,
    registrationCost: pricing.registrationCost,
    acquisitionCost: pricing.acquisitionCost,
    exteriorColorName: "알파인 화이트",
    interiorColorName: "블랙",
    guidance,
    // 클라는 워크벤치 state, 서버는 대표 시나리오 행에서 조달 — 같은 견적이면 같은 값(서버 조립기 주석 참조).
    // 시나리오 없으면 서버가 ""를 쓰므로 클라 입력도 ""로 대응(동일 의미).
    purchaseMethod: scenario?.purchaseMethod ?? "",
    scenario: clientScenario,
    quoteCode: QUOTE_CODE,
    appStatus: "sent",
    sentAtIso: SENT_AT_ISO,
    validUntilIso: null,
    nowMs: Date.parse(SENT_AT_ISO),
  };

  return {
    clientModel: buildAppCardModel(clientInput),
    payload: buildAdvisorQuotePayload(serverQuote, scenario, { modelYear: MODEL_YEAR, sentAtIso: SENT_AT_ISO }).payload,
  };
}

function assertParity(clientModel: AppCardModel, payload: AdvisorQuotePayload): void {
  // 필드 집합 완전성 잠금 — 기대 키를 클라 모델에서 파생하므로, 클라에 표시 필드가 추가되면
  // 서버 payload에 반영(또는 CLIENT_ONLY_KEYS 결정)하기 전까지 여기서 자동으로 깨진다.
  const expectedKeys = [
    ...Object.keys(clientModel).filter((k) => !CLIENT_ONLY_KEYS.includes(k)),
    "payloadVersion",
  ].sort();
  expect(
    Object.keys(payload).sort(),
    "payload 키 집합 드리프트 — 새 표시 필드는 서버 조립기(src/lib/app-card-payload.ts)·인계문 계약표(ref/2026-07-05-app-advisor-quotes-handoff.md 2절)·Flutter 앱(mr-cha-app) 3곳에 전파할 것",
  ).toEqual(expectedKeys);

  // payloadVersion 값 고정 — 키 존재는 위 잠금이 보지만 값(계약 버전)은 별도 검증.
  expect(payload.payloadVersion).toBe(1);

  // 공유 키 전부 값 비교 — 실패 메시지에 키 이름을 실어 어느 라벨이 어긋났는지 바로 보이게 한다.
  const clientRec: Record<string, unknown> = clientModel;
  const payloadRec: Record<string, unknown> = payload;
  for (const key of Object.keys(clientModel)) {
    if (CLIENT_ONLY_KEYS.includes(key) || key === "footerStampLabel") continue;
    expect(payloadRec[key], key).toEqual(clientRec[key]);
  }

  // footerStampLabel — TZ 차이로 값 비교 제외(파일 상단 주석), 포맷만 양쪽 가드.
  expect(clientModel.footerStampLabel).toMatch(STAMP_FORMAT);
  expect(payload.footerStampLabel).toMatch(STAMP_FORMAT);
}

describe("발송 payload 클라↔서버 파리티", () => {
  it("운용리스 — percent 보증금 병기 라벨까지 전 필드 일치", () => {
    const { clientModel, payload } = buildBoth(leaseScenario);
    // 픽스처가 percent 병기 경로를 실제로 지나는지 값으로 고정(양쪽이 폴백으로 우연히 일치하는 무의미 green 방지).
    expect(clientModel.depositLabel).toBe("(30%) 22,290,000원");
    assertParity(clientModel, payload);
  });

  it("할부 — 선납금(amount 모드) 어휘 분기까지 전 필드 일치", () => {
    const { clientModel, payload } = buildBoth(installmentScenario);
    expect(clientModel.downPaymentRowLabel).toBe("선납금");
    expect(clientModel.downPaymentLabel).toBe("10,000,000원");
    assertParity(clientModel, payload);
  });

  it("시나리오 없음 — null 폴백(조건 미정·금융사 미정·계산 후 안내 등)까지 전 필드 일치", () => {
    const { clientModel, payload } = buildBoth(null);
    expect(clientModel.hasScenario).toBe(false);
    assertParity(clientModel, payload);
  });
});
