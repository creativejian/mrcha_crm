import type { AdminReport } from "./reports";

// 경영 리포트 히어로 3칩(전체 출고·리스 실적·렌트 실적)의 표시 데이터 조립 — 순수.
// 컴포넌트(components/AdminHeroMetrics.tsx)와 분리한 이유: Ladle 스토리·유닛 테스트가 이 함수만
// 따로 부르고, 한 파일에 두면 react-refresh 룰(컴포넌트 파일은 컴포넌트만 export)에 걸린다.
// spec: ref/specs/2026-08-03-crm-delivery-revenue-design.md

export type HeroMetric = { label: string; value: string; unit: string; delta: string; up: boolean };

export function buildHeroPerformance(report: AdminReport): HeroMetric[] {
  const { count, prevCount, leaseAmount, prevLeaseAmount, rentAmount, prevRentAmount } = report.delivery;
  const won = (v: number) => v.toLocaleString("ko-KR");
  const metric = (label: string, unit: string, cur: number, prev: number): HeroMetric => {
    const diff = cur - prev;
    return {
      label,
      value: won(cur),
      unit,
      delta: diff === 0 ? "±0" : `${diff > 0 ? "+" : ""}${won(diff)}`,
      up: diff > 0,
    };
  };
  // 구매방식별 대수는 칩 안이 아니라 **아래 바 목록**이 보여준다(2026-08-04 유슨생 실물 판단 —
  // 스토리 A안/B안 비교 후 B 선택). 칩 안 한 줄(A안)은 폐기했다.
  return [
    metric("전체 출고", "대", count, prevCount),
    metric("리스 실적", "원", leaseAmount, prevLeaseAmount),
    metric("렌트 실적", "원", rentAmount, prevRentAmount),
  ];
}
