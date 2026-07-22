import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// apiFetch(../lib/api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { MCMasterPage } from "./MCMasterPage";

function renderPage(roleTab: "최고관리자" | "상담사") {
  return render(
    <MemoryRouter initialEntries={["/mc-master"]}>
      <Routes>
        <Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} />} />
        <Route path="/mc-master/:modelId" element={<MCMasterPage roleTab={roleTab} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const BRANDS = [{ id: 1, name: "현대", logoUrl: null, isDomestic: true, isPopular: true, sortOrder: 1, brandCode: 1 }];
const MODELS = [
  {
    id: 10,
    name: "그랜저",
    category: "준대형 세단",
    status: "판매중",
    sortOrder: 1,
    modelCode: 1,
    imageUrl: null,
    trimCount: 5,
    minPrice: 40000000,
    maxPrice: 55000000,
  },
];

const TRIMS = [
  {
    id: 100,
    name: "캐스퍼 1.0",
    trimName: "캐스퍼 1.0",
    canonicalName: null,
    price: 15000000,
    modelYear: 2026,
    fuelType: "가솔린",
    driveSystem: "FWD",
    displacementCc: 998,
    transmissionType: "A/T",
    bodyStyle: null,
    seatingCapacity: 4,
    status: "판매중",
    mcCode: null,
    sortOrder: 1,
  },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/catalog/brands") return new Response(JSON.stringify(BRANDS), { status: 200 });
      if (url.startsWith("/api/catalog/trims")) return new Response(JSON.stringify(TRIMS), { status: 200 });
      if (url.startsWith("/api/catalog/models")) return new Response(JSON.stringify(MODELS), { status: 200 });
      return new Response("[]", { status: 200 });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

it("브랜드·모델 렌더", async () => {
  renderPage("최고관리자");
  expect(await screen.findByText("그랜저")).toBeInTheDocument();
  expect(screen.getByText("현대")).toBeInTheDocument();
});

it("최고관리자는 모델 추가/수정 버튼 노출", async () => {
  renderPage("최고관리자");
  await screen.findByText("그랜저");
  expect(screen.getByRole("button", { name: /모델 추가/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "그랜저 수정" })).toBeInTheDocument();
});

it("상담사는 편집 버튼 숨김", async () => {
  renderPage("상담사");
  await screen.findByText("그랜저");
  expect(screen.queryByRole("button", { name: /모델 추가/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "그랜저 수정" })).toBeNull();
});

it("모델 클릭 시 트림 리스트로 드릴다운", async () => {
  const user = userEvent.setup();
  renderPage("최고관리자");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  expect(await screen.findByText("캐스퍼 1.0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /트림 추가/ })).toBeInTheDocument();
});

it("선택 모드: 체크박스 + 선택 삭제 노출", async () => {
  const user = userEvent.setup();
  renderPage("최고관리자");
  await screen.findByText("그랜저");
  await user.click(screen.getByRole("button", { name: /^선택$/ }));
  expect(screen.getByRole("checkbox", { name: "전체 선택" })).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "그랜저 선택" }));
  expect(screen.getByRole("button", { name: /선택 삭제 \(1\)/ })).toBeInTheDocument();
});
