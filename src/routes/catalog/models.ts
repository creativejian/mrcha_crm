import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  assignMcCodes,
  createModel,
  deleteModel,
  listModelOptionSummary,
  listModelsByBrand,
  listTrimColorsByModel,
  reorderCatalog,
  updateModel,
} from "../../db/queries/catalog-admin";
import { type CatalogApp, id, run, status } from "./shared";

// /api/catalog/models* — 모델 CRUD/순서/고유번호 할당.
// (/models/:id/trim-colors·option-summary는 모델 단위 조회라 여기 둔다.)
export function registerModelRoutes(catalog: CatalogApp) {
  catalog.get("/models", zValidator("query", z.object({ brandId: id })), async (c) => {
    const rows = await listModelsByBrand(c.req.valid("query").brandId, c.var.db);
    return c.json(
      rows.map((m) => ({
        ...m,
        trimCount: Number(m.trimCount),
        minPrice: m.minPrice == null ? null : Number(m.minPrice),
        maxPrice: m.maxPrice == null ? null : Number(m.maxPrice),
      })),
    );
  });

  catalog.post(
    "/models",
    zValidator(
      "json",
      z.object({ brandId: id, name: z.string().min(1), category: z.string().nullable().default(null), status: status.default("판매중") }),
    ),
    async (c) => run(c, () => createModel(c.req.valid("json"), c.var.db)),
  );

  catalog.patch(
    "/models/:id",
    zValidator("param", z.object({ id })),
    zValidator("json", z.object({ category: z.string().nullable().optional(), status: status.optional() })),
    async (c) => run(c, () => updateModel(c.req.valid("param").id, c.req.valid("json"), c.var.db), "모델을 찾을 수 없습니다."),
  );

  catalog.delete("/models/:id", zValidator("param", z.object({ id })), async (c) =>
    run(c, () => deleteModel(c.req.valid("param").id, c.var.db), "모델을 찾을 수 없습니다."),
  );

  // 모델의 mc_code 미부여 트림에 고유번호 일괄 부여(tx로 원자 처리).
  catalog.post("/models/:id/assign-codes", zValidator("param", z.object({ id })), async (c) =>
    run(c, () => c.var.db.transaction((tx) => assignMcCodes(c.req.valid("param").id, tx))),
  );

  catalog.post(
    "/models/reorder",
    zValidator("json", z.object({ ids: z.array(id).min(1) })),
    async (c) =>
      run(c, async () => {
        await reorderCatalog("models", c.req.valid("json").ids, c.var.db);
        return { ok: true };
      }),
  );

  catalog.get("/models/:id/trim-colors", zValidator("param", z.object({ id })), async (c) =>
    c.json(await listTrimColorsByModel(c.req.valid("param").id, c.var.db)),
  );

  // 트림별 옵션 요약(배지): 기본/튜닝 개수 + 무옵션 확정.
  catalog.get("/models/:id/option-summary", zValidator("param", z.object({ id })), async (c) =>
    c.json(await listModelOptionSummary(c.req.valid("param").id, c.var.db)),
  );
}
