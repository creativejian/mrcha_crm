import { createHash } from "node:crypto";

import { PURCHASE_UNSET_SENTINEL } from "../../client/src/data/customers";
import { formatMoney, formatTerm, guidanceOf, numOr, stampLabelOf, vehicleTitleOf } from "./app-card-payload";

export type CorpusSourceType = "memo" | "task" | "need_memo" | "need_customer_note" | "need_review_note" | "consultation" | "quote" | "customer_profile";

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
  customer_profile: "프로필",
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


// ── 고객 프로필 청크(2026-07-06) ──────────────────────────────────────────────
// 고객당 1행(source_id = customer_id): 프로필 + 구조화 니즈. 서술형 니즈 3필드(need_memo/customer_note/
// review_note)는 별도 청크라 중복 포함하지 않는다. phone은 제외(PII — 검색 가치 대비 프롬프트 노출 리스크),
// 진행 상태/가능성도 제외(자주 바뀌어 재임베딩 잦고, 프롬프트에는 getCustomerMetaByIds 메타 병기가 이미 실림).

export type CustomerProfileChunkCustomer = {
  residence: string | null;
  customerType: string | null;
  customerTypeDetail: string | null;
  source: string | null;
  advisorName: string | null;
  needModel: string | null;
  needTrim: string | null;
  needMethod: string | null;
  needTiming: string | null;
  needColors: string | null;
  needCompare: string | null;
  needContractTerm: string | null;
  needInitialCost: string | null;
  needAnnualMileage: string | null;
  needDeliveryMethod: string | null;
  needContractFocus: string | null;
};

// 값 없는 항목·공백·미입력 센티널("확인 필요")은 항목째 생략. 전부 비면 빈 문자열 —
// 호출부(runEmbedJob/백필)가 빈 텍스트를 임베딩 행 삭제/미수집으로 처리한다.
export function buildCustomerProfileChunkText(c: CustomerProfileChunkCustomer): string {
  const val = (raw: string | null): string | null => {
    const v = raw?.trim();
    return v && v !== PURCHASE_UNSET_SENTINEL ? v : null;
  };
  const labeled = (label: string, raw: string | null) => (val(raw) ? `${label} ${val(raw)}` : null);
  const job = [val(c.customerType), val(c.customerTypeDetail)].filter(Boolean).join("·");
  const vehicle = [val(c.needModel), val(c.needTrim)].filter(Boolean).join(" ");
  const parts: (string | null)[] = [
    labeled("거주지", c.residence),
    job ? `직군 ${job}` : null,
    labeled("상담경로", c.source),
    labeled("담당자", c.advisorName),
    vehicle ? `관심 차종 ${vehicle}` : null,
    labeled("구매방식", c.needMethod),
    labeled("구매시기", c.needTiming),
    labeled("컬러", c.needColors),
    labeled("비교 차종", c.needCompare),
    labeled("계약기간", c.needContractTerm),
    labeled("초기비용", c.needInitialCost),
    labeled("연간 주행거리", c.needAnnualMileage),
    labeled("출고 방식", c.needDeliveryMethod),
    labeled("계약 중점", c.needContractFocus),
  ];
  return parts.filter(Boolean).join(" · ");
}
