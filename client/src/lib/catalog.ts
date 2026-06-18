import type { VehicleStatus } from "@/data/vehicle-taxonomy";
import { apiFetch } from "./api";

export type CatalogCounts = {
  brands: number;
  models: number;
  trims: number;
  trimOptions: number;
  colors: number;
  trimNoOptions: number;
  trimOptionRelations: number;
};

export async function fetchCatalogCounts(): Promise<CatalogCounts> {
  const res = await apiFetch("/api/catalog/counts");
  if (!res.ok) throw new Error(`catalog counts 실패: ${res.status}`);
  return (await res.json()) as CatalogCounts;
}

// ── 차량 관리(admin) ───────────────────────────────────────────────────────────
export type CatalogBrand = {
  id: number;
  name: string;
  logoUrl: string | null;
  isDomestic: boolean;
  isPopular: boolean;
  sortOrder: number;
  brandCode: number | null;
};

export type CatalogModel = {
  id: number;
  name: string;
  category: string | null;
  status: VehicleStatus;
  sortOrder: number | null;
  modelCode: number | null;
  imageUrl: string | null;
  trimCount: number;
  minPrice: number | null;
  maxPrice: number | null;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `요청 실패: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchBrands(): Promise<CatalogBrand[]> {
  return jsonOrThrow(await apiFetch("/api/catalog/brands"));
}

export async function fetchModels(brandId: number): Promise<CatalogModel[]> {
  return jsonOrThrow(await apiFetch(`/api/catalog/models?brandId=${brandId}`));
}

export async function createModel(input: {
  brandId: number;
  name: string;
  category: string | null;
  status: VehicleStatus;
}): Promise<CatalogModel> {
  return jsonOrThrow(
    await apiFetch("/api/catalog/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateModel(
  id: number,
  input: { category?: string | null; status?: VehicleStatus },
): Promise<CatalogModel> {
  return jsonOrThrow(
    await apiFetch(`/api/catalog/models/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteModel(id: number): Promise<{ id: number }> {
  return jsonOrThrow(await apiFetch(`/api/catalog/models/${id}`, { method: "DELETE" }));
}

// ── 트림 ───────────────────────────────────────────────────────────────────────
export type CatalogTrim = {
  id: number;
  name: string;
  trimName: string;
  canonicalName: string | null;
  price: number;
  modelYear: number | null;
  fuelType: string | null;
  driveSystem: string | null;
  displacementCc: number | null;
  transmissionType: string | null;
  bodyStyle: string | null;
  seatingCapacity: number | null;
  status: VehicleStatus;
  mcCode: string | null;
  sortOrder: number | null;
  priceUpdatedAt: string | null;
  financialDiscountAmount: number | null;
  partnerDiscountAmount: number | null;
  cashDiscountAmount: number | null;
  discountUpdatedAt: string | null;
};

export type TrimColor = {
  trimId: number | null;
  colorType: string;
  name: string;
  hexValue: string | null;
};

export type TrimInput = {
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
};

export async function fetchTrims(modelId: number): Promise<CatalogTrim[]> {
  return jsonOrThrow(await apiFetch(`/api/catalog/trims?modelId=${modelId}`));
}

export async function fetchTrimColors(modelId: number): Promise<TrimColor[]> {
  return jsonOrThrow(await apiFetch(`/api/catalog/models/${modelId}/trim-colors`));
}

export async function createTrim(modelId: number, input: TrimInput): Promise<CatalogTrim> {
  return jsonOrThrow(
    await apiFetch("/api/catalog/trims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId, ...input }),
    }),
  );
}

export async function updateTrim(id: number, input: Partial<TrimInput>): Promise<CatalogTrim> {
  return jsonOrThrow(
    await apiFetch(`/api/catalog/trims/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteTrim(id: number): Promise<{ id: number }> {
  return jsonOrThrow(await apiFetch(`/api/catalog/trims/${id}`, { method: "DELETE" }));
}

// 모델의 mc_code 미부여 트림에 고유번호 일괄 부여.
export async function assignMcCodes(modelId: number): Promise<{ assigned: number }> {
  return jsonOrThrow(await apiFetch(`/api/catalog/models/${modelId}/assign-codes`, { method: "POST" }));
}

// ── 옵션 ───────────────────────────────────────────────────────────────────────
export type OptionType = "basic" | "tuning";
export type CatalogOption = { id: number; type: OptionType; name: string; price: number | null };
// 옵션 관계(includes/excludes) — 표식 표시용(읽기 전용).
export type OptionRelation = { optionId: number; relatedOptionId: number; type: "includes" | "excludes" };
export type OptionsBundle = { options: CatalogOption[]; relations: OptionRelation[] };
// 트림 행 배지용 요약: 기본/튜닝 개수 + 무옵션 확정.
export type TrimOptionSummary = { trimId: number; basic: number; tuning: number; noOption: boolean };

export async function fetchOptionSummary(modelId: number): Promise<TrimOptionSummary[]> {
  return jsonOrThrow(await apiFetch(`/api/catalog/models/${modelId}/option-summary`));
}

export async function fetchOptions(trimId: number): Promise<OptionsBundle> {
  return jsonOrThrow(await apiFetch(`/api/catalog/trims/${trimId}/options`));
}

export async function createOption(
  trimId: number,
  input: { type: OptionType; name: string; price: number | null },
): Promise<CatalogOption> {
  return jsonOrThrow(
    await apiFetch(`/api/catalog/trims/${trimId}/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateOption(id: number, input: { name?: string; price?: number | null }): Promise<CatalogOption> {
  return jsonOrThrow(
    await apiFetch(`/api/catalog/options/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteOption(id: number): Promise<{ id: number }> {
  return jsonOrThrow(await apiFetch(`/api/catalog/options/${id}`, { method: "DELETE" }));
}

export async function setNoOption(trimId: number): Promise<{ ok: boolean }> {
  return jsonOrThrow(await apiFetch(`/api/catalog/trims/${trimId}/no-option`, { method: "POST" }));
}

export async function unsetNoOption(trimId: number): Promise<{ ok: boolean }> {
  return jsonOrThrow(await apiFetch(`/api/catalog/trims/${trimId}/no-option`, { method: "DELETE" }));
}

// 순서변경: orderedIds 위치(1..N) = sort_order.
export async function reorderModels(ids: number[]): Promise<void> {
  await jsonOrThrow(
    await apiFetch("/api/catalog/models/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}

export async function reorderTrims(ids: number[]): Promise<void> {
  await jsonOrThrow(
    await apiFetch("/api/catalog/trims/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}

// 트림 다른 모델로 이동(같은 브랜드).
export async function moveTrims(trimIds: number[], targetModelId: number): Promise<{ moved: number }> {
  return jsonOrThrow(
    await apiFetch("/api/catalog/trims/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trimIds, targetModelId }),
    }),
  );
}
