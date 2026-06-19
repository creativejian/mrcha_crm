import { and, asc, count, eq, inArray, isNull, max, min, sql } from "drizzle-orm";

import {
  brandsInCatalog,
  colorsInCatalog,
  modelsInCatalog,
  trimNoOptionsInCatalog,
  trimOptionRelationsInCatalog,
  trimOptionsInCatalog,
  trimsInCatalog,
} from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { buildCanonicalName } from "./canonical-name";

// 쓰기 함수는 기본 getDefaultDb()(로컬/테스트/fallback), 테스트·라우트에선 tx/요청 db를 넘긴다.

export const VEHICLE_STATUSES = ["판매중", "출시예정", "사전예약", "단종", "블라인드"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

// ── 모델 ──────────────────────────────────────────────────────────────────────
export async function listModelsByBrand(brandId: number, executor: Executor = getDefaultDb()) {
  return executor
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
  executor: Executor = getDefaultDb(),
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
  executor: Executor = getDefaultDb(),
) {
  const patch: Record<string, unknown> = {};
  if (input.category !== undefined) patch.category = input.category;
  if (input.status !== undefined) patch.status = input.status;
  const [row] = await executor.update(modelsInCatalog).set(patch).where(eq(modelsInCatalog.id, id)).returning();
  return row ?? null;
}

export async function deleteModel(id: number, executor: Executor = getDefaultDb()) {
  const [row] = await executor
    .delete(modelsInCatalog)
    .where(eq(modelsInCatalog.id, id))
    .returning({ id: modelsInCatalog.id });
  return row ?? null;
}

// ── 트림 ──────────────────────────────────────────────────────────────────────
// canonical 계산용 모델+브랜드 정보(브랜드명·모델명·국산여부).
async function modelCanonicalContext(modelId: number, executor: Executor = getDefaultDb()) {
  const [row] = await executor
    .select({ brand: brandsInCatalog.name, model: modelsInCatalog.name, isDomestic: brandsInCatalog.isDomestic })
    .from(modelsInCatalog)
    .innerJoin(brandsInCatalog, eq(brandsInCatalog.id, modelsInCatalog.brandId))
    .where(eq(modelsInCatalog.id, modelId));
  return row ?? null;
}

export async function listTrimsByModel(modelId: number, executor: Executor = getDefaultDb()) {
  return executor
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
      priceUpdatedAt: trimsInCatalog.priceUpdatedAt,
      financialDiscountAmount: trimsInCatalog.financialDiscountAmount,
      partnerDiscountAmount: trimsInCatalog.partnerDiscountAmount,
      cashDiscountAmount: trimsInCatalog.cashDiscountAmount,
      discountUpdatedAt: trimsInCatalog.discountUpdatedAt,
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
    financialDiscountAmount?: number | null;
    partnerDiscountAmount?: number | null;
    cashDiscountAmount?: number | null;
  },
  executor: Executor = getDefaultDb(),
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
      financialDiscountAmount: input.financialDiscountAmount ?? null,
      partnerDiscountAmount: input.partnerDiscountAmount ?? null,
      cashDiscountAmount: input.cashDiscountAmount ?? null,
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
    financialDiscountAmount: number | null;
    partnerDiscountAmount: number | null;
    cashDiscountAmount: number | null;
  }>,
  executor: Executor = getDefaultDb(),
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
  // 할인 변경 시 discount_updated_at은 DB 트리거가 자동 갱신.
  if (input.financialDiscountAmount !== undefined) patch.financialDiscountAmount = input.financialDiscountAmount;
  if (input.partnerDiscountAmount !== undefined) patch.partnerDiscountAmount = input.partnerDiscountAmount;
  if (input.cashDiscountAmount !== undefined) patch.cashDiscountAmount = input.cashDiscountAmount;
  const [row] = await executor.update(trimsInCatalog).set(patch).where(eq(trimsInCatalog.id, id)).returning();
  return row ?? null;
}

export async function deleteTrim(id: number, executor: Executor = getDefaultDb()) {
  const [row] = await executor
    .delete(trimsInCatalog)
    .where(eq(trimsInCatalog.id, id))
    .returning({ id: trimsInCatalog.id });
  return row ?? null;
}

// ── 옵션 ──────────────────────────────────────────────────────────────────────
export async function listOptionsByTrim(trimId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({
      id: trimOptionsInCatalog.id,
      type: trimOptionsInCatalog.type,
      name: trimOptionsInCatalog.name,
      price: trimOptionsInCatalog.price,
    })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.trimId, trimId))
    .orderBy(asc(trimOptionsInCatalog.id));
}

// 트림 옵션의 includes/excludes 관계(표식 표시용·읽기 전용). 편집은 Phase 2.
export async function listOptionRelationsByTrim(trimId: number, executor: Executor = getDefaultDb()) {
  const opts = await executor
    .select({ id: trimOptionsInCatalog.id })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.trimId, trimId));
  const ids = opts.map((o) => o.id);
  if (ids.length === 0) return [];
  return executor
    .select({
      optionId: trimOptionRelationsInCatalog.optionId,
      relatedOptionId: trimOptionRelationsInCatalog.relatedOptionId,
      type: trimOptionRelationsInCatalog.type,
    })
    .from(trimOptionRelationsInCatalog)
    .where(inArray(trimOptionRelationsInCatalog.optionId, ids));
}

