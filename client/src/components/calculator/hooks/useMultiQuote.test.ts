// useMultiQuote(계산기 모달 T2) — 릴레이 배선·미취급/실패 분기 단위테스트.
// 릴레이(sendJson)만 모킹 — 미취급 판별(isLenderNotAvailableMessage)·금융사 어휘(SOLUTION_LENDERS)는
// 실물로 잠근다(SolutionLenderRankingModal.test.tsx 관례 미러). 실 API 호출 없음.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError, sendJson } from "@/lib/http";
import { SOLUTION_LENDERS } from "@/lib/solution-quote";

import type { QuotePayload, QuoteResult } from "../quote-types";
import { useMultiQuote } from "./useMultiQuote";

vi.mock("@/lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http")>()),
  sendJson: vi.fn(),
}));

const sendJsonMock = vi.mocked(sendJson);

const basePayload: Omit<QuotePayload, "lenderCode"> = {
  productType: "operating_lease",
  brand: "BMW",
  modelName: "5시리즈",
  masterMcCode: "MC-1",
  affiliateType: "비제휴사",
  directModelEntry: false,
  ownershipType: "company",
  leaseTermMonths: 60,
  annualMileageKm: 20000,
  upfrontPayment: 0,
  depositAmount: 0,
  quotedVehiclePrice: 50_000_000,
};

const quoteResult: QuoteResult = {
  productType: "operating_lease",
  monthlyPayment: 1_234_567,
  rates: { annualRateDecimal: 0.0532, effectiveAnnualRateDecimal: 0.055, monthlyRateDecimal: 0.0044 },
  residual: { matrixGroup: null, rateDecimal: 0.4, amount: 20_000_000 },
  majorInputs: {
    leaseTermMonths: 60,
    ownershipType: "company",
    vehiclePrice: 50_000_000,
    discountedVehiclePrice: 50_000_000,
    upfrontPayment: 0,
    depositAmount: 0,
    financedPrincipal: 30_000_000,
  },
  warnings: [],
};

beforeEach(() => {
  sendJsonMock.mockReset();
});

describe("useMultiQuote", () => {
  it("성공 시 전 금융사(SOLUTION_LENDERS) 병렬 호출 후 결과를 세팅한다", async () => {
    sendJsonMock.mockResolvedValue({ ok: true, quote: quoteResult });
    const { result } = renderHook(() => useMultiQuote());

    expect(result.current.hasAnyResult).toBe(false);
    await act(() => result.current.calculateAll(basePayload));

    // 전 금융사 1회씩 — lenderCode만 주입된 동일 payload로 릴레이 호출
    expect(sendJsonMock).toHaveBeenCalledTimes(SOLUTION_LENDERS.length);
    for (const lender of SOLUTION_LENDERS) {
      expect(sendJsonMock).toHaveBeenCalledWith("/api/solution/calculate", "POST", {
        ...basePayload,
        lenderCode: lender.code,
      });
    }

    expect(result.current.entries).toHaveLength(SOLUTION_LENDERS.length);
    expect(result.current.entries.map((e) => e.lenderCode)).toEqual(SOLUTION_LENDERS.map((l) => l.code));
    for (const entry of result.current.entries) {
      expect(entry.result).toEqual(quoteResult);
      expect(entry.loading).toBe(false);
      expect(entry.error).toBeNull();
      expect(entry.notAvailable).toBe(false);
    }
    expect(result.current.isAnyLoading).toBe(false);
    expect(result.current.hasAnyResult).toBe(true);
  });

  it("미취급 문구 실패는 notAvailable=true(조용히 제외)·error=null", async () => {
    // 릴레이가 파트너 400 문구를 {error}로 패스스루 → HttpError.message에 미취급 패턴 매칭
    sendJsonMock.mockRejectedValue(new HttpError("해당 차량은 미취급입니다", 400));
    const { result } = renderHook(() => useMultiQuote());

    await act(() => result.current.calculateAll(basePayload));

    for (const entry of result.current.entries) {
      expect(entry.notAvailable).toBe(true);
      expect(entry.error).toBeNull();
      expect(entry.result).toBeNull();
      expect(entry.loading).toBe(false);
    }
    expect(result.current.hasAnyResult).toBe(false);
  });

  it("일반 실패(미취급 패턴 미매칭)는 error에 사유를 세팅한다", async () => {
    sendJsonMock.mockRejectedValue(new HttpError("계산 서버에 연결하지 못했습니다", 502));
    const { result } = renderHook(() => useMultiQuote());

    await act(() => result.current.calculateAll(basePayload));

    for (const entry of result.current.entries) {
      expect(entry.error).toBe("계산 서버에 연결하지 못했습니다");
      expect(entry.notAvailable).toBe(false);
      expect(entry.result).toBeNull();
    }
  });

  it("응답이 {ok, quote} 형태를 이탈하면 성공으로 둔갑시키지 않는다(일반 실패 분기)", async () => {
    sendJsonMock.mockResolvedValue({ ok: true }); // quote 누락 — 파트너/릴레이 스키마 드리프트 가정
    const { result } = renderHook(() => useMultiQuote());

    await act(() => result.current.calculateAll(basePayload));

    for (const entry of result.current.entries) {
      expect(entry.result).toBeNull();
      expect(entry.error).toBe("계산 응답을 해석하지 못했습니다");
      expect(entry.notAvailable).toBe(false);
    }
  });

  // 배치 7 A#6 회귀 잠금 — 조회 중 초기화 시 in-flight 응답이 리셋을 덮고 결과를 부활시키던 race.
  it("reset 후 도착한 늦은 응답은 무시한다(세대 토큰 — stale 폐기)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sendJsonMock.mockImplementation(async () => {
      await gate;
      return { ok: true, quote: quoteResult };
    });
    const { result } = renderHook(() => useMultiQuote());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.calculateAll(basePayload);
    });
    expect(result.current.isAnyLoading).toBe(true);

    // 조회가 끝나기 전에 초기화
    act(() => {
      result.current.reset();
    });
    expect(result.current.isAnyLoading).toBe(false);
    expect(result.current.hasAnyResult).toBe(false);

    // 늦은 응답 도착 — 리셋을 덮고 결과가 부활하면 안 된다
    await act(async () => {
      release();
      await pending;
    });
    for (const entry of result.current.entries) {
      expect(entry.result).toBeNull();
      expect(entry.error).toBeNull();
      expect(entry.loading).toBe(false);
    }
    expect(result.current.hasAnyResult).toBe(false);
  });
});
