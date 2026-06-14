export type Brand = {
  id: number;
  name: string;
  logoUrl: string | null;
  isDomestic: boolean;
  isPopular: boolean;
  sortOrder: number | null;
  brandCode: number | null;
};

export type Model = {
  id: number;
  brandId: number;
  name: string;
  imageUrl: string | null;
  category: string | null;
  status: string;
  sortOrder: number | null;
  modelCode: number | null;
};

export type Trim = {
  id: number;
  modelId: number;
  name: string;
  trimName: string | null;
  canonicalName: string | null;
  price: number;
  fuelType: string | null;
  displacementCc: number | null;
  modelYear: number | null;
  driveSystem: string | null;
  transmissionType: string | null;
  bodyStyle: string | null;
  seatingCapacity: number | null;
  status: string;
  sortOrder: number | null;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`vehicle fetch failed: ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}

export function fetchBrands(): Promise<Brand[]> {
  return getJson<Brand[]>("/api/vehicles/brands");
}

export function fetchModels(brandId: number): Promise<Model[]> {
  return getJson<Model[]>(`/api/vehicles/models?brandId=${brandId}`);
}

export function fetchTrims(modelId: number): Promise<Trim[]> {
  return getJson<Trim[]>(`/api/vehicles/trims?modelId=${modelId}`);
}
