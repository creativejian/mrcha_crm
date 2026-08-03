import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { RoleTab } from "@/data/roles";
import { resetChangeRequestCachesForTest, type ChangeRequestItem } from "@/lib/catalog-change-requests";
import { resetStaffDirectoryCache } from "@/lib/staff";

import { invalidateCatalogAfterApproval } from "./mc-master/catalog-cache";
import { mcMasterViewState } from "./mc-master/view-state";

// apiFetch(../lib/api)가 supabase.auth.getSession()을 호출하고, 큐 훅들이 실시간 신호 채널
// (catalog-change-realtime)을 열므로 auth + channel 둘 다 스텁한다(채널은 체이닝만 흉내).
vi.mock("@/lib/supabase", () => {
  const channelStub = {
    on: () => channelStub,
    subscribe: () => channelStub,
    send: async () => "ok",
  };
  return {
    supabase: {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
      channel: () => channelStub,
      removeChannel: async () => "ok",
    },
  };
});

// MCMasterPage가 프리필의 "내 요청" 판별에 useAuth().userId를 쓴다 — Provider 없이 렌더하므로
// 목업(값은 아래 STAFF_ID와 동일 리터럴 — vi.mock 호이스팅 때문에 상수를 참조할 수 없다).
vi.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({
    loading: false,
    authed: true,
    roleTab: null,
    roleClaim: null,
    userId: "aaaaaaaa-0000-0000-0000-000000000001",
    name: null,
    avatarUrl: null,
  }),
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
  decidedAt: null, // rejected/approved 파생 픽스처는 null 폴백(createdAt 기준 창)으로 충분히 최근
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
// 그룹 순서 이동 테스트가 다그룹 픽스처를 주입한다 — 기본은 기존 단일 트림(TRIMS).
let trimsResponse: object[] = TRIMS;
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
  trimsResponse = TRIMS;
  fetchCalls = [];
  resetStaffDirectoryCache(); // 직원 디렉토리도 모듈 캐시 — 케이스 간 누수 차단(QuoteWorkbench.gate 관례).
  resetChangeRequestCachesForTest(); // 대기열·내 요청 (N) 즉시 표시용 모듈 캐시 — 같은 이유로 초기화.
  // 30s 모듈 캐시도 케이스 간 누수 — PR3에서 생긴 리셋 API로 초기화. ⚠️ brands·trimColors 캐시는
  // 의도적으로 남는다(승인이 못 바꾸는 축) — 브랜드를 케이스별로 바꾸는 테스트가 생기면 별도 리셋 필요.
  invalidateCatalogAfterApproval();
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
      // "이어서 수정" 교체(PUT) — 적재와 동형 202 { queued }로 응답한다(서버 계약).
      if (init?.method === "PUT" && url.startsWith("/api/catalog/change-requests/"))
        return new Response(JSON.stringify({ queued: true, requestId: "cr-2" }), { status: 202 });
      if (init?.method === "PATCH" && url === "/api/catalog/trims/100")
        return new Response(JSON.stringify(trimPatchResponse.body), { status: trimPatchResponse.status });
      if (url === "/api/catalog/trims/100/options")
        return new Response(JSON.stringify({ options: [{ id: 900, type: "basic", name: "선루프", price: 500000 }], relations: [] }), {
          status: 200,
        });
      // 옵션 요약·색상은 빈 배열로 명시한다 — 광범위 models 분기에 흘려보내면 MODELS 배열을
      // summary로 받는 셈이라, 옵션 배지가 "옵션 미입력"으로 뜨는 게 우연에 기대게 된다.
      if (url === "/api/catalog/models/10/option-summary") return new Response("[]", { status: 200 });
      if (url.endsWith("/trim-colors")) return new Response("[]", { status: 200 });
      if (url.startsWith("/api/catalog/trims")) return new Response(JSON.stringify(trimsResponse), { status: 200 });
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
  // 패널 닫힘(성공 흐름) — 토스트와 setTrimPanel(null)은 같은 await 사슬의 다른 지점이라
  // 마이크로태스크 타이밍에 기대지 않고 기다린다.
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "승인 요청" })).toBeNull();
  });
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

