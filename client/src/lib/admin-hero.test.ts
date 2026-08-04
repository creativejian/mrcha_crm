import { describe, expect, it } from "vitest";

import { buildHeroPerformance } from "./admin-hero";
import type { AdminReport } from "./reports";

// 히어로 칩 조립(순수) — 구매방식별 소계 문구가 이사님 확정(spec 2026-08-03 §1)대로 나오는지.
// 화면 형태 비교는 Ladle 스토리(AdminHeroMetrics.stories.tsx), 여기는 **문자열 계약**만 잠근다.

const delivery = (patch: Partial<AdminReport["delivery"]>): AdminReport =>
  ({
    delivery: {
      count: 0,
      prevCount: 0,
      leaseAmount: 0,
      prevLeaseAmount: 0,
      rentAmount: 0,
      prevRentAmount: 0,
      countByMethod: [],
      ...patch,
    },
  }) as AdminReport;

describe("buildHeroPerformance", () => {
  it("전체 출고 칩에 구매방식별 소계를 붙인다(서버 순서 그대로 · 중점 구분)", () => {
    const [total] = buildHeroPerformance(
      delivery({
        count: 32,
        countByMethod: [
          { method: "운용리스", count: 27 },
          { method: "장기렌트", count: 2 },
          { method: "할부", count: 2 },
        ],
      }),
    );
    // 정렬은 서버가 소유한다(많은 순·동수는 이름) — 클라가 다시 정렬하면 두 규칙이 갈라진다.
    expect(total!.sub).toBe("운용리스 27 · 장기렌트 2 · 할부 2");
  });

  it("소계가 없으면 줄 자체를 만들지 않는다 — 빈 문자열이 아니라 undefined", () => {
    const [total] = buildHeroPerformance(delivery({ count: 0 }));
    expect(total!.sub).toBeUndefined();
  });

  it("실적 금액 칩에는 소계가 붙지 않는다(대수만의 내역이다)", () => {
    const [, lease, rent] = buildHeroPerformance(
      delivery({ count: 1, leaseAmount: 100, countByMethod: [{ method: "운용리스", count: 1 }] }),
    );
    expect(lease!.sub).toBeUndefined();
    expect(rent!.sub).toBeUndefined();
  });

  it("전월 대비는 증감 부호를 붙이고 동일하면 ±0", () => {
    const [total] = buildHeroPerformance(delivery({ count: 32, prevCount: 26 }));
    expect(total!.delta).toBe("+6");
    expect(total!.up).toBe(true);
    const [same] = buildHeroPerformance(delivery({ count: 5, prevCount: 5 }));
    expect(same!.delta).toBe("±0");
    expect(same!.up).toBe(false);
  });
});
