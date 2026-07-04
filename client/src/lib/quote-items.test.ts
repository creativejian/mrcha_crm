import { describe, expect, it } from "vitest";

import { flattenPrimaryScenario, formatScenarioMoneyMode, toQuoteItem, type CustomerDetailQuote } from "./quote-items";

const NOW = new Date("2026-05-28T12:00:00+09:00").getTime();

function makeQuote(over: Partial<CustomerDetailQuote> = {}): CustomerDetailQuote {
  return {
    id: "q1",
    quoteCode: "QT-2606-0001",
    entryMode: "solution",
    quoteRound: "1차",
    brandName: "벤츠",
    modelName: "Maybach S-Class",
    trimName: "S 500 4M Long",
    status: "고객 확인 전",
    appStatus: "sent",
    decisionStatus: "none",
    stockStatus: "재고있음",
    note: "비고",
    validUntil: "2026-06-03T12:00:00+09:00", // NOW + 6일
    sentAt: "2026-05-28T12:39:00+09:00",
    viewedAt: null,
    revision: 0,
    primaryScenarioId: "s1",
    basePrice: null,
    optionTotal: null,
    finalDiscount: null,
    acquisitionTax: null,
    bond: null,
    delivery: null,
    incidental: null,
    finalVehiclePrice: null,
    acquisitionCost: null,
    trimId: null,
    exteriorColorId: null,
    interiorColorId: null,
    options: null,
    exteriorColorName: null,
    exteriorColorHex: null,
    interiorColorName: null,
    interiorColorHex: null,
    fileName: null,
    fileSize: null,
    fileMime: null,
    guidance: null,
    scenarios: [
      { id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: 60, monthlyPayment: "2473200", depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: false },
    ],
    ...over,
  };
}

describe("toQuoteItem", () => {
  it("대표 시나리오(primaryScenarioId)에서 금융 4필드를 평탄화", () => {
    const k = toQuoteItem(makeQuote(), NOW);
    expect(k.financeType).toBe("운용리스");
    expect(k.term).toBe("60개월");
    expect(k.monthlyPayment).toBe("월 2,473,200원");
    expect(k.lender).toBe("iM캐피탈");
  });

  it("quote 헤더 필드 직매핑 + union 좁히기", () => {
    const k = toQuoteItem(makeQuote(), NOW);
    expect(k.id).toBe("q1");
    expect(k.quoteCode).toBe("QT-2606-0001");
    expect(k.source).toBe("solution");
    expect(k.appStatus).toBe("sent");
    expect(k.decisionStatus).toBe("none");
    expect(k.stockStatus).toBe("재고있음");
    expect(k.brand).toBe("벤츠");
    expect(k.model).toBe("Maybach S-Class");
    expect(k.trim).toBe("S 500 4M Long");
  });

  it("vehicleName/title은 brand+model+trim 조합", () => {
    const k = toQuoteItem(makeQuote(), NOW);
    expect(k.vehicleName).toBe("벤츠 Maybach S-Class S 500 4M Long");
    expect(k.title).toBe("벤츠 Maybach S-Class S 500 4M Long");
  });

  it("validLabel: 미래는 D-day", () => {
    expect(toQuoteItem(makeQuote(), NOW).validLabel).toBe("D-6");
  });

  it("validLabel: 과거/null", () => {
    expect(toQuoteItem(makeQuote({ validUntil: "2026-05-27T12:00:00+09:00" }), NOW).validLabel).toBe("만료됨");
    expect(toQuoteItem(makeQuote({ validUntil: null }), NOW).validLabel).toBeUndefined();
  });

  it("시나리오 비거나 값 null이면 폴백", () => {
    const k = toQuoteItem(makeQuote({ primaryScenarioId: null, scenarios: [] }), NOW);
    expect(k.financeType).toBeUndefined();
    expect(k.term).toBe("조건 미정");
    expect(k.monthlyPayment).toBeUndefined();
    expect(k.lender).toBe("금융사 미정");
  });

  it("primaryScenarioId 없으면 scenarioNo 최소를 대표로", () => {
    const k = toQuoteItem(
      makeQuote({
        primaryScenarioId: null,
        scenarios: [
          { id: "s2", scenarioNo: 2, purchaseMethod: "할부", lender: "B", termMonths: 36, monthlyPayment: "100", depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: false },
          { id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "A", termMonths: 60, monthlyPayment: "200", depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: false },
        ],
      }),
      NOW,
    );
    expect(k.financeType).toBe("운용리스");
  });

  it("알 수 없는 enum 값은 안전 폴백", () => {
    const k = toQuoteItem(makeQuote({ entryMode: "weird", appStatus: null, decisionStatus: null, stockStatus: "??" }), NOW);
    expect(k.source).toBe("manual");
    expect(k.appStatus).toBe("draft");
    expect(k.decisionStatus).toBe("none");
    expect(k.stockStatus).toBeUndefined();
  });

  it("#4c-2 가격(string)→number, 색상 이름/hex 매핑", () => {
    const k = toQuoteItem(makeQuote({
      finalVehiclePrice: "241500000",
      exteriorColorName: "옵시디언 블랙", exteriorColorHex: "#0a0a0a",
      interiorColorName: "마키아토 베이지", interiorColorHex: "#d8c7a8",
    }), NOW);
    expect(k.finalVehiclePrice).toBe(241500000);
    expect(k.exteriorColorName).toBe("옵시디언 블랙");
    expect(k.exteriorColorHex).toBe("#0a0a0a");
    expect(k.interiorColorName).toBe("마키아토 베이지");
    expect(k.interiorColorHex).toBe("#d8c7a8");
  });

  it("guidance(추가 안내)를 매핑하고 null이면 undefined", () => {
    const g = { deliveryComment: "a", stockNotice: "b", expectedDelivery: "c", customerRegion: "d", keyPoint: "e", recommendReason: "f", services: ["s1", "s2"] };
    expect(toQuoteItem(makeQuote({ guidance: g }), NOW).guidance).toEqual(g);
    expect(toQuoteItem(makeQuote({ guidance: null }), NOW).guidance).toBeUndefined();
  });

  it("#4c-2 가격/색상 없으면 undefined", () => {
    const k = toQuoteItem(makeQuote(), NOW);
    expect(k.finalVehiclePrice).toBeUndefined();
    expect(k.exteriorColorName).toBeUndefined();
    expect(k.interiorColorName).toBeUndefined();
  });

  it("PR1 catalog FK(trimId/색상 id) 있으면 number 매핑", () => {
    const k = toQuoteItem(makeQuote({ trimId: 1024, exteriorColorId: 7, interiorColorId: 12 }), NOW);
    expect(k.trimId).toBe(1024);
    expect(k.exteriorColorId).toBe(7);
    expect(k.interiorColorId).toBe(12);
  });

  it("PR1 catalog FK 없으면(null) undefined", () => {
    const k = toQuoteItem(makeQuote(), NOW);
    expect(k.trimId).toBeUndefined();
    expect(k.exteriorColorId).toBeUndefined();
    expect(k.interiorColorId).toBeUndefined();
  });

  it("#4c-3a scenarios 배열 보존(N건) + 대표 평탄화 유지", () => {
    const k = toQuoteItem(makeQuote({
      primaryScenarioId: "s1",
      scenarios: [
        { id: "s1", scenarioNo: 1, purchaseMethod: "운용리스", lender: "우리금융캐피탈", termMonths: 60, monthlyPayment: "2398000", depositMode: "percent", depositValue: "30", downPaymentMode: null, downPaymentValue: null, residualMode: "max", residualValue: null, mileageMode: "basic", mileageValue: "20,000km / 년", isSaved: true },
        { id: "s2", scenarioNo: 2, purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: null, monthlyPayment: "2473200", depositMode: "amount", depositValue: "10000000", downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: true },
      ],
    }), NOW);
    expect(k.scenarios?.length).toBe(2);
    expect(k.scenarios?.[0].lender).toBe("우리금융캐피탈");
    expect(k.scenarios?.[1].depositMode).toBe("amount");
    expect(k.financeType).toBe("운용리스");
    expect(k.lender).toBe("우리금융캐피탈");
  });
});

