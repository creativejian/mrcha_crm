import { describe, expect, it } from "vitest";
import { DEFAULT_QUOTE_GUIDANCE, normalizeQuoteGuidance, sanitizeQuoteGuidance } from "./quote-guidance";

describe("normalizeQuoteGuidance", () => {
  it("legacy keyPoint(단일 문자열)를 keyPoints 배열로 변환한다", () => {
    const g = normalizeQuoteGuidance({ deliveryComment: "a", stockNotice: "b", expectedDelivery: "c", customerRegion: "d", keyPoint: "핵심", recommendReason: "r", services: ["s"] });
    expect(g?.keyPoints).toEqual(["핵심"]);
  });
  it("keyPoints가 이미 있으면 그대로, 빈 legacy keyPoint는 빈 배열", () => {
    expect(normalizeQuoteGuidance({ ...DEFAULT_QUOTE_GUIDANCE, keyPoints: ["a", "b"] })?.keyPoints).toEqual(["a", "b"]);
    expect(normalizeQuoteGuidance({ deliveryComment: "a", stockNotice: "b", expectedDelivery: "c", customerRegion: "d", keyPoint: "", recommendReason: "", services: [] })?.keyPoints).toEqual([]);
  });
  it("null/undefined는 null", () => {
    expect(normalizeQuoteGuidance(null)).toBeNull();
    expect(normalizeQuoteGuidance(undefined)).toBeNull();
  });
});

describe("sanitizeQuoteGuidance", () => {
  it("빈/공백 keyPoints·services를 제거하고 trim한다", () => {
    const g = sanitizeQuoteGuidance({ ...DEFAULT_QUOTE_GUIDANCE, keyPoints: [" a ", "", "  "], services: ["s1 ", ""] });
    expect(g.keyPoints).toEqual(["a"]);
    expect(g.services).toEqual(["s1"]);
  });
});
