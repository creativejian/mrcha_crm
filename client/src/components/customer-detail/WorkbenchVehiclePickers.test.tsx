import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// apiFetch(../lib/api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { WorkbenchColorPicker, WorkbenchOptionPicker, WorkbenchVehiclePicker } from "./WorkbenchVehiclePickers";

const BRAND = { id: 1, name: "현대", logoUrl: null, isDomestic: true, isPopular: true, sortOrder: 1, brandCode: 1 };
const MODEL = { id: 10, brandId: 1, name: "팰리세이드", imageUrl: null, category: null, status: "판매중", sortOrder: 1, modelCode: 1 };
// mcCode 없는 트림(수기 견적 대상) — 워크벤치는 계산기와 달리 선택을 막지 않는다(행위 보존, plan 함정 7).
const TRIM = { id: 100, modelId: 10, name: "Exclusive", trimName: "Exclusive", canonicalName: null, price: 50000000, fuelType: null, displacementCc: null, modelYear: null, driveSystem: null, transmissionType: null, bodyStyle: null, seatingCapacity: null, status: "판매중", sortOrder: 1, mcCode: null };
const TRIM_DETAIL = { ...TRIM, specs: null, financialDiscountAmount: null, partnerDiscountAmount: null, cashDiscountAmount: null, brandId: 1, brandName: "현대", modelName: "팰리세이드", options: [], optionRelations: [], colors: [], noOptions: null };

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/vehicles/brands") return new Response(JSON.stringify([BRAND]), { status: 200 });
      if (url.startsWith("/api/vehicles/models")) return new Response(JSON.stringify([MODEL]), { status: 200 });
      if (url.startsWith("/api/vehicles/workbench")) {
        return new Response(
          JSON.stringify({ brands: [BRAND], models: [MODEL], trims: [TRIM], trimDetail: TRIM_DETAIL }),
          { status: 200 },
        );
      }
      if (url.includes("/api/vehicles/trims/")) return new Response(JSON.stringify(TRIM_DETAIL), { status: 200 });
      if (url.startsWith("/api/vehicles/trims")) return new Response(JSON.stringify([TRIM]), { status: 200 });
      return new Response("[]", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkbenchVehiclePicker", () => {
  it("행 클릭 → 다이얼로그 캐스케이드(브랜드→모델→트림)로 선택, 직접 선택은 trimDetail 미동봉", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkbenchVehiclePicker onChange={onChange} />);

    // 제조사 행 클릭 → 브랜드 다이얼로그
    await user.click(screen.getByRole("button", { name: /제조사/ }));
    expect(await screen.findByText("브랜드 선택")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /현대/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ brand: expect.objectContaining({ name: "현대" }) }));

    // 모델 로드 완료 → 모델 다이얼로그 자동 오픈(계산기 캐스케이드 미러)
    expect(await screen.findByText(/모델 선택/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /팰리세이드/ }));

    // 트림 로드 완료 → 트림 다이얼로그 자동 오픈
    expect(await screen.findByText(/트림 선택/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Exclusive/ }));

    // 직접 선택 = trimDetail 미동봉(소비자 fetchTrimDetail 폴백 계약) + mcCode 없는 트림도 선택 가능(원본 trim 그대로)
    const last = onChange.mock.calls.at(-1)?.[0] as { trim?: { id: number; mcCode: string | null }; trimDetail?: unknown };
    expect(last.trim).toEqual(expect.objectContaining({ id: 100, mcCode: null }));
    expect(last.trimDetail).toBeUndefined();
  });

  it("initialTrimId로 brand/model/trim 선택을 복원하고 onChange에 trimDetail 동봉", async () => {
    const onChange = vi.fn();
    render(<WorkbenchVehiclePicker initialTrimId={100} onChange={onChange} />);
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

  it("모델·트림 행은 상위 미선택이면 비활성(기존 행위 유지)", () => {
    render(<WorkbenchVehiclePicker />);
    expect(screen.getByRole("button", { name: /모델/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /트림/ })).toBeDisabled();
  });
});