it("팀장 옵션 패널: 추가·수정은 열리고 삭제는 없고 제출 라벨은 '승인 요청'", async () => {
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(screen.getByRole("button", { name: "옵션 미입력" }));
  const editOption = await screen.findByRole("button", { name: "선루프 수정" });
  expect(screen.queryByRole("button", { name: "선루프 삭제" })).toBeNull();
  expect(screen.getByRole("button", { name: /기본 옵션 추가/ })).toBeInTheDocument();
  // 옵션 추가·수정도 큐 8종이라 결말이 202 적재다 — 인라인 에디터 제출 라벨도 같은 축이어야
  // "추가/저장을 눌렀는데 목록이 안 바뀌었다"로 읽히지 않는다(spec §7.1).
  await user.click(editOption);
  expect(await screen.findByRole("button", { name: "승인 요청" })).toBeInTheDocument();
});

// ── PR3 Task 6 → 2026-08-03 확장: 행 "승인 대기" 배지 = 클릭 팝오버(diff + admin 승인/반려).
// 시도 전에 보여 409(타인 pending)를 예방하는 게 목적이라 admin·manager 공통이다. 아래 케이스는
// 팀장으로 렌더한다 — admin 화면에는 헤더 대기열 버튼이 함께 있고, 그 버튼의 **로딩 구간
// 텍스트가 정확히 "승인 대기"**(ChangeRequestQueue의 visibleRows === null — 카운트 미표시)라
// 완전일치 매처가 두 요소를 동시에 물 수 있다.
it("행 배지 클릭 → 팝오버에 요청자·작업·전후 diff — 팀장에겐 승인/반려가 없다", async () => {
  // 같은 트림에 2건 — 한 배지 팝오버에 여러 요청이 쌓이는 경로까지 잠근다.
  modelPendingRows = [
    { ...PENDING_ROW, targetId: 100, targetBrandId: 1, targetModelId: 10, targetTrimId: 100 },
    {
      ...PENDING_ROW,
      id: "cr-3",
      kind: "trim.no-option.set",
      payload: {},
      snapshot: {},
      targetId: 100,
      targetBrandId: 1,
      targetModelId: 10,
      targetTrimId: 100,
    },
  ];
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(await screen.findByRole("button", { name: "승인 대기" })); // 행 배지(팀장에겐 헤더 대기열 버튼이 없어 유일)
  expect(await screen.findAllByText("박서준")).toHaveLength(2); // 요청 2건이 행별로 쌓인다
  expect(screen.getByText("트림 수정")).toBeInTheDocument(); // kind 라벨
  expect(screen.getByText("무옵션 확정")).toBeInTheDocument(); // 2건이 한 팝오버에 누적
  expect(screen.getByText(/가격:\s*45,000,000\s*→\s*50,000,000/)).toBeInTheDocument(); // 전→후 diff
  expect(screen.queryByRole("button", { name: "승인" })).toBeNull(); // 승인/반려는 admin 전용
  expect(screen.queryByRole("button", { name: "반려" })).toBeNull();
});

it("admin: 행 배지 팝오버에서 승인 → approve API 발사 + 행 즉시 숨김", async () => {
  modelPendingRows = [{ ...PENDING_ROW, targetId: 100, targetBrandId: 1, targetModelId: 10, targetTrimId: 100 }];
  const user = userEvent.setup();
  renderPage("최고관리자");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  // 헤더 대기열 버튼이 "(0)"까지 붙기를 기다린다 — 로딩 구간 텍스트가 행 배지와 같은 "승인 대기"라
  // 완전일치 매처가 두 요소를 물 수 있다(위 주석 참조).
  await screen.findByRole("button", { name: "승인 대기 (0)" });
  await user.click(screen.getByRole("button", { name: "승인 대기" }));
  await user.click(await screen.findByRole("button", { name: "승인" }));
  await waitFor(() => {
    expect(fetchCalls.some(([url, init]) => url === "/api/catalog/change-requests/cr-1/approve" && init?.method === "POST")).toBe(true);
  });
  // 성공(done) 즉시 숨김 — 재조회 완료 전에도 배지가 사라진다(대기열 팝오버와 같은 규칙).
  await waitFor(() => expect(screen.queryByRole("button", { name: "승인 대기" })).toBeNull());
});