export async function createOption(
  input: { trimId: number; type: "basic" | "tuning"; name: string; price: number | null },
  executor: Executor = getDefaultDb(),
) {
  const [row] = await executor
    .insert(trimOptionsInCatalog)
    .values({ trimId: input.trimId, type: input.type, name: input.name, price: input.price })
    .returning();
  return row;
}

export async function updateOption(
  id: number,
  input: { name?: string; price?: number | null },
  executor: Executor = getDefaultDb(),
) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.price !== undefined) patch.price = input.price;
  const [row] = await executor.update(trimOptionsInCatalog).set(patch).where(eq(trimOptionsInCatalog.id, id)).returning();
  return row ?? null;
}

export async function deleteOption(id: number, executor: Executor = getDefaultDb()) {
  const [row] = await executor
    .delete(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.id, id))
    .returning({ id: trimOptionsInCatalog.id });
  return row ?? null;
}

// 모델 하위 트림별 옵션 요약(배지용): 기본/튜닝 개수 + 무옵션 확정 여부.
// 옵션도 무옵션 등록도 없는 트림은 결과에서 빠지고, 프론트가 '미정'으로 처리한다.
export async function listModelOptionSummary(modelId: number, executor: Executor = getDefaultDb()) {
  const counts = await executor
    .select({ trimId: trimOptionsInCatalog.trimId, type: trimOptionsInCatalog.type, c: count() })
    .from(trimOptionsInCatalog)
    .innerJoin(trimsInCatalog, eq(trimsInCatalog.id, trimOptionsInCatalog.trimId))
    .where(eq(trimsInCatalog.modelId, modelId))
    .groupBy(trimOptionsInCatalog.trimId, trimOptionsInCatalog.type);
  const noOpt = await executor
    .select({ trimId: trimNoOptionsInCatalog.trimId })
    .from(trimNoOptionsInCatalog)
    .innerJoin(trimsInCatalog, eq(trimsInCatalog.id, trimNoOptionsInCatalog.trimId))
    .where(eq(trimsInCatalog.modelId, modelId));
  const map = new Map<number, { basic: number; tuning: number; noOption: boolean }>();
  const slot = (id: number) => {
    let e = map.get(id);
    if (!e) {
      e = { basic: 0, tuning: 0, noOption: false };
      map.set(id, e);
    }
    return e;
  };
  for (const r of counts) {
    const e = slot(r.trimId);
    if (r.type === "basic") e.basic = Number(r.c);
    else if (r.type === "tuning") e.tuning = Number(r.c);
  }
  for (const r of noOpt) slot(r.trimId).noOption = true;
  return [...map.entries()].map(([trimId, v]) => ({ trimId, ...v }));
}

// 무옵션 확정: 옵션이 하나도 없을 때만 등록(idempotent).
export async function setTrimNoOption(trimId: number, executor: Executor = getDefaultDb()) {
  const [row] = await executor
    .select({ c: count() })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.trimId, trimId));
  if (Number(row?.c ?? 0) > 0) throw new Error("옵션이 있는 트림은 ‘옵션 없음’으로 확정할 수 없습니다.");
  await executor.insert(trimNoOptionsInCatalog).values({ trimId }).onConflictDoNothing();
  return { ok: true };
}

export async function unsetTrimNoOption(trimId: number, executor: Executor = getDefaultDb()) {
  await executor.delete(trimNoOptionsInCatalog).where(eq(trimNoOptionsInCatalog.trimId, trimId));
  return { ok: true };
}

// ── 고유번호(mc_code) 부여 ──────────────────────────────────────────────────────
// 새 트림은 trim_code 미부여라 mc_code가 null이다. 관리자가 모델 단위로 할당하면
// trim_code를 sort_order순으로 채번(활성+삭제이력 max+1부터)하고, catalog.trims의
// auto_mc_code 트리거가 mc_code(MC+brand2+model2+year2+trim3)를 자동 생성한다.

// 브랜드/모델 코드가 모두 있어야 mc_code 생성 가능. assignMcCodes 내부 전용.
async function modelHasCodes(modelId: number, executor: Executor = getDefaultDb()): Promise<boolean> {
  const [row] = await executor
    .select({ modelCode: modelsInCatalog.modelCode, brandCode: brandsInCatalog.brandCode })
    .from(modelsInCatalog)
    .innerJoin(brandsInCatalog, eq(brandsInCatalog.id, modelsInCatalog.brandId))
    .where(eq(modelsInCatalog.id, modelId));
  return row != null && row.modelCode != null && row.brandCode != null;
}

