import { describe, expect, it } from "vitest";

import { optionBadgeState } from "./option-badge";

describe("optionBadgeState", () => {
  it("옵션이 1개 이상이면 has", () => {
    expect(optionBadgeState(2, 5, false)).toBe("has");
    expect(optionBadgeState(1, 0, false)).toBe("has");
    expect(optionBadgeState(0, 3, true)).toBe("has"); // 옵션 우선
  });

  it("옵션 0 + 무옵션 확정이면 confirmed-none", () => {
    expect(optionBadgeState(0, 0, true)).toBe("confirmed-none");
  });

  it("옵션 0 + 미확정이면 undecided", () => {
    expect(optionBadgeState(0, 0, false)).toBe("undecided");
  });
});
