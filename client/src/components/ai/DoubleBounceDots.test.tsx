import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DoubleBounceDots } from "./DoubleBounceDots";

describe("DoubleBounceDots", () => {
  it("두 개의 bounce 닷을 렌더", () => {
    const { container } = render(<DoubleBounceDots />);
    expect(container.querySelectorAll(".db-dot")).toHaveLength(2);
  });
});
