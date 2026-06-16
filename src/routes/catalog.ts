import { Hono } from "hono";

import { getCatalogCounts } from "../db/queries/catalog-counts";
import { runSync } from "../sync/sync";

export const catalog = new Hono();

// 모듈 레벨 동시 실행 가드 (단일 인스턴스 전제).
let syncing = false;

catalog.get("/counts", async (c) => {
  return c.json(await getCatalogCounts());
});

catalog.post("/sync", async (c) => {
  if (syncing) return c.json({ error: "이미 동기화가 진행 중입니다." }, 409);
  syncing = true;
  try {
    const tables = await runSync();
    return c.json({ ok: tables.every((t) => t.complete), tables });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    syncing = false;
  }
});
