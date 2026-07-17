// 판매사(딜러) 목록 조회 — 서버 릴레이 GET /api/solution/dealers 소비(제프 lib/api.ts fetchDealers 미러).
// http 체인(apiFetch)이 있는 클라 전용 lib — 순수 solution-quote.ts(서버 공유 경계)와 분리(#151 사유).
import { getJson } from "./http";
import type { SolutionLenderCode } from "./solution-quote";

/**
 * 판매사(딜러) 1건.
 *
 * ⚠ `baseIrrRate`의 **의미는 lender마다 다르다** — BNK=기준 IRR / 우리카드=제휴+SM+전담AG 합산
 * 수수료율 / 메리츠=딜러 fee 율(제프 lib/api.ts 원문). 한 화면에 섞어 보여줄 때는 lender를 함께 표시할 것.
 */
export type SolutionDealer = { dealerName: string; baseIrrRate: number };

/** 사별 조회를 union한 드롭다운 항목 — 어느 lender의 딜러인지 반드시 달고 다닌다(제프 DealerOption 미러). */
export type DealerOption = SolutionDealer & { lenderCode: SolutionLenderCode; lenderName: string };

// 미지원 금융사는 업스트림이 200 빈 목록을 주므로 호출부 분기 불요. 실패(4xx/5xx)는 throw — 소비처가 catch.
export async function fetchSolutionDealers(lenderCode: SolutionLenderCode, brand: string): Promise<SolutionDealer[]> {
  const data = await getJson<{ ok?: unknown; dealers?: SolutionDealer[] }>(
    `/api/solution/dealers?lenderCode=${encodeURIComponent(lenderCode)}&brand=${encodeURIComponent(brand)}`,
  );
  return data.dealers ?? [];
}
