import { expect, it } from "vitest";

import { MODEL_CATEGORIES, VEHICLE_STATUSES, statusBadgeTone, statusLabel } from "./vehicle-taxonomy";

it("status enum 5종", () => {
  expect(VEHICLE_STATUSES).toEqual(["판매중", "출시예정", "사전예약", "단종", "블라인드"]);
});

it("표시 라벨: 사전예약→예약판매, 블라인드→숨김", () => {
  expect(statusLabel("판매중")).toBe("판매중");
  expect(statusLabel("사전예약")).toBe("예약판매");
  expect(statusLabel("블라인드")).toBe("숨김");
});

it("배지 톤 매핑", () => {
  expect(statusBadgeTone("판매중")).toBe("green");
  expect(statusBadgeTone("단종")).toBe("gray");
});

it("카테고리 옵션 비어있지 않음", () => {
  expect(MODEL_CATEGORIES.length).toBeGreaterThan(0);
  expect(MODEL_CATEGORIES).toContain("중형 세단");
});
