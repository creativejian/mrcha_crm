import { describe, expect, it } from "vitest";
import type { ContractingQuoteSummary, CustomerDeliveryInfo } from "@/data/customers";
import { deliveryInfoSummary, resolveDeliveryInfoSubmit, seedDeliveryInfoDraft } from "./delivery-info";

const QUOTE: ContractingQuoteSummary = {
  id: "q-1",
  brandName: "BMW",
  modelName: "5 Series",
  trimName: "520i",
  purchaseMethod: null,
  lender: "iM캐피탈",
};
const SAVED: CustomerDeliveryInfo = {
  contractVehicle: "수기 차량",
  contractDate: "2026-07-15",
  lender: "수기 금융사",
  deliveredDate: null,
  deliveryMemo: null,
  sourceQuoteId: "q-old",
};
const EMPTY: CustomerDeliveryInfo = {
  contractVehicle: null,
  contractDate: null,
  lender: null,
  deliveredDate: null,
  deliveryMemo: null,
  sourceQuoteId: null,
};

describe("seedDeliveryInfoDraft (soft pipe — spec §5.3)", () => {
  it("저장값 없는 필드만 contracting 견적에서 시드한다(차량 dedupe 라벨·금융사)", () => {
    const draft = seedDeliveryInfoDraft(null, QUOTE);
    expect(draft.contractVehicle).toBe("BMW 5 Series 520i");
    expect(draft.lender).toBe("iM캐피탈");
    expect(draft.sourceQuoteId).toBe("q-1");
  });

  it("저장값이 있으면 프리필하지 않는다(수기 우선) — sourceQuoteId는 기존값 승계", () => {
    const draft = seedDeliveryInfoDraft(SAVED, QUOTE);
    expect(draft.contractVehicle).toBe("수기 차량");
    expect(draft.lender).toBe("수기 금융사");
    expect(draft.sourceQuoteId).toBe("q-old");
  });

  it("일부 필드만 비면 그 필드만 시드하고 sourceQuoteId는 시드 견적으로 갱신", () => {
    const draft = seedDeliveryInfoDraft({ ...SAVED, lender: null }, QUOTE);
    expect(draft.contractVehicle).toBe("수기 차량");
    expect(draft.lender).toBe("iM캐피탈");
    expect(draft.sourceQuoteId).toBe("q-1");
  });

  it("contracting 견적이 없으면 빈 폼(저장값만)", () => {
    const draft = seedDeliveryInfoDraft(null, null);
    expect(draft).toEqual({ contractVehicle: "", contractDate: "", lender: "", deliveredDate: "", deliveryMemo: "", sourceQuoteId: null });
  });

  it("트림이 모델을 포함하면 중복 없이(dedupedModelTrim 재사용)", () => {
    const draft = seedDeliveryInfoDraft(null, { ...QUOTE, brandName: "제네시스", modelName: "G80", trimName: "G80 가솔린 2.5" });
    expect(draft.contractVehicle).toBe("제네시스 G80 가솔린 2.5");
  });
});

describe("resolveDeliveryInfoSubmit", () => {
  const DRAFT = {
    contractVehicle: " BMW 520i ",
    contractDate: "2026-07-15",
    lender: "",
    deliveredDate: "",
    deliveryMemo: "  ",
    sourceQuoteId: "q-1",
  };

  it("빈 문자열·공백은 null, 텍스트는 trim, 날짜는 정규화해 body로", () => {
    const submit = resolveDeliveryInfoSubmit(DRAFT);
    expect(submit).toEqual({
      kind: "save",
      body: {
        contractVehicle: "BMW 520i",
        contractDate: "2026-07-15",
        lender: null,
        deliveredDate: null,
        deliveryMemo: null,
        sourceQuoteId: "q-1",
      },
    });
  });

  it("유연 날짜 입력(2026.7.5)을 ISO로 정규화한다(datetime-text 규약)", () => {
    const submit = resolveDeliveryInfoSubmit({ ...DRAFT, contractDate: "2026.7.5" });
    expect(submit.kind).toBe("save");
    if (submit.kind === "save") expect(submit.body.contractDate).toBe("2026-07-05");
  });

  it("해석 불가 날짜는 invalid(어느 필드인지 사유 명시)", () => {
    const contract = resolveDeliveryInfoSubmit({ ...DRAFT, contractDate: "내일" });
    expect(contract.kind).toBe("invalid");
    if (contract.kind === "invalid") expect(contract.reason).toContain("계약일");
    const delivered = resolveDeliveryInfoSubmit({ ...DRAFT, deliveredDate: "13/45" });
    expect(delivered.kind).toBe("invalid");
    if (delivered.kind === "invalid") expect(delivered.reason).toContain("출고 실측일");
  });
});

describe("deliveryInfoSummary (셀 요약 — spec §5.1)", () => {
  it("계약 줄 = '계약 M/D · 금융사', 실측 줄 = '출고 M/D'", () => {
    expect(deliveryInfoSummary({ ...EMPTY, contractDate: "2026-07-15", lender: "iM캐피탈", deliveredDate: "2026-07-20" })).toEqual({
      contractLine: "계약 7/15 · iM캐피탈",
      deliveredLine: "출고 7/20",
      fallback: null,
    });
  });

  it("있는 값만 조합한다(금융사만 → 금융사만)", () => {
    expect(deliveryInfoSummary({ ...EMPTY, lender: "iM캐피탈" })?.contractLine).toBe("iM캐피탈");
  });

  it("전부 비면 null(셀은 + 미입력), 줄 없는 필드만 있으면 fallback '입력됨'", () => {
    expect(deliveryInfoSummary(EMPTY)).toBeNull();
    expect(deliveryInfoSummary(null)).toBeNull();
    expect(deliveryInfoSummary({ ...EMPTY, deliveryMemo: "탁송 조율" })).toEqual({
      contractLine: null,
      deliveredLine: null,
      fallback: "입력됨",
    });
  });
});
