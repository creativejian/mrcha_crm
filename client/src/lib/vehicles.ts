import { getJson } from "./http";

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

export type TrimOption = { id: number; type: "basic" | "tuning"; name: string; price: number | null };
export type TrimOptionRelation = { id: number; optionId: number; relatedOptionId: number; type: "includes" | "excludes" };
export type TrimColor = {
  id: number;
  colorType: "exterior" | "interior";
  name: string;
  code: string | null;
  hexValue: string | null;
  sortOrder: number;
};
export type TrimDetail = Trim & {
  specs: unknown;
  financialDiscountAmount: number | null;
  partnerDiscountAmount: number | null;
  cashDiscountAmount: number | null;
  options: TrimOption[];
  optionRelations: TrimOptionRelation[];
  colors: TrimColor[];
  brandId: number;
  brandName: string;
  modelName: string;
  noOptions: { note: string | null; checkedAt: string } | null;
};

export function fetchBrands(): Promise<Brand[]> {
  return getJson<Brand[]>("/api/vehicles/brands");
}

export function fetchModels(brandId: number): Promise<Model[]> {
  return getJson<Model[]>(`/api/vehicles/models?brandId=${brandId}`);
}

export function fetchTrims(modelId: number): Promise<Trim[]> {
  return getJson<Trim[]>(`/api/vehicles/trims?modelId=${modelId}`);
}

export function fetchTrimDetail(trimId: number): Promise<TrimDetail> {
  return getJson<TrimDetail>(`/api/vehicles/trims/${trimId}`);
}
