import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { z } from "zod";

import {
  VEHICLE_STATUSES,
  assignMcCodes,
  createModel,
  createOption,
  createTrim,
  deleteModel,
  deleteOption,
  deleteTrim,
  listColorsByTrim,
  listModelOptionSummary,
  listModelsByBrand,
  listOptionRelationsByTrim,
  listOptionsByTrim,
  listTrimColorsByModel,
  listTrimsByModel,
  moveTrims,
  reorderCatalog,
  setTrimNoOption,
  unsetTrimNoOption,
  updateModel,
  updateOption,
  updateTrim,
} from "../db/queries/catalog-admin";
import { getCatalogCounts } from "../db/queries/catalog-counts";
import { getBrands } from "../db/queries/vehicles";
import type { DbVariables } from "../middleware/db";

export const catalog = new Hono<{ Variables: DbVariables }>();

const id = z.coerce.number().int().positive();
const status = z.enum(VEHICLE_STATUSES);
const optionType = z.enum(["basic", "tuning"]);

// 트리거/제약 위반 등 DB 에러를 사용자 친화 한글 메시지로.
function dbErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/trim_name/i.test(msg) && /(format|hyphen|enforce| - )/i.test(msg))
    return "국산차 트림명은 '서브라인 - 등급' 형식이어야 합니다.";
  if (/foreign key|23503/i.test(msg)) return "참조 중인 데이터가 있어 삭제할 수 없습니다(견적 등).";
  if (/duplicate key|unique constraint|23505/i.test(msg)) return "같은 모델에 동일한 트림명 또는 고유번호가 있습니다.";
  if (/단종|trim_status|enforce_trim_status/i.test(msg)) return "단종 모델의 트림은 단종/블라인드 상태만 가능합니다.";
  if (/prevent_.*_change|code/i.test(msg) && /update|change/i.test(msg)) return "이미 부여된 코드는 변경할 수 없습니다.";
  return msg;
}

// 쓰기 핸들러 공통: 에러 → 500(한글), null → 404.
async function run<T>(c: Context, work: () => Promise<T>, notFoundMsg?: string): Promise<Response> {
  try {
    const result = await work();
    if (result == null && notFoundMsg) return c.json({ error: notFoundMsg }, 404);
    return c.json(result ?? null);
  } catch (e) {
    return c.json({ error: dbErrorMessage(e) }, 500);
  }
}

catalog.get("/counts", async (c) => c.json(await getCatalogCounts(c.var.db)));
catalog.get("/brands", async (c) => c.json(await getBrands(c.var.db)));

// ── 모델 ──────────────────────────────────────────────────────────────────────
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

// ── 트림 ──────────────────────────────────────────────────────────────────────
catalog.get("/models/:id/trim-colors", zValidator("param", z.object({ id })), async (c) =>
  c.json(await listTrimColorsByModel(c.req.valid("param").id, c.var.db)),
);

// 트림별 옵션 요약(배지): 기본/튜닝 개수 + 무옵션 확정.
catalog.get("/models/:id/option-summary", zValidator("param", z.object({ id })), async (c) =>
  c.json(await listModelOptionSummary(c.req.valid("param").id, c.var.db)),
);

catalog.get("/trims", zValidator("query", z.object({ modelId: id })), async (c) => {
  const trims = await listTrimsByModel(c.req.valid("query").modelId, c.var.db);
  return c.json(trims.map((t) => ({ ...t, price: Number(t.price) })));
});

catalog.post(
  "/trims",
  zValidator(
    "json",
    z.object({
      modelId: id,
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
    }),
  ),
  async (c) => run(c, () => createTrim(c.req.valid("json"), c.var.db)),
);

catalog.patch(
  "/trims/:id",
  zValidator("param", z.object({ id })),
  zValidator(
    "json",
    z.object({
      trimName: z.string().min(1).optional(),
      price: z.number().int().nonnegative().optional(),
      modelYear: z.number().int().optional(),
      fuelType: z.string().min(1).optional(),
      driveSystem: z.string().nullable().optional(),
      displacementCc: z.number().int().nullable().optional(),
      transmissionType: z.string().nullable().optional(),
      bodyStyle: z.string().nullable().optional(),
      seatingCapacity: z.number().int().nullable().optional(),
      status: status.optional(),
      financialDiscountAmount: z.number().int().nullable().optional(),
      partnerDiscountAmount: z.number().int().nullable().optional(),
      cashDiscountAmount: z.number().int().nullable().optional(),
    }),
  ),
  async (c) => run(c, () => updateTrim(c.req.valid("param").id, c.req.valid("json"), c.var.db), "트림을 찾을 수 없습니다."),
);

catalog.delete("/trims/:id", zValidator("param", z.object({ id })), async (c) =>
  run(c, () => deleteTrim(c.req.valid("param").id, c.var.db), "트림을 찾을 수 없습니다."),
);

// ── 옵션 / 색상 ────────────────────────────────────────────────────────────────
catalog.get("/trims/:id/options", zValidator("param", z.object({ id })), async (c) => {
  const trimId = c.req.valid("param").id;
  const [options, relations] = await Promise.all([
    listOptionsByTrim(trimId, c.var.db),
    listOptionRelationsByTrim(trimId, c.var.db),
  ]);
  return c.json({ options, relations });
});

catalog.get("/trims/:id/colors", zValidator("param", z.object({ id })), async (c) =>
  c.json(await listColorsByTrim(c.req.valid("param").id, c.var.db)),
);

catalog.post(
  "/trims/:id/options",
  zValidator("param", z.object({ id })),
  zValidator("json", z.object({ type: optionType, name: z.string().min(1), price: z.number().int().nullable().default(null) })),
  async (c) => run(c, () => createOption({ trimId: c.req.valid("param").id, ...c.req.valid("json") }, c.var.db)),
);

catalog.patch(
  "/options/:id",
  zValidator("param", z.object({ id })),
  zValidator("json", z.object({ name: z.string().min(1).optional(), price: z.number().int().nullable().optional() })),
  async (c) => run(c, () => updateOption(c.req.valid("param").id, c.req.valid("json"), c.var.db), "옵션을 찾을 수 없습니다."),
);

catalog.delete("/options/:id", zValidator("param", z.object({ id })), async (c) =>
  run(c, () => deleteOption(c.req.valid("param").id, c.var.db), "옵션을 찾을 수 없습니다."),
);

// 무옵션 확정 토글(옵션 0개일 때만 등록 가능).
catalog.post("/trims/:id/no-option", zValidator("param", z.object({ id })), async (c) =>
  run(c, () => setTrimNoOption(c.req.valid("param").id, c.var.db)),
);
catalog.delete("/trims/:id/no-option", zValidator("param", z.object({ id })), async (c) =>
  run(c, () => unsetTrimNoOption(c.req.valid("param").id, c.var.db)),
);
