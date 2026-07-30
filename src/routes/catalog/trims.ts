import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  createTrim,
  deleteTrim,
  listTrimsByModel,
  moveTrims,
  reorderCatalog,
} from "../../db/queries/catalog-admin";
import { updateTrimWithDiscountAudit } from "../../db/queries/discount-adoptions";
import { visibleTrimsFor } from "../../lib/dealer-visibility";
import { trimCreateBody, trimUpdateBody } from "./schemas";
import { type CatalogApp, id, run } from "./shared";

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
    // 딜러에게는 관리자 확정 할인을 내리지 않는다 — 자기 제안만 본다(lib/dealer-visibility 참조).
    const visible = visibleTrimsFor(c.var.user.role, trims);
    return c.json(visible.map((t) => ({ ...t, price: Number(t.price) })));
  });

  catalog.post("/trims", zValidator("json", trimCreateBody), async (c) =>
    run(c, () => createTrim(c.req.valid("json"), c.var.db)),
  );

  // 관리자 직접 편집 — 갱신 + 할인 3필드 감사 한 몸(근거·트랜잭션 필요성은
  // db/queries/discount-adoptions.ts의 updateTrimWithDiscountAudit 주석 참조, spec §3.4).
  catalog.patch(
    "/trims/:id",
    zValidator("param", z.object({ id })),
    zValidator("json", trimUpdateBody),
    async (c) => {
      const trimId = c.req.valid("param").id;
      const patch = c.req.valid("json");
      const adoptedBy = c.var.user.id;
      return run(
        c,
        () => c.var.db.transaction((tx) => updateTrimWithDiscountAudit(trimId, patch, adoptedBy, tx)),
        "트림을 찾을 수 없습니다.",
      );
    },
  );

  catalog.delete("/trims/:id", zValidator("param", z.object({ id })), async (c) =>
    run(c, () => deleteTrim(c.req.valid("param").id, c.var.db), "트림을 찾을 수 없습니다."),
  );
}
