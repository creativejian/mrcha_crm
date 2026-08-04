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
          <em className={metric.up ? "up" : undefined}><span className="num">{metric.delta}</span> 전월 대비</em>
        </div>
      ))}
    </div>
  );
}

// 출고 대수 구매방식별 내역(2026-08-04) — 이사님 확정("구매방식별로 표기하는 게 정확",
// spec 2026-08-03 §1)의 표기 형태. 후보 2안을 Ladle에서 실물로 비교해 **바 목록으로 확정**했다
// (유슨생 판단 — 칩 안 한 줄은 숫자가 옆으로 늘어서 비율이 안 읽혔다).
//
// 클래스는 브랜드별 문의 바와 같은 것을 쓴다(.bar-list/.bar-row/.bar-track/.bar-fill) — 같은
// "이름 · 막대 · 수" 구조라 새 어휘를 만들 이유가 없고, 화면 안에서 두 목록이 같아 보인다.
export function DeliveryMethodBars({ rows }: { rows: Array<{ method: string; count: number }> }) {
  // 0건이면 아무것도 그리지 않는다 — 빈 목록 자리가 남으면 "집계가 깨졌나"로 읽힌다.
  if (rows.length === 0) return null;
  // 최댓값 기준 상대 길이. 서버가 이미 많은 순으로 보내므로 첫 행이 항상 100%다.
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="bar-list admin-method-bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.method}>
          <span>{r.method}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <strong className="num">{r.count}</strong>
        </div>
      ))}
    </div>
  );
}
