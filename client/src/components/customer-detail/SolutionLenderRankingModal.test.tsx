import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { requestSolutionQuote } from "@/lib/customer-quotes";
import type { BuildArgs, SolutionQuoteInput } from "@/lib/solution-quote";
import type { SolutionRankingEntry } from "@/lib/solution-ranking";

import { SolutionLenderRankingModal } from "./SolutionLenderRankingModal";

// 릴레이만 모킹 — 빌더/파서/랭킹 lib는 원본(모달의 조립→행 변환 경로를 실물로 잠근다).
vi.mock("@/lib/customer-quotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customer-quotes")>()),
  requestSolutionQuote: vi.fn(),
}));

const requestSolution = vi.mocked(requestSolutionQuote);

// 장기렌트 = 취급 3사(MG·메리츠·iM) — 병렬 배치 수가 작아 테스트에 적합.
const baseArgs: Omit<BuildArgs, "lenderLabel"> = {
  purchaseMethod: "장기렌트",
  termMonths: 60,
  depositMode: "none",
  depositRaw: "",
  downPaymentMode: "none",
  downPaymentRaw: "",
  residualMode: "max",
  residualRaw: "",
  mileageValue: "20,000km / 년",
  subsidyApplicable: false,
  subsidyRaw: "",
  vehicle: { brand: "BMW", model: "5시리즈", mcCode: "MC-1" },
  pricing: { baseAndOption: 50_000_000, discount: 0 },
};

const rawOf = (monthly: number, rateDecimal: number, warnings: string[] = []) => ({
  ok: true,
  quote: {
    monthlyPayment: monthly,
    rates: { annualRateDecimal: rateDecimal, effectiveAnnualRateDecimal: rateDecimal },
    residual: { amount: 20_000_000, rateDecimal: 0.4 },
    workbookImport: { versionLabel: "2607" },
    warnings,
  },
});

function mockPerLender() {
  requestSolution.mockReset();
  requestSolution.mockImplementation(async (input) => {
    const code = (input as SolutionQuoteInput).lenderCode;
    if (code === "meritz-capital") throw new Error("해당 차량을 찾지 못했습니다"); // 미취급 → 조용히 제외
    if (code === "mg-capital") return rawOf(900_000, 0.04, ["잔가 후보 2개 중 최대값 적용"]); // 금리 최저·경고 1
    return rawOf(880_000, 0.05); // im-capital — 월납입 최저
  });
}

function renderModal() {
  const onPick = vi.fn<(condId: string, entry: SolutionRankingEntry) => void>();
  const onClose = vi.fn<() => void>();
  const utils = render(
    <SolutionLenderRankingModal
      condId="manual-condition-1"
      purchaseMethod="장기렌트"
      buildBaseArgs={() => baseArgs}
      onPick={onPick}
      onClose={onClose}
    />,
  );
  return { ...utils, onPick, onClose };
}

describe("SolutionLenderRankingModal (개정 2 R4 — 제프 랭킹 UX 미러)", () => {
  it("오픈 즉시 지원 금융사 전체 병렬 조회 → 미취급 조용히 제외 → 월 납입 순 랭킹(뱃지·차액·경고) 렌더", async () => {
    mockPerLender();
    const { container } = renderModal();
    await waitFor(() => expect(requestSolution).toHaveBeenCalledTimes(3)); // 장기렌트 3사 병렬(배치 엔드포인트 아님)
    await waitFor(() => expect(container.querySelectorAll(".kim-solution-rank-row")).toHaveLength(2)); // 미취급 1사 제외
    const rows = Array.from(container.querySelectorAll(".kim-solution-rank-row"));
    // 기본 정렬 = 월 납입 순: iM(880,000·장기렌트라 라운딩 없음) 1위, MG(900,000) 2위 + 1위 대비 +20,000(빨강)
    expect(rows[0].textContent).toContain("iM캐피탈");
    expect(rows[0].textContent).toContain("880,000");
    expect(rows[0].textContent).toContain("최저 월납입");
    expect(rows[1].textContent).toContain("MG캐피탈");
    expect(rows[1].textContent).toContain("+20,000");
    expect(rows[1].textContent).toContain("최저 금리"); // 4% < 5%
    // ⚠️ warnings tooltip(제프 미러 — title에 개행 join)
    expect(rows[1].querySelector(".rank-warn")?.getAttribute("title")).toBe("잔가 후보 2개 중 최대값 적용");
    // 로딩 종료 후 헤더 상태
    expect(container.querySelector(".kim-solution-rank-status")?.textContent).toContain("조회 완료 · 2개");
  });

  it("정렬 토글: 금리 순으로 바꾸면 MG(4%)가 1위로 — +차액은 월 납입 순 전용이라 사라진다", async () => {
    mockPerLender();
    const { container } = renderModal();
    await waitFor(() => expect(container.querySelectorAll(".kim-solution-rank-row")).toHaveLength(2));
    fireEvent.change(container.querySelector(".kim-solution-rank-sort select")!, { target: { value: "interestRate" } });
    const rows = Array.from(container.querySelectorAll(".kim-solution-rank-row"));
    expect(rows[0].textContent).toContain("MG캐피탈");
    expect(rows[0].textContent).not.toContain("+20,000");
    expect(rows[1].textContent).not.toContain("+20,000");
  });

  it("행 클릭 → onPick(condId, entry — 표시 라운딩 월납입·raw 동봉) / 취소 → onClose", async () => {
    mockPerLender();
    const { container, onPick, onClose } = renderModal();
    await waitFor(() => expect(container.querySelectorAll(".kim-solution-rank-row")).toHaveLength(2));
    fireEvent.click(container.querySelectorAll(".kim-solution-rank-row")[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toBe("manual-condition-1");
    expect(onPick.mock.calls[0][1]).toMatchObject({ lenderCode: "im-capital", label: "iM캐피탈", monthlyDisplay: 880_000 });
    fireEvent.click(container.querySelector(".kim-solution-lender-foot button")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("전부 실패(미취급) → '조회 결과가 없습니다' + 수기 안내 문구 유지", async () => {
    requestSolution.mockReset();
    requestSolution.mockRejectedValue(new Error("미취급 차량입니다"));
    const { container } = renderModal();
    await waitFor(() => expect(container.querySelector(".kim-solution-rank-empty")?.textContent).toBe("조회 결과가 없습니다"));
    expect(container.querySelector(".kim-solution-lender-foot p")?.textContent).toContain("수기 작성");
  });

  it("전부 실패(에러성 — 미취급 아님) → 사유가 empty state에 표면화(무결과 위장 금지)", async () => {
    // env 오설정(릴레이 503) 등이 "조회 결과가 없습니다"로 위장돼 실사용 혼란을 낸 실사례의 회귀 그물.
    requestSolution.mockReset();
    requestSolution.mockRejectedValue(new Error("솔루션 연결이 설정되지 않았습니다(PARTNER_QUOTE_API_URL 미설정)"));
    const { container } = renderModal();
    await waitFor(() =>
      expect(container.querySelector(".kim-solution-rank-empty")?.textContent).toContain(
        "조회에 실패했습니다 — 솔루션 연결이 설정되지 않았습니다",
      ),
    );
  });
});
