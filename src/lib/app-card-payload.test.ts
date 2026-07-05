import { describe, expect, test } from "bun:test";

import {
  buildAdvisorQuotePayload,
  type AdvisorPayloadQuoteRow,
  type AdvisorPayloadScenarioRow,
} from "./app-card-payload";

// 픽스처 기준: 클라 buildAppCardModel(client/src/lib/app-card.ts) 라벨 재현 검증.
// finalVehiclePrice = 74,300,000 + 1,000,000 - 1,000,000 = 74,300,000 (percent 환산 기준).
const fullQuote: AdvisorPayloadQuoteRow = {
  quoteCode: "QT-2607-0001",
  brandName: "BMW",
  modelName: "5 Series",
  trimName: "520i M Sport",
  basePrice: "74300000",
  optionTotal: "1000000",
  options: [{ id: 1, name: "썬루프", price: 1000000 }],
  discountLines: [{ label: "프로모션", amount: 1000000, unit: "amount" }],
  finalDiscount: "1000000",
  acquisitionTax: "5200000",
  acquisitionTaxMode: "normal",
  bond: "300000",
  delivery: "0",
  incidental: "100000",
  exteriorColorName: "알파인 화이트",
  interiorColorName: "블랙",
  guidance: {
    deliveryComment: "이 차량은 1주일 내 출고 가능해요",
    stockNotice: "즉시 출고 가능",
    expectedDelivery: "1주일 이내",
    customerRegion: "인천",
    keyPoints: [" 잔존가치 최대 조건 ", "", "초기 부담 최소"],
    recommendReason: "이유1\n 이유2 \n\n",
    services: ["썬팅: 후퍼옵틱 KBR", "블랙박스 기본", " "],
  },
};