// ── 2026-08-03: trim.create pending = 미리보기 행(구 헤더 pill 집계에서 승격) ────────
it("trim.create pending은 미리보기 행으로 트림 테이블 안에 나타난다", async () => {
  modelPendingRows = [
    {
      ...PENDING_ROW,
      id: "cr-2",
      kind: "trim.create",
      targetId: null,
      targetBrandId: 1,
      targetModelId: 10,
      targetTrimId: null,
      payload: { modelId: 10, trimName: "새 트림", price: 1234000, modelYear: 2027, fuelType: "가솔린" },
      snapshot: {},
    },
  ];
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  // "새 트림"은 ' - ' 없는 이름 → '기타' 서브라인 = 기존 트림(캐스퍼 1.0)과 같은 첫 그룹(펼침 상태).
  expect(await screen.findByText("새 트림")).toBeInTheDocument();
  expect(screen.getByText("1,234,000원")).toBeInTheDocument(); // payload 값이 행 셀로 보인다
  expect(screen.getByRole("button", { name: "승인 대기(신규)" })).toBeInTheDocument();
  expect(screen.queryByText("승인 대기 1")).toBeNull(); // 헤더 pill로는 더 안 올라간다
});

it("팀장: 미리보기 행 연필(이어서 수정) → 폼 프리필 + 저장이 PUT 교체를 쏜다", async () => {
  modelPendingRows = [
    {
      ...PENDING_ROW,
      id: "cr-2",
      kind: "trim.create",
      targetId: null,
      targetBrandId: 1,
      targetModelId: 10,
      targetTrimId: null,
      payload: { modelId: 10, trimName: "새 트림", price: 1234000, modelYear: 2027, fuelType: "가솔린" },
      snapshot: {},
    },
  ];
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await user.click(await screen.findByRole("button", { name: "새 트림 이어서 수정" }));
  expect(await screen.findByDisplayValue("새 트림")).toBeInTheDocument(); // payload 프리필
  expect(screen.getByDisplayValue("1,234,000")).toBeInTheDocument();
  expect(screen.getByText(/대기 중인 승인 요청을 이어서 수정합니다/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "승인 요청" }));
  await waitFor(() => {
    const call = fetchCalls.find(([url, init]) => url === "/api/catalog/change-requests/cr-2" && init?.method === "PUT");
    expect(call).toBeTruthy();
    const sent = JSON.parse(String(call![1]?.body)) as Record<string, unknown>;
    expect(sent.modelId).toBe(10); // 부모 좌표 동봉(서버 고정과 이중 방어)
    expect(sent.trimName).toBe("새 트림");
  });
});

it("타인의 미리보기 행에는 이어서 수정 연필이 없다(승인 대기 배지만)", async () => {
  modelPendingRows = [
    {
      ...PENDING_ROW,
      id: "cr-2",
      kind: "trim.create",
      targetId: null,
      targetBrandId: 1,
      targetModelId: 10,
      targetTrimId: null,
      requestedBy: "bbbbbbbb-0000-0000-0000-000000000002",
      payload: { modelId: 10, trimName: "새 트림", price: 1234000, modelYear: 2027, fuelType: "가솔린" },
      snapshot: {},
    },
  ];
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  expect(await screen.findByText("새 트림")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "새 트림 이어서 수정" })).toBeNull();
});

