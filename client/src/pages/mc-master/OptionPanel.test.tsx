import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import type { CatalogTrim } from "@/lib/catalog";
import { fetchOptionsCached } from "./catalog-cache";
import { OptionPanel } from "./OptionPanel";

const TRIM: CatalogTrim = {
  id: 8000,
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
  priceUpdatedAt: null,
  financialDiscountAmount: null,
  partnerDiscountAmount: null,
  cashDiscountAmount: null,
  discountUpdatedAt: null,
};

afterEach(() => vi.restoreAllMocks());

it("캐시 hit: 첫 렌더부터 옵션 리스트(비동기 대기 없이)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            options: [{ id: 1, type: "basic", name: "파노라마 선루프", price: 1200000 }],
            relations: [],
          }),
          { status: 200 },
        ),
    ),
  );
  await fetchOptionsCached(TRIM.id); // 모듈 캐시 채움
  render(
    <OptionPanel
      trim={TRIM}
      canEdit
      canDelete
      summary={{ trimId: TRIM.id, basic: 1, tuning: 0, noOption: false }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByText("파노라마 선루프")).toBeInTheDocument(); // findBy 아님 — 캐시라 동기
});

it("캐시 miss 로딩 중: summary 카운트로 탭 라벨, 「옵션 없음 확정」 미표시", () => {
  // never-resolve fetch로 loaded=false 상태를 고정
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  render(
    <OptionPanel
      trim={{ ...TRIM, id: 8001 }}
      canEdit
      canDelete
      summary={{ trimId: 8001, basic: 3, tuning: 2, noOption: false }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /기본 옵션 \(3\)/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /튜닝 옵션 \(2\)/ })).toBeInTheDocument();
  // 「옵션 없음으로 확정」 토글 케이스 보강 — 로딩 중에는 「옵션 없음으로 확정」 토글이 보이면 안 된다
  expect(screen.queryByRole("button", { name: /옵션 없음으로 확정/ })).toBeNull();
});

it("200 즉시 실행(admin): 무옵션 토글 후 로컬 플립되어 라벨이 「확정 해제」로 바뀐다", async () => {
  const trimId = 8002;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/catalog/trims/${trimId}/options`) {
        return new Response(JSON.stringify({ options: [], relations: [] }), { status: 200 });
      }
      if (url === `/api/catalog/trims/${trimId}/no-option` && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`예상 못한 fetch: ${url}`);
    }),
  );
  render(
    <OptionPanel
      trim={{ ...TRIM, id: trimId }}
      canEdit
      canDelete
      summary={{ trimId, basic: 0, tuning: 0, noOption: false }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const toggle = await screen.findByRole("button", { name: "옵션 없음으로 확정" });
  fireEvent.click(toggle);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "옵션 없음 확정 해제" })).toBeInTheDocument();
  });
});

it("202 큐 적재(팀장 제안): 무옵션 토글 후 로컬 플립 없음(반영 전이라 라벨 그대로)", async () => {
  const trimId = 8003;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/catalog/trims/${trimId}/options`) {
        return new Response(JSON.stringify({ options: [], relations: [] }), { status: 200 });
      }
      if (url === `/api/catalog/trims/${trimId}/no-option` && init?.method === "POST") {
        return new Response(JSON.stringify({ queued: true, requestId: "cr-x" }), { status: 202 });
      }
      throw new Error(`예상 못한 fetch: ${url}`);
    }),
  );
  render(
    <OptionPanel
      trim={{ ...TRIM, id: trimId }}
      canEdit
      canDelete={false}
      summary={{ trimId, basic: 0, tuning: 0, noOption: false }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const toggle = await screen.findByRole("button", { name: "옵션 없음으로 확정" });
  fireEvent.click(toggle);
  // busy 종료(=fetch 완료) 대기 — 큐 적재 응답은 아직 반영 전이라 라벨이 그대로여야 한다.
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(screen.getByRole("button", { name: "옵션 없음으로 확정" })).toBeInTheDocument();
});
