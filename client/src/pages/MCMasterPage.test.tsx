import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mcMasterViewState } from "./mc-master/view-state";

// apiFetch(../lib/api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { MCMasterPage } from "./MCMasterPage";

// 현재 URL을 화면에 노출해 브랜드 쿼리(?brand=) 반영을 관찰한다.
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="loc">{pathname + search}</div>;
}

function renderPage(roleTab: "최고관리자" | "상담사", entry = "/mc-master") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} />} />
        <Route path="/mc-master/:modelId" element={<MCMasterPage roleTab={roleTab} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const BRANDS = [
  { id: 1, name: "현대", logoUrl: null, isDomestic: true, isPopular: true, sortOrder: 1, brandCode: 1 },
  { id: 17, name: "포르쉐", logoUrl: null, isDomestic: false, isPopular: false, sortOrder: 2, brandCode: 17 },
];
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
  // 모듈 스코프 화면 상태(마지막 브랜드·스크롤)는 라우트 언마운트를 넘겨 살아남는 게 목적이라
  // 테스트끼리도 새어 나간다 — 케이스별로 초기화한다.
  mcMasterViewState.brandId = null;
  mcMasterViewState.modelScrollTop = 0;
  mcMasterViewState.brandScrollTop = 0;
  mcMasterViewState.trimScrollTop.clear();
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

it("URL ?brand= 로 진입하면 그 브랜드가 선택된다(딥링크·새로고침)", async () => {
  renderPage("최고관리자", "/mc-master?brand=17");
  const porsche = await screen.findByRole("button", { name: "포르쉐" });
  expect(porsche.className).toContain("is-active");
});

it("브랜드를 고르면 URL에 실린다", async () => {
  const user = userEvent.setup();
  renderPage("최고관리자");
  await user.click(await screen.findByRole("button", { name: "포르쉐" }));
  expect(screen.getByTestId("loc")).toHaveTextContent("/mc-master?brand=17");
});

it("쿼리 없이 재진입해도 마지막 브랜드를 복원한다(Topbar 메뉴 경로)", async () => {
  const user = userEvent.setup();
  const first = renderPage("최고관리자");
  await user.click(await screen.findByRole("button", { name: "포르쉐" }));
  first.unmount(); // 다른 메뉴로 이동 = 라우트 element 언마운트

  renderPage("최고관리자"); // 메뉴는 쿼리 없는 /mc-master를 연다
  expect(await screen.findByTestId("loc")).toHaveTextContent("/mc-master?brand=17");
  expect((await screen.findByRole("button", { name: "포르쉐" })).className).toContain("is-active");
});

it("트림 뷰로 들어가도 브랜드 쿼리를 물고 간다(트림 화면 새로고침 정합)", async () => {
  const user = userEvent.setup();
  renderPage("최고관리자");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  expect(screen.getByTestId("loc")).toHaveTextContent("/mc-master/10?brand=1");
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
