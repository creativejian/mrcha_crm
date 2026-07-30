import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { RoleTab } from "@/data/roles";
import type { ChangeRequestItem } from "@/lib/catalog-change-requests";
import { resetStaffDirectoryCache } from "@/lib/staff";

import { invalidateCatalogAfterApproval } from "./mc-master/catalog-cache";
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

function renderPage(roleTab: RoleTab, entry = "/mc-master", onToast: (m: string) => void = () => {}) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} onToast={onToast} />} />
        <Route path="/mc-master/:modelId" element={<MCMasterPage roleTab={roleTab} onToast={onToast} />} />
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

// 관리자 승인 대기열(ChangeRequestQueueButton, Task 6) 테스트용 고정값 — 각 케이스가
// changeRequestQueue를 필요할 때만 채운다(기본은 빈 배열 = 대기 0건).
const STAFF_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const STAFF = [{ id: STAFF_ID, name: "박서준", role: "advisor", liveReceiving: true }];

const PENDING_ROW: ChangeRequestItem = {
  id: "cr-1",
  kind: "trim.update",
  targetType: "trim",
  targetId: 100,
  payload: { price: 50000000 },
  snapshot: { price: 45000000 },
  status: "pending",
  requestedBy: STAFF_ID,
  rejectReason: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  targetLabel: "5 Series › 523d",
  targetBrandId: 3,
  targetModelId: 30,
  targetTrimId: 300,
};

let changeRequestQueue: ChangeRequestItem[] = [];
// 팀장 축(PR3) 스텁: 모델 단위 pending 배지 재료 · 내 요청 목록 · 트림 저장 응답(202/409 주입구).
let modelPendingRows: ChangeRequestItem[] = [];
let myRequests: ChangeRequestItem[] = [];
let trimPatchResponse: { status: number; body: unknown } = { status: 200, body: { id: 100 } };
let fetchCalls: [string, RequestInit | undefined][] = [];

beforeEach(() => {
  // 모듈 스코프 화면 상태(마지막 브랜드·스크롤)는 라우트 언마운트를 넘겨 살아남는 게 목적이라
  // 테스트끼리도 새어 나간다 — 케이스별로 초기화한다.
  mcMasterViewState.brandId = null;
  mcMasterViewState.modelScrollTop = 0;
  mcMasterViewState.brandScrollTop = 0;
  mcMasterViewState.trimScrollTop.clear();
  changeRequestQueue = [];
  modelPendingRows = [];
  myRequests = [];
  trimPatchResponse = { status: 200, body: { id: 100 } };
  fetchCalls = [];
  resetStaffDirectoryCache(); // 직원 디렉토리도 모듈 캐시 — 케이스 간 누수 차단(QuoteWorkbench.gate 관례).
  invalidateCatalogAfterApproval(); // 30s 모듈 캐시도 케이스 간 누수 — PR3에서 생긴 리셋 API로 표준 초기화.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push([url, init]);
      if (url === "/api/catalog/brands") return new Response(JSON.stringify(BRANDS), { status: 200 });
      // ⚠️ 분기 순서: 아래 startsWith("/api/catalog/models")·("/api/catalog/trims")·
      // ("/api/catalog/change-requests")가 광범위 매칭이라, 구체 URL은 반드시 그 위에 둔다.
      if (url === "/api/catalog/models/10/change-requests") return new Response(JSON.stringify(modelPendingRows), { status: 200 });
      if (url === "/api/catalog/change-requests?mine=1") return new Response(JSON.stringify(myRequests), { status: 200 });
      if (init?.method === "DELETE" && url.startsWith("/api/catalog/change-requests/"))
        return new Response(JSON.stringify({ status: "canceled" }), { status: 200 });
      if (init?.method === "PATCH" && url === "/api/catalog/trims/100")
        return new Response(JSON.stringify(trimPatchResponse.body), { status: trimPatchResponse.status });
      if (url === "/api/catalog/trims/100/options")
        return new Response(JSON.stringify({ options: [{ id: 900, type: "basic", name: "선루프", price: 500000 }], relations: [] }), {
          status: 200,
        });
      if (url.startsWith("/api/catalog/trims")) return new Response(JSON.stringify(TRIMS), { status: 200 });
      if (url.startsWith("/api/catalog/models")) return new Response(JSON.stringify(MODELS), { status: 200 });
      if (url === "/api/staff") return new Response(JSON.stringify(STAFF), { status: 200 });
      if (url === "/api/dealer/me") return new Response("null", { status: 200 });
      // 승인/반려는 URL만으로 분기(성공만 검증 — 서버 응답 본문은 approve()가 쓰지 않는다).
      if (url.endsWith("/approve") || url.endsWith("/reject")) return new Response("{}", { status: 200 });
      if (url.startsWith("/api/catalog/change-requests")) {
        return new Response(JSON.stringify(changeRequestQueue), { status: 200 });
      }
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

// 관리자 승인 대기열(ChangeRequestQueueButton) — PR2 Task 6.
it("최고관리자는 승인 대기 버튼을 렌더한다", async () => {
  renderPage("최고관리자");
  await screen.findByText("그랜저");
  expect(await screen.findByRole("button", { name: "승인 대기 (0)" })).toBeInTheDocument();
});

it("상담사는 승인 대기 버튼을 렌더하지 않는다", async () => {
  renderPage("상담사");
  await screen.findByText("그랜저");
  expect(screen.queryByRole("button", { name: /승인 대기/ })).toBeNull();
});

// PR 3에서 canPropose(팀장 제안 축)가 이 헤더로 넓어질 때, 팀장이 승인 버튼까지 함께 얻는
// 회귀를 잠근다 — 승인 대기열은 canEdit(최고관리자 전용)에만 붙어야 한다(팀장은 제안만 가능).
it("팀장은 승인 대기 버튼을 렌더하지 않는다(PR3 canPropose 확장 대비 잠금)", async () => {
  renderPage("팀장");
  await screen.findByText("그랜저");
  expect(screen.queryByRole("button", { name: /승인 대기/ })).toBeNull();
});

it("딜러는 승인 대기 버튼을 렌더하지 않는다", async () => {
  renderPage("딜러");
  // 딜러는 브랜드 스코프가 확정되기 전엔 모델 fetch 자체를 보내지 않으므로(SCOPE_BRAND_PENDING)
  // "그랜저"를 기다릴 수 없다 — 항상 뜨는 헤더 타이틀로 마운트 완료를 확인한다.
  await screen.findByRole("heading", { name: /차량 관리/ });
  expect(screen.queryByRole("button", { name: /승인 대기/ })).toBeNull();
});

it("승인 대기 팝오버 — 요청자·작업·대상·전후 diff를 표시한다", async () => {
  changeRequestQueue = [PENDING_ROW];
  const user = userEvent.setup();
  renderPage("최고관리자");
  await screen.findByText("그랜저");
  await user.click(await screen.findByRole("button", { name: "승인 대기 (1)" }));

  expect(await screen.findByText("트림 수정")).toBeInTheDocument(); // kind 라벨
  expect(screen.getByText("박서준")).toBeInTheDocument(); // 요청자
  expect(screen.getByRole("button", { name: "5 Series › 523d" })).toBeInTheDocument(); // 대상(착지 가능 → 버튼)
  expect(screen.getByText(/가격:\s*45,000,000\s*→\s*50,000,000/)).toBeInTheDocument(); // 전→후 diff
});

it("승인 클릭 시 approve API를 호출하고 행을 즉시 숨긴다", async () => {
  changeRequestQueue = [PENDING_ROW];
  const user = userEvent.setup();
  renderPage("최고관리자");
  await screen.findByText("그랜저");
  await user.click(await screen.findByRole("button", { name: "승인 대기 (1)" }));
  await screen.findByRole("button", { name: "5 Series › 523d" });

  await user.click(screen.getByRole("button", { name: "승인" }));

  await waitFor(() => {
    expect(fetchCalls.some(([url, init]) => url === "/api/catalog/change-requests/cr-1/approve" && init?.method === "POST")).toBe(true);
  });
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "5 Series › 523d" })).toBeNull();
  });
});

