import { test, expect } from "bun:test";

import { chunk, idsToSoftDelete, projectRow } from "./sync-diff";

test("idsToSoftDelete: master에 없는 catalog 활성 id만 반환", () => {
  expect(idsToSoftDelete(new Set([1, 2]), [1, 2, 3, 4])).toEqual([3, 4]);
});

test("idsToSoftDelete: 전부 master에 있으면 빈 배열", () => {
  expect(idsToSoftDelete(new Set([1, 2, 3]), [1, 2, 3])).toEqual([]);
});

test("idsToSoftDelete: catalog 활성이 비면 빈 배열", () => {
  expect(idsToSoftDelete(new Set([1, 2]), [])).toEqual([]);
});

test("chunk: size 단위로 분할", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([
    [1, 2],
    [3, 4],
    [5],
  ]);
});

test("chunk: 빈 배열은 빈 결과", () => {
  expect(chunk([], 3)).toEqual([]);
});

test("chunk: size<1이면 에러", () => {
  expect(() => chunk([1], 0)).toThrow();
});

test("projectRow: snake_case row를 화이트리스트 camelCase로 투영", () => {
  const row = { brand_id: 7, name: "X", extra: "drop" };
  expect(
    projectRow(row, [
      { prop: "brandId", col: "brand_id" },
      { prop: "name", col: "name" },
    ]),
  ).toEqual({ brandId: 7, name: "X" });
});

test("projectRow: 없는 컬럼은 undefined로", () => {
  expect(projectRow({}, [{ prop: "note", col: "note" }])).toEqual({ note: undefined });
});
