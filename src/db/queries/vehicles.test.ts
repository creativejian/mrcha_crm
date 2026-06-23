import { test, expect } from "bun:test";

import { getBrands, getModelsByBrand, getTrimsByModel, getTrimDetail } from "./vehicles";

test("getBrands: 거울 브랜드를 sort_order 순으로 반환", async () => {
  const brands = await getBrands();
  expect(brands.length).toBe(33);
  expect(brands[0].name).toBe("현대");
});

test("getModelsByBrand: 해당 브랜드의 모델만 반환", async () => {
  const brands = await getBrands();
  const models = await getModelsByBrand(brands[0].id);
  expect(models.length).toBeGreaterThan(0);
  expect(models.every((m) => m.brandId === brands[0].id)).toBe(true);
});

test("getTrimsByModel: 해당 모델의 트림만 반환", async () => {
  const brands = await getBrands();
  const models = await getModelsByBrand(brands[0].id);
  const trims = await getTrimsByModel(models[0].id);
  expect(trims.length).toBeGreaterThan(0);
  expect(trims.every((t) => t.modelId === models[0].id)).toBe(true);
});

test("getTrimDetail: 트림 + 옵션/색상 배열 포함", async () => {
  const brands = await getBrands();
  const models = await getModelsByBrand(brands[0].id);
  const trims = await getTrimsByModel(models[0].id);
  const detail = await getTrimDetail(trims[0].id);
  expect(detail).not.toBeNull();
  expect(detail!.id).toBe(trims[0].id);
  expect(Array.isArray(detail!.options)).toBe(true);
  expect(Array.isArray(detail!.colors)).toBe(true);
  expect(Array.isArray(detail!.optionRelations)).toBe(true);
  // PR2a: brand/model ancestry(VehiclePicker 복원 전제)
  expect(detail!.brandId).toBe(brands[0].id);
  expect(detail!.brandName).toBe(brands[0].name);
  expect(detail!.modelName).toBe(models[0].name);
});

test("getTrimDetail: 없는 트림이면 null", async () => {
  const detail = await getTrimDetail(999_999_999);
  expect(detail).toBeNull();
});
