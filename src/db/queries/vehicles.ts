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
import { db } from "../client";

// master catalog 직접 read. master엔 거울 전용 deleted_at이 없으므로 isNull(deletedAt) 필터를 쓰지 않는다.
// status(판매중/단종/출시예정 등)는 거울 동작과 동일하게 필터하지 않는다(단종 차량도 라인업에 노출).

export async function getBrands() {
  return db
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

export async function getModelsByBrand(brandId: number) {
  return db
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

export async function getTrimsByModel(modelId: number) {
  return db
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

export async function getTrimDetail(trimId: number) {
  const [trim] = await db
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
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.id, trimId));

  if (!trim) return null;

  const options = await db
    .select({
      id: trimOptionsInCatalog.id,
      type: trimOptionsInCatalog.type,
      name: trimOptionsInCatalog.name,
      price: trimOptionsInCatalog.price,
    })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.trimId, trimId));

  const optionIds = options.map((o) => o.id);
  const optionRelations = optionIds.length
    ? await db
        .select({
          id: trimOptionRelationsInCatalog.id,
          optionId: trimOptionRelationsInCatalog.optionId,
          relatedOptionId: trimOptionRelationsInCatalog.relatedOptionId,
          type: trimOptionRelationsInCatalog.type,
        })
        .from(trimOptionRelationsInCatalog)
        .where(inArray(trimOptionRelationsInCatalog.optionId, optionIds))
    : [];

  const colors = await db
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
    .orderBy(asc(colorsInCatalog.sortOrder));

  const [noOptions] = await db
    .select({
      note: trimNoOptionsInCatalog.note,
      checkedAt: trimNoOptionsInCatalog.checkedAt,
    })
    .from(trimNoOptionsInCatalog)
    .where(eq(trimNoOptionsInCatalog.trimId, trimId));

  return { ...trim, options, optionRelations, colors, noOptions: noOptions ?? null };
}
