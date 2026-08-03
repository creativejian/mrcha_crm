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
