import type { VehicleStatus } from "@/data/vehicle-taxonomy";

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
  const res = await fetch("/api/catalog/counts");
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
  return jsonOrThrow(await fetch("/api/catalog/brands"));
}

export async function fetchModels(brandId: number): Promise<CatalogModel[]> {
  return jsonOrThrow(await fetch(`/api/catalog/models?brandId=${brandId}`));
}

export async function createModel(input: {
  brandId: number;
  name: string;
  category: string | null;
  status: VehicleStatus;
}): Promise<CatalogModel> {
  return jsonOrThrow(
    await fetch("/api/catalog/models", {
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
    await fetch(`/api/catalog/models/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteModel(id: number): Promise<{ id: number }> {
  return jsonOrThrow(await fetch(`/api/catalog/models/${id}`, { method: "DELETE" }));
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
};

export async function fetchTrims(modelId: number): Promise<CatalogTrim[]> {
  return jsonOrThrow(await fetch(`/api/catalog/trims?modelId=${modelId}`));
}

export async function createTrim(modelId: number, input: TrimInput): Promise<CatalogTrim> {
  return jsonOrThrow(
    await fetch("/api/catalog/trims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId, ...input }),
    }),
  );
}

export async function updateTrim(id: number, input: Partial<TrimInput>): Promise<CatalogTrim> {
  return jsonOrThrow(
    await fetch(`/api/catalog/trims/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteTrim(id: number): Promise<{ id: number }> {
  return jsonOrThrow(await fetch(`/api/catalog/trims/${id}`, { method: "DELETE" }));
}

// 순서변경: orderedIds 위치(1..N) = sort_order.
export async function reorderModels(ids: number[]): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/catalog/models/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}

export async function reorderTrims(ids: number[]): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/catalog/trims/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}
