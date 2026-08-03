import { describe, expect, it } from "vitest";

import { moveGroupToKey, moveItem } from "./reorder";

it("from→to 이동", () => {
  expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
});

it("동일/범위밖이면 원본", () => {
  expect(moveItem([1, 2], 1, 1)).toEqual([1, 2]);
  expect(moveItem([1, 2], 5, 0)).toEqual([1, 2]);
});

// 그룹(서브라인) 블록 드래그 이동 — 이사님 요청(2026-08-03): 트림 하나씩이 아니라 그룹째
// 옮긴다(목록 보기 '선택'). 결과 배열을 reorderTrims(전체 id 1..N 재부여)에 그대로 넘기는 전제.
describe("moveGroupToKey", () => {
  const mk = (trimName: string) => ({ trimName });
  const A1 = mk("27년형 가솔린 1.0 - 스마트");
  const A2 = mk("27년형 가솔린 1.0 - 디 에센셜");
  const B1 = mk("27년형 가솔린 터보 1.0 - 인스퍼레이션");
  const C1 = mk("26년형 가솔린 1.0 - 스마트");

  it("아래 그룹 위치로 — 블록 통째 이동, 그룹 내 순서 유지", () => {
    expect(moveGroupToKey([A1, A2, B1, C1], "27년형 가솔린 1.0", "27년형 가솔린 터보 1.0")).toEqual([B1, A1, A2, C1]);
  });

  it("위 그룹 위치로 — 두 칸 건너뛰기도 한 번에", () => {
    expect(moveGroupToKey([A1, A2, B1, C1], "26년형 가솔린 1.0", "27년형 가솔린 1.0")).toEqual([C1, A1, A2, B1]);
  });

  it("같은 키·없는 키는 원본 참조 그대로(no-op 판별)", () => {
    const list = [A1, B1];
    expect(moveGroupToKey(list, "27년형 가솔린 1.0", "27년형 가솔린 1.0")).toBe(list);
    expect(moveGroupToKey(list, "없는 그룹", "27년형 가솔린 1.0")).toBe(list);
    expect(moveGroupToKey(list, "27년형 가솔린 1.0", "없는 그룹")).toBe(list);
  });

  it("흩어진 그룹(비연속)은 첫 등장 위치 기준으로 한 덩어리로 모인다", () => {
    // A1 · B1 · A2 순서(그룹 A가 B를 사이에 두고 흩어짐) → A 이동 시 A1+A2가 모여 움직인다.
    expect(moveGroupToKey([A1, B1, A2], "27년형 가솔린 1.0", "27년형 가솔린 터보 1.0")).toEqual([B1, A1, A2]);
  });

  it("' - ' 없는 트림명은 '기타' 그룹으로 움직인다", () => {
    const x = mk("단일 트림명");
    expect(moveGroupToKey([x, A1], "기타", "27년형 가솔린 1.0")).toEqual([A1, x]);
  });
});
