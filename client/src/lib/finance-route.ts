import type { FinanceMode } from "@/pages/FinancePage";

// 재무 관리 mode 메타(타이틀·서브타이틀) SSOT — 공통 헤더가 참조. 고객 관리의 customerModeMeta 대칭.
export const financeModeMeta: Record<FinanceMode, [string, string]> = {
  stats: ["재무 관리 · 통계", "매출, 지출, 정산, 순마진 흐름을 한눈에 확인합니다."],
  revenue: ["재무 관리 · 매출 관리", "계약과 출고에서 발생하는 수수료 매출과 입금 상태를 관리합니다."],
  expense: ["재무 관리 · 지출 관리", "광고비, 출고 비용, 운영비처럼 차선생 운영 지출을 분류합니다."],
  payroll: ["재무 관리 · 급여 관리", "구성원별 급여, 성과급, 지급 기준을 관리합니다."],
};

// 재무 mode를 URL(?view=)에서 파생한다(고객 관리 customerModeFromSearch 대칭). 없는/모르는 값은 stats 폴백.
export function financeModeFromSearch(search: string): FinanceMode {
  const view = new URLSearchParams(search).get("view");
  return view && view in financeModeMeta ? (view as FinanceMode) : "stats";
}

// 재무 목록 URL 조립 — 기본 stats는 view 생략. 사이드바 서브메뉴가 이 함수로 URL을 전환한다.
export function financeListPath(mode: FinanceMode): string {
  return mode === "stats" ? "/finance" : `/finance?view=${mode}`;
}
