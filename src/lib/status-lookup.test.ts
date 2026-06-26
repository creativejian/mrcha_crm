import { test, expect } from "bun:test";

import { checkStatusSelection } from "./status-lookup";

const groups = new Set(["신규", "계약완료"]);
const statusParent = new Map<string, string>([
  ["상담접수", "신규"],
  ["출고완료", "계약완료"],
]);

test("변경 없음(둘 다 미입력) → null", () => {
  expect(checkStatusSelection(groups, statusParent, {})).toBeNull();
});

test("유효한 group+status → null", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "계약완료", status: "출고완료" })).toBeNull();
});

test("group 단독 변경(유효) → null(종속 스킵)", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "신규" })).toBeNull();
});

test("status 단독 변경(유효) → null(종속 스킵)", () => {
  expect(checkStatusSelection(groups, statusParent, { status: "출고완료" })).toBeNull();
});

test("없는 1차 group → 에러", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "없음", status: "출고완료" })).toContain("1차");
});

test("없는 2차 status → 에러", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "계약완료", status: "없음" })).toContain("2차");
});

test("종속 불일치(group ≠ status의 부모) → 에러", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: "신규", status: "출고완료" })).toContain("속하지 않");
});

test("둘 다 null로 클리어 → null", () => {
  expect(checkStatusSelection(groups, statusParent, { statusGroup: null, status: null })).toBeNull();
});
