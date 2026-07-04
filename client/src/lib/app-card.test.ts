import { describe, expect, it } from "vitest";
import { buildAppCardModel, type AppCardModelInput } from "./app-card";
import { DEFAULT_QUOTE_GUIDANCE } from "@/data/quote-guidance";

const NOW = new Date("2026-07-04T12:00:00+09:00").getTime();

const base: AppCardModelInput = {
  brandName: "BMW",
  modelName: "X7",
  trimName: "xDrive 40i M Spt 7인승",
  modelYear: 2026,
  basePrice: 154480000,
  optionTotal: 0,
  optionNames: [],
  discount: 11000000,
  discountLabels: ["타사할인"],
  finalVehiclePrice: 142800000,
  acquisitionTax: 3200000,
  acquisitionTaxMode: "normal",
  bond: 0,
  delivery: 0,
  incidental: 0,
  registrationCost: 3200000,
  acquisitionCost: 146000000,
  exteriorColorName: "알파인 화이트",
  interiorColorName: "블랙",
  guidance: {
    ...DEFAULT_QUOTE_GUIDANCE,
    deliveryComment: "이 차량은 1주일 내 출고 가능해요",
    stockNotice: "즉시 출고 가능",
    expectedDelivery: "1주일 이내",
    customerRegion: "서울",
    keyPoints: ["잔존가치 최대 조건으로 월 납입금을 낮춘 조건입니다.", "초기 부담을 낮추는 조건입니다."],
    recommendReason: "잔가율이 높아 월 납입 부담이 낮습니다\n재고 차량이라 즉시 출고됩니다",
    services: ["썬팅: 후퍼옵틱 KBR 전면 + 측후면 제공", "담당 카매니저 출고 일정 개별 안내"],
  },
  purchaseMethod: "운용리스",
  scenario: {
    scenarioNo: 1,
    purchaseMethod: "운용리스",
    termMonths: 60,
    monthlyPayment: "1473200",
    lender: "우리금융캐피탈",
    depositMode: "none",
    depositValue: null,
    downPaymentMode: "percent",
    downPaymentValue: "20",
    residualMode: "percent",
    residualValue: "58",
    mileageMode: "basic",
    mileageValue: "20,000km / 년",
    carTaxIncluded: false,
    subsidyApplicable: false,
    subsidyAmount: null,
    totalReturnCost: "167652170",
    totalTakeoverCost: "182000000",
    dueAtDelivery: "3000000",
    interestRate: "5.32",
  },
  quoteCode: "QT-2607-0001",
  appStatus: "sent",
  sentAtIso: "2026-04-16T18:07:00+09:00",
  validUntilIso: "2026-07-10T12:00:00+09:00",
  nowMs: NOW,
};

describe("buildAppCardModel — 섹션 1 헤더·핵심 요약", () => {
  it("상태/디데이/차명/칩/서브라인을 조립한다", () => {
    const m = buildAppCardModel(base);
    expect(m.statusLabel).toBe("미확인 견적");
    expect(m.ddayLabel).toBe("D-6");
    expect(m.brand).toBe("BMW");
    expect(m.vehicleTitle).toBe("X7 xDrive 40i M Spt 7인승");
    expect(m.purchaseMethod).toBe("운용리스");
    expect(m.termLabel).toBe("60개월");
    expect(m.sublineLabel).toBe("2026년식 ㅣ 154,480,000원 ㅣ 추가옵션 없음");
  });
  it("차명 dedupe: 트림명이 모델명으로 시작하면 트림명만 쓴다(카탈로그 트림명이 모델 접두 포함하는 케이스)", () => {
    const m = buildAppCardModel({ ...base, modelName: "X7", trimName: "X7 xDrive 40i M Spt LCI (7인승)" });
    expect(m.vehicleTitle).toBe("X7 xDrive 40i M Spt LCI (7인승)");
  });
  it("월납입금·금리칩·잔존(%병기)·총비용(반납 우선)·할인 행", () => {
    const m = buildAppCardModel(base);
    expect(m.monthlyLabel).toBe("1,473,200원");
    expect(m.rateChipLabel).toBe("금리 5.32%");
    expect(m.residualLabel).toBe("82,824,000원 (58%)"); // 142,800,000 × 58% — 섹션1 금액 선행
    expect(m.residualCondLabel).toBe("(58%) 82,824,000원"); // 섹션3 % 선행(디자인 어순)
    expect(m.totalCostLabel).toBe("167,652,170원"); // 반납 우선
    expect(m.discountRowLabel).toBe("최대 할인 적용 (타사할인)");
    expect(m.discountLabel).toBe("11,000,000");
  });
  it("보증금 무보증·주행거리 연 표기·핵심포인트 배열", () => {
    const m = buildAppCardModel(base);
    expect(m.depositLabel).toBe("0원 (무보증)");
    expect(m.mileageLabel).toBe("연 20,000km");
    expect(m.keyPoints).toEqual(["잔존가치 최대 조건으로 월 납입금을 낮춘 조건입니다.", "초기 부담을 낮추는 조건입니다."]);
  });
  it("총비용: 반납 없으면 인수, 둘 다 없으면 계산 후 안내", () => {
    const noReturn = buildAppCardModel({ ...base, scenario: { ...base.scenario!, totalReturnCost: null } });
    expect(noReturn.totalCostLabel).toBe("182,000,000원");
    const none = buildAppCardModel({ ...base, scenario: { ...base.scenario!, totalReturnCost: null, totalTakeoverCost: null } });
    expect(none.totalCostLabel).toBe("계산 후 안내");
  });
});

