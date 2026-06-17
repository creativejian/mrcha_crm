import { expect, it } from "vitest";

import { moveItem } from "./reorder";

it("from→to 이동", () => {
  expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
});

it("동일/범위밖이면 원본", () => {
  expect(moveItem([1, 2], 1, 1)).toEqual([1, 2]);
  expect(moveItem([1, 2], 5, 0)).toEqual([1, 2]);
});
