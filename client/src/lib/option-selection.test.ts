import { describe, expect, it } from "vitest";

import {
  disabledOptionIds,
  excludeGroups,
  excludePartners,
  optionTotal,
  resolveSelection,
  type OptionLite,
  type OptionRelation,
} from "./option-selection";

const opts: OptionLite[] = [
  { id: 1, type: "basic", price: 500000 },
  { id: 2, type: "tuning", price: 1500000 },
  { id: 3, type: "tuning", price: 2000000 },
  { id: 4, type: "tuning", price: null },
];

describe("resolveSelection", () => {
  it("관계 없으면 단순 토글 on/off", () => {
    expect([...resolveSelection([], new Set(), 2, true)]).toEqual([2]);
    expect([...resolveSelection([], new Set([2, 3]), 2, false)]).toEqual([3]);
  });

  it("excludes는 resolveSelection에서 처리하지 않는다(비활성화로 대체)", () => {
    const rels: OptionRelation[] = [{ optionId: 2, relatedOptionId: 3, type: "excludes" }];
    // 충돌은 UI 비활성화로 막으므로 resolveSelection은 자동해제하지 않는다
    expect([...resolveSelection(rels, new Set([2]), 3, true)].sort()).toEqual([2, 3]);
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
  it("선택된 모든 옵션 합산(basic 포함), price null은 0", () => {
    expect(optionTotal(opts, new Set([1, 2, 4]))).toBe(2000000); // basic 50만 + tuning 150만 + null 0
    expect(optionTotal(opts, new Set([2, 3]))).toBe(3500000);
    expect(optionTotal(opts, new Set())).toBe(0);
  });
});

describe("disabledOptionIds", () => {
  const rels: OptionRelation[] = [{ optionId: 2, relatedOptionId: 3, type: "excludes" }];
  it("선택된 옵션의 배타 상대가 비활성화 (대칭)", () => {
    expect([...disabledOptionIds(rels, new Set([2]))]).toEqual([3]);
    expect([...disabledOptionIds(rels, new Set([3]))]).toEqual([2]);
  });
  it("둘 다 미선택이면 비활성화 없음", () => {
    expect([...disabledOptionIds(rels, new Set())]).toEqual([]);
  });
});

describe("excludeGroups", () => {
  const options: OptionLite[] = [
    { id: 1, type: "basic", price: null },
    { id: 2, type: "tuning", price: 100 },
    { id: 3, type: "tuning", price: 200 },
    { id: 4, type: "tuning", price: 300 },
    { id: 5, type: "tuning", price: 400 },
  ];
  it("같은 배타군은 같은 그룹번호, 무관 옵션은 맵에 없음", () => {
    const rels: OptionRelation[] = [
      { optionId: 2, relatedOptionId: 3, type: "excludes" },
      { optionId: 4, relatedOptionId: 5, type: "excludes" },
    ];
    const g = excludeGroups(options, rels);
    expect(g.get(2)).toBe(g.get(3));
    expect(g.get(4)).toBe(g.get(5));
    expect(g.get(2)).not.toBe(g.get(4));
    expect(g.has(1)).toBe(false);
    expect(g.get(2)).toBe(0);
    expect(g.get(4)).toBe(1);
  });
  it("연쇄 배타(2-3, 3-4)는 한 그룹", () => {
    const rels: OptionRelation[] = [
      { optionId: 2, relatedOptionId: 3, type: "excludes" },
      { optionId: 3, relatedOptionId: 4, type: "excludes" },
    ];
    const g = excludeGroups(options, rels);
    expect(g.get(2)).toBe(g.get(3));
    expect(g.get(3)).toBe(g.get(4));
  });
});

describe("excludePartners", () => {
  it("배타 상대 목록 (대칭, includes 제외)", () => {
    const rels: OptionRelation[] = [
      { optionId: 2, relatedOptionId: 3, type: "excludes" },
      { optionId: 2, relatedOptionId: 4, type: "excludes" },
      { optionId: 5, relatedOptionId: 6, type: "includes" },
    ];
    expect(excludePartners(rels, 2).sort()).toEqual([3, 4]);
    expect(excludePartners(rels, 3)).toEqual([2]);
    expect(excludePartners(rels, 5)).toEqual([]);
  });
});
