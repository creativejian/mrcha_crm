import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBrands, fetchModels, fetchTrims } from "./vehicles";

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

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    await expect(fetchBrands()).rejects.toThrow();
  });
});
