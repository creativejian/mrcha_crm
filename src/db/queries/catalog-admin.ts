import { asc, count, eq, max, min } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { db } from "../client";

// 쓰기 함수는 기본 db, 테스트에선 tx를 넘겨 롤백한다(prod 무변경).
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const VEHICLE_STATUSES = ["판매중", "출시예정", "사전예약", "단종", "블라인드"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

// ── 모델 ──────────────────────────────────────────────────────────────────────
export async function listModelsByBrand(brandId: number) {
  return db
    .select({
      id: modelsInCatalog.id,
      name: modelsInCatalog.name,
      category: modelsInCatalog.category,
      status: modelsInCatalog.status,
      sortOrder: modelsInCatalog.sortOrder,
      modelCode: modelsInCatalog.modelCode,
      imageUrl: modelsInCatalog.imageUrl,
      trimCount: count(trimsInCatalog.id),
      minPrice: min(trimsInCatalog.price),
      maxPrice: max(trimsInCatalog.price),
    })
    .from(modelsInCatalog)
    .leftJoin(trimsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
    .where(eq(modelsInCatalog.brandId, brandId))
    .groupBy(modelsInCatalog.id)
    .orderBy(asc(modelsInCatalog.sortOrder));
}

export async function createModel(
  input: { brandId: number; name: string; category: string | null; status: VehicleStatus },
  executor: Executor = db,
) {
  // model_code·sort_order는 트리거 자동 부여 (insert 시 생략).
  const [row] = await executor
    .insert(modelsInCatalog)
    .values({ brandId: input.brandId, name: input.name, category: input.category, status: input.status })
    .returning();
  return row;
}

export async function updateModel(
  id: number,
  input: { category?: string | null; status?: VehicleStatus },
  executor: Executor = db,
) {
  const patch: Record<string, unknown> = {};
  if (input.category !== undefined) patch.category = input.category;
  if (input.status !== undefined) patch.status = input.status;
  const [row] = await executor.update(modelsInCatalog).set(patch).where(eq(modelsInCatalog.id, id)).returning();
  return row ?? null;
}

export async function deleteModel(id: number, executor: Executor = db) {
  const [row] = await executor
    .delete(modelsInCatalog)
    .where(eq(modelsInCatalog.id, id))
    .returning({ id: modelsInCatalog.id });
  return row ?? null;
}
