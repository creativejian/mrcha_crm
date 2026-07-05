import { test, expect } from "bun:test";

import { buildChunkContent, buildQuoteChunkText, contentHash, type CorpusRow, type QuoteChunkQuote, type QuoteChunkScenario } from "./assistant-corpus";

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

const FULL_QUOTE: QuoteChunkQuote = {
  quoteCode: "QT-2607-0001",
  brandName: "BMW",
  modelName: "320i",
  trimName: "320i M Sport",
  appStatus: "sent",
  sentAt: new Date("2026-07-05T00:30:00Z"), // KST 09:30
  guidance: {
    recommendReason: "재고 확보 차량\n조건 우수",
    keyPoints: ["즉시 출고", "보증 연장"],
    services: ["썬팅: 후퍼옵틱"],
  },
};
const FULL_SC: QuoteChunkScenario = { purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2350000", lender: "하나캐피탈" };

test("buildQuoteChunkText: 풀필드 — 헤더+대표 시나리오+발송(KST)+guidance", () => {
  expect(buildQuoteChunkText(FULL_QUOTE, FULL_SC)).toBe(
    "QT-2607-0001 · BMW 320i M Sport · 운용리스 · 60개월 · 월 2,350,000원 · 하나캐피탈 · 26/07/05 09:30 발송"
    + " · 추천이유: 재고 확보 차량 조건 우수 · 핵심포인트: 즉시 출고, 보증 연장 · 서비스: 썬팅: 후퍼옵틱",
  );
});

test("buildQuoteChunkText: 최소 필드 — 차량 미선택·시나리오 없음·draft", () => {
  const q: QuoteChunkQuote = { quoteCode: "QT-2607-0002", brandName: null, modelName: null, trimName: null, appStatus: "draft", sentAt: null, guidance: null };
  expect(buildQuoteChunkText(q, null)).toBe("QT-2607-0002 · 차량 미선택 · 작성 중");
});

test("buildQuoteChunkText: sent인데 sentAt 없으면 작성 중(방어), viewed도 발송으로 표기", () => {
  const noStamp: QuoteChunkQuote = { ...FULL_QUOTE, appStatus: "sent", sentAt: null };
  expect(buildQuoteChunkText(noStamp, null)).toContain("작성 중");
  const viewed: QuoteChunkQuote = { ...FULL_QUOTE, appStatus: "viewed" };
  expect(buildQuoteChunkText(viewed, null)).toContain("26/07/05 09:30 발송");
  // 열람 여부는 절대 미포함(스펙 결정 1 — 앱이 advisor_quotes에 직접 써 CRM 훅 없음)
  expect(buildQuoteChunkText(viewed, null)).not.toContain("열람");
});

test("buildQuoteChunkText: legacy keyPoint(단수) 승격 — normalizeQuoteGuidance 재현", () => {
  const q: QuoteChunkQuote = { ...FULL_QUOTE, guidance: { keyPoint: "구형 단수 포인트" } };
  expect(buildQuoteChunkText(q, FULL_SC)).toContain("핵심포인트: 구형 단수 포인트");
});

test("buildQuoteChunkText: 값 없는 항목 생략 — 빈 라벨 나열 금지", () => {
  const sc: QuoteChunkScenario = { purchaseMethod: "할부", termMonths: null, monthlyPayment: null, lender: null };
  const text = buildQuoteChunkText({ ...FULL_QUOTE, appStatus: "draft", sentAt: null, guidance: null }, sc);
  expect(text).toBe("QT-2607-0001 · BMW 320i M Sport · 할부 · 작성 중");
});
