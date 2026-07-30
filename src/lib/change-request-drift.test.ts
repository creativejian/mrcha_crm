import { expect, test } from "bun:test";

import { detectSnapshotDrift } from "./change-request-drift";

test("같으면 빈 배열", () => {
  expect(detectSnapshotDrift({ price: 100, status: "판매중" }, { price: 100, status: "판매중" })).toEqual([]);
});

test("값이 다른 키만 골라낸다", () => {
  expect(detectSnapshotDrift({ price: 100, status: "판매중" }, { price: 200, status: "판매중" })).toEqual(["price"]);
});

test("snapshot에 있는 키만 본다 — current의 여분 키는 무시", () => {
  expect(detectSnapshotDrift({ price: 100 }, { price: 100, extra: "x" })).toEqual([]);
});

test("null과 undefined는 동치 — '값 없음'의 두 표기가 드리프트로 오탐되지 않는다", () => {
  expect(detectSnapshotDrift({ driveSystem: null }, {})).toEqual([]);
  expect(detectSnapshotDrift({ driveSystem: undefined }, { driveSystem: null })).toEqual([]);
});

test("null → 실값 변화는 드리프트다", () => {
  expect(detectSnapshotDrift({ driveSystem: null }, { driveSystem: "AWD" })).toEqual(["driveSystem"]);
});

test("타입이 다르면 값이 같아 보여도 드리프트다 — 정규화는 호출측 책임(fail-closed)", () => {
  expect(detectSnapshotDrift({ price: 100 }, { price: "100" })).toEqual(["price"]);
});
