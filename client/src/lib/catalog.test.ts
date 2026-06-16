import { afterEach, expect, it, vi } from "vitest";

import { fetchCatalogCounts, runCatalogSync } from "./catalog";

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

it("runCatalogSync: 결과 반환", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            tables: [{ name: "brands", fetched: 33, total: 33, complete: true, upserted: 33, softDeleted: 0 }],
          }),
          { status: 200 },
        ),
    ),
  );
  const r = await runCatalogSync();
  expect(r.ok).toBe(true);
  expect(r.tables[0].name).toBe("brands");
});

it("runCatalogSync: 409 → 서버 에러 메시지로 throw", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "이미 동기화가 진행 중입니다." }), { status: 409 })),
  );
  await expect(runCatalogSync()).rejects.toThrow("이미 동기화가 진행 중입니다.");
});
