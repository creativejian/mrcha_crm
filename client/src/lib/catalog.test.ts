import { afterEach, expect, it, vi } from "vitest";

import { createModel, deleteModel, fetchBrands, fetchCatalogCounts, fetchModels, updateModel } from "./catalog";

const COUNTS = {
  brands: 33,
  models: 265,
  trims: 1669,
  trimOptions: 10495,
  colors: 10483,
  trimNoOptions: 57,
  trimOptionRelations: 6236,
};

afterEach(() => vi.restoreAllMocks());

it("fetchCatalogCounts: 건수 객체 반환", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(COUNTS), { status: 200 })));
  const c = await fetchCatalogCounts();
  expect(c.brands).toBe(33);
  expect(c.trimOptionRelations).toBe(6236);
});

it("fetchCatalogCounts: 실패 시 throw", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
  await expect(fetchCatalogCounts()).rejects.toThrow();
});

it("fetchModels: brandId 쿼리 전달", async () => {
  const data = [{ id: 1, name: "5 Series", category: "준대형 세단", status: "판매중", trimCount: 13, minPrice: 1, maxPrice: 2 }];
  const spy = vi.fn(async (_url: string) => new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal("fetch", spy);
  const r = await fetchModels(7);
  expect(spy.mock.calls[0][0]).toBe("/api/catalog/models?brandId=7");
  expect(r[0].name).toBe("5 Series");
});

it("createModel: POST + body", async () => {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: 9 }), { status: 200 }));
  vi.stubGlobal("fetch", spy);
  await createModel({ brandId: 7, name: "X", category: null, status: "판매중" });
  expect(spy.mock.calls[0][1]?.method).toBe("POST");
});

it("updateModel: 서버 에러 메시지로 throw", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "모델을 찾을 수 없습니다." }), { status: 404 })),
  );
  await expect(updateModel(1, { status: "단종" })).rejects.toThrow("모델을 찾을 수 없습니다.");
});

it("fetchBrands / deleteModel 호출 경로", async () => {
  const spy = vi.fn(async (_url: string) => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", spy);
  await fetchBrands();
  expect(spy.mock.calls[0][0]).toBe("/api/catalog/brands");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 200 })));
  await deleteModel(1);
});
