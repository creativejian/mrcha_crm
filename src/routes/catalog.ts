import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { z } from "zod";

import {
  VEHICLE_STATUSES,
  createModel,
  createOption,
  createTrim,
  deleteModel,
  deleteOption,
  deleteTrim,
  listColorsByTrim,
  listModelsByBrand,
  listOptionsByTrim,
  listTrimsByModel,
  updateModel,
  updateOption,
  updateTrim,
} from "../db/queries/catalog-admin";
import { getCatalogCounts } from "../db/queries/catalog-counts";
import { getBrands } from "../db/queries/vehicles";

export const catalog = new Hono();

const id = z.coerce.number().int().positive();
const status = z.enum(VEHICLE_STATUSES);
const optionType = z.enum(["basic", "tuning"]);

// 트리거/제약 위반 등 DB 에러를 사용자 친화 한글 메시지로.
function dbErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/trim_name/i.test(msg) && /(format|hyphen|enforce| - )/i.test(msg))
    return "국산차 트림명은 '서브라인 - 등급' 형식이어야 합니다.";
  if (/foreign key|23503/i.test(msg)) return "참조 중인 데이터가 있어 삭제할 수 없습니다(견적 등).";
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

catalog.get("/counts", async (c) => c.json(await getCatalogCounts()));
catalog.get("/brands", async (c) => c.json(await getBrands()));

// ── 모델 ──────────────────────────────────────────────────────────────────────
catalog.get("/models", zValidator("query", z.object({ brandId: id })), async (c) => {
  const rows = await listModelsByBrand(c.req.valid("query").brandId);
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
  async (c) => run(c, () => createModel(c.req.valid("json"))),
);

catalog.patch(
  "/models/:id",
  zValidator("param", z.object({ id })),
  zValidator("json", z.object({ category: z.string().nullable().optional(), status: status.optional() })),
  async (c) => run(c, () => updateModel(c.req.valid("param").id, c.req.valid("json")), "모델을 찾을 수 없습니다."),
);

catalog.delete("/models/:id", zValidator("param", z.object({ id })), async (c) =>
  run(c, () => deleteModel(c.req.valid("param").id), "모델을 찾을 수 없습니다."),
);

// ── 트림 ──────────────────────────────────────────────────────────────────────
catalog.get("/trims", zValidator("query", z.object({ modelId: id })), async (c) => {
  const trims = await listTrimsByModel(c.req.valid("query").modelId);
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
    }),
  ),
  async (c) => run(c, () => createTrim(c.req.valid("json"))),
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
    }),
  ),
  async (c) => run(c, () => updateTrim(c.req.valid("param").id, c.req.valid("json")), "트림을 찾을 수 없습니다."),
);

catalog.delete("/trims/:id", zValidator("param", z.object({ id })), async (c) =>
  run(c, () => deleteTrim(c.req.valid("param").id), "트림을 찾을 수 없습니다."),
);

// ── 옵션 / 색상 ────────────────────────────────────────────────────────────────
catalog.get("/trims/:id/options", zValidator("param", z.object({ id })), async (c) =>
  c.json(await listOptionsByTrim(c.req.valid("param").id)),
);

catalog.get("/trims/:id/colors", zValidator("param", z.object({ id })), async (c) =>
  c.json(await listColorsByTrim(c.req.valid("param").id)),
);

catalog.post(
  "/trims/:id/options",
  zValidator("param", z.object({ id })),
  zValidator("json", z.object({ type: optionType, name: z.string().min(1), price: z.number().int().nullable().default(null) })),
  async (c) => run(c, () => createOption({ trimId: c.req.valid("param").id, ...c.req.valid("json") })),
);

catalog.patch(
  "/options/:id",
  zValidator("param", z.object({ id })),
  zValidator("json", z.object({ name: z.string().min(1).optional(), price: z.number().int().nullable().optional() })),
  async (c) => run(c, () => updateOption(c.req.valid("param").id, c.req.valid("json")), "옵션을 찾을 수 없습니다."),
);

catalog.delete("/options/:id", zValidator("param", z.object({ id })), async (c) =>
  run(c, () => deleteOption(c.req.valid("param").id), "옵션을 찾을 수 없습니다."),
);
