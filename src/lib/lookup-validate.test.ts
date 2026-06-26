import { test, expect, describe } from "bun:test";

import { validateLookupValue, validateStatusSelection } from "./lookup-validate";

describe("validateLookupValue", () => {
  test("null 통과", () => expect(validateLookupValue("chance", null)).toBeNull());
  test("유효 chance 통과", () => expect(validateLookupValue("chance", "높음")).toBeNull());
  test("무효 chance 거부", () => expect(validateLookupValue("chance", "외계인")).toContain("chance"));
  test("유효 task_category 통과", () => expect(validateLookupValue("task_category", "견적")).toBeNull());
  test("무효 task_category 거부", () => expect(validateLookupValue("task_category", "없는분류")).toContain("task_category"));
  test("유효 source 통과", () => expect(validateLookupValue("source", "대표전화")).toBeNull());
  test("유효 doc_type 통과", () => expect(validateLookupValue("doc_type", "사업자등록증")).toBeNull());
  test("유효 schedule_type 통과", () => expect(validateLookupValue("schedule_type", "재연락")).toBeNull());
  test("알 수 없는 category 통과(방어)", () => expect(validateLookupValue("unknown", "x")).toBeNull());
});

describe("validateStatusSelection", () => {
  test("유효 종속 통과", () => expect(validateStatusSelection({ statusGroup: "계약완료", status: "출고완료" })).toBeNull());
  test("종속 위반 거부", () => expect(validateStatusSelection({ statusGroup: "신규", status: "출고완료" })).toContain("속하지 않"));
  test("다부모 통과(추후재컨택=관리중)", () => expect(validateStatusSelection({ statusGroup: "관리중", status: "추후재컨택" })).toBeNull());
  test("다부모 통과(추후재컨택=상담완료)", () => expect(validateStatusSelection({ statusGroup: "상담완료", status: "추후재컨택" })).toBeNull());
});
