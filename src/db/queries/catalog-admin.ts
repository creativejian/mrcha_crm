import { asc, count, eq, max, min } from "drizzle-orm";

import { brandsInCatalog, modelsInCatalog, trimsInCatalog } from "../catalog";
import { db } from "../client";
import { buildCanonicalName } from "./canonical-name";

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

// ── 트림 ──────────────────────────────────────────────────────────────────────
// canonical 계산용 모델+브랜드 정보(브랜드명·모델명·국산여부).
async function modelCanonicalContext(modelId: number, executor: Executor = db) {
  const [row] = await executor
    .select({ brand: brandsInCatalog.name, model: modelsInCatalog.name, isDomestic: brandsInCatalog.isDomestic })
    .from(modelsInCatalog)
    .innerJoin(brandsInCatalog, eq(brandsInCatalog.id, modelsInCatalog.brandId))
    .where(eq(modelsInCatalog.id, modelId));
  return row ?? null;
}

export async function listTrimsByModel(modelId: number) {
  return db
    .select({
      id: trimsInCatalog.id,
      name: trimsInCatalog.name,
      trimName: trimsInCatalog.trimName,
      canonicalName: trimsInCatalog.canonicalName,
      price: trimsInCatalog.price,
      modelYear: trimsInCatalog.modelYear,
      fuelType: trimsInCatalog.fuelType,
      driveSystem: trimsInCatalog.driveSystem,
      displacementCc: trimsInCatalog.displacementCc,
      transmissionType: trimsInCatalog.transmissionType,
      bodyStyle: trimsInCatalog.bodyStyle,
      seatingCapacity: trimsInCatalog.seatingCapacity,
      status: trimsInCatalog.status,
      mcCode: trimsInCatalog.mcCode,
      sortOrder: trimsInCatalog.sortOrder,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, modelId))
    .orderBy(asc(trimsInCatalog.sortOrder));
}

export async function createTrim(
  input: {
    modelId: number;
    trimName: string;
    price: number;
    modelYear: number;
    fuelType: string;
    driveSystem?: string | null;
    displacementCc?: number | null;
    transmissionType?: string | null;
    bodyStyle?: string | null;
    seatingCapacity?: number | null;
    status?: VehicleStatus;
  },
  executor: Executor = db,
) {
  const ctx = await modelCanonicalContext(input.modelId, executor);
  if (!ctx) throw new Error("모델을 찾을 수 없습니다.");
  const canonicalName = buildCanonicalName({
    brand: ctx.brand,
    model: ctx.model,
    isDomestic: ctx.isDomestic,
    modelYear: input.modelYear,
    fuelType: input.fuelType,
    trimName: input.trimName,
  });
  const [row] = await executor
    .insert(trimsInCatalog)
    .values({
      modelId: input.modelId,
      name: input.trimName,
      trimName: input.trimName,
      canonicalName,
      price: input.price,
      modelYear: input.modelYear,
      fuelType: input.fuelType,
      driveSystem: input.driveSystem ?? null,
      displacementCc: input.displacementCc ?? null,
      transmissionType: input.transmissionType ?? null,
      bodyStyle: input.bodyStyle ?? null,
      seatingCapacity: input.seatingCapacity ?? null,
      status: input.status ?? "판매중",
    })
    .returning();
  return row;
}

export async function updateTrim(
  id: number,
  input: Partial<{
    trimName: string;
    price: number;
    modelYear: number;
    fuelType: string;
    driveSystem: string | null;
    displacementCc: number | null;
    transmissionType: string | null;
    bodyStyle: string | null;
    seatingCapacity: number | null;
    status: VehicleStatus;
  }>,
  executor: Executor = db,
) {
  const patch: Record<string, unknown> = {};
  // trimName 변경 시 name도 동기화(앱과 동일). canonical_name은 생성 시에만 설정(Phase 1).
  if (input.trimName !== undefined) {
    patch.trimName = input.trimName;
    patch.name = input.trimName;
  }
  if (input.price !== undefined) patch.price = input.price;
  if (input.modelYear !== undefined) patch.modelYear = input.modelYear;
  if (input.fuelType !== undefined) patch.fuelType = input.fuelType;
  if (input.driveSystem !== undefined) patch.driveSystem = input.driveSystem;
  if (input.displacementCc !== undefined) patch.displacementCc = input.displacementCc;
  if (input.transmissionType !== undefined) patch.transmissionType = input.transmissionType;
  if (input.bodyStyle !== undefined) patch.bodyStyle = input.bodyStyle;
  if (input.seatingCapacity !== undefined) patch.seatingCapacity = input.seatingCapacity;
  if (input.status !== undefined) patch.status = input.status;
  const [row] = await executor.update(trimsInCatalog).set(patch).where(eq(trimsInCatalog.id, id)).returning();
  return row ?? null;
}

export async function deleteTrim(id: number, executor: Executor = db) {
  const [row] = await executor
    .delete(trimsInCatalog)
    .where(eq(trimsInCatalog.id, id))
    .returning({ id: trimsInCatalog.id });
  return row ?? null;
}
