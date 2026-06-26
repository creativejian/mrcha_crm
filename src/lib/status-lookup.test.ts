import { test, expect } from "bun:test";

import { buildStatusMaps, checkStatusSelection } from "./status-lookup";

// 다부모: "추후재컨택"이 관리중·상담완료 둘 다에 속함.
const { activeGroups, statusParents } = buildStatusMaps({
  신규: ["상담접수", "지속적부재"],
  관리중: ["추후재컨택"],
  상담완료: ["추후재컨택"],
  계약완료: ["출고완료"],
});

test("변경 없음(둘 다 미입력) → null", () => {
  expect(checkStatusSelection(activeGroups, statusParents, {})).toBeNull();
});

test("유효한 group+status → null", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "계약완료", status: "출고완료" })).toBeNull();
});

test("group 단독 변경(유효) → null(종속 스킵)", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "신규" })).toBeNull();
});

test("status 단독 변경(유효) → null(종속 스킵)", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { status: "출고완료" })).toBeNull();
});

test("없는 1차 group → 에러", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "없음", status: "출고완료" })).toContain("1차");
});

test("없는 2차 status → 에러", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "계약완료", status: "없음" })).toContain("2차");
});

test("종속 불일치(group ≠ status의 부모) → 에러", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "신규", status: "출고완료" })).toContain("속하지 않");
});

test("둘 다 null로 클리어 → null", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: null, status: null })).toBeNull();
});

// 다부모 종속: 같은 2차가 여러 1차에 속하면 각 1차 모두 허용.
test("다부모 - 관리중+추후재컨택 → null", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "관리중", status: "추후재컨택" })).toBeNull();
});

test("다부모 - 상담완료+추후재컨택 → null", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "상담완료", status: "추후재컨택" })).toBeNull();
});

test("다부모 - 신규엔 추후재컨택 불속 → 에러", () => {
  expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "신규", status: "추후재컨택" })).toContain("속하지 않");
});
