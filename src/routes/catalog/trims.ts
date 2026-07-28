import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  createTrim,
  deleteTrim,
  listTrimsByModel,
  moveTrims,
  reorderCatalog,
  updateTrim,
} from "../../db/queries/catalog-admin";
import { trimsInCatalog } from "../../db/catalog";
import { recordAdminDiscountEdits } from "../../db/queries/discount-adoptions";
import { visibleTrimsFor } from "../../lib/dealer-visibility";
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
    // 딜러에게는 관리자 확정 할인을 내리지 않는다 — 자기 제안만 본다(lib/dealer-visibility 참조).
    const visible = visibleTrimsFor(c.var.user.role, trims);
    return c.json(visible.map((t) => ({ ...t, price: Number(t.price) })));
  });

  catalog.post("/trims", zValidator("json", trimBody.extend({ modelId: id })), async (c) =>
    run(c, () => createTrim(c.req.valid("json"), c.var.db)),
  );

  // 관리자 직접 편집. **할인 3필드가 바뀌면 감사 행을 남긴다**(spec §3.4) — 딜러 채택만 기록하면
  // 관리자가 확정값을 바꿔도 최신 감사가 옛 딜러 채택이라 팝오버가 거짓 출처를 보여준다
  // (2026-07-28 실기에서 실제로 그렇게 됐다). **트랜잭션**으로 열어 갱신과 감사를 한 몸으로 둔다:
  // 갱신만 커밋되면 "누가 바꿨는지 모르는 확정 할인"이 남고, 그게 이 표를 만든 이유다.
  catalog.patch(
    "/trims/:id",
    zValidator("param", z.object({ id })),
    zValidator("json", trimBody.partial()),
    async (c) => {
      const trimId = c.req.valid("param").id;
      const patch = c.req.valid("json");
      const adoptedBy = c.var.user.id;
      return run(
        c,
        () =>
          c.var.db.transaction(async (tx) => {
            // 갱신 전 값을 같은 트랜잭션에서 읽는다 — previous_amount의 근거이고, 되돌리기의 유일한 단서다.
            const [before] = await tx
              .select({
                financial: trimsInCatalog.financialDiscountAmount,
                partner: trimsInCatalog.partnerDiscountAmount,
                cash: trimsInCatalog.cashDiscountAmount,
              })
              .from(trimsInCatalog)
              .where(eq(trimsInCatalog.id, trimId));
            if (!before) return null;
            const row = await updateTrim(trimId, patch, tx);
            if (row) await recordAdminDiscountEdits({ trimId, before, patch, adoptedBy }, tx);
            return row;
          }),
        "트림을 찾을 수 없습니다.",
      );
    },
  );

  catalog.delete("/trims/:id", zValidator("param", z.object({ id })), async (c) =>
    run(c, () => deleteTrim(c.req.valid("param").id, c.var.db), "트림을 찾을 수 없습니다."),
  );
}
