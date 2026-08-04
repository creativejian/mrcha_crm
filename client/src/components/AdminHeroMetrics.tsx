import type { HeroMetric } from "@/lib/admin-hero";

// 경영 리포트 히어로 3칩. 조립은 순수 buildHeroPerformance(lib/admin-hero) 몫이고 여기는 표시만
// 담당한다 — Ladle 스토리가 같은 부품으로 표기 형태를 비교한다.
export function AdminHeroMetrics({ metrics }: { metrics: HeroMetric[] }) {
  return (
    <div className="advisor-performance-grid admin-performance-grid">
      {metrics.map((metric) => (
        <div className="advisor-performance-item admin-performance-item" key={metric.label}>
          <span>{metric.label}</span>
          <strong><span className="num">{metric.value}</span>{metric.unit}</strong>
          {/* 소계는 값과 전월 대비 사이 — 값의 내역이라 값에 붙고, 비교 축(전월)과 섞이면 안 된다. */}
          {metric.sub && <small className="admin-performance-sub">{metric.sub}</small>}
          <em className={metric.up ? "up" : undefined}><span className="num">{metric.delta}</span> 전월 대비</em>
        </div>
      ))}
    </div>
  );
}
