import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBrands, fetchModels, fetchTrims, fetchTrimDetail } from "./vehicles";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vehicles api", () => {
  it("fetchBrands GETs /api/vehicles/brands", async () => {
    const data = [{ id: 1, name: "현대" }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
    const brands = await fetchBrands();
    expect(fetch).toHaveBeenCalledWith("/api/vehicles/brands");
    expect(brands).toEqual(data);
  });

  it("fetchModels passes brandId in query", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    await fetchModels(5);
    expect(fetch).toHaveBeenCalledWith("/api/vehicles/models?brandId=5");
  });

  it("fetchTrims passes modelId in query", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    await fetchTrims(7);
    expect(fetch).toHaveBeenCalledWith("/api/vehicles/trims?modelId=7");
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 })));
    const result = await fetchTrimDetail(100);
    expect(fetch).toHaveBeenCalledWith("/api/vehicles/trims/100");
    expect(result).toEqual(detail);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    await expect(fetchBrands()).rejects.toThrow();
  });
});
