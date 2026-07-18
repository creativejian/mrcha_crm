import { afterEach, describe, expect, it, vi } from "vitest";

import { colorLabelOf, depositLabelOf, fetchCustomerQuoteRequests, fetchQuoteRequestDetail, toAppQuoteRequest, type AppQuoteRequestRow } from "./quote-requests";

// apiFetch(./api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const base: AppQuoteRequestRow = {
  id: "q1",
  createdAt: "2026-06-25T04:02:34.633288+00:00",
  requesterName: "제임스",
  requesterPhone: null,
  paymentMethod: "lease",
  period: 60,
  depositType: "advance",
  depositRatio: 0,
  rentalDeposit: 5598000,
  trimPrice: 186600000,
  status: "open",
  colorPreferenceMode: null,
  exteriorColorId: null,
  exteriorColorName: null,
  exteriorColorHex: null,
  interiorColorId: null,
  interiorColorName: null,
  interiorColorHex: null,
  brandName: "기아",
  modelName: "쏘렌토",
  trimName: "26년형 노블레스",
  optionCount: 3,
  matchedCustomerId: null,
  matchedCustomerName: null,
  matchedCustomerCode: null,
  promotedQuoteCount: 0,
  promotedQuoteIds: [],
  matchType: "none",
  nameMatches: [],
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

  it("colorLabel: mode 4종 + null 숨김", () => {
    expect(toAppQuoteRequest({ ...base, colorPreferenceMode: "undecided" }).colorLabel).toBe("컬러 미정");
    expect(toAppQuoteRequest({ ...base, colorPreferenceMode: "no_preference" }).colorLabel).toBe("컬러 무관");
    expect(toAppQuoteRequest({ ...base, colorPreferenceMode: "selected" }).colorLabel).toBe("컬러 지정");
    expect(toAppQuoteRequest({ ...base, colorPreferenceMode: "consultation" }).colorLabel).toBe("희망 컬러 있음");
    expect(toAppQuoteRequest({ ...base, colorPreferenceMode: null }).colorLabel).toBeNull();
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

  it("matched 고객 필드(id/name/code)를 노출한다", () => {
    const r = toAppQuoteRequest({ ...base, matchType: "phone", matchedCustomerId: "c1", matchedCustomerName: "한소희", matchedCustomerCode: "CU-2605-0001" });
    expect(r.matchedCustomerId).toBe("c1");
    expect(r.matchedCustomerName).toBe("한소희");
    expect(r.matchedCustomerCode).toBe("CU-2605-0001");
  });
});

describe("toAppQuoteRequest promotedQuoteCount", () => {
  it("역참조 카운트를 그대로 노출", () => {
    expect(toAppQuoteRequest({ ...base, promotedQuoteCount: 3 }).promotedQuoteCount).toBe(3);
    expect(toAppQuoteRequest({ ...base, promotedQuoteCount: 0 }).promotedQuoteCount).toBe(0);
  });
});

describe("toAppQuoteRequest promotedQuoteIds", () => {
  it("최신순 역참조 id 배열을 그대로 노출", () => {
    expect(toAppQuoteRequest({ ...base, promotedQuoteIds: ["q-new", "q-old"] }).promotedQuoteIds).toEqual(["q-new", "q-old"]);
    expect(toAppQuoteRequest({ ...base, promotedQuoteIds: [] }).promotedQuoteIds).toEqual([]);
  });
});

describe("depositLabelOf", () => {
  it("비율+금액: 보증금 (20%) 1,180만원", () => {
    expect(depositLabelOf({ depositType: "deposit", depositRatio: 20, rentalDeposit: 11800000 })).toBe("보증금 (20%) 1,180만원");
  });
  it("금액만: 보증금 1,180만원", () => {
    expect(depositLabelOf({ depositType: "deposit", depositRatio: 0, rentalDeposit: 11800000 })).toBe("보증금 1,180만원");
  });
  it("비율만: 보증금 (20%)", () => {
    expect(depositLabelOf({ depositType: "deposit", depositRatio: 20, rentalDeposit: 0 })).toBe("보증금 (20%)");
  });
  it("유형 null: —", () => {
    expect(depositLabelOf({ depositType: null, depositRatio: 0, rentalDeposit: 0 })).toBe("—");
  });
});

describe("colorLabelOf", () => {
  it("4 mode 한글 라벨", () => {
    expect(colorLabelOf("undecided")).toBe("컬러 미정");
    expect(colorLabelOf("no_preference")).toBe("컬러 무관");
    expect(colorLabelOf("selected")).toBe("컬러 지정");
    expect(colorLabelOf("consultation")).toBe("희망 컬러 있음");
  });
  it("null(기존 행) → null (라벨 숨김)", () => {
    expect(colorLabelOf(null)).toBeNull();
  });
  it("미지의 값 → null 방어", () => {
    expect(colorLabelOf("unknown_mode")).toBeNull();
  });
});

describe("fetchQuoteRequestDetail", () => {
  it("GET /api/quote-requests/:id 호출 + paymentMethod 한글 매핑", async () => {
    // apiFetch는 fetch(url, { headers }) 형태로 호출하므로 첫 인자(URL)만 검증한다.
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "r1",
            trimId: 100,
            paymentMethod: "lease",
            optionIds: [1, 2],
            period: 36,
            depositType: "deposit",
            depositRatio: 20,
            rentalDeposit: 11800000,
            exteriorColorId: 10,
            interiorColorId: 20,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", spy);
    const d = await fetchQuoteRequestDetail("r1");
    expect((spy.mock.calls[0] as unknown[])[0]).toBe("/api/quote-requests/r1");
    expect(d.trimId).toBe(100);
    expect(d.optionIds).toEqual([1, 2]);
    expect(d.purchaseMethod).toBe("운용리스"); // lease → 한글
    expect(d.period).toBe(36);
    expect(d.depositType).toBe("deposit");
    expect(d.depositRatio).toBe(20);
    expect(d.rentalDeposit).toBe(11800000);
    expect(d.exteriorColorId).toBe(10);
    expect(d.interiorColorId).toBe(20);
  });

  it("컬러 id 없는 응답(selected 아님) → null 프리필", async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: "r2", trimId: 100, paymentMethod: "lease", optionIds: [], period: 36, depositType: "deposit", depositRatio: 0, rentalDeposit: 0 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", spy);
    const d = await fetchQuoteRequestDetail("r2");
    expect(d.exteriorColorId).toBeNull();
    expect(d.interiorColorId).toBeNull();
  });
});

describe("fetchCustomerQuoteRequests", () => {
  it("GET /api/customers/:id/quote-requests 호출 + 어댑터 적용", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify([base]), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const list = await fetchCustomerQuoteRequests("cust-1");
    expect((spy.mock.calls[0] as unknown[])[0]).toBe("/api/customers/cust-1/quote-requests");
    expect(list).toHaveLength(1);
    expect(list[0].vehicleLabel).toBe("기아 쏘렌토 · 26년형 노블레스"); // toAppQuoteRequest 적용 확인
  });
});
