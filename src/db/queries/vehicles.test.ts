import { test, expect } from "bun:test";

import { getBrands, getModelsByBrand, getTrimsByModel, getTrimDetail } from "./vehicles";

test("getBrands: 브랜드를 sort_order 순으로 반환", async () => {
  const brands = await getBrands();
  // 정확 건수(33)·첫 브랜드명("현대") 하드코딩 금지(0725 경량 체크 L5) — 라이브 master catalog는
  // MC 마스터·앱 팀이 편집하는 데이터라 브랜드 하나만 늘어도 확정 red였다. 성질(비어있지 않음·
  // sort_order 오름차순 계약)만 잠근다.
  expect(brands.length).toBeGreaterThan(0);
  const orders = brands.map((b) => b.sortOrder);
  expect([...orders].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(orders);
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