// 활성 트림 + 삭제 이력(trim_code_history) 중 최대 trim_code (삭제분 코드 재사용 방지).
async function maxTrimCode(modelId: number, executor: Executor = getDefaultDb()): Promise<number> {
  const [active] = await executor
    .select({ m: max(trimsInCatalog.trimCode) })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, modelId));
  const histRows = (await executor.execute(
    sql`select coalesce(max(trim_code), 0)::int as m from catalog.trim_code_history where model_id = ${modelId}`,
  )) as unknown as Array<{ m: number }>;
  return Math.max(Number(active?.m ?? 0), Number(histRows[0]?.m ?? 0));
}

// 모델의 mc_code 미부여 트림에 일괄 부여(앱 '고유번호 할당'). 라우트에서 tx로 감싼다.
export async function assignMcCodes(modelId: number, executor: Executor = getDefaultDb()): Promise<{ assigned: number }> {
  if (!(await modelHasCodes(modelId, executor)))
    throw new Error("브랜드 또는 모델의 고유번호가 아직 부여되지 않았습니다.");
  const targets = await executor
    .select({ id: trimsInCatalog.id, trimName: trimsInCatalog.trimName, modelYear: trimsInCatalog.modelYear })
    .from(trimsInCatalog)
    .where(and(eq(trimsInCatalog.modelId, modelId), isNull(trimsInCatalog.mcCode)))
    .orderBy(asc(trimsInCatalog.sortOrder));
  if (targets.length === 0) return { assigned: 0 };
  const noYear = targets.find((t) => t.modelYear == null);
  if (noYear) throw new Error(`'${noYear.trimName}'의 연식을 먼저 입력하세요.`);
  // sort_order순으로 max+1부터 채번 → 각 UPDATE 시 auto_mc_code 트리거가 mc_code 생성.
  const start = await maxTrimCode(modelId, executor);
  for (let i = 0; i < targets.length; i++) {
    await executor.update(trimsInCatalog).set({ trimCode: start + i + 1 }).where(eq(trimsInCatalog.id, targets[i].id));
  }
  return { assigned: targets.length };
}

// 트림을 다른 모델로 이동(앱 '모델 이동', 같은 브랜드 내). model_id 변경 + 대상 모델 기준
// sort_order 재부여(max+1…) — 앱은 재부여를 안 해 UNIQUE(model_id, sort_order) 충돌 위험이
// 있어 CRM은 보강한다. trim_code/mc_code/canonical_name은 트리거가 변경을 막아 유지(앱 동일, mc_code stale).
export async function moveTrims(
  trimIds: number[],
  targetModelId: number,
  executor: Executor = getDefaultDb(),
): Promise<{ moved: number }> {
  if (trimIds.length === 0) return { moved: 0 };
  const [row] = await executor
    .select({ m: max(trimsInCatalog.sortOrder) })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, targetModelId));
  let order = Number(row?.m ?? 0);
  for (const id of trimIds) {
    order += 1;
    await executor
      .update(trimsInCatalog)
      .set({ modelId: targetModelId, sortOrder: order })
      .where(eq(trimsInCatalog.id, id));
  }
  return { moved: trimIds.length };
}

// ── 순서변경 ──────────────────────────────────────────────────────────────────
// orderedIds 위치(1..N)를 sort_order로. public.batch_update_sort_order RPC가 temp 값으로
// UNIQUE(brand_id/model_id, sort_order) 충돌을 회피한다. table='models'|'trims'.
export async function reorderCatalog(
  table: "models" | "trims",
  orderedIds: number[],
  executor: Executor = getDefaultDb(),
): Promise<void> {
  if (orderedIds.length === 0) return;
  const sortOrders = orderedIds.map((_, i) => i + 1);
  await executor.execute(
    sql`select public.batch_update_sort_order(${table}, ${sql.param(orderedIds)}::int[], ${sql.param(sortOrders)}::int[])`,
  );
}

// 모델 하위 모든 트림의 색상(트림 리스트 칩 표시용). trimId로 묶어서 쓴다.
export async function listTrimColorsByModel(modelId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({
      trimId: colorsInCatalog.trimId,
      colorType: colorsInCatalog.colorType,
      name: colorsInCatalog.name,
      hexValue: colorsInCatalog.hexValue,
      sortOrder: colorsInCatalog.sortOrder,
    })
    .from(colorsInCatalog)
    .innerJoin(trimsInCatalog, eq(trimsInCatalog.id, colorsInCatalog.trimId))
    .where(eq(trimsInCatalog.modelId, modelId))
    .orderBy(asc(colorsInCatalog.sortOrder));
}

// 트림 색상(읽기 전용 칩) — Phase 1 표시용.
export async function listColorsByTrim(trimId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({
      id: colorsInCatalog.id,
      colorType: colorsInCatalog.colorType,
      name: colorsInCatalog.name,
      hexValue: colorsInCatalog.hexValue,
    })
    .from(colorsInCatalog)
    .where(eq(colorsInCatalog.trimId, trimId))
    .orderBy(asc(colorsInCatalog.sortOrder));
}
