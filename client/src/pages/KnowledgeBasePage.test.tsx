import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content")>()),
  fetchKnowledgeArticles: vi.fn(),
  fetchKnowledgeArticle: vi.fn(),
}));

import { fetchKnowledgeArticles, type KnowledgeListItem } from "@/lib/content";
import { KnowledgeBasePage } from "./KnowledgeBasePage";

const item: KnowledgeListItem = {
  id: "1", category: "sales", documentTitle: "문서 하나", blockNumber: 1, subNumber: null, updatedAt: "2026-07-05T00:00:00Z",
};

// InsightsPage 카운트 게이트의 미러 잠금(배치 10 C#2) — 종전엔 Insights 테스트 주석이
// "미러 동일"이라 주장만 하고 이 파일이 없어 KnowledgeBasePage 게이트 회귀를 아무 테스트도 못 잡았다.
describe("KnowledgeBasePage", () => {
  it("does not flash 0 in the total count while the list is loading", async () => {
    let resolveList: (rows: KnowledgeListItem[]) => void = () => {};
    vi.mocked(fetchKnowledgeArticles).mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    render(<KnowledgeBasePage />);

    expect(screen.queryByText("0")).not.toBeInTheDocument();

    resolveList([item]);
    await screen.findByText("문서 하나");
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  // 배치 10 C#1 미러: 목록 실패 시에도 카운트를 비운다(0은 "정말 0건"만 — #287 계약).
  it("does not show 0 in the total count when the list fails to load", async () => {
    vi.mocked(fetchKnowledgeArticles).mockRejectedValue(new Error("network"));
    render(<KnowledgeBasePage />);

    await screen.findByText(/불러오지 못했습니다/);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