describe("toQuoteItem primaryScenarioId 노출", () => {
  it("primaryScenarioId를 매핑", () => {
    const k = toQuoteItem(makeQuote({ primaryScenarioId: "s1" }), NOW);
    expect(k.primaryScenarioId).toBe("s1");
  });
  it("primaryScenarioId null이면 undefined", () => {
    const k = toQuoteItem(makeQuote({ primaryScenarioId: null }), NOW);
    expect(k.primaryScenarioId).toBeUndefined();
  });
});

describe("flattenPrimaryScenario", () => {
  it("시나리오 → 대표 요약 4필드", () => {
    const flat = flattenPrimaryScenario({ id: "s2", scenarioNo: 2, purchaseMethod: "할부", lender: "B캐피탈", termMonths: 36, monthlyPayment: "200", depositMode: null, depositValue: null, downPaymentMode: null, downPaymentValue: null, residualMode: null, residualValue: null, mileageMode: null, mileageValue: null, isSaved: false });
    expect(flat.financeType).toBe("할부");
    expect(flat.term).toBe("36개월");
    expect(flat.monthlyPayment).toBe("월 200원");
    expect(flat.lender).toBe("B캐피탈");
  });
  it("null이면 폴백", () => {
    const flat = flattenPrimaryScenario(null);
    expect(flat.financeType).toBeUndefined();
    expect(flat.term).toBe("조건 미정");
    expect(flat.monthlyPayment).toBeUndefined();
    expect(flat.lender).toBe("금융사 미정");
  });
});

describe("formatScenarioMoneyMode", () => {
  it("percent → N%", () => {
    expect(formatScenarioMoneyMode("percent", "30")).toBe("30%");
  });
  it("amount → 만원 절삭(천단위 콤마)", () => {
    expect(formatScenarioMoneyMode("amount", "10000000")).toBe("1,000만원");
  });
  it("none → 없음, max → 최대", () => {
    expect(formatScenarioMoneyMode("none", null)).toBe("없음");
    expect(formatScenarioMoneyMode("max", null)).toBe("최대");
  });
  it("mode null/빈값/NaN → undefined", () => {
    expect(formatScenarioMoneyMode(null, "30")).toBeUndefined();
    expect(formatScenarioMoneyMode("percent", null)).toBeUndefined();
    expect(formatScenarioMoneyMode("amount", "abc")).toBeUndefined();
  });
});

describe("toQuoteItem 견적 원본 file_* 매핑 (#4d)", () => {
  it("file_* 있으면 fileName/fileSize/mimeType 매핑", () => {
    const k = toQuoteItem(makeQuote({ fileName: "원본견적.pdf", fileSize: 12345, fileMime: "application/pdf" }), NOW);
    expect(k.fileName).toBe("원본견적.pdf");
    expect(k.fileSize).toBe(12345);
    expect(k.mimeType).toBe("application/pdf");
  });
  it("file_* 없으면 undefined", () => {
    const k = toQuoteItem(makeQuote(), NOW);
    expect(k.fileName).toBeUndefined();
    expect(k.fileSize).toBeUndefined();
    expect(k.mimeType).toBeUndefined();
  });
});
