import "@/index.css";
import { AdminHeroMetrics } from "./AdminHeroMetrics";
import { buildHeroPerformance } from "@/lib/admin-hero";
import type { AdminReport } from "@/lib/reports";

// 출고 대수 **구매방식별 표기 형태**를 눈으로 고르기 위한 스토리(2026-08-04).
// 방향은 이사님 확정("구매방식별로 표기하는 게 정확" — spec 2026-08-03 §1), 형태는 미정이라
// 유슨생·송실장이 여기서 보고 정한다. 실 DB에는 계약 확정일이 아직 0건이라 화면으로는 판단할
// 수 없어서, mock을 공유 master에 넣는 대신(이사님 화면에 가짜 실적이 뜬다) 여기서 렌더한다.
//
// ▶ 보는 법: `bun run dev:ladle` → CRM/Admin Hero
// ▶ 정할 것: 아래 A안(소계 한 줄)과 B안(바 차트) 중 하나. 판단 기준은 각 스토리 상단 주석 참조.

const base: AdminReport["delivery"] = {
  count: 0,
  prevCount: 0,
  leaseAmount: 0,
  prevLeaseAmount: 0,
  rentAmount: 0,
  prevRentAmount: 0,
  countByMethod: [],
};

const report = (delivery: Partial<AdminReport["delivery"]>): AdminReport => ({ delivery: { ...base, ...delivery } }) as AdminReport;

/** 2026-08-04 실측 비율(견적 32건: 운용리스 27·장기렌트 2·할부 2·중고리스 1)을 출고 대수로 옮긴 것. */
const REAL_SHAPE = report({
  count: 32,
  prevCount: 26,
  leaseAmount: 1_284_000_000,
  prevLeaseAmount: 1_010_000_000,
  rentAmount: 96_000_000,
  prevRentAmount: 120_000_000,
  countByMethod: [
    { method: "운용리스", count: 27 },
    { method: "장기렌트", count: 2 },
    { method: "할부", count: 2 },
    { method: "중고리스", count: 1 },
  ],
});

/** 가정: 구매방식이 고르게 퍼진 미래. 쏠림이 풀렸을 때도 형태가 견디는지 본다. */
const EVEN_SHAPE = report({
  count: 40,
  prevCount: 33,
  leaseAmount: 1_500_000_000,
  prevLeaseAmount: 1_200_000_000,
  rentAmount: 640_000_000,
  prevRentAmount: 480_000_000,
  countByMethod: [
    { method: "운용리스", count: 14 },
    { method: "장기렌트", count: 11 },
    { method: "할부", count: 8 },
    { method: "중고리스", count: 5 },
    { method: "미지정", count: 2 },
  ],
});

export default {
  title: "CRM/Admin Hero",
};

/**
 * **A안 — 소계 한 줄**(현재 구현·추천). 값 아래에 "운용리스 27 · 장기렌트 2 …"를 muted로 붙인다.
 * 판단 포인트: ①쏠림이 심한 실측 분포에서 뒤쪽 숫자(1~2건)가 읽히는가 ②칩 높이가 다른 두 칩과
 * 어긋나 보이지 않는가 ③구매방식이 5종이 되면(EvenDistribution) 줄바꿈이 어색하지 않은가.
 */
export const A_SubtotalLine = () => <AdminHeroMetrics metrics={buildHeroPerformance(REAL_SHAPE)} />;

export const A_SubtotalLine_EvenDistribution = () => <AdminHeroMetrics metrics={buildHeroPerformance(EVEN_SHAPE)} />;

/** 0건(현재 실 DB 상태) — 소계 줄이 아예 사라져 기존 화면과 같아야 한다. */
export const A_SubtotalLine_Empty = () => <AdminHeroMetrics metrics={buildHeroPerformance(report({}))} />;

// ── B안 프리뷰 ────────────────────────────────────────────────────────────
// 스토리 전용 로컬 컴포넌트다(프로덕션에 넣지 않는다 — 고르고 나서 이긴 안만 구현한다).
function MethodBars({ delivery }: { delivery: AdminReport["delivery"] }) {
  const max = Math.max(...delivery.countByMethod.map((r) => r.count), 1);
  // 클래스는 브랜드별 문의 바와 동일(.bar-list/.bar-row/.bar-track/.bar-fill) — 새 CSS 없이
  // 실제로 붙였을 때의 모습 그대로 보기 위해서다.
  return (
    <div className="panel-body bar-list" style={{ marginTop: 14 }}>
      {delivery.countByMethod.map((r) => (
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

/**
 * **B안 — 바 차트**. 브랜드별 문의와 같은 시각 형식이라 학습 비용이 0이고 비율이 직관적이다.
 * 판단 포인트: ①실측처럼 한 방식에 쏠리면 나머지 막대가 거의 안 보인다(빈약해 보이는지)
 * ②히어로가 세로로 길어져 아래 리포트 영역이 접히는 것을 감수할 만한가.
 */
export const B_Bars = () => (
  <>
    <AdminHeroMetrics metrics={buildHeroPerformance(report({ ...REAL_SHAPE.delivery, countByMethod: [] }))} />
    <MethodBars delivery={REAL_SHAPE.delivery} />
  </>
);

export const B_Bars_EvenDistribution = () => (
  <>
    <AdminHeroMetrics metrics={buildHeroPerformance(report({ ...EVEN_SHAPE.delivery, countByMethod: [] }))} />
    <MethodBars delivery={EVEN_SHAPE.delivery} />
  </>
);
