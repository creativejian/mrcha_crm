import { describe, expect, it } from "vitest";
import { buildAppCardModel, type AppCardModelInput } from "./app-card";
import { DEFAULT_QUOTE_GUIDANCE } from "@/data/quote-guidance";

const base: AppCardModelInput = {
  brandName: "벤츠",
  modelName: "Maybach S-Class",
  trimName: "S 500 4M Long",
  modelYear: 2026,
  basePrice: 166000000,
  discount: 5000000,
  finalVehiclePrice: 161000000,
  registrationCost: 7000000,
  acquisitionCost: 168000000,
  exteriorColorName: "옵시디언 블랙",
  interiorColorName: "마키아토 베이지",
  guidance: { ...DEFAULT_QUOTE_GUIDANCE, stockNotice: "즉시 출고 가능", expectedDelivery: "1주일 이내", customerRegion: "인천" },
  purchaseMethod: "운용리스",
  scenario: {
    scenarioNo: 1,
    purchaseMethod: "운용리스",
    termMonths: 60,
    monthlyPayment: "2398000",
    lender: "우리금융캐피탈",
    depositMode: "percent",
    depositValue: "30",
    downPaymentMode: "none",
    downPaymentValue: null,
    residualMode: "max",
    residualValue: null,
    mileageMode: "basic",
    mileageValue: "20,000km / 년",
  },
};

describe("buildAppCardModel", () => {
  it("실데이터 입력을 카드 라벨로 변환한다", () => {
    const m = buildAppCardModel(base);
    expect(m.brand).toBe("벤츠");
    expect(m.modelLabel).toBe("Maybach S-Class");
    expect(m.trimLabel).toBe("S 500 4M Long");
    expect(m.yearLabel).toBe("2026년식");
    expect(m.basePriceLabel).toBe("166,000,000");
    expect(m.discountLabel).toBe("5,000,000");
    expect(m.purchaseMethod).toBe("운용리스");
    expect(m.termLabel).toBe("60개월");
    expect(m.monthlyLabel).toBe("2,398,000원");
    expect(m.lenderLabel).toBe("우리금융캐피탈");
    expect(m.depositLabel).toBe("30%");
    expect(m.downPaymentLabel).toBe("없음");
    expect(m.residualLabel).toBe("최대");
    expect(m.mileageLabel).toBe("20,000km / 년");
    expect(m.exteriorColorLabel).toBe("옵시디언 블랙");
    expect(m.interiorColorLabel).toBe("마키아토 베이지");
    expect(m.stockNotice).toBe("즉시 출고 가능");
    expect(m.expectedDelivery).toBe("1주일 이내");
    expect(m.customerRegion).toBe("인천");
    expect(m.finalVehiclePriceLabel).toBe("161,000,000");
    expect(m.registrationCostLabel).toBe("7,000,000");
    expect(m.acquisitionCostLabel).toBe("168,000,000");
    expect(m.hasScenario).toBe(true);
  });

  it("소스 없는 필드(금리/총비용)는 안내 텍스트로 표시한다", () => {
    const m = buildAppCardModel(base);
    expect(m.rateLabel).toBe("—");
    expect(m.totalCostLabel).toBe("계산 후 안내");
  });

  it("시나리오가 없으면 placeholder/미정으로 표시하고 hasScenario=false", () => {
    const m = buildAppCardModel({ ...base, scenario: null });
    expect(m.hasScenario).toBe(false);
    expect(m.monthlyLabel).toBe("계산 후 안내");
    expect(m.termLabel).toBe("조건 미정");
    expect(m.depositLabel).toBe("조건 미정");
    expect(m.downPaymentLabel).toBe("없음");
    expect(m.residualLabel).toBe("계산 후 안내");
    expect(m.lenderLabel).toBe("금융사 미정");
  });

  it("차량/연식/색상 미선택은 폴백 라벨을 쓴다", () => {
    const m = buildAppCardModel({ ...base, brandName: null, modelName: null, trimName: null, modelYear: null, exteriorColorName: null, interiorColorName: null });
    expect(m.brand).toBe("차량 미선택");
    expect(m.modelLabel).toBe("차량 미선택");
    expect(m.trimLabel).toBe("");
    expect(m.yearLabel).toBe("");
    expect(m.exteriorColorLabel).toBe("미선택");
    expect(m.interiorColorLabel).toBe("미선택");
  });
});
