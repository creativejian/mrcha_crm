import { render, screen } from "@testing-library/react";
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
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(COUNTS), { status: 200 })));
});

afterEach(() => vi.restoreAllMocks());

it("건수 렌더", async () => {
  render(<MCMasterPage />);
  expect(await screen.findByText("1,669")).toBeInTheDocument();
});

it("counts 실패 시 '불러오기 실패'", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
  render(<MCMasterPage />);
  expect((await screen.findAllByText("불러오기 실패")).length).toBeGreaterThan(0);
});