const fullScenario: AdvisorPayloadScenarioRow = {
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

const SENT_AT = "2026-07-05T03:04:00.000Z"; // KST 2026-07-05 12:04

function quoteRow(over: Partial<AdvisorPayloadQuoteRow> = {}): AdvisorPayloadQuoteRow {
  return { ...fullQuote, ...over };
}

function scenarioRow(over: Partial<AdvisorPayloadScenarioRow> = {}): AdvisorPayloadScenarioRow {
  return { ...fullScenario, ...over };
}

describe("buildAdvisorQuotePayload", () => {
  test("풀필드 운용리스 — percent 병기 어순·환산 기준=finalVehiclePrice", () => {
    const { payload, vehicleLabel, monthlyPayment } = buildAdvisorQuotePayload(quoteRow(), scenarioRow(), {
      modelYear: 2026,
      sentAtIso: SENT_AT,
    });

    // 섹션 1 — 헤더·핵심 요약
    expect(payload.brand).toBe("BMW");
    expect(payload.vehicleTitle).toBe("5 Series 520i M Sport");
    expect(payload.purchaseMethod).toBe("운용리스");
    expect(payload.termLabel).toBe("48개월");
    expect(payload.sublineLabel).toBe("2026년식 ㅣ 74,300,000원 ㅣ 추가옵션 1개");
    expect(payload.monthlyLabel).toBe("2,398,000원");
    expect(payload.rateChipLabel).toBe("금리 5.3%");
    // percent 환산 기준 = finalVehiclePrice(74,300,000) — acquisitionCost(79,800,000)가 아님을 값으로 실증.
    expect(payload.depositLabel).toBe("(30%) 22,290,000원"); // percentFirst
    expect(payload.residualLabel).toBe("43,094,000원 (58%)"); // 금액 선행
    expect(payload.residualCondLabel).toBe("(58%) 43,094,000원"); // percentFirst
    expect(payload.totalCostLabel).toBe("12,345,678원"); // 반납 우선
    expect(payload.discountRowLabel).toBe("최대 할인 적용 (프로모션)");
    expect(payload.discountLabel).toBe("1,000,000");
    expect(payload.mileageLabel).toBe("연 20,000km");
    expect(payload.keyPoints).toEqual(["잔존가치 최대 조건", "초기 부담 최소"]);

    // 섹션 2 — 출고 정보 + 취득원가 구성
    expect(payload.deliveryComment).toBe("이 차량은 1주일 내 출고 가능해요");
    expect(payload.exteriorColorLabel).toBe("알파인 화이트");
    expect(payload.interiorColorLabel).toBe("블랙");
    expect(payload.optionSummaryLabel).toBe("썬루프");
    expect(payload.stockNotice).toBe("즉시 출고 가능");
    expect(payload.expectedDelivery).toBe("1주일 이내");
    expect(payload.customerRegion).toBe("인천");
    expect(payload.basePriceLabel).toBe("74,300,000");
    expect(payload.optionTotalLabel).toBe("1,000,000");
    expect(payload.finalVehiclePriceLabel).toBe("74,300,000");
    expect(payload.acquisitionTaxLabel).toBe("5,200,000");
    expect(payload.acquisitionTaxModeLabel).toBe("일반");
    expect(payload.bondLabel).toBe("300,000");
    expect(payload.deliveryFeeLabel).toBe("0");
    expect(payload.incidentalLabel).toBe("100,000");
    expect(payload.registrationCostLabel).toBe("5,500,000"); // 취득세+공채
    expect(payload.acquisitionCostLabel).toBe("79,800,000"); // fvp+등록비용

    // 섹션 3 — 추천 견적 조건
    expect(payload.hasScenario).toBe(true);
    expect(payload.lenderLabel).toBe("BMW파이낸셜");
    expect(payload.downPaymentRowLabel).toBe("선수금");
    expect(payload.downPaymentLabel).toBe("없음"); // mode none
    expect(payload.carTaxLabel).toBe("포함");
    expect(payload.subsidyLabel).toBe("해당 없음");
    expect(payload.rateLabel).toBe("5.3%");
    expect(payload.totalReturnCostLabel).toBe("12,345,678원");
    expect(payload.totalTakeoverCostLabel).toBe("23,456,789원");
    expect(payload.dueAtDeliveryLabel).toBe("5,500,000원");

    // 섹션 4 — 추천 이유 + 서비스 + 푸터
    expect(payload.recommendReasons).toEqual(["이유1", "이유2"]);
    expect(payload.services).toEqual([
      { label: "썬팅", value: "후퍼옵틱 KBR" },
      { label: "", value: "블랙박스 기본" },
    ]);
    expect(payload.footerStampLabel).toBe("26/07/05 12:04"); // KST 고정 환산(서버 UTC 런타임 무관)
    expect(payload.quoteCodeLabel).toBe("QT-2607-0001");

    // 정규 컬럼 반환값
    expect(vehicleLabel).toBe("BMW 5 Series 520i M Sport");
    expect(monthlyPayment).toBe(2398000);
  });

  test("payload 계약 — statusLabel/ddayLabel 미포함 + payloadVersion 1", () => {
    const { payload } = buildAdvisorQuotePayload(quoteRow(), scenarioRow(), { modelYear: 2026, sentAtIso: SENT_AT });
    expect(payload.payloadVersion).toBe(1);
    // 앱이 viewed_at/valid_until 컬럼에서 계산하는 필드 — 스냅샷 포함 시 D-7 박제 버그.
    expect("statusLabel" in payload).toBe(false);
    expect("ddayLabel" in payload).toBe(false);
  });

  test("할부 — downPaymentRowLabel=선납금, 금액 모드", () => {
    const { payload } = buildAdvisorQuotePayload(
      quoteRow(),
      scenarioRow({ purchaseMethod: "할부", downPaymentMode: "amount", downPaymentValue: "10000000" }),
      { modelYear: 2026, sentAtIso: SENT_AT },
    );
    expect(payload.purchaseMethod).toBe("할부");
    expect(payload.downPaymentRowLabel).toBe("선납금");
    expect(payload.downPaymentLabel).toBe("10,000,000원");
  });

  test("시나리오 없음 — hasScenario=false + 섹션3 폴백", () => {
    const { payload, monthlyPayment } = buildAdvisorQuotePayload(quoteRow(), null, {
      modelYear: 2026,
      sentAtIso: SENT_AT,
    });
    expect(payload.hasScenario).toBe(false);
    expect(payload.termLabel).toBe("조건 미정");
    expect(payload.monthlyLabel).toBe("계산 후 안내");
    expect(payload.rateChipLabel).toBeNull();
    expect(payload.residualLabel).toBe("계산 후 안내");
    expect(payload.residualCondLabel).toBe("계산 후 안내");
    expect(payload.totalCostLabel).toBe("계산 후 안내");
    expect(payload.depositLabel).toBe("조건 미정");
    expect(payload.mileageLabel).toBe("연 20,000km");
    expect(payload.lenderLabel).toBe("금융사 미정");
    expect(payload.downPaymentLabel).toBe("없음");
    expect(payload.downPaymentRowLabel).toBe("선수금"); // purchaseMethod "" → 할부 아님
    expect(payload.purchaseMethod).toBe("");
    expect(payload.carTaxLabel).toBe("불포함");
    expect(payload.subsidyLabel).toBe("해당 없음");
    expect(payload.rateLabel).toBe("—");
    expect(payload.totalReturnCostLabel).toBe("—");
    expect(payload.totalTakeoverCostLabel).toBe("—");
    expect(payload.dueAtDeliveryLabel).toBe("—");
    expect(monthlyPayment).toBeNull();
  });

  test("guidance legacy keyPoint 단수 → keyPoints 승격, 배열 있으면 배열 우선", () => {
    const legacy = buildAdvisorQuotePayload(
      quoteRow({ guidance: { keyPoint: " 포인트 하나 ", deliveryComment: "코멘트" } }),
      scenarioRow(),
      { modelYear: 2026, sentAtIso: SENT_AT },
    ).payload;
    expect(legacy.keyPoints).toEqual(["포인트 하나"]);
    expect(legacy.deliveryComment).toBe("코멘트");

    const both = buildAdvisorQuotePayload(
      quoteRow({ guidance: { keyPoints: ["신형"], keyPoint: "구형" } }),
      scenarioRow(),
      { modelYear: 2026, sentAtIso: SENT_AT },
    ).payload;
    expect(both.keyPoints).toEqual(["신형"]); // 클라 normalizeQuoteGuidance 동작: 배열 우선
  });

  test("guidance null 방어 — 빈 guidance(기본 제안문 주입 금지)", () => {
    const { payload } = buildAdvisorQuotePayload(quoteRow({ guidance: null }), scenarioRow(), {
      modelYear: 2026,
      sentAtIso: SENT_AT,
    });
    expect(payload.deliveryComment).toBe("");
    expect(payload.stockNotice).toBe("");
    expect(payload.expectedDelivery).toBe("");
    expect(payload.customerRegion).toBe("");
    expect(payload.keyPoints).toEqual([]);
    expect(payload.recommendReasons).toEqual([]);
    expect(payload.services).toEqual([]);
  });

  test("빈 값 폴백 — 클라 문구 그대로(—·계산 후 안내·미선택 등)", () => {
    const { payload, vehicleLabel, monthlyPayment } = buildAdvisorQuotePayload(
      quoteRow({
        brandName: null,
        modelName: null,
        trimName: null,
        basePrice: null,
        optionTotal: null,
        options: null,
        discountLines: null,
        finalDiscount: null,
        acquisitionTax: null,
        acquisitionTaxMode: null,
        bond: null,
        delivery: null,
        incidental: null,
        exteriorColorName: null,
        interiorColorName: null,
        guidance: null,
      }),
      scenarioRow({
        purchaseMethod: null,
        lender: null,
        termMonths: null,
        depositMode: null,
        depositValue: null,
        downPaymentMode: null,
        downPaymentValue: null,
        residualMode: null,
        residualValue: null,
        mileageValue: null,
        carTaxIncluded: null,
        subsidyApplicable: true, // 보조금 해당인데 금액 미입력 → NO_SOURCE 경로
        subsidyAmount: null,
        monthlyPayment: null,
        totalReturnCost: null,
        totalTakeoverCost: null,
        dueAtDelivery: null,
        interestRate: null,
      }),
      { modelYear: null, sentAtIso: "" },
    );
    expect(payload.brand).toBe("차량 미선택");
    expect(payload.vehicleTitle).toBe("차량 미선택");
    expect(payload.sublineLabel).toBe("0원 ㅣ 추가옵션 없음"); // 년식 없음 → 항목 제외
    expect(payload.monthlyLabel).toBe("계산 후 안내");
    expect(payload.rateChipLabel).toBeNull();
    expect(payload.residualLabel).toBe("계산 후 안내"); // residualMode null
    expect(payload.depositLabel).toBe("0원 (무보증)"); // depositMode null
    expect(payload.discountRowLabel).toBe("최대 할인 적용"); // discountLines 없음 → 괄호 없음
    expect(payload.discountLabel).toBe("0");
    expect(payload.mileageLabel).toBe("연 20,000km");
    expect(payload.exteriorColorLabel).toBe("미선택");
    expect(payload.interiorColorLabel).toBe("미선택");
    expect(payload.optionSummaryLabel).toBe("없음");
    expect(payload.acquisitionTaxModeLabel).toBe("일반"); // mode null → normal
    expect(payload.basePriceLabel).toBe("0");
    expect(payload.finalVehiclePriceLabel).toBe("0");
    expect(payload.termLabel).toBe("조건 미정");
    expect(payload.lenderLabel).toBe("금융사 미정");
    expect(payload.downPaymentLabel).toBe("없음"); // downPaymentMode null
    expect(payload.downPaymentRowLabel).toBe("선수금"); // purchaseMethod null → "" → 할부 아님
    expect(payload.carTaxLabel).toBe("불포함");
    expect(payload.subsidyLabel).toBe("—"); // 해당인데 금액 없음
    expect(payload.rateLabel).toBe("—");
    expect(payload.totalCostLabel).toBe("계산 후 안내");
    expect(payload.dueAtDeliveryLabel).toBe("—");
    expect(payload.footerStampLabel).toBe("발송 전 미리보기"); // sentAtIso 무효 방어(클라 stampLabelOf 재현)
    expect(vehicleLabel).toBe("차량 미선택");
    expect(monthlyPayment).toBeNull();
  });

  test("percent 모드인데 finalVehiclePrice=0 — 환산 없이 %만", () => {
    const { payload } = buildAdvisorQuotePayload(
      quoteRow({ basePrice: null, optionTotal: null, finalDiscount: null }),
      scenarioRow({ depositMode: "percent", depositValue: "30" }),
      { modelYear: null, sentAtIso: SENT_AT },
    );
    expect(payload.depositLabel).toBe("30%"); // 기준가 0이면 괄호·금액 없이 % 원문
  });

  test("vehicleTitle dedupe — 트림명이 모델명 접두면 트림명만", () => {
    const deduped = buildAdvisorQuotePayload(
      quoteRow({ modelName: "5 Series", trimName: "5 Series 520i M Spt" }),
      scenarioRow(),
      { modelYear: 2026, sentAtIso: SENT_AT },
    );
    expect(deduped.payload.vehicleTitle).toBe("5 Series 520i M Spt");
    expect(deduped.vehicleLabel).toBe("BMW 5 Series 520i M Spt");

    // 한쪽만 있는 경우: 있는 쪽 그대로
    const modelOnly = buildAdvisorQuotePayload(quoteRow({ trimName: null }), scenarioRow(), {
      modelYear: 2026,
      sentAtIso: SENT_AT,
    });
    expect(modelOnly.payload.vehicleTitle).toBe("5 Series");

    const trimOnly = buildAdvisorQuotePayload(quoteRow({ modelName: null }), scenarioRow(), {
      modelYear: 2026,
      sentAtIso: SENT_AT,
    });
    expect(trimOnly.payload.vehicleTitle).toBe("520i M Sport");
    expect(trimOnly.vehicleLabel).toBe("BMW 520i M Sport");
  });
});
