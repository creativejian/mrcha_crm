import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBrands, fetchModels, fetchTrims, fetchTrimDetail } from "./vehicles";

// apiFetch(./api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

/** apiFetch는 fetch(url, { headers }) 형태로 호출하므로 첫 번째 인자(URL)만 검증한다. */
function calledUrl(spy: ReturnType<typeof vi.fn>): string {
  return (spy.mock.calls[0] as unknown[])[0] as string;
}

describe("vehicles api", () => {
  it("fetchBrands GETs /api/vehicles/brands", async () => {
    const data = [{ id: 1, name: "현대" }];
    const spy = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const brands = await fetchBrands();
    expect(calledUrl(spy)).toBe("/api/vehicles/brands");
    expect(brands).toEqual(data);
  });

  it("fetchModels passes brandId in query", async () => {
    const spy = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await fetchModels(5);
    expect(calledUrl(spy)).toBe("/api/vehicles/models?brandId=5");
  });

  it("fetchTrims passes modelId in query", async () => {
    const spy = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await fetchTrims(7);
    expect(calledUrl(spy)).toBe("/api/vehicles/trims?modelId=7");
  });

  it("fetchTrimDetail GETs /api/vehicles/trims/:id", async () => {
    const detail = {
      id: 100,
      modelId: 10,
      name: "S 500",
      price: 50000000,
      financialDiscountAmount: 1000000,
      partnerDiscountAmount: null,
      cashDiscountAmount: null,
      options: [],
      optionRelations: [],
      colors: [],
      noOptions: null,
    };
    const spy = vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const result = await fetchTrimDetail(100);
    expect(calledUrl(spy)).toBe("/api/vehicles/trims/100");
    expect(result).toEqual(detail);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    await expect(fetchBrands()).rejects.toThrow();
  });
});
