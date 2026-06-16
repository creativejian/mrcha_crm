import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MCMasterPage } from "./MCMasterPage";

const COUNTS = {
  brands: 33,
  models: 265,
  trims: 1669,
  trimOptions: 10495,
  colors: 10483,
  trimNoOptions: 57,
  trimOptionRelations: 6236,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/catalog/counts") return new Response(JSON.stringify(COUNTS), { status: 200 });
      if (url === "/api/catalog/sync" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ok: true,
            tables: [{ name: "brands", fetched: 33, total: 33, complete: true, upserted: 33, softDeleted: 0 }],
          }),
          { status: 200 },
        );
      }
      return new Response("[]", { status: 200 });
    }),
  );
});

afterEach(() => vi.restoreAllMocks());

it("건수 렌더", async () => {
  render(<MCMasterPage roleTab="최고관리자" />);
  expect(await screen.findByText("1,669")).toBeInTheDocument();
});

it("최고관리자는 동기화 버튼 노출, 클릭 시 결과 표시", async () => {
  const user = userEvent.setup();
  render(<MCMasterPage roleTab="최고관리자" />);
  await screen.findByText("33");
  await user.click(screen.getByRole("button", { name: "마스터 동기화" }));
  expect(await screen.findByText(/동기화 완료/)).toBeInTheDocument();
});

it("비최고관리자는 동기화 버튼 숨김", async () => {
  render(<MCMasterPage roleTab="상담사" />);
  await screen.findByText("33");
  expect(screen.queryByRole("button", { name: "마스터 동기화" })).toBeNull();
});

it("counts 실패 시 '불러오기 실패'", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
  render(<MCMasterPage roleTab="최고관리자" />);
  expect((await screen.findAllByText("불러오기 실패")).length).toBeGreaterThan(0);
});