describe("buildAppCardModel — 섹션 2 출고 정보·취득원가 구성", () => {
  it("출고 정보 블록 필드", () => {
    const m = buildAppCardModel(base);
    expect(m.deliveryComment).toBe("이 차량은 1주일 내 출고 가능해요");
    expect(m.exteriorColorLabel).toBe("알파인 화이트");
    expect(m.optionSummaryLabel).toBe("없음");
    expect(m.stockNotice).toBe("즉시 출고 가능");
  });
  it("취득원가 구성 라벨(취득세 모드 병기 포함)", () => {
    const m = buildAppCardModel(base);
    expect(m.basePriceLabel).toBe("154,480,000");
    expect(m.finalVehiclePriceLabel).toBe("142,800,000");
    expect(m.acquisitionTaxModeLabel).toBe("일반");
    expect(m.registrationCostLabel).toBe("3,200,000");
    expect(m.acquisitionCostLabel).toBe("146,000,000");
  });
  it("옵션 있으면 서브라인 N개·요약은 이름 나열", () => {
    const m = buildAppCardModel({ ...base, optionNames: ["어드밴스드 패키지", "선루프"], optionTotal: 5000000 });
    expect(m.sublineLabel).toContain("추가옵션 2개");
    expect(m.optionSummaryLabel).toBe("어드밴스드 패키지, 선루프");
  });
});

describe("buildAppCardModel — 섹션 3 추천 견적 조건", () => {
  it("전 조건 라벨(선수금 %선행 병기·자동차세·보조금·금리·총비용 2종·출고전납입)", () => {
    const m = buildAppCardModel(base);
    expect(m.hasScenario).toBe(true);
    expect(m.lenderLabel).toBe("우리금융캐피탈");
    expect(m.downPaymentLabel).toBe("(20%) 28,560,000원"); // 142,800,000 × 20%
    expect(m.carTaxLabel).toBe("불포함");
    expect(m.subsidyLabel).toBe("해당 없음");
    expect(m.rateLabel).toBe("5.32%");
    expect(m.totalReturnCostLabel).toBe("167,652,170원");
    expect(m.totalTakeoverCostLabel).toBe("182,000,000원");
    expect(m.dueAtDeliveryLabel).toBe("3,000,000원");
  });
  it("보조금 해당이면 금액, 자동차세 포함이면 포함", () => {
    const m = buildAppCardModel({ ...base, scenario: { ...base.scenario!, carTaxIncluded: true, subsidyApplicable: true, subsidyAmount: "1000000" } });
    expect(m.carTaxLabel).toBe("포함");
    expect(m.subsidyLabel).toBe("1,000,000원");
  });
  it("시나리오 없으면 hasScenario=false + 안전 폴백", () => {
    const m = buildAppCardModel({ ...base, scenario: null });
    expect(m.hasScenario).toBe(false);
    expect(m.monthlyLabel).toBe("계산 후 안내");
    expect(m.depositLabel).toBe("조건 미정");
    expect(m.rateChipLabel).toBeNull();
    expect(m.rateLabel).toBe("—");
  });
  it("할부면 선수금 행 라벨이 선납금(도메인 규칙 — 앱 초기비용 유형이 구매방식 종속)", () => {
    expect(buildAppCardModel(base).downPaymentRowLabel).toBe("선수금");
    expect(buildAppCardModel({ ...base, purchaseMethod: "할부" }).downPaymentRowLabel).toBe("선납금");
  });
});

describe("buildAppCardModel — 섹션 4·발송 상태", () => {
  it("추천이유 줄 분리·서비스 라벨:값 분리·푸터", () => {
    const m = buildAppCardModel(base);
    expect(m.recommendReasons).toEqual(["잔가율이 높아 월 납입 부담이 낮습니다", "재고 차량이라 즉시 출고됩니다"]);
    expect(m.services[0]).toEqual({ label: "썬팅", value: "후퍼옵틱 KBR 전면 + 측후면 제공" });
    expect(m.services[1]).toEqual({ label: "", value: "담당 카매니저 출고 일정 개별 안내" });
    expect(m.footerStampLabel).toBe("26/04/16 18:07");
    expect(m.quoteCodeLabel).toBe("QT-2607-0001");
  });
  it("발송 전(견적 미저장 포함) 표기: D-7 발송 시 시작·발송 전 미리보기·저장 후 부여", () => {
    const m = buildAppCardModel({ ...base, quoteCode: null, appStatus: null, sentAtIso: null, validUntilIso: null });
    expect(m.ddayLabel).toBe("D-7 · 발송 시 시작");
    expect(m.footerStampLabel).toBe("발송 전 미리보기");
    expect(m.quoteCodeLabel).toBe("저장 후 부여");
  });
  it("만료·확인한 견적", () => {
    const m = buildAppCardModel({ ...base, appStatus: "viewed", validUntilIso: "2026-07-01T00:00:00+09:00" });
    expect(m.statusLabel).toBe("확인한 견적");
    expect(m.ddayLabel).toBe("만료됨");
  });
});
