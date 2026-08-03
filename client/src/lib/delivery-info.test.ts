import { describe, expect, it } from "vitest";
import type { ContractingQuoteSummary, CustomerDeliveryInfo } from "@/data/customers";
import { deliveryInfoSummary, resolveDeliveryInfoSubmit, resolveSettlementSubmit, seedDeliveryInfoDraft, unconfirmedDeliveryDays } from "./delivery-info";

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
  contractConfirmedDate: null,
  deliveryMemo: null,
  sourceQuoteId: "q-old",
};
const EMPTY: CustomerDeliveryInfo = {
  contractVehicle: null,
  contractDate: null,
  lender: null,
  deliveredDate: null,
  contractConfirmedDate: null,
  deliveryMemo: null,
  sourceQuoteId: null,
};

describe("seedDeliveryInfoDraft (soft pipe — spec §5.3)", () => {
  it("저장값 없는 필드만 contracting 견적에서 시드한다(차량 dedupe 라벨·금융사)", () => {
    const draft = seedDeliveryInfoDraft(null, QUOTE);
    expect(draft.contractVehicle).toBe("BMW 5 Series 520i");
    expect(draft.lender).toBe("iM캐피탈");
    expect(draft.sourceQuoteId).toBe("q-1");
    expect(draft.seededFields).toEqual(["contractVehicle", "lender"]);
  });

  it("저장값이 있으면 프리필하지 않는다(수기 우선) — sourceQuoteId는 기존값 승계", () => {
    const draft = seedDeliveryInfoDraft(SAVED, QUOTE);
    expect(draft.contractVehicle).toBe("수기 차량");
    expect(draft.lender).toBe("수기 금융사");
    expect(draft.sourceQuoteId).toBe("q-old");
    // 저장값을 그대로 보여주는 것뿐이므로 "견적에서 가져옴" 힌트가 뜨면 안 된다.
    expect(draft.seededFields).toEqual([]);
  });

  it("일부 필드만 비면 그 필드만 시드하고 sourceQuoteId는 시드 견적으로 갱신", () => {
    const draft = seedDeliveryInfoDraft({ ...SAVED, lender: null }, QUOTE);
    expect(draft.contractVehicle).toBe("수기 차량");
    expect(draft.lender).toBe("iM캐피탈");
    expect(draft.sourceQuoteId).toBe("q-1");
    // 힌트는 실제로 채운 칸에만 — 수기 차량에는 붙지 않는다.
    expect(draft.seededFields).toEqual(["lender"]);
  });

  it("contracting 견적이 없으면 빈 폼(저장값만)", () => {
    const draft = seedDeliveryInfoDraft(null, null);
    expect(draft).toEqual({ contractVehicle: "", contractDate: "", lender: "", deliveredDate: "", contractConfirmedDate: "", deliveryMemo: "", sourceQuoteId: null, seededFields: [] });
  });

  it("seededFields는 저장 본문에 새지 않는다 — 표시용 메타", () => {
    const draft = seedDeliveryInfoDraft(null, QUOTE);
    const submit = resolveDeliveryInfoSubmit(draft);
    expect(submit.kind).toBe("save");
    if (submit.kind !== "save") return;
    expect(submit.body).not.toHaveProperty("seededFields");
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
    contractConfirmedDate: "",
    deliveryMemo: "  ",
    sourceQuoteId: "q-1",
    seededFields: ["contractVehicle"] as const,
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
        contractConfirmedDate: null,
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

// 정산 제출 해석(admin 전용 축, 2026-08-03). 서버 zod가 최종 게이트지만 클라도 같은 규칙으로 막아
// "저장 눌렀는데 400"이 되지 않게 한다.
describe("resolveSettlementSubmit", () => {
  it("빈 입력은 둘 다 null(값 지우기)", () => {
    expect(resolveSettlementSubmit("", "")).toEqual({ kind: "save", body: { settledAt: null, feeAmount: null } });
  });

  it("콤마는 입력 편의라 지운다 — 1,180,000 → 1180000", () => {
    expect(resolveSettlementSubmit("2026-09-10", "1,180,000")).toEqual({
      kind: "save",
      body: { settledAt: "2026-09-10", feeAmount: 1180000 },
    });
  });

  it("유연 날짜(2026.9.10)를 ISO로 정규화한다(출고 날짜 칸과 같은 규약)", () => {
    const submit = resolveSettlementSubmit("2026.9.10", "");
    expect(submit.kind).toBe("save");
    if (submit.kind === "save") expect(submit.body.settledAt).toBe("2026-09-10");
  });

  it("음수·문자는 invalid — 입금액에 음수는 없다", () => {
    expect(resolveSettlementSubmit("", "-1").kind).toBe("invalid");
    expect(resolveSettlementSubmit("", "백만원").kind).toBe("invalid");
  });

  it("해석 불가 날짜는 invalid(어느 칸인지 사유 명시)", () => {
    const submit = resolveSettlementSubmit("내일", "");
    expect(submit.kind).toBe("invalid");
    if (submit.kind === "invalid") expect(submit.reason).toContain("입금일");
  });

  it("금액만 있고 날짜가 없어도 저장된다 — 입금 예정 전 수수료만 아는 경우", () => {
    expect(resolveSettlementSubmit("", "1180000")).toEqual({
      kind: "save",
      body: { settledAt: null, feeAmount: 1180000 },
    });
  });
});

// 출고 후 미확정 추적(2026-08-03 이사님 — 1일 초과부터). 인도와 확정 사이가 취소·지연이 생기는
// 유일한 구간이라, 이 판정이 틀리면 상담사가 챙겨야 할 건을 놓친다.
describe("unconfirmedDeliveryDays", () => {
  const NOW = new Date("2026-08-05T03:00:00Z"); // KST 8/5 12:00
  const delivered = (d: string | null, confirmed: string | null = null): CustomerDeliveryInfo => ({
    ...EMPTY,
    deliveredDate: d,
    contractConfirmedDate: confirmed,
  });

  it("확정됐으면 null — 신호가 아니다", () => {
    expect(unconfirmedDeliveryDays(delivered("2026-08-01", "2026-08-03"), NOW)).toBeNull();
  });

  it("인도일이 없으면 null — 아직 출고 전이라 셀 것이 없다", () => {
    expect(unconfirmedDeliveryDays(delivered(null), NOW)).toBeNull();
    expect(unconfirmedDeliveryDays(null, NOW)).toBeNull();
  });

  it("당일 인도는 null(임계 미만), 다음 날부터 1일로 뜬다 — 1일 초과 규칙", () => {
    expect(unconfirmedDeliveryDays(delivered("2026-08-05"), NOW)).toBeNull();
    expect(unconfirmedDeliveryDays(delivered("2026-08-04"), NOW)).toBe(1);
    expect(unconfirmedDeliveryDays(delivered("2026-08-01"), NOW)).toBe(4);
  });

  it("일수는 KST 달력일 — 브라우저 로컬 tz가 아니라 서버 지표와 같은 숫자여야 한다", () => {
    // KST 8/5 00:30(= UTC 8/4 15:30)에도 "8/4 인도"는 1일이다(시각이 아니라 달력일 차이).
    const justAfterKstMidnight = new Date("2026-08-04T15:30:00Z");
    expect(unconfirmedDeliveryDays(delivered("2026-08-04"), justAfterKstMidnight)).toBe(1);
  });

  it("깨진 날짜 문자열은 null — 배지가 NaN일로 뜨지 않게", () => {
    expect(unconfirmedDeliveryDays(delivered("내일"), NOW)).toBeNull();
  });
});
