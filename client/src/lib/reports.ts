// 경영 리포트 API 클라이언트 — spec: ref/specs/2026-08-02-crm-admin-report-live-design.md.
import { getJson } from "./http";

export type AdminReport = {
  month: string;
  prevMonth: string;
  overview: {
    newInflow: { count: number; prevCount: number };
    inProgress: { count: number };
    quotesSent: { count: number; viewedCount: number };
    contracted: { count: number };
    upcomingDeliveries: { count: number; overdueCount: number };
  };
  brandInquiries: { total: number; rows: Array<{ brand: string; count: number }> };
  quoteFunnel: { created: number; sent: number; viewed: number; contracting: number };
  // 실적(취급 규모) — 출고 달 기준(2026-08-03 이사님 확정). 할부·중고리스는 대수에만 들어가고
  // 금액에는 안 들어간다(실적 개념 자체가 없음 — spec 2026-08-03 §1a).
  delivery: {
    count: number;
    prevCount: number;
    leaseAmount: number;
    prevLeaseAmount: number;
    rentAmount: number;
    prevRentAmount: number;
  };
};

export function fetchAdminReport(month?: string): Promise<AdminReport> {
  return getJson<AdminReport>(`/api/reports/admin${month ? `?month=${encodeURIComponent(month)}` : ""}`);
}

// 월 선택 옵션 — **응답의 month에서 과거로 파생**한다(클라가 KST 현재 월을 스스로 계산하지 않는다).
// 첫 로드는 month 없이 요청하고 서버가 정한 현재 월을 받으므로, 기준 시각의 소유자가 서버 한 곳이다.
export function recentMonthOptions(current: string, count = 12): string[] {
  const [y, m] = current.split("-").map(Number);
  if (!y || !m) return [current];
  return Array.from({ length: count }, (_, i) => {
    const total = y * 12 + (m - 1) - i;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  });
}

export function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  return y && m ? `${y}년 ${Number(m)}월` : month;
}
