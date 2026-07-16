import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content")>()),
  fetchInsights: vi.fn(),
  fetchInsight: vi.fn(),
}));

import { fetchInsight, fetchInsights, type InsightListItem } from "@/lib/content";
import { InsightsPage } from "./InsightsPage";

const item: InsightListItem = {
  id: "1", title: "인사이트 하나", summary: "요약", category: "시장", status: "published", publishedAt: null, updatedAt: "2026-07-05T00:00:00Z",
};

describe("InsightsPage", () => {
  // 배치 6 C#1: 상세 열기 실패가 성공 로드된 목록을 통째로 지우면 안 된다.
  it("keeps the list visible when opening a detail fails", async () => {
    vi.mocked(fetchInsights).mockResolvedValue([item]);
    vi.mocked(fetchInsight).mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<InsightsPage />);

    await screen.findByText("인사이트 하나");
    await user.click(screen.getByText("인사이트 하나"));

    // 상세 실패 안내가 뜨되, 목록은 그대로 남아 있어야 한다.
    await waitFor(() => expect(screen.getByText(/문서를 불러오지 못했습니다/)).toBeInTheDocument());
    expect(screen.getByText("인사이트 하나")).toBeInTheDocument();
  });

  // 배치 6 C#6: 목록 행이 키보드(Enter)로도 열려야 한다(마우스 전용 <tr onClick> 해소).
  it("opens a detail via keyboard Enter on a list row", async () => {
    vi.mocked(fetchInsights).mockResolvedValue([item]);
    vi.mocked(fetchInsight).mockResolvedValue({ ...item, content: "상세 본문", thumbnailUrl: null });
    const user = userEvent.setup();
    render(<InsightsPage />);

    const row = (await screen.findByText("인사이트 하나")).closest("tr") as HTMLTableRowElement;
    row.focus();
    await user.keyboard("{Enter}");

    await screen.findByText("상세 본문");
  });
});
