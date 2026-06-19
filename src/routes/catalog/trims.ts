import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  createTrim,
  deleteTrim,
  listTrimsByModel,
  moveTrims,
  reorderCatalog,
  updateTrim,
} from "../../db/queries/catalog-admin";
import { type CatalogApp, id, run, status } from "./shared";

// 트림 본문 스키마. create는 modelId를 더해 그대로, patch는 .partial()로 전부 optional.
const trimBody = z.object({
  trimName: z.string().min(1),
  price: z.number().int().nonnegative(),
  modelYear: z.number().int(),
  fuelType: z.string().min(1),
  driveSystem: z.string().nullable().optional(),
  displacementCc: z.number().int().nullable().optional(),
  transmissionType: z.string().nullable().optional(),
  bodyStyle: z.string().nullable().optional(),
  seatingCapacity: z.number().int().nullable().optional(),
  status: status.optional(),
  financialDiscountAmount: z.number().int().nullable().optional(),
  partnerDiscountAmount: z.number().int().nullable().optional(),
  cashDiscountAmount: z.number().int().nullable().optional(),
});

// /api/catalog/trims* — 트림 CRUD/순서/모델 이동.
export function registerTrimRoutes(catalog: CatalogApp) {
  catalog.post(
    "/trims/reorder",
    zValidator("json", z.object({ ids: z.array(id).min(1) })),
    async (c) =>
      run(c, async () => {
        await reorderCatalog("trims", c.req.valid("json").ids, c.var.db);
        return { ok: true };
      }),
  );

  // 트림 다른 모델로 이동(tx 원자 처리).
  catalog.post(
    "/trims/move",
    zValidator("json", z.object({ trimIds: z.array(id).min(1), targetModelId: id })),
    async (c) => {
      const { trimIds, targetModelId } = c.req.valid("json");
      return run(c, () => c.var.db.transaction((tx) => moveTrims(trimIds, targetModelId, tx)));
    },
  );

  catalog.get("/trims", zValidator("query", z.object({ modelId: id })), async (c) => {
    const trims = await listTrimsByModel(c.req.valid("query").modelId, c.var.db);
    return c.json(trims.map((t) => ({ ...t, price: Number(t.price) })));
  });

  catalog.post("/trims", zValidator("json", trimBody.extend({ modelId: id })), async (c) =>
    run(c, () => createTrim(c.req.valid("json"), c.var.db)),
  );

  catalog.patch(
    "/trims/:id",
    zValidator("param", z.object({ id })),
    zValidator("json", trimBody.partial()),
    async (c) => run(c, () => updateTrim(c.req.valid("param").id, c.req.valid("json"), c.var.db), "트림을 찾을 수 없습니다."),
  );

  catalog.delete("/trims/:id", zValidator("param", z.object({ id })), async (c) =>
    run(c, () => deleteTrim(c.req.valid("param").id, c.var.db), "트림을 찾을 수 없습니다."),
  );
}
