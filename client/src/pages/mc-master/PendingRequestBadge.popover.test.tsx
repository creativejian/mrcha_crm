import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

// 배지 팝오버 컴포넌트 단위 동작 — 바깥 클릭 닫힘(2026-08-03 실기 버그 회귀 그물).
vi.mock("@/lib/supabase", () => {
  const channelStub = { on: () => channelStub, subscribe: () => channelStub, send: async () => "ok" };
  return {
    supabase: {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
      channel: () => channelStub,
      removeChannel: async () => "ok",
    },
  };
});

import type { ChangeRequestItem } from "@/lib/catalog-change-requests";
import { PendingRequestBadge } from "./PendingRequestBadge";

const ROW: ChangeRequestItem = {
  id: "cr-1",
  kind: "trim.update",
  targetType: "trim",
  targetId: 1,
  payload: { price: 2 },
  snapshot: { price: 1 },
  status: "pending",
  requestedBy: "u1",
  rejectReason: null,
  createdAt: new Date().toISOString(),
  decidedAt: null,
  targetLabel: "x",
  targetBrandId: 1,
  targetModelId: 1,
  targetTrimId: 1,
};

afterEach(() => vi.restoreAllMocks());

/** 요청 URL만 모아 두는 fetch 스텁 — 어떤 엔드포인트를 실제로 불렀는지 잠근다. */
function stubFetch(): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    }),
  );
  return calls;
}

// 승인/반려 행 상태머신(useChangeRequestRows + ApproveRejectActions 공용화 — 2026-08-03)의
// 회귀 그물. 세 팝오버(대기열·내 요청·이 배지)가 같은 부품을 쓰므로 여기서 한 번 잠근다.
it("승인하면 승인 API를 부르고 onApplied를 올린 뒤 배지가 사라진다", async () => {
  const calls = stubFetch();
  const onApplied = vi.fn();
  const user = userEvent.setup();
  render(<PendingRequestBadge requests={[ROW]} staffNames={new Map()} canApprove onApplied={onApplied} />);
  await user.click(screen.getByRole("button", { name: "승인 대기" }));
  await user.click(await screen.findByRole("button", { name: "승인" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  expect(calls.some((u) => u.includes(`/change-requests/${ROW.id}/approve`))).toBe(true);
  // 마지막 남은 요청이 처리되면 배지 자체가 사라진다(빈 팝오버 방지 — closeIfLast).
  await waitFor(() => expect(screen.queryByRole("button", { name: "승인 대기" })).toBeNull());
});

it("반려는 사유 입력이 필수다 — 빈 사유면 확인이 잠기고, 입력 후에만 반려 API가 나간다", async () => {
  const calls = stubFetch();
  const onApplied = vi.fn();
  const user = userEvent.setup();
  render(<PendingRequestBadge requests={[ROW]} staffNames={new Map()} canApprove onApplied={onApplied} />);
  await user.click(screen.getByRole("button", { name: "승인 대기" }));
  await user.click(await screen.findByRole("button", { name: "반려" }));
  const confirm = screen.getByRole("button", { name: "확인" });
  expect(confirm).toBeDisabled(); // 사유가 비면 반려할 수 없다
  await user.type(screen.getByPlaceholderText("반려 사유"), "  기준가 확인 필요  ");
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  await waitFor(() => expect(calls.some((u) => u.includes(`/change-requests/${ROW.id}/reject`))).toBe(true));
  // 반려는 catalog 무변 — 재조회(onApplied)를 유발하지 않는다.
  expect(onApplied).not.toHaveBeenCalled();
});

it("요청이 여러 건이면 한 건 처리 뒤에도 팝오버가 남는다(닫힘은 마지막 건에서만)", async () => {
  stubFetch();
  const user = userEvent.setup();
  const second: ChangeRequestItem = { ...ROW, id: "cr-2", payload: { price: 3 } };
  render(<PendingRequestBadge requests={[ROW, second]} staffNames={new Map()} canApprove onApplied={() => {}} />);
  await user.click(screen.getByRole("button", { name: "승인 대기" }));
  expect(await screen.findAllByRole("button", { name: "승인" })).toHaveLength(2);
  await user.click(screen.getAllByRole("button", { name: "승인" })[0]!);
  // 처리한 행만 사라지고 남은 행은 그 자리에 — 여기서 닫히면 남은 건을 다시 열어야 한다.
  await waitFor(() => expect(screen.getAllByRole("button", { name: "승인" })).toHaveLength(1));
  expect(screen.getByRole("button", { name: "승인 대기" })).toBeInTheDocument();
});

it("manager(canApprove=false)에게는 승인/반려가 없고 diff만 보인다", async () => {
  stubFetch();
  const user = userEvent.setup();
  render(<PendingRequestBadge requests={[ROW]} staffNames={new Map()} canApprove={false} onApplied={() => {}} />);
  await user.click(screen.getByRole("button", { name: "승인 대기" }));
  expect(await screen.findByText("트림 수정")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "승인" })).toBeNull();
  expect(screen.queryByRole("button", { name: "반려" })).toBeNull();
});

it("바깥 pointerdown으로 닫힌다(팝오버 안 클릭은 유지)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  const user = userEvent.setup();
  render(
    <div>
      <div data-testid="outside">밖</div>
      <PendingRequestBadge requests={[ROW]} staffNames={new Map()} canApprove={false} onApplied={() => {}} />
    </div>,
  );
  await user.click(screen.getByRole("button", { name: "승인 대기" }));
  expect(await screen.findByText("트림 수정")).toBeInTheDocument();
  // 팝오버 내부 클릭은 닫히지 않는다.
  await user.click(screen.getByText("트림 수정"));
  expect(screen.getByText("트림 수정")).toBeInTheDocument();
  // 바깥 클릭 → 닫힘.
  await user.click(screen.getByTestId("outside"));
  await waitFor(() => expect(screen.queryByText("트림 수정")).toBeNull());
});

it("배지 버튼 재클릭으로 닫힌다 — pointerdown 닫기 + click 재열기 이중 발화 회귀 그물", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  const user = userEvent.setup();
  render(<PendingRequestBadge requests={[ROW]} staffNames={new Map()} canApprove={false} onApplied={() => {}} />);
  const badge = screen.getByRole("button", { name: "승인 대기" });
  await user.click(badge);
  expect(await screen.findByText("트림 수정")).toBeInTheDocument();
  await user.click(badge); // anchorRef가 없으면 닫힘→즉시 재열림으로 계속 떠 있었다(2026-08-03 실기)
  await waitFor(() => expect(screen.queryByText("트림 수정")).toBeNull());
});

it("표 스크롤이면 닫힌다 — fixed 좌표라 앵커에서 떨어져 떠다니는 것 방지", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  const user = userEvent.setup();
  render(
    <div data-testid="scroller" style={{ overflow: "auto" }}>
      <PendingRequestBadge requests={[ROW]} staffNames={new Map()} canApprove={false} onApplied={() => {}} />
    </div>,
  );
  await user.click(screen.getByRole("button", { name: "승인 대기" }));
  expect(await screen.findByText("트림 수정")).toBeInTheDocument();
  fireEvent.scroll(screen.getByTestId("scroller"));
  await waitFor(() => expect(screen.queryByText("트림 수정")).toBeNull());
});
