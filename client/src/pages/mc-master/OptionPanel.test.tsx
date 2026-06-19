import { render, screen } from "@testing-library/react";
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
      summary={{ trimId: TRIM.id, basic: 1, tuning: 0, noOption: false }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByText("파노라마 선루프")).toBeInTheDocument(); // findBy 아님 — 캐시라 동기
});

it("캐시 miss 로딩 중: summary 카운트로 탭 라벨, 「옵션 없음 확정」 미표시", () => {
  // never-resolve fetch로 loaded=false 상태를 고정
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  render(
    <OptionPanel
      trim={{ ...TRIM, id: 8001 }}
      canEdit
      summary={{ trimId: 8001, basic: 3, tuning: 2, noOption: false }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /기본 옵션 \(3\)/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /튜닝 옵션 \(2\)/ })).toBeInTheDocument();
  // :265 보강 — 로딩 중에는 「옵션 없음으로 확정」 토글이 보이면 안 된다
  expect(screen.queryByRole("button", { name: /옵션 없음으로 확정/ })).toBeNull();
});
