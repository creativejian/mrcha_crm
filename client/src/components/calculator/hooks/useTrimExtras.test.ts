// useTrimExtras(계산기 모달 T2) — CRM workbench 1콜 응답 → 제프 두 훅 계약(options/colors) 분해 매핑
// 단위테스트. fetchWorkbenchVehicle만 모킹 — 실 API 호출 없음.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/http";
import { fetchWorkbenchVehicle, type WorkbenchVehicle } from "@/lib/vehicles";

import { useTrimExtras } from "./useTrimExtras";

vi.mock("@/lib/vehicles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vehicles")>()),
  fetchWorkbenchVehicle: vi.fn(),
}));

const workbenchMock = vi.mocked(fetchWorkbenchVehicle);

const workbenchOf = (noOptions: WorkbenchVehicle["trimDetail"]["noOptions"]): WorkbenchVehicle => ({
  brands: [],
  models: [],
  trims: [],
  trimDetail: {
    id: 501,
    modelId: 7,
    name: "가솔린 2.0 - 럭셔리",
    trimName: "럭셔리",
    canonicalName: null,
    price: 50_000_000,
    fuelType: "가솔린",
    displacementCc: 1998,
    modelYear: 2026,
    driveSystem: null,
    transmissionType: null,
    bodyStyle: null,
    seatingCapacity: null,
    status: "판매중",
    sortOrder: null,
    mcCode: "MC-1",
    specs: null,
    financialDiscountAmount: null,
    partnerDiscountAmount: null,
    cashDiscountAmount: null,
    options: [
      { id: 1, type: "basic", name: "선루프", price: 500_000 },
      { id: 2, type: "tuning", name: "튜닝 휠", price: null },
      { id: 3, type: "basic", name: "HUD", price: 900_000 },
    ],
    optionRelations: [{ id: 11, optionId: 1, relatedOptionId: 3, type: "excludes" }],
    colors: [
      { id: 21, colorType: "exterior", name: "화이트", code: "WH", hexValue: "#ffffff", sortOrder: 1 },
      { id: 22, colorType: "interior", name: "블랙", code: null, hexValue: null, sortOrder: 2 },
    ],
    brandId: 1,
    brandName: "BMW",
    modelName: "5시리즈",
    noOptions,
  },
});

beforeEach(() => {
  workbenchMock.mockReset();
});

describe("useTrimExtras", () => {
  it("workbench 1콜 응답을 제프 두 계약(options/colors)으로 분해 매핑한다", async () => {
    workbenchMock.mockResolvedValue(workbenchOf(null));
    const { result } = renderHook(() => useTrimExtras(501));

    await waitFor(() => expect(result.current.options.loaded).toBe(true));

    expect(workbenchMock).toHaveBeenCalledWith(501);
    // 옵션: type으로 basic/tuning 분리 + {id,name,price} 투영(CRM type 필드 제거)
    expect(result.current.options.basic).toEqual([
      { id: 1, name: "선루프", price: 500_000 },
      { id: 3, name: "HUD", price: 900_000 },
    ]);
    expect(result.current.options.tuning).toEqual([{ id: 2, name: "튜닝 휠", price: null }]);
    // 관계: {optionId,relatedOptionId,type} 투영(CRM 여분 id 제거)
    expect(result.current.options.relations).toEqual([{ optionId: 1, relatedOptionId: 3, type: "excludes" }]);
    // noOptions: CRM {note,checkedAt}|null → 제프 boolean
    expect(result.current.options.noOptions).toBe(false);
    expect(result.current.options.error).toBeNull();

    // 컬러: colorType으로 exterior/interior 분리 + {id,name,code,hexValue,sortOrder} 투영
    expect(result.current.colors.loaded).toBe(true);
    expect(result.current.colors.exterior).toEqual([
      { id: 21, name: "화이트", code: "WH", hexValue: "#ffffff", sortOrder: 1 },
    ]);
    expect(result.current.colors.interior).toEqual([
      { id: 22, name: "블랙", code: null, hexValue: null, sortOrder: 2 },
    ]);
  });

  it("noOptions 행 존재 시 boolean true로 매핑한다", async () => {
    workbenchMock.mockResolvedValue(workbenchOf({ note: "무옵션 트림", checkedAt: "2026-07-16" }));
    const { result } = renderHook(() => useTrimExtras(501));

    await waitFor(() => expect(result.current.options.loaded).toBe(true));
    expect(result.current.options.noOptions).toBe(true);
  });

  it("trimId null이면 fetch 없이 즉시 클리어한다(제프 mcCode null 미러)", async () => {
    workbenchMock.mockResolvedValue(workbenchOf(null));
    const { result, rerender } = renderHook(({ trimId }: { trimId: number | null }) => useTrimExtras(trimId), {
      initialProps: { trimId: 501 as number | null },
    });
    await waitFor(() => expect(result.current.options.loaded).toBe(true));

    rerender({ trimId: null });

    expect(result.current.options.loaded).toBe(false);
    expect(result.current.options.basic).toEqual([]);
    expect(result.current.colors.loaded).toBe(false);
    expect(result.current.colors.exterior).toEqual([]);
    expect(workbenchMock).toHaveBeenCalledTimes(1); // null 전환은 새 fetch를 일으키지 않는다
  });

  it("404(트림 미존재)는 옵션/컬러 없음으로 간주한다(error=null·loaded=true)", async () => {
    workbenchMock.mockRejectedValue(new HttpError("요청 실패: 404", 404));
    const { result } = renderHook(() => useTrimExtras(501));

    await waitFor(() => expect(result.current.options.loaded).toBe(true));
    expect(result.current.options.error).toBeNull();
    expect(result.current.colors.error).toBeNull();
    expect(result.current.colors.loaded).toBe(true);
  });
});
