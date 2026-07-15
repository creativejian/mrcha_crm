import { describe, expect, test } from "vitest";

import { KNOWLEDGE_BLOCK_TO_SLUG, knowledgeCategoryLabel } from "./knowledge-categories";

describe("knowledge-categories (앱 knowledge_categories.dart 미러)", () => {
  test("slug → 한글 라벨 매핑", () => {
    expect(knowledgeCategoryLabel("identity-role")).toBe("차선생의 정체성과 역할 기준");
    expect(knowledgeCategoryLabel("lease")).toBe("리스");
    expect(knowledgeCategoryLabel("purchase-risk")).toBe("자동차 구매 피해와 리스크 방어");
  });

  test("미등록 slug는 그대로 반환(앱 label() 동작)", () => {
    expect(knowledgeCategoryLabel("brand-new-slug")).toBe("brand-new-slug");
  });

  test("블록 1~12 slug 체계", () => {
    expect(KNOWLEDGE_BLOCK_TO_SLUG[1]).toBe("identity-role");
    expect(KNOWLEDGE_BLOCK_TO_SLUG[12]).toBe("purchase-risk");
    expect(Object.keys(KNOWLEDGE_BLOCK_TO_SLUG)).toHaveLength(12);
  });
});