const OPTIONS = [
  { id: 1, type: "basic" as const, name: "컨비니언스 패키지", price: 800000 },
  { id: 2, type: "tuning" as const, name: "선루프", price: 1500000 },
  { id: 3, type: "tuning" as const, name: "고급 시트", price: 2000000 },
];

describe("WorkbenchOptionPicker", () => {
  it("다이얼로그에서 체크 후 적용 시 onChange로 selectedIds·total 통지", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkbenchOptionPicker options={OPTIONS} relations={[]} selectedIds={[]} trimLabel="현대 팰리세이드" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    await user.click(screen.getByText("선루프"));
    expect(onChange).not.toHaveBeenCalled(); // 적용 전 부모 불변(다이얼로그 로컬 편집)
    await user.click(screen.getByRole("button", { name: "적용" }));
    expect(onChange).toHaveBeenCalledWith({ selectedIds: [2], total: 1500000 });
  });

  it("selectedIds가 트리거 라벨에 반영(개수·합산)", () => {
    render(<WorkbenchOptionPicker options={OPTIONS} relations={[]} selectedIds={[2]} trimLabel="" />);
    expect(screen.getByRole("button", { name: /1개 선택/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1,500,000원/ })).toBeInTheDocument();
  });

  it("excludes 선택 시 배타 상대 비활성 + 사유 캡션", async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchOptionPicker
        options={OPTIONS}
        relations={[{ id: 1, optionId: 2, relatedOptionId: 3, type: "excludes" }]}
        selectedIds={[2]}
        trimLabel=""
      />,
    );
    await user.click(screen.getByRole("button", { name: /옵션/ }));
    expect(screen.getByText("고급 시트").closest("button")).toBeDisabled();
    expect(screen.getAllByText(/함께 선택 불가/).length).toBeGreaterThan(0);
  });

  it("옵션이 없으면 트리거 비활성", () => {
    render(<WorkbenchOptionPicker options={[]} relations={[]} selectedIds={[]} trimLabel="" />);
    expect(screen.getByRole("button", { name: /옵션/ })).toBeDisabled();
  });
});

const COLORS = [
  { id: 1, colorType: "exterior" as const, name: "폴라 화이트 (149U)", code: "C11", hexValue: "#ffffff", sortOrder: 1 },
  { id: 2, colorType: "exterior" as const, name: "옵시디안 블랙 (197U)", code: "C13", hexValue: "#0c0c0c", sortOrder: 0 },
  { id: 3, colorType: "interior" as const, name: "블랙 투톤", code: "I1", hexValue: "#000000", sortOrder: 0 },
];

describe("WorkbenchColorPicker", () => {
  it("colorType으로 필터하고 색상 클릭 시 원본 TrimColor로 onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkbenchColorPicker colorType="exterior" colors={COLORS} value={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /외장/ }));
    expect(screen.queryByText("블랙 투톤")).toBeNull(); // 내장은 안 보임
    await user.click(screen.getByText("옵시디안 블랙 (197U)"));
    expect(onChange).toHaveBeenCalledWith(COLORS[1]);
  });

  it("선택된 색상 재클릭 = 해제(onChange(null)) — 다이얼로그 토글 의미론", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkbenchColorPicker colorType="exterior" colors={COLORS} value={COLORS[1]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /외장/ }));
    // 다이얼로그 안의 같은 색상 행 클릭(트리거에도 색상명이 있어 전수 조회 후 마지막 = 다이얼로그 행)
    const rows = screen.getAllByText("옵시디안 블랙 (197U)");
    await user.click(rows[rows.length - 1]);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("value가 있으면 트리거에 색상명 표시, 해당 타입 색상이 없으면 비활성", () => {
    render(<WorkbenchColorPicker colorType="exterior" colors={COLORS} value={COLORS[0]} />);
    expect(screen.getByText("폴라 화이트 (149U)")).toBeInTheDocument();

    render(<WorkbenchColorPicker colorType="interior" colors={[COLORS[0]]} value={null} />);
    expect(screen.getByRole("button", { name: /내장/ })).toBeDisabled();
  });
});
