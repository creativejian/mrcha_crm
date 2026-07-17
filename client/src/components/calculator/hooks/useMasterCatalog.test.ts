// useMasterCatalog — 빠른 연속 선택 race 가드(배치 7 A#16) 단위테스트.
// @/lib/vehicles만 모킹(useMultiQuote.test.ts 관례 미러 — 어댑터 toMaster*는 실물). 실 API 호출 없음.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBrands, fetchModels, fetchTrims } from "@/lib/vehicles";
import type { Brand, Model, Trim } from "@/lib/vehicles";

import { useMasterCatalog } from "./useMasterCatalog";

vi.mock("@/lib/vehicles", () => ({
  fetchBrands: vi.fn(),
  fetchModels: vi.fn(),
  fetchTrims: vi.fn(),
}));

const fetchBrandsMock = vi.mocked(fetchBrands);
const fetchModelsMock = vi.mocked(fetchModels);
const fetchTrimsMock = vi.mocked(fetchTrims);

const brand = (id: number, name: string): Brand => ({
  id,
  name,
  logoUrl: null,
  isDomestic: false,
  isPopular: false,
  sortOrder: 1,
  brandCode: null,
});

const model = (id: number, brandId: number, name: string): Model => ({
  id,
  brandId,
  name,
  imageUrl: null,
  category: null,
  status: "active",
  sortOrder: 1,
  modelCode: null,
});

const trim = (id: number, modelId: number, name: string): Trim => ({
  id,
  modelId,
  name,
  trimName: null,
  canonicalName: null,
  price: 50_000_000,
  fuelType: null,
  displacementCc: null,
  modelYear: null,
  driveSystem: null,
  transmissionType: null,
  bodyStyle: null,
  seatingCapacity: null,
  status: "active",
  sortOrder: 1,
  mcCode: `MC-${id}`,
});

beforeEach(() => {
  fetchBrandsMock.mockReset();
  fetchModelsMock.mockReset();
  fetchTrimsMock.mockReset();
});

describe("useMasterCatalog race 가드 (배치 7 A#16)", () => {
  it("브랜드 A→B 빠른 전환 시 늦은 A 모델 응답을 무시한다", async () => {
    fetchBrandsMock.mockResolvedValue([brand(1, "BMW"), brand(2, "Benz")]);
    const deferred = new Map<number, (models: Model[]) => void>();
    fetchModelsMock.mockImplementation(
      (brandId: number) =>
        new Promise<Model[]>((resolve) => {
          deferred.set(brandId, resolve);
        }),
    );

    const { result } = renderHook(() => useMasterCatalog());
    await act(async () => {}); // 마운트 loadBrands flush

    let pA!: Promise<void>;
    let pB!: Promise<void>;
    act(() => {
      pA = result.current.selectBrand(1);
    });
    act(() => {
      pB = result.current.selectBrand(2);
    });

    // 최신 선택(B) 응답이 먼저 도착
    await act(async () => {
      deferred.get(2)!([model(20, 2, "E-Class")]);
      await pB;
    });
    expect(result.current.selectedBrand?.name).toBe("Benz");
    expect(result.current.models.map((m) => m.name)).toEqual(["E-Class"]);

    // 늦은 A 응답 도착 — 최신 선택(B)의 목록을 덮으면 안 된다
    await act(async () => {
      deferred.get(1)!([model(10, 1, "5시리즈")]);
      await pA;
    });
    expect(result.current.selectedBrand?.name).toBe("Benz");
    expect(result.current.models.map((m) => m.name)).toEqual(["E-Class"]);
    expect(result.current.modelsLoading).toBe(false);
  });

  it("모델 A→B 빠른 전환 시 늦은 A 트림 응답을 무시한다", async () => {
    fetchBrandsMock.mockResolvedValue([brand(1, "BMW")]);
    fetchModelsMock.mockResolvedValue([model(10, 1, "5시리즈"), model(11, 1, "3시리즈")]);
    const deferred = new Map<number, (trims: Trim[]) => void>();
    fetchTrimsMock.mockImplementation(
      (modelId: number) =>
        new Promise<Trim[]>((resolve) => {
          deferred.set(modelId, resolve);
        }),
    );

    const { result } = renderHook(() => useMasterCatalog());
    await act(async () => {}); // 마운트 loadBrands flush
    await act(async () => {
      await result.current.selectBrand(1);
    });

    let pA!: Promise<void>;
    let pB!: Promise<void>;
    act(() => {
      pA = result.current.selectModel(10);
    });
    act(() => {
      pB = result.current.selectModel(11);
    });

    // 최신 선택(B=3시리즈) 응답이 먼저 도착
    await act(async () => {
      deferred.get(11)!([trim(21, 11, "320i")]);
      await pB;
    });
    expect(result.current.selectedModel?.name).toBe("3시리즈");
    expect(result.current.trims.map((t) => t.name)).toEqual(["320i"]);

    // 늦은 A(5시리즈) 트림 응답 도착 — 최신 선택의 목록을 덮으면 안 된다
    await act(async () => {
      deferred.get(10)!([trim(20, 10, "520i")]);
      await pA;
    });
    expect(result.current.selectedModel?.name).toBe("3시리즈");
    expect(result.current.trims.map((t) => t.name)).toEqual(["320i"]);
    expect(result.current.trimsLoading).toBe(false);
  });
});
