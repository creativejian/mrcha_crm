import { describe, expect, it } from "vitest";

import { buildHeroPerformance } from "./admin-hero";
import type { AdminReport } from "./reports";

// 히어로 칩 조립(순수). 구매방식별 내역은 칩이 아니라 아래 바 목록이 담당하므로
// (2026-08-04 유슨생 실물 판단) 여기서는 값·전월 대비 표기만 잠근다.

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
  it("전월 대비는 증감 부호를 붙이고 동일하면 ±0(증가만 up)", () => {
    const [up] = buildHeroPerformance(delivery({ count: 32, prevCount: 26 }));
    expect(up!.value).toBe("32");
    expect(up!.delta).toBe("+6");
    expect(up!.up).toBe(true);

    const [same] = buildHeroPerformance(delivery({ count: 5, prevCount: 5 }));
    expect(same!.delta).toBe("±0");
    expect(same!.up).toBe(false);

    // 감소는 up=false — 초록으로 칠하면 좋은 소식처럼 읽힌다(dashboard.css 주석과 한 쌍).
    const [down] = buildHeroPerformance(delivery({ count: 3, prevCount: 9 }));
    expect(down!.delta).toBe("-6");
    expect(down!.up).toBe(false);
  });

  it("금액은 천 단위 구분 — 억 단위에서 자릿수를 눈으로 세지 않게", () => {
    const [, lease] = buildHeroPerformance(delivery({ leaseAmount: 1_284_000_000 }));
    expect(lease!.value).toBe("1,284,000,000");
    expect(lease!.unit).toBe("원");
  });
});
