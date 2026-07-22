import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

// http.ts → api.ts → supabase 체인이 실 env를 요구하므로 모듈째 mock(App.test.tsx 선례).
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));
vi.mock("@/lib/quote-requests", () => ({
  fetchAppQuoteRequestsCached: vi.fn(),
  linkRequestToCustomer: vi.fn(),
  createCustomerFromRequest: vi.fn(),
}));

import { HttpError } from "@/lib/http";
import { fetchAppQuoteRequestsCached, linkRequestToCustomer, type AppQuoteRequest } from "@/lib/quote-requests";

import { AppRequestsPage } from "./AppRequestsPage";

const PHONE_MATCH_ROW: AppQuoteRequest = {
  id: "req-1",
  createdAt: "26/07/13 10:00",
  requesterName: "김테스트",
  vehicleLabel: "기아 쏘렌토",
  paymentLabel: "장기렌트",
  periodLabel: "48개월",
  depositLabel: "보증금 10%",
  trimPriceLabel: "3,500만원",
  optionLabel: "옵션 2개",
  colorLabel: "컬러 지정",
  statusLabel: "접수",
  matchLabel: "전화 매칭",
  matchedCustomerId: "cust-1",
  matchedCustomerName: "박서연",
  matchedCustomerCode: "CU-2605-0019",
  promotedQuoteCount: 0,
  promotedQuoteIds: [],
  matchType: "phone",
  nameMatches: [],
};

const NAME_MATCH_ROW: AppQuoteRequest = {
  ...PHONE_MATCH_ROW,
  id: "req-2",
  matchLabel: "신규(미연결)",
  matchType: "none",
  matchedCustomerId: null,
  matchedCustomerName: null,
  matchedCustomerCode: null,
  nameMatches: [{ id: "cand-7", name: "김테스트", code: "CU-2604-0007" }],
};

function renderInbox(onToast = vi.fn()) {
  vi.mocked(fetchAppQuoteRequestsCached).mockResolvedValue([PHONE_MATCH_ROW]);
  render(
    <MemoryRouter>
      <AppRequestsPage signal={0} onRead={vi.fn()} onToast={onToast} onCustomerListChanged={vi.fn()} />
    </MemoryRouter>,
  );
  return onToast;
}

afterEach(() => vi.clearAllMocks());

// 이사님 2026-07-13 ② 결정: link 충돌은 차단 유지 + "왜 막혔는지 + 그 고객으로 가는 경로"를 보여준다.
it("link 409 + conflict 동봉 → 인라인 안내(사유 + 충돌 고객 보기 링크)로 표시하고, 닫기로 지운다", async () => {
  const user = userEvent.setup();
  const message = "이 앱 계정은 이미 홍길동(CU-2606-0012) 고객에 연결돼 있습니다.";
  vi.mocked(linkRequestToCustomer).mockRejectedValue(new HttpError(message, 409, { customerCode: "CU-2606-0012", name: "홍길동" }));
  const onToast = renderInbox();

  await user.click(await screen.findByRole("button", { name: "박서연에 연결" }));

  const notice = await screen.findByRole("alert");
  expect(notice).toHaveTextContent(message);
  const goLink = screen.getByRole("link", { name: /홍길동 고객 보기/ });
  expect(goLink).toHaveAttribute("href", "/customer-detail/CU-2606-0012");
  expect(onToast).not.toHaveBeenCalled(); // 안내로 대체 — 뜬금없는 실패 토스트 없음

  await user.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

// 역방향(대상 고객이 다른 앱 계정에 연결됨)은 이동할 고객이 없어 conflict 미동봉 — 서버 사유를 토스트로.
it("link 409 conflict 미동봉 → 서버 한글 사유를 토스트로 표시한다(일반 실패 문구 아님)", async () => {
  const user = userEvent.setup();
  vi.mocked(linkRequestToCustomer).mockRejectedValue(new HttpError("이 고객은 이미 다른 앱 계정에 연결돼 있습니다.", 409));
  const onToast = renderInbox();

  await user.click(await screen.findByRole("button", { name: "박서연에 연결" }));

  expect(onToast).toHaveBeenCalledWith("이 고객은 이미 다른 앱 계정에 연결돼 있습니다.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

// 배치 9 B-b: 제안 클릭 → link 후보 id 인자 계약 잠금 — handleLink 기본 인자(matchedCustomerId)가
// none 행에선 null이라, 회귀로 후보 id 인자가 빠지면 에러·토스트 없이 무음 no-op이 된다(#282 신규 경로).
it("이름 제안 클릭 → 후보 고객 id로 link를 호출한다(none 행 무음 no-op 회귀 방지)", async () => {
  const user = userEvent.setup();
  vi.mocked(fetchAppQuoteRequestsCached).mockResolvedValue([NAME_MATCH_ROW]);
  vi.mocked(linkRequestToCustomer).mockResolvedValue({
    id: "cand-7",
    customerCode: "CU-2604-0007",
    name: "김테스트",
    droppedPhone: null,
  });
  render(
    <MemoryRouter>
      <AppRequestsPage signal={0} onRead={vi.fn()} onToast={vi.fn()} onCustomerListChanged={vi.fn()} />
    </MemoryRouter>,
  );

  await user.click(await screen.findByRole("button", { name: "김테스트 CU-2604-0007 연결" }));

  expect(linkRequestToCustomer).toHaveBeenCalledWith("req-2", "cand-7");
});

// 네트워크 등 비HTTP 실패는 기존 일반 문구 유지.
it("link 비HTTP 실패 → 기존 일반 실패 토스트 유지", async () => {
  const user = userEvent.setup();
  vi.mocked(linkRequestToCustomer).mockRejectedValue(new TypeError("Failed to fetch"));
  const onToast = renderInbox();

  await user.click(await screen.findByRole("button", { name: "박서연에 연결" }));

  expect(onToast).toHaveBeenCalledWith("연결에 실패했습니다");
});