// ── PR3: 팀장(canPropose) 개방 ────────────────────────────────────────────────
it("팀장: 모델 추가·수정 진입은 열리고 선택(일괄삭제·순서변경) 토글은 없다", async () => {
  renderPage("팀장");
  await screen.findByText("그랜저");
  expect(screen.getByRole("button", { name: /모델 추가/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "그랜저 수정" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^선택$/ })).toBeNull();
});

it("팀장 트림 뷰: 트림 추가·수정은 열리고 고유번호 할당은 없고 저장 버튼은 '승인 요청'", async () => {
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  expect(screen.getByRole("button", { name: /트림 추가/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /고유번호 할당/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  expect(await screen.findByRole("button", { name: "승인 요청" })).toBeInTheDocument();
});

it("팀장 저장(202 queued): 토스트가 뜨고 패널이 닫힌다", async () => {
  trimPatchResponse = { status: 202, body: { queued: true, requestId: "cr-9" } };
  const toasts: string[] = [];
  const user = userEvent.setup();
  renderPage("팀장", "/mc-master", (m) => toasts.push(m));
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  await user.click(await screen.findByRole("button", { name: "승인 요청" }));
  await waitFor(() => {
    expect(toasts).toContain("승인 요청됨 — 관리자 컨펌 후 반영됩니다");
  });
  expect(fetchCalls.some(([url, init]) => url === "/api/catalog/trims/100" && init?.method === "PATCH")).toBe(true);
  expect(screen.queryByRole("button", { name: "승인 요청" })).toBeNull(); // 패널 닫힘(성공 흐름)
});

it("팀장 저장(409 타인 pending): 패널에 서버 메시지가 뜨고 열려 있다", async () => {
  trimPatchResponse = { status: 409, body: { error: "이미 승인 대기 중인 요청이 있습니다." } };
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  await user.click(await screen.findByRole("button", { name: "승인 요청" }));
  expect(await screen.findByText("이미 승인 대기 중인 요청이 있습니다.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "승인 요청" })).toBeInTheDocument(); // 패널 유지
});

it("팀장 옵션 패널: 추가·수정은 열리고 삭제는 없다", async () => {
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(screen.getByRole("button", { name: "옵션 미입력" }));
  expect(await screen.findByRole("button", { name: "선루프 수정" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "선루프 삭제" })).toBeNull();
  expect(screen.getByRole("button", { name: /기본 옵션 추가/ })).toBeInTheDocument();
});
