import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// apiFetch(./lib/api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { App } from "./App";

// 일부 화면(mc-master 등)이 마운트 시 fetch를 호출하므로 전역 mock.
// catalog counts는 객체를 기대하므로(undefined.toLocaleString 방지) 0건 객체로 응답.
const ZERO_COUNTS = { brands: 0, models: 0, trims: 0, trimOptions: 0, colors: 0, trimNoOptions: 0, trimOptionRelations: 0 };
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/catalog/counts")) {
        return new Response(JSON.stringify(ZERO_COUNTS), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

it("/quotes → 견적 관리 화면(제목)", () => {
  renderAt("/quotes");
  expect(screen.getByRole("heading", { level: 1, name: "견적 관리" })).toBeInTheDocument();
});

it("/mc-master → 엠씨 마스터 화면(제목)", () => {
  renderAt("/mc-master");
  expect(screen.getByRole("heading", { level: 1, name: "엠씨 마스터" })).toBeInTheDocument();
});

it("알 수 없는 경로 → 대시보드로 리다이렉트", () => {
  renderAt("/unknown-path");
  // 신규 대시보드(DashboardPreviewPage)는 자체 h2 제목을 쓰고 공통 헤더는 숨긴다(#250 승격).
  expect(screen.getByRole("heading", { level: 2, name: "오늘 상담 우선순위" })).toBeInTheDocument();
});