// ── PR3 Task 7: 팀장 "내 요청 (N)" 팝오버(spec §7.3) ─────────────────────────
it("팀장: 내 요청 (N) — 반려 사유가 보이고 pending 행 취소가 DELETE를 쏜다", async () => {
  myRequests = [
    { ...PENDING_ROW, id: "cr-p", status: "pending" },
    // 반려 행은 **다른 대상**(301)이어야 보인다 — 같은 대상+작업에 재요청(pending)을 내면
    // 자동 소멸 규칙(filterMyRequestVisible)이 반려 행을 즉시 걷어낸다(루프 완료).
    { ...PENDING_ROW, id: "cr-r", status: "rejected", rejectReason: "가격 근거 부족", targetId: 301, targetTrimId: 301 },
  ];
  const user = userEvent.setup();
  renderPage("팀장");
  await screen.findByText("그랜저");
  await user.click(await screen.findByRole("button", { name: "내 요청 (1)" })); // (N)=pending만
  expect(await screen.findByText(/반려 사유: 가격 근거 부족/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "취소" }));
  await waitFor(() => {
    expect(fetchCalls.some(([url, init]) => url === "/api/catalog/change-requests/cr-p" && init?.method === "DELETE")).toBe(true);
  });
  // done 즉시 숨김 × (N) 상호작용 — 재조회가 끝나기 전에도 행이 사라지고 카운트가 따라 준다.
  await waitFor(() => expect(screen.queryByRole("button", { name: "취소" })).toBeNull());
  expect(screen.getByRole("button", { name: "내 요청 (0)" })).toBeInTheDocument();
});

it("내 요청 버튼은 팀장 전용 — 관리자·상담사에겐 없다", async () => {
  const admin = renderPage("최고관리자");
  await screen.findByText("그랜저");
  expect(screen.queryByRole("button", { name: /내 요청/ })).toBeNull();
  admin.unmount();

  renderPage("상담사");
  await screen.findByText("그랜저");
  expect(screen.queryByRole("button", { name: /내 요청/ })).toBeNull();
});

it("팀장 저장(202)이 큐에 쌓이면 행 배지가 즉시 나타난다(pub/sub 재조회)", async () => {
  trimPatchResponse = { status: 202, body: { queued: true, requestId: "cr-9" } };
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  expect(screen.queryByText("승인 대기")).toBeNull(); // 저장 전엔 배지 없음
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  // 저장이 202로 적재되면 onCatalogWriteQueued가 배지 훅을 재조회시킨다 — 재조회 시점의
  // 스텁 응답을 pending 1건으로 바꿔 "적재 → 배지 등장"을 통합으로 잠근다.
  modelPendingRows = [{ ...PENDING_ROW, targetId: 100, targetBrandId: 1, targetModelId: 10, targetTrimId: 100 }];
  await user.click(await screen.findByRole("button", { name: "승인 요청" }));
  expect(await screen.findByText("승인 대기")).toBeInTheDocument();
});

// ── 프리필(교체 함정 보완, 2026-07-31): 재제출 = 기존 pending 교체(spec §6.1)라, 폼이 카탈로그
// 원값에서 시작하면 나눠 저장할 때 앞서 낸 변경분이 소리 없이 빠진다 — 내 pending payload를
// 폼 초기값에 겹치는 것을 잠근다.
it("팀장 프리필: 내 pending payload가 편집 폼에 겹쳐지고 안내가 뜬다", async () => {
  modelPendingRows = [
    { ...PENDING_ROW, targetId: 100, targetBrandId: 1, targetModelId: 10, targetTrimId: 100, payload: { price: 99000000 } },
  ];
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await screen.findByText("승인 대기"); // 행 배지 = pendingRows 도착 보장(프리필은 열기 전 로드 전제)
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  expect(await screen.findByDisplayValue("99,000,000")).toBeInTheDocument(); // 카탈로그 15,000,000이 아니라 내 제안값
  expect(screen.getByText(/대기 중인 승인 요청을 이어서 수정합니다/)).toBeInTheDocument();
});

it("타인 pending은 프리필하지 않는다 — 폼은 카탈로그 값, 안내 없음", async () => {
  modelPendingRows = [
    {
      ...PENDING_ROW,
      targetId: 100,
      targetBrandId: 1,
      targetModelId: 10,
      targetTrimId: 100,
      payload: { price: 99000000 },
      requestedBy: "bbbbbbbb-0000-0000-0000-000000000002",
    },
  ];
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await screen.findByText("승인 대기");
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  expect(await screen.findByDisplayValue("15,000,000")).toBeInTheDocument();
  expect(screen.queryByText(/이어서 수정합니다/)).toBeNull();
});

