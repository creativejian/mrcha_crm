import { createHash } from "node:crypto";

import { formatMoney, formatTerm, guidanceOf, numOr, stampLabelOf, vehicleTitleOf } from "./app-card-payload";

export type CorpusSourceType = "memo" | "task" | "need_memo" | "need_customer_note" | "need_review_note" | "consultation" | "quote";

export type CorpusRow = {
  sourceType: CorpusSourceType;
  sourceId: string;
  customerId: string;
  customerName: string;
  text: string;
};

const LABEL: Record<CorpusSourceType, string> = {
  memo: "상담메모",
  task: "할일",
  need_memo: "니즈메모",
  need_customer_note: "고객노트",
  need_review_note: "심사메모",
  consultation: "상담이력",
  quote: "견적",
};

// 임베딩할 content 문자열. 고객명·소스라벨을 앞에 붙여 검색·생성 컨텍스트를 풍부하게 한다.
export function buildChunkContent(row: CorpusRow): string {
  return `고객 ${row.customerName} ${LABEL[row.sourceType]}: ${row.text}`;
}

// content 스냅샷 해시(재임베딩 skip 판단용).
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ── 견적 청크(스펙 2026-07-05 결정 2) ────────────────────────────────────────
// CorpusRow.text에 들어갈 견적 요약 본문. 최종 content는 buildChunkContent가 "고객 {이름} 견적: " 접두를 붙인다.
// 라벨 헬퍼는 app-card-payload(발송 payload 조립기)의 것을 재사용 — 라벨 규칙이 바뀌면 코퍼스도 자동 추종.

export type QuoteChunkQuote = {
  quoteCode: string;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  appStatus: string | null; // draft|queued|sent|viewed
  sentAt: Date | null;
  guidance: unknown; // jsonb — guidanceOf가 legacy keyPoint(단수)까지 흡수
};

export type QuoteChunkScenario = {
  purchaseMethod: string | null;
  termMonths: number | null;
  monthlyPayment: string | null; // drizzle numeric = string
  lender: string | null;
};

// 값 없는 항목은 생략(빈 라벨 나열 금지). 열람(viewed_at) 상태는 넣지 않는다 —
// 앱이 advisor_quotes에 직접 써 CRM 훅이 없어 스테일로 박제된다(스펙 결정 1).
export function buildQuoteChunkText(q: QuoteChunkQuote, sc: QuoteChunkScenario | null): string {
  const g = guidanceOf(q.guidance);
  const monthly = numOr(sc?.monthlyPayment ?? null);
  const keyPoints = g.keyPoints.map((k) => k.trim()).filter(Boolean);
  const services = g.services.map((s) => s.trim()).filter(Boolean);
  const recommend = g.recommendReason.replace(/\s*\n+\s*/g, " ").trim();
  const sentLabel =
    (q.appStatus === "sent" || q.appStatus === "viewed") && q.sentAt
      ? `${stampLabelOf(q.sentAt.toISOString())} 발송`
      : "작성 중";
  const parts: (string | null)[] = [
    q.quoteCode,
    `${q.brandName ?? ""} ${vehicleTitleOf(q.modelName, q.trimName)}`.trim(),
    sc?.purchaseMethod || null,
    sc?.termMonths != null ? formatTerm(sc.termMonths) : null,
    monthly != null ? `월 ${formatMoney(monthly)}원` : null,
    sc?.lender || null,
    sentLabel,
    recommend ? `추천이유: ${recommend}` : null,
    keyPoints.length ? `핵심포인트: ${keyPoints.join(", ")}` : null,
    services.length ? `서비스: ${services.join(", ")}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
