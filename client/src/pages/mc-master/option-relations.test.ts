import { describe, expect, it } from "vitest";

import type { OptionRelation } from "@/lib/option-selection";
import { excludesText, includesText } from "./option-relations";

const rels: OptionRelation[] = [
  { optionId: 1, relatedOptionId: 2, type: "excludes" },
  { optionId: 3, relatedOptionId: 1, type: "excludes" },
  { optionId: 1, relatedOptionId: 4, type: "includes" },
];
const names = new Map([
  [1, "A"],
  [2, "B"],
  [3, "C"],
  [4, "D"],
]);

describe("excludesText", () => {
  it("대칭으로 배타 상대 이름을 나열", () => {
    expect(excludesText(rels, 1, names)).toBe("B, C와 중복 선택 불가");
    expect(excludesText(rels, 2, names)).toBe("A와 중복 선택 불가");
  });
  it("배타 관계 없으면 null", () => {
    expect(excludesText(rels, 4, names)).toBeNull();
  });
});

describe("includesText", () => {
  it("단방향 자동 선택 대상만", () => {
    expect(includesText(rels, 1, names)).toBe("D 자동 선택");
    expect(includesText(rels, 4, names)).toBeNull();
  });
});
