import { test, expect } from "bun:test";

import { buildChunkContent, contentHash, type CorpusRow } from "./assistant-corpus";

test("buildChunkContent: 소스타입별 라벨 + 고객명 + 본문", () => {
  const row: CorpusRow = { sourceType: "memo", sourceId: "s1", customerId: "c1", customerName: "김민준", text: "GLC 재고 문의" };
  expect(buildChunkContent(row)).toBe("고객 김민준 상담메모: GLC 재고 문의");
});

test("buildChunkContent: need_review_note 라벨", () => {
  const row: CorpusRow = { sourceType: "need_review_note", sourceId: "c1", customerId: "c1", customerName: "박서연", text: "보증금 30% 검토" };
  expect(buildChunkContent(row)).toBe("고객 박서연 심사메모: 보증금 30% 검토");
});

test("contentHash: 같은 문자열 같은 해시, 다르면 다름", () => {
  expect(contentHash("a")).toBe(contentHash("a"));
  expect(contentHash("a")).not.toBe(contentHash("b"));
});
