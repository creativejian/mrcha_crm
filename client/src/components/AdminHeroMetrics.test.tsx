import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeliveryMethodBars } from "./AdminHeroMetrics";

// 출고 대수 구매방식별 바 목록(2026-08-04 유슨생 실물 판단으로 확정된 표기 형태).
// 잠그는 것은 **비율의 기준**과 **0건 처리** — 둘 다 틀려도 화면은 그럴듯해 보인다.

describe("DeliveryMethodBars", () => {
  it("0건이면 아무것도 그리지 않는다 — 빈 목록 자리가 남으면 집계 오류로 읽힌다", () => {
    const { container } = render(<DeliveryMethodBars rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("막대 폭은 최댓값 기준 상대값 — 전체 대수가 아니다(쏠린 분포에서 뒤가 안 보인다)", () => {
    const { container } = render(
      <DeliveryMethodBars
        rows={[
          { method: "운용리스", count: 27 },
          { method: "장기렌트", count: 2 },
        ]}
      />,
    );
    const fills = container.querySelectorAll<HTMLElement>(".bar-fill");
    // 첫 행은 최댓값이라 항상 100%(서버가 많은 순으로 보낸다).
    expect(fills[0]!.style.width).toBe("100%");
    // 2/27 ≈ 7.4% — 32(전체)로 나눴다면 6.25%가 된다. 기준이 바뀌면 이 값이 어긋난다.
    expect(fills[1]!.style.width).toBe(`${(2 / 27) * 100}%`);
  });

  it("이름과 건수를 그대로 보여준다(순서는 서버가 정한 대로)", () => {
    render(
      <DeliveryMethodBars
        rows={[
          { method: "운용리스", count: 27 },
          { method: "미지정", count: 1 },
        ]}
      />,
    );
    expect(screen.getByText("운용리스")).toBeInTheDocument();
    expect(screen.getByText("27")).toBeInTheDocument();
    // 구매방식을 모르는 건도 숨기지 않는다 — 숨기면 막대 합과 위 칩 숫자가 어긋난다.
    expect(screen.getByText("미지정")).toBeInTheDocument();
  });
});
