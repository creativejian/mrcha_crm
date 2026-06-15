import { describe, expect, it } from "vitest";

import { optionTotal, resolveSelection, type OptionLite, type OptionRelation } from "./option-selection";

const opts: OptionLite[] = [
  { id: 1, type: "basic", price: null },
  { id: 2, type: "tuning", price: 1500000 },
  { id: 3, type: "tuning", price: 2000000 },
  { id: 4, type: "tuning", price: null },
];

describe("resolveSelection", () => {
  it("관계 없으면 단순 토글 on/off", () => {
    expect([...resolveSelection([], new Set(), 2, true)]).toEqual([2]);
    expect([...resolveSelection([], new Set([2, 3]), 2, false)]).toEqual([3]);
  });

  it("excludes: 켤 때 배타 옵션 자동 해제 (대칭)", () => {
    const rels: OptionRelation[] = [{ optionId: 2, relatedOptionId: 3, type: "excludes" }];
    // 데이터가 2→3 단방향이어도, 3을 켜면 2가 빠져야 한다
    expect([...resolveSelection(rels, new Set([2]), 3, true)]).toEqual([3]);
    expect([...resolveSelection(rels, new Set([3]), 2, true)]).toEqual([2]);
  });

  it("includes: 켤 때 포함 옵션 자동 추가 (단방향, 한 단계)", () => {
    const rels: OptionRelation[] = [
      { optionId: 2, relatedOptionId: 3, type: "includes" },
      { optionId: 3, relatedOptionId: 4, type: "includes" },
    ];
    // 2 켜면 3까지만(4는 연쇄 안 함)
    expect([...resolveSelection(rels, new Set(), 2, true)].sort()).toEqual([2, 3]);
  });

  it("끌 때는 연쇄 해제 안 함", () => {
    const rels: OptionRelation[] = [{ optionId: 2, relatedOptionId: 3, type: "includes" }];
    expect([...resolveSelection(rels, new Set([2, 3]), 2, false)]).toEqual([3]);
  });

  it("입력 Set을 변경하지 않는다", () => {
    const selected = new Set([2]);
    resolveSelection([], selected, 3, true);
    expect([...selected]).toEqual([2]);
  });
});

describe("optionTotal", () => {
  it("tuning만 합산, basic 제외, price null은 0", () => {
    expect(optionTotal(opts, new Set([1, 2, 4]))).toBe(1500000); // 1=basic 제외, 4=null→0
    expect(optionTotal(opts, new Set([2, 3]))).toBe(3500000);
    expect(optionTotal(opts, new Set())).toBe(0);
  });
});
