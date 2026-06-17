import { describe, expect, it } from "vitest";

import { groupTrimsBySubline, trimGrade, trimSubline } from "./trim-grouping";

describe("trimSubline / trimGrade", () => {
  it("국산차 '서브라인 - 등급'을 분리한다", () => {
    expect(trimSubline("26년형 가솔린 1.0 - 스마트")).toBe("26년형 가솔린 1.0");
    expect(trimGrade("26년형 가솔린 1.0 - 스마트")).toBe("스마트");
  });

  it("괄호(밴 등)가 포함된 서브라인도 첫 ' - '에서 분리한다", () => {
    expect(trimSubline("26년형 가솔린 터보 1.0 (밴) - 스마트 초이스")).toBe("26년형 가솔린 터보 1.0 (밴)");
    expect(trimGrade("26년형 가솔린 터보 1.0 (밴) - 스마트 초이스")).toBe("스마트 초이스");
  });

  it("등급에 하이픈이 더 있어도 첫 ' - '만 기준으로 한다", () => {
    expect(trimSubline("라인 - 등급 - 추가")).toBe("라인");
    expect(trimGrade("라인 - 등급 - 추가")).toBe("등급 - 추가");
  });

  it("' - '가 없으면 서브라인은 '기타', 등급은 원문이다", () => {
    expect(trimSubline("S 500 4M Long")).toBe("기타");
    expect(trimGrade("S 500 4M Long")).toBe("S 500 4M Long");
  });
});

describe("groupTrimsBySubline", () => {
  const mk = (trimName: string) => ({ trimName });

  it("서브라인별로 첫 등장 순서를 유지하며 묶는다", () => {
    const groups = groupTrimsBySubline([
      mk("26년형 가솔린 1.0 - 스마트"),
      mk("26년형 가솔린 1.0 - 디 에센셜"),
      mk("26년형 가솔린 터보 1.0 - 스마트 (캐스퍼액티브I)"),
      mk("26년형 가솔린 1.0 (밴) - 스마트"),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "26년형 가솔린 1.0",
      "26년형 가솔린 터보 1.0",
      "26년형 가솔린 1.0 (밴)",
    ]);
    expect(groups[0].trims).toHaveLength(2);
    expect(groups[1].trims).toHaveLength(1);
  });

  it("같은 서브라인이 떨어져 있어도 같은 그룹으로 모은다", () => {
    const groups = groupTrimsBySubline([mk("A - 1"), mk("B - 1"), mk("A - 2")]);
    expect(groups.map((g) => g.key)).toEqual(["A", "B"]);
    expect(groups[0].trims).toHaveLength(2);
  });

  it("' - '가 없는 트림은 '기타' 그룹으로 모은다", () => {
    const groups = groupTrimsBySubline([mk("S 500"), mk("A - 1")]);
    expect(groups[0].key).toBe("기타");
    expect(groups[1].key).toBe("A");
  });
});
