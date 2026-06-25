import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// apiFetch(../lib/api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { VehiclePicker } from "./VehiclePicker";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/vehicles/brands") {
        return new Response(
          JSON.stringify([{ id: 1, name: "현대", logoUrl: null, isDomestic: true, isPopular: true, sortOrder: 1, brandCode: 1 }]),
          { status: 200 },
        );
      }
      if (url.startsWith("/api/vehicles/models")) {
        return new Response(
          JSON.stringify([{ id: 10, brandId: 1, name: "팰리세이드", imageUrl: null, category: null, status: "판매중", sortOrder: 1, modelCode: 1 }]),
          { status: 200 },
        );
      }
      if (url.startsWith("/api/vehicles/workbench")) {
        return new Response(
          JSON.stringify({
            brands: [{ id: 1, name: "현대", logoUrl: null, isDomestic: true, isPopular: true, sortOrder: 1, brandCode: 1 }],
            models: [{ id: 10, brandId: 1, name: "팰리세이드", imageUrl: null, category: null, status: "판매중", sortOrder: 1, modelCode: 1 }],
            trims: [{ id: 100, modelId: 10, name: "Exclusive", trimName: "Exclusive", canonicalName: null, price: 50000000, fuelType: null, displacementCc: null, modelYear: null, driveSystem: null, transmissionType: null, bodyStyle: null, seatingCapacity: null, status: "판매중", sortOrder: 1 }],
            trimDetail: { id: 100, modelId: 10, name: "Exclusive", trimName: "Exclusive", canonicalName: null, price: 50000000, specs: null, fuelType: null, displacementCc: null, modelYear: null, driveSystem: null, transmissionType: null, bodyStyle: null, seatingCapacity: null, status: "판매중", sortOrder: 1, financialDiscountAmount: null, partnerDiscountAmount: null, cashDiscountAmount: null, brandId: 1, brandName: "현대", modelName: "팰리세이드", options: [], optionRelations: [], colors: [], noOptions: null },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/vehicles/trims/")) {
        // fetchTrimDetail(trimId): PR2a ancestry(brandId/brandName/modelName) 포함
        return new Response(
          JSON.stringify({ id: 100, modelId: 10, name: "Exclusive", trimName: "Exclusive", canonicalName: null, price: 50000000, specs: null, fuelType: null, displacementCc: null, modelYear: null, driveSystem: null, transmissionType: null, bodyStyle: null, seatingCapacity: null, status: "판매중", sortOrder: 1, financialDiscountAmount: null, partnerDiscountAmount: null, cashDiscountAmount: null, brandId: 1, brandName: "현대", modelName: "팰리세이드", options: [], optionRelations: [], colors: [], noOptions: null }),
          { status: 200 },
        );
      }
      if (url.startsWith("/api/vehicles/trims")) {
        return new Response(
          JSON.stringify([{ id: 100, modelId: 10, name: "Exclusive", trimName: "Exclusive", canonicalName: null, price: 50000000, fuelType: null, displacementCc: null, modelYear: null, driveSystem: null, transmissionType: null, bodyStyle: null, seatingCapacity: null, status: "판매중", sortOrder: 1 }]),
          { status: 200 },
        );
      }
      return new Response("[]", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VehiclePicker", () => {
  it("브랜드 선택 → 모델 로드 → 모델 선택 → 트림 로드", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VehiclePicker onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /제조사/ }));
    await user.click(await screen.findByRole("button", { name: "현대" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ brand: expect.objectContaining({ name: "현대" }) }));

    await user.click(screen.getByRole("button", { name: /모델/ }));
    await user.click(await screen.findByRole("button", { name: "팰리세이드" }));

    await user.click(screen.getByRole("button", { name: /트림/ }));
    expect(await screen.findByRole("button", { name: "Exclusive" })).toBeInTheDocument();
  });

  it("initialTrimId로 brand/model/trim 선택을 복원하고 onChange 통지", async () => {
    const onChange = vi.fn();
    render(<VehiclePicker initialTrimId={100} onChange={onChange} />);
    expect(await screen.findByRole("button", { name: /현대/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /팰리세이드/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exclusive/ })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: expect.objectContaining({ id: 1 }),
        model: expect.objectContaining({ id: 10 }),
        trim: expect.objectContaining({ id: 100 }),
        trimDetail: expect.objectContaining({ id: 100 }),
      }),
    );
  });

  it("브랜드 로드 실패 시 에러 표시", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    const user = userEvent.setup();
    render(<VehiclePicker />);
    await user.click(screen.getByRole("button", { name: /제조사/ }));
    expect(await screen.findByText("불러오기 실패")).toBeInTheDocument();
  });
});
