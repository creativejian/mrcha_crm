import type { AdminReport } from "./reports";

// 경영 리포트 히어로 3칩(전체 출고·리스 실적·렌트 실적)의 표시 데이터 조립 — 순수.
// 컴포넌트(components/AdminHeroMetrics.tsx)와 분리한 이유: Ladle 스토리·유닛 테스트가 이 함수만
// 따로 부르고, 한 파일에 두면 react-refresh 룰(컴포넌트 파일은 컴포넌트만 export)에 걸린다.
// spec: ref/specs/2026-08-03-crm-delivery-revenue-design.md

export type HeroMetric = {
  label: string;
  value: string;
  unit: string;
  delta: string;
  up: boolean;
  /** 값의 내역 한 줄(전체 출고의 구매방식별 소계). 없으면 줄 자체를 그리지 않는다. */
  sub?: string;
};

export function buildHeroPerformance(report: AdminReport): HeroMetric[] {
  const { count, prevCount, leaseAmount, prevLeaseAmount, rentAmount, prevRentAmount, countByMethod } = report.delivery;
  const won = (v: number) => v.toLocaleString("ko-KR");
  const metric = (label: string, unit: string, cur: number, prev: number, sub?: string): HeroMetric => {
    const diff = cur - prev;
    return {
      label,
      value: won(cur),
      unit,
      delta: diff === 0 ? "±0" : `${diff > 0 ? "+" : ""}${won(diff)}`,
      up: diff > 0,
      sub,
    };
  };
  // 구매방식별 소계(이사님 확정 — spec §1): 총 대수 한 숫자로는 운용리스 20대와 할부 20대가
  // 같아 보이는데 취급 규모가 전혀 다르다. 0건이면 붙이지 않는다(빈 줄이 남는다).
  const byMethod = countByMethod.length > 0 ? countByMethod.map((r) => `${r.method} ${r.count}`).join(" · ") : undefined;
  return [
    metric("전체 출고", "대", count, prevCount, byMethod),
    metric("리스 실적", "원", leaseAmount, prevLeaseAmount),
    metric("렌트 실적", "원", rentAmount, prevRentAmount),
  ];
}
