import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "./MarkdownMessage";

describe("MarkdownMessage", () => {
  it("마크다운을 HTML 요소로 렌더(헤딩·불릿·볼드)", () => {
    render(<MarkdownMessage content={"## 제목\n\n- 항목1\n- 항목2\n\n**굵게**"} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("제목");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("굵게").tagName.toLowerCase()).toBe("strong");
  });
});