// ── 할인 3필드 제외(spec §3.1 정정, 2026-07-31): 확정 할인은 딜러 제안→관리자 채택 체계 소유 —
// 팀장 폼에서 숨기고 제출 payload에서도 뺀다(서버 strip과 이중 방어).
it("팀장 폼엔 할인 정보가 없고 제출 payload에도 할인 키가 안 실린다", async () => {
  trimPatchResponse = { status: 202, body: { queued: true, requestId: "cr-9" } };
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  await screen.findByRole("button", { name: "승인 요청" });
  expect(screen.queryByText("자사 할인(원)")).toBeNull();
  await user.click(screen.getByRole("button", { name: "승인 요청" }));
  await waitFor(() => {
    expect(fetchCalls.some(([url, init]) => url === "/api/catalog/trims/100" && init?.method === "PATCH")).toBe(true);
  });
  const patch = fetchCalls.find(([url, init]) => url === "/api/catalog/trims/100" && init?.method === "PATCH")!;
  const sent = JSON.parse(String(patch[1]?.body)) as Record<string, unknown>;
  expect("financialDiscountAmount" in sent).toBe(false);
  expect("partnerDiscountAmount" in sent).toBe(false);
  expect("cashDiscountAmount" in sent).toBe(false);
});

it("admin 폼엔 할인 정보가 그대로 있다(채택 외 수동 조정 경로 유지)", async () => {
  const user = userEvent.setup();
  renderPage("최고관리자");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  expect(await screen.findByText("자사 할인(원)")).toBeInTheDocument();
});

// ── 그룹 순서 모드(이사님 요청 2026-08-03) — 목록 보기 '선택' → 그룹 헤더 그립 드래그 ────
const GROUP_TRIMS = [
  { ...TRIMS[0], id: 100, name: "27년형 가솔린 1.0 - 스마트", trimName: "27년형 가솔린 1.0 - 스마트" },
  { ...TRIMS[0], id: 101, name: "27년형 가솔린 1.0 - 디 에센셜", trimName: "27년형 가솔린 1.0 - 디 에센셜", sortOrder: 2 },
  { ...TRIMS[0], id: 102, name: "26년형 가솔린 1.0 - 스마트", trimName: "26년형 가솔린 1.0 - 스마트", sortOrder: 3 },
];

it("admin 목록 보기 선택: 그룹 헤더만 남고, 드래그 → 블록째 이동된 전체 id로 reorder API 발사", async () => {
  trimsResponse = GROUP_TRIMS;
  const user = userEvent.setup();
  renderPage("최고관리자");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("스마트"); // 그룹 뷰 로드(첫 그룹 펼침 상태)
  await user.click(screen.getByRole("button", { name: "선택" }));
  // 그룹 순서 모드 — 트림 행·체크박스 없이 그룹 헤더만 남는다.
  expect(screen.queryByText("스마트")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  const from = screen.getByText("27년형 가솔린 1.0").closest("tr")!;
  const to = screen.getByText("26년형 가솔린 1.0").closest("tr")!;
  // SelectableRow와 같은 드래그 의미론: dragOver에서 낙관 이동 → dragEnd에서 저장.
  fireEvent.dragStart(from);
  fireEvent.dragOver(to);
  fireEvent.dragEnd(from);
  await waitFor(() => {
    const call = fetchCalls.find(([url, init]) => url === "/api/catalog/trims/reorder" && init?.method === "POST");
    expect(call).toBeTruthy();
    // 27년형 그룹(100·101)이 26년형(102) 뒤로 — 그룹 내 순서 유지.
    expect(JSON.parse(String(call![1]?.body))).toEqual({ ids: [102, 100, 101] });
  });
});

it("팀장에겐 목록 보기 선택 버튼이 없다(그룹 순서 = reorder admin 전용과 동형)", async () => {
  trimsResponse = GROUP_TRIMS;
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("스마트");
  expect(screen.queryByRole("button", { name: "선택" })).toBeNull();
});
