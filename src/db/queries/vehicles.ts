import { asc, eq, inArray } from "drizzle-orm";

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

// master catalog 직접 read. master엔 거울 전용 deleted_at이 없으므로 isNull(deletedAt) 필터를 쓰지 않는다.
// status(판매중/단종/출시예정 등)는 거울 동작과 동일하게 필터하지 않는다(단종 차량도 라인업에 노출).

export async function getBrands(executor: Executor = getDefaultDb()) {
  return executor
    .select({
      id: brandsInCatalog.id,
      name: brandsInCatalog.name,
      logoUrl: brandsInCatalog.logoUrl,
      isDomestic: brandsInCatalog.isDomestic,
      isPopular: brandsInCatalog.isPopular,
      sortOrder: brandsInCatalog.sortOrder,
      brandCode: brandsInCatalog.brandCode,
    })
    .from(brandsInCatalog)
    .orderBy(asc(brandsInCatalog.sortOrder));
}

export async function getModelsByBrand(brandId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({
      id: modelsInCatalog.id,
      brandId: modelsInCatalog.brandId,
      name: modelsInCatalog.name,
      imageUrl: modelsInCatalog.imageUrl,
      category: modelsInCatalog.category,
      status: modelsInCatalog.status,
      sortOrder: modelsInCatalog.sortOrder,
      modelCode: modelsInCatalog.modelCode,
    })
    .from(modelsInCatalog)
    .where(eq(modelsInCatalog.brandId, brandId))
    .orderBy(asc(modelsInCatalog.sortOrder));
}

export async function getTrimsByModel(modelId: number, executor: Executor = getDefaultDb()) {
  return executor
    .select({
      id: trimsInCatalog.id,
      modelId: trimsInCatalog.modelId,
      name: trimsInCatalog.name,
      trimName: trimsInCatalog.trimName,
      canonicalName: trimsInCatalog.canonicalName,
      price: trimsInCatalog.price,
      fuelType: trimsInCatalog.fuelType,
      displacementCc: trimsInCatalog.displacementCc,
      modelYear: trimsInCatalog.modelYear,
      driveSystem: trimsInCatalog.driveSystem,
      transmissionType: trimsInCatalog.transmissionType,
      bodyStyle: trimsInCatalog.bodyStyle,
      seatingCapacity: trimsInCatalog.seatingCapacity,
      status: trimsInCatalog.status,
      sortOrder: trimsInCatalog.sortOrder,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, modelId))
    .orderBy(asc(trimsInCatalog.sortOrder));
}

export async function getTrimDetail(trimId: number, executor: Executor = getDefaultDb()) {
  const [trimRows, options, colors, noOptionRows] = await Promise.all([
    executor
      .select({
        id: trimsInCatalog.id,
        modelId: trimsInCatalog.modelId,
        name: trimsInCatalog.name,
        trimName: trimsInCatalog.trimName,
        canonicalName: trimsInCatalog.canonicalName,
        price: trimsInCatalog.price,
        specs: trimsInCatalog.specs,
        fuelType: trimsInCatalog.fuelType,
        displacementCc: trimsInCatalog.displacementCc,
        modelYear: trimsInCatalog.modelYear,
        driveSystem: trimsInCatalog.driveSystem,
        transmissionType: trimsInCatalog.transmissionType,
        bodyStyle: trimsInCatalog.bodyStyle,
        seatingCapacity: trimsInCatalog.seatingCapacity,
        status: trimsInCatalog.status,
        sortOrder: trimsInCatalog.sortOrder,
        financialDiscountAmount: trimsInCatalog.financialDiscountAmount,
        partnerDiscountAmount: trimsInCatalog.partnerDiscountAmount,
        cashDiscountAmount: trimsInCatalog.cashDiscountAmount,
        brandId: brandsInCatalog.id,
        brandName: brandsInCatalog.name,
        modelName: modelsInCatalog.name,
      })
      .from(trimsInCatalog)
      .leftJoin(modelsInCatalog, eq(trimsInCatalog.modelId, modelsInCatalog.id))
      .leftJoin(brandsInCatalog, eq(modelsInCatalog.brandId, brandsInCatalog.id))
      .where(eq(trimsInCatalog.id, trimId)),
    executor
      .select({
        id: trimOptionsInCatalog.id,
        type: trimOptionsInCatalog.type,
        name: trimOptionsInCatalog.name,
        price: trimOptionsInCatalog.price,
      })
      .from(trimOptionsInCatalog)
      .where(eq(trimOptionsInCatalog.trimId, trimId)),
    executor
      .select({
        id: colorsInCatalog.id,
        colorType: colorsInCatalog.colorType,
        name: colorsInCatalog.name,
        code: colorsInCatalog.code,
        hexValue: colorsInCatalog.hexValue,
        sortOrder: colorsInCatalog.sortOrder,
      })
      .from(colorsInCatalog)
      .where(eq(colorsInCatalog.trimId, trimId))
      .orderBy(asc(colorsInCatalog.sortOrder)),
    executor
      .select({
        note: trimNoOptionsInCatalog.note,
        checkedAt: trimNoOptionsInCatalog.checkedAt,
      })
      .from(trimNoOptionsInCatalog)
      .where(eq(trimNoOptionsInCatalog.trimId, trimId)),
  ]);

  const trim = trimRows[0];
  if (!trim) return null;

  const optionIds = options.map((o) => o.id);
  const optionRelations = optionIds.length
    ? await executor
        .select({
          id: trimOptionRelationsInCatalog.id,
          optionId: trimOptionRelationsInCatalog.optionId,
          relatedOptionId: trimOptionRelationsInCatalog.relatedOptionId,
          type: trimOptionRelationsInCatalog.type,
        })
        .from(trimOptionRelationsInCatalog)
        .where(inArray(trimOptionRelationsInCatalog.optionId, optionIds))
    : [];

  return { ...trim, options, optionRelations, colors, noOptions: noOptionRows[0] ?? null };
}

// 워크벤치 수정 진입 번들: trimDetail + 그 차량의 brand/model/trim 목록을 한 요청에서 병렬 조회.
// trimDetail.brandId/modelId는 trim+join에서 이미 노출되어 models/trims를 좁힌다.
export async function getWorkbenchVehicle(trimId: number, executor: Executor = getDefaultDb()) {
  const [trimDetail, brands] = await Promise.all([
    getTrimDetail(trimId, executor),
    getBrands(executor),
  ]);
  if (!trimDetail) return null;
  // model_id/brand_id는 DB not-null이지만 Drizzle이 leftJoin 컬럼을 nullable로 추론하므로 타입 가드 필요.
  if (trimDetail.brandId === null || trimDetail.modelId === null) return null;
  const [models, trims] = await Promise.all([
    getModelsByBrand(trimDetail.brandId, executor),
    getTrimsByModel(trimDetail.modelId, executor),
  ]);
  return { brands, models, trims, trimDetail };
}
