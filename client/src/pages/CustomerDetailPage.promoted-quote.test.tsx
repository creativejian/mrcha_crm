import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import type { Customer } from "@/data/customers";
import type { CustomerDetailData } from "@/lib/customers";

import { CustomerDetailPage } from "./CustomerDetailPage";

// 니즈 카드 "견적 보기"(NeedsDashboard.onViewQuote) → 부모 viewPromotedQuote 배선만 검증한다.
// 나머지 자식 컴포넌트는 렌더 비용만 크고 이 계약과 무관해 stub. 훅은 전부 실물이라
// openEditQuote의 실제 부작용(confirmingQuoteContractEditId)이 그대로 관측된다.
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ userId: "u-1", roleClaim: "admin" }) }));
vi.mock("@/components/customer-detail/CustomerDetailHeader", () => ({ CustomerDetailHeader: () => null }));
vi.mock("@/components/customer-detail/CustomerMemos", () => ({ CustomerMemos: () => null }));
vi.mock("@/components/customer-detail/CustomerChecks", () => ({ CustomerChecks: () => null }));
vi.mock("@/components/customer-detail/CustomerSchedules", () => ({ CustomerSchedules: () => null }));
vi.mock("@/components/customer-detail/CustomerDocuments", () => ({ CustomerDocuments: () => null }));
vi.mock("@/components/customer-detail/StatusWorkflow", () => ({ StatusWorkflow: () => null }));
vi.mock("@/components/customer-detail/PurchaseConditions", () => ({ PurchaseConditions: () => null }));
vi.mock("@/components/customer-detail/QuoteWorkbench", () => ({ QuoteWorkbench: () => null }));
vi.mock("@/components/customer-detail/NeedsDashboard", () => ({
  NeedsDashboard: ({ onViewQuote }: { onViewQuote: (reqId: string, quoteId: string) => void }) => (
    <button type="button" onClick={() => onViewQuote("req-1", "q-1")}>견적 보기</button>
  ),
}));
// QuoteList/QuotePreviewModals는 같은 모듈 — 견적함 상태를 화면 밖에서 관측하려고 프로브로 노출한다.
vi.mock("@/components/customer-detail/QuoteList", () => ({
  QuoteList: ({ quoteList }: { quoteList: { confirmingQuoteContractEditId: string | null; editorOpen: boolean } }) => (
    <div data-testid="quote-list-probe" data-contract-edit-id={quoteList.confirmingQuoteContractEditId ?? ""} data-editor-open={String(quoteList.editorOpen)} />
  ),
  QuotePreviewModals: () => null,
}));

vi.mock("@/lib/customers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customers")>()),
  fetchCustomerDetail: vi.fn(async () => detail),
  updateCustomer: vi.fn(async () => ({})),
}));
vi.mock("@/lib/customer-quotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customer-quotes")>()),
  updateQuote: vi.fn(async () => ({})),
  createQuote: vi.fn(async () => ({})),
  requestSolutionQuote: vi.fn(),
}));
vi.mock("@/lib/quote-requests", () => ({
  fetchCustomerQuoteRequestsCached: vi.fn(async () => []),
  fetchAppQuoteRequestsCached: vi.fn(async () => []),
  fetchQuoteRequestDetail: vi.fn(),
}));
vi.mock("@/lib/consultations", () => ({
  fetchCustomerConsultationsCached: vi.fn(async () => []),
  invalidateCustomerConsultations: vi.fn(),
  dismissConsultation: vi.fn(),
}));
vi.mock("@/lib/solution-dealers", () => ({ fetchSolutionDealers: vi.fn(async () => []) }));
vi.mock("@/lib/support-matrix", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/support-matrix")>()),
  useSupportMatrix: () => null,
}));

// 승격 견적 1건 = 계약 진행 상태(니즈 카드 "견적 보기"의 대상).
const contractingQuote = {
  id: "q-1",
  quoteCode: "QT-1",
  title: "테스트 견적",
  decisionStatus: "contracting",
  scenarios: [],
  options: [],
  sourceQuoteRequestId: "req-1",
};

const detail = {
  id: "d-1",
  name: "김지안",
  customerCode: "CU-1",
  appUserId: null,
  residence: "서울특별시 · 강남구",
  quotes: [contractingQuote],
  tasks: [],
  schedules: [],
  documents: [],
  memos: [],
  consultations: [],
} as unknown as CustomerDetailData;

const customer = {
  id: "d-1", no: 11, name: "김지안", customerId: "CU-1",
  statusGroup: "견적", status: "발송완료", advisorId: "u-1",
  source: "앱 문의", receivedAt: "2026-07-01", advisor: "자메스", assignedAt: "2026-07-01",
  team: "1팀", date: "2026-07-20", nextAction: "-",
} as unknown as Customer;

function probe() {
  return screen.getByTestId("quote-list-probe");
}

describe("니즈 카드 '견적 보기' — 계약 진행 견적 선검사 (배치 13 K2-c)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("계약 진행 견적은 안내 토스트만 내고 확인 상태를 만들지 않는다", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    render(
      <MemoryRouter>
        <CustomerDetailPage customer={customer} onBack={vi.fn()} onToast={onToast} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "견적 보기" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "견적 보기" }));

    expect(onToast).toHaveBeenCalledWith("계약 진행 중인 견적은 계약 관리 창에서 수정할 수 있습니다.");
    // 선검사가 없으면 openEditQuote가 확인 상태만 세팅한다 — 그 안내 다이얼로그의 유일한 렌더 지점이
    // 견적함 행 액션 팝오버 안이라 니즈 카드 경로에선 화면에 아무것도 안 뜨고 editorOpen만 잠긴다.
    expect(probe().getAttribute("data-contract-edit-id")).toBe("");
    expect(probe().getAttribute("data-editor-open")).toBe("false");
  });
});
