import { and, asc, eq, inArray, isNull } from "drizzle-orm";

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
    .where(isNull(brandsInCatalog.deletedAt))
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
    .where(and(eq(modelsInCatalog.brandId, brandId), isNull(modelsInCatalog.deletedAt)))
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
    .where(and(eq(trimsInCatalog.modelId, modelId), isNull(trimsInCatalog.deletedAt)))
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
    .where(and(eq(trimsInCatalog.id, trimId), isNull(trimsInCatalog.deletedAt)));

  if (!trim) return null;

  const options = await db
    .select({
      id: trimOptionsInCatalog.id,
      type: trimOptionsInCatalog.type,
      name: trimOptionsInCatalog.name,
      price: trimOptionsInCatalog.price,
    })
    .from(trimOptionsInCatalog)
    .where(and(eq(trimOptionsInCatalog.trimId, trimId), isNull(trimOptionsInCatalog.deletedAt)));

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
        .where(
          and(
            inArray(trimOptionRelationsInCatalog.optionId, optionIds),
            isNull(trimOptionRelationsInCatalog.deletedAt),
          ),
        )
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
    .where(and(eq(colorsInCatalog.trimId, trimId), isNull(colorsInCatalog.deletedAt)))
    .orderBy(asc(colorsInCatalog.sortOrder));

  const [noOptions] = await db
    .select({
      note: trimNoOptionsInCatalog.note,
      checkedAt: trimNoOptionsInCatalog.checkedAt,
    })
    .from(trimNoOptionsInCatalog)
    .where(and(eq(trimNoOptionsInCatalog.trimId, trimId), isNull(trimNoOptionsInCatalog.deletedAt)));

  return { ...trim, options, optionRelations, colors, noOptions: noOptions ?? null };
}
