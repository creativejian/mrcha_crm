import { describe, expect, it } from "vitest";

import { toAppQuoteRequest, type AppQuoteRequestRow } from "./quote-requests";

const base: AppQuoteRequestRow = {
  id: "q1",
  createdAt: "2026-06-25T04:02:34.633288+00:00",
  requesterName: "제임스",
  requesterPhone: null,
  paymentMethod: "lease",
  period: 60,
  depositType: "advance",
  rentalDeposit: 5598000,
  trimPrice: 186600000,
  status: "open",
  brandName: "기아",
  modelName: "쏘렌토",
  trimName: "26년형 노블레스",
  optionCount: 3,
  matchedCustomerId: null,
  matchedCustomerName: null,
  matchedCustomerCode: null,
  matchType: "none",
};

describe("toAppQuoteRequest", () => {
  it("payment_method 4종 한글", () => {
    expect(toAppQuoteRequest({ ...base, paymentMethod: "lease" }).paymentLabel).toBe("운용리스");
    expect(toAppQuoteRequest({ ...base, paymentMethod: "rent" }).paymentLabel).toBe("장기렌트");
    expect(toAppQuoteRequest({ ...base, paymentMethod: "installment" }).paymentLabel).toBe("할부");
    expect(toAppQuoteRequest({ ...base, paymentMethod: "cash" }).paymentLabel).toBe("일시불");
    expect(toAppQuoteRequest({ ...base, paymentMethod: null }).paymentLabel).toBe("—");
  });

  it("deposit_type 3종 + 금액 결합", () => {
    expect(toAppQuoteRequest({ ...base, depositType: "deposit" }).depositLabel).toBe("보증금 559만원");
    expect(toAppQuoteRequest({ ...base, depositType: "advance", rentalDeposit: 0 }).depositLabel).toBe("선수금");
    expect(toAppQuoteRequest({ ...base, depositType: null, rentalDeposit: 0 }).depositLabel).toBe("—");
  });

  it("status 3종 한글", () => {
    expect(toAppQuoteRequest({ ...base, status: "open" }).statusLabel).toBe("진행중");
    expect(toAppQuoteRequest({ ...base, status: "closed" }).statusLabel).toBe("마감");
    expect(toAppQuoteRequest({ ...base, status: "completed" }).statusLabel).toBe("완료");
  });

  it("차량/기간/옵션/차량가 라벨", () => {
    const r = toAppQuoteRequest(base);
    expect(r.vehicleLabel).toBe("기아 쏘렌토 · 26년형 노블레스");
    expect(r.periodLabel).toBe("60개월");
    expect(r.optionLabel).toBe("3개");
    expect(r.trimPriceLabel).toBe("1억 8,660만원");
    expect(toAppQuoteRequest({ ...base, period: null, optionCount: 0 }).periodLabel).toBe("—");
    expect(toAppQuoteRequest({ ...base, optionCount: 0 }).optionLabel).toBe("없음");
  });

  it("매칭 3분기", () => {
    expect(toAppQuoteRequest(base).matchLabel).toBe("신규(미연결)");
    expect(toAppQuoteRequest({ ...base, matchType: "phone", matchedCustomerName: "한소희" }).matchLabel).toBe("기존 고객 한소희(추정)");
    expect(toAppQuoteRequest({ ...base, matchType: "app_user", matchedCustomerName: "한소희" }).matchLabel).toBe("연결됨 한소희");
  });

  it("fallback: requesterName null → 이름없음, 차량 전부 null → 차량 미지정", () => {
    const r = toAppQuoteRequest({ ...base, requesterName: null, brandName: null, modelName: null, trimName: null });
    expect(r.requesterName).toBe("이름없음");
    expect(r.vehicleLabel).toBe("차량 미지정");
  });
});
