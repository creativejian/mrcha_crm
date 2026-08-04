import "@/index.css";
import { AdminHeroMetrics, DeliveryMethodBars } from "./AdminHeroMetrics";
import { buildHeroPerformance } from "@/lib/admin-hero";
import type { AdminReport } from "@/lib/reports";

// 경영 리포트 히어로 + 출고 대수 구매방식별 바(2026-08-04).
// 실 DB에는 계약 확정일이 아직 0건이라 실화면은 0으로만 뜬다 — 표기 형태를 눈으로 고를 때
// mock을 공유 master에 넣는 대신(이사님 화면에 가짜 실적이 뜨고 잔재 위험도 있다) 여기서 렌더했다.
// 후보 2안(칩 안 소계 한 줄 / 바 목록)을 실물로 비교해 **바 목록으로 확정**(유슨생).
// 남겨두는 이유 = 실 데이터가 쌓이기 전까지 이 화면을 볼 수 있는 유일한 경로.
//
// 보는 법: `bun run dev:ladle` → CRM/Admin Hero

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

const Hero = ({ data }: { data: AdminReport }) => (
  <section className="card advisor-performance admin-performance">
    <AdminHeroMetrics metrics={buildHeroPerformance(data)} />
    <DeliveryMethodBars rows={data.delivery.countByMethod} />
  </section>
);

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

/** 가정: 구매방식이 고르게 퍼진 미래 + 구매방식 미상("미지정")이 섞인 경우. */
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

/** 실측 분포 — 한 방식에 쏠려도 뒤쪽 건수가 숫자로 읽히는지가 이 형태의 관건이었다. */
export const Default = () => <Hero data={REAL_SHAPE} />;

/** 구매방식이 5종으로 늘고 고르게 퍼진 경우 — 세로로 길어지는 정도를 본다. */
export const EvenDistribution = () => <Hero data={EVEN_SHAPE} />;

/** 0건(현재 실 DB 상태) — 바 목록이 통째로 사라져 기존 히어로와 같아야 한다. */
export const Empty = () => <Hero data={report({})} />;
