import { describe, expect, it } from "vitest";
import { DEFAULT_QUOTE_GUIDANCE, normalizeQuoteGuidance, regionFromResidence, sanitizeQuoteGuidance } from "./quote-guidance";

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
  it("keyPoint(legacy)와 keyPoints 동시 존재 시 keyPoints 우선 — 빈 배열이어도 legacy 무시(서버 guidanceOf와 동일 의미론)", () => {
    const base = { deliveryComment: "a", stockNotice: "b", expectedDelivery: "c", customerRegion: "d", recommendReason: "r", services: [] };
    expect(normalizeQuoteGuidance({ ...base, keyPoint: "옛값", keyPoints: ["신값"] })?.keyPoints).toEqual(["신값"]);
    expect(normalizeQuoteGuidance({ ...base, keyPoint: "옛값", keyPoints: [] })?.keyPoints).toEqual([]);
  });
});

describe("sanitizeQuoteGuidance", () => {
  it("빈/공백 keyPoints·services를 제거하고 trim한다", () => {
    const g = sanitizeQuoteGuidance({ ...DEFAULT_QUOTE_GUIDANCE, keyPoints: [" a ", "", "  "], services: ["s1 ", ""] });
    expect(g.keyPoints).toEqual(["a"]);
    expect(g.services).toEqual(["s1"]);
  });
});

describe("regionFromResidence", () => {
  it("거주지 문자열에서 지역 옵션을 파생한다", () => {
    expect(regionFromResidence("인천광역시")).toBe("인천");
    expect(regionFromResidence("서울특별시 강남구")).toBe("서울");
    expect(regionFromResidence("경기도 성남시")).toBe("경기");
  });
  it("옵션에 없는 지역은 기타", () => {
    expect(regionFromResidence("울산광역시")).toBe("기타");
  });
  it("미입력/placeholder는 확인 필요", () => {
    expect(regionFromResidence(null)).toBe("확인 필요");
    expect(regionFromResidence("")).toBe("확인 필요");
    expect(regionFromResidence("확인 필요")).toBe("확인 필요");
    expect(regionFromResidence("미정")).toBe("확인 필요");
  });
});
