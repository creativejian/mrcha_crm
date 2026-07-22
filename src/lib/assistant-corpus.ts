import { createHash } from "node:crypto";

import { PURCHASE_UNSET_SENTINEL } from "../../client/src/data/customers";
import { formatMoney, formatTerm, guidanceOf, numOr, stampLabelOf, vehicleTitleOf } from "./app-card-payload";
import { EMBEDDING_MODEL } from "./gemini-embed";
import { dateLabelOf, kstDateOf } from "./kst-date";
import { DEPOSIT_TYPE_LABEL, PAYMENT_METHOD_LABEL } from "../../client/src/data/quote-request-labels";

export type CorpusSourceType = "memo" | "task" | "need_memo" | "need_customer_note" | "need_review_note" | "consultation" | "quote" | "customer_profile" | "schedule" | "customer_documents" | "quote_request";

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
  schedule: "일정",
  customer_documents: "서류함",
  quote_request: "앱 견적요청",
};

// 임베딩할 content 문자열. 고객명·소스라벨을 앞에 붙여 검색·생성 컨텍스트를 풍부하게 한다.
export function buildChunkContent(row: CorpusRow): string {
  return `고객 ${row.customerName} ${LABEL[row.sourceType]}: ${row.text}`;
}

// buildChunkContent의 "고객 {이름} " 접두를 근거 표시용으로 벗긴다 — 근거 목록/프롬프트는 고객명을
// 별도 라벨로 이미 붙이므로("김지안 · …") 접두를 그대로 두면 "김지안 · 고객 김지안 견적:"처럼 중복된다.
// 임베딩 content 자체는 불변(검색 컨텍스트 유지) — 표시 시점에만 벗겨 재임베딩이 필요 없다.
export function stripChunkCustomerPrefix(content: string, customerName: string): string {
  const prefix = `고객 ${customerName} `;
  return content.startsWith(prefix) ? content.slice(prefix.length) : content;
}

// 임베딩 content 스냅샷 해시 — **소비자는 임베딩 2경로뿐**이다(`embed-on-write.ts` 증분 훅,
// `backfill-embeddings.ts` 백필). `crm.embeddings.content_hash`에만 저장된다.
// ⚠️ 모델명을 해시에 **반드시** 섞는다(2026-07-22). 임베딩 모델을 바꾸면 벡터 공간이 통째로 달라지는데
// (001↔2 코사인 0.03 실측 — 거의 직교), 해시가 content만 보면 기존 행이 전부 skip돼 **구 모델 벡터가
// 남은 채 새 데이터만 새 모델로 들어간다** = 공간이 섞여 검색이 조용히 죽는다(유사도가 임계값에 못 미침).
// 모델명을 섞어두면 상수 한 줄 교체가 곧 전 코퍼스 해시 변경 → 백필이 자동으로 전량 재임베딩한다.
// `embeddings` 테이블에 모델 컬럼이 없어 이 salt가 **혼입 방지 단일 방어선**이다 — 회귀 그물은
// `assistant-corpus.test.ts`의 스킴 잠금(독립 계산식)이고, 실 DB 불변식은
// `src/test-utils/embedding-model-consistency.test.ts`가 본다(`check:residue`가 아니다 — 그 스크립트는
// 픽스처 잔재 전용이라 해시 판별식이 0줄이다. 배치 15 M1).
//
// ⚠️ **임베딩 밖에서 재사용 금지**(배치 14 K1-a). `#312`가 salt를 넣기 전 이 함수는 이름이 `contentHash`라
// AI 힌트 캐시 키(`customers.ai_summary_source_hash`)도 같이 쓰고 있었고, 그래서 **임베딩 모델 상수 교체
// 한 줄이 임베딩과 무관한 전 고객 힌트를 무효화**했다(실측 22/22가 구 스킴 해시 보유 = 재생성 대기).
// 힌트용은 `aiHintSourceHash`(순수 sha256, `ai-hint.ts`)로 분리돼 있다. 새 소비자가 생기면 그 도메인의
// 해시를 따로 만들 것 — 이 함수의 salt는 **임베딩 벡터 공간의 버전**이지 범용 콘텐츠 지문이 아니다.
export function embeddingContentHash(content: string): string {
  return createHash("sha256").update(`${EMBEDDING_MODEL}\n${content}`).digest("hex");
}

// ── 견적 청크(스펙 2026-07-05 결정 2) ────────────────────────────────────────
// CorpusRow.text에 들어갈 견적 요약 본문. 최종 content는 buildChunkContent가 "고객 {이름} 견적: " 접두를 붙인다.
// 라벨 헬퍼는 app-card-payload(발송 payload 조립기)의 것을 재사용 — 라벨 규칙이 바뀌면 코퍼스도 자동 추종.

export type QuoteChunkQuote = {
  quoteCode: string;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  appStatus: string | null; // draft|queued|sent
  sentAt: Date | null;
  guidance: unknown; // jsonb — guidanceOf가 legacy keyPoint(단수)까지 흡수
  discountLines: unknown; // jsonb [{label,amount,unit}] — 쓰기 zod 게이트(#168)를 신뢰하되 방어 파싱
  finalDiscount: string | null; // drizzle numeric = string, 할인 총액
};

export type QuoteChunkScenario = {
  purchaseMethod: string | null;
  termMonths: number | null;
  monthlyPayment: string | null; // drizzle numeric = string
  lender: string | null;
};

// 할인 파트: 총액(finalDiscount) + 구성 행 라벨(#168 discount_lines — "재구매 할인 들어간 견적" 같은
// 질문의 검색 근거). 0원 행도 병기(미리보기와 동일 규칙), 총액 0/없음 + 행 없음이면 생략.
function discountLabelOf(finalDiscount: string | null, rawLines: unknown): string | null {
  const total = numOr(finalDiscount);
  const lines = (Array.isArray(rawLines) ? rawLines : []).flatMap((l) => {
    const r = l as { label?: unknown; amount?: unknown; unit?: unknown };
    if (typeof r?.label !== "string" || !r.label.trim() || typeof r.amount !== "number") return [];
    return [`${r.label.trim()} ${r.unit === "percent" ? `${r.amount}%` : `${formatMoney(r.amount)}원`}`];
  });
  if (!total && !lines.length) return null;
  return `할인${total ? ` ${formatMoney(total)}원` : ""}${lines.length ? ` (${lines.join(", ")})` : ""}`;
}

// 시나리오 1개 요약(비교안 목록용) — 대표 시나리오가 본문 파트로 펼치는 것과 같은 항목을 한 줄로.
function scenarioSummaryOf(sc: QuoteChunkScenario): string | null {
  const monthly = numOr(sc.monthlyPayment);
  const parts = [
    sc.purchaseMethod || null,
    sc.termMonths != null ? formatTerm(sc.termMonths) : null,
    monthly != null ? `월 ${formatMoney(monthly)}원` : null,
    sc.lender || null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

// 값 없는 항목은 생략(빈 라벨 나열 금지). 열람(viewed_at) 상태는 넣지 않는다 —
// 앱이 advisor_quotes에 직접 써 CRM 훅이 없어 스테일로 박제된다(스펙 결정 1).
// others = 대표를 제외한 비교 시나리오 2·3안(호출부가 pickPrimaryScenario 결과로 분리).
export function buildQuoteChunkText(q: QuoteChunkQuote, sc: QuoteChunkScenario | null, others: QuoteChunkScenario[] = []): string {
  const g = guidanceOf(q.guidance);
  const monthly = numOr(sc?.monthlyPayment ?? null);
  const keyPoints = g.keyPoints.map((k) => k.trim()).filter(Boolean);
  const services = g.services.map((s) => s.trim()).filter(Boolean);
  const recommend = g.recommendReason.replace(/\s*\n+\s*/g, " ").trim();
  const compare = others.map(scenarioSummaryOf).filter(Boolean);
  const sentLabel =
    q.appStatus === "sent" && q.sentAt
      ? `${stampLabelOf(q.sentAt.toISOString())} 발송`
      : "작성 중";
  const parts: (string | null)[] = [
    q.quoteCode,
    `${q.brandName ?? ""} ${vehicleTitleOf(q.modelName, q.trimName)}`.trim(),
    sc?.purchaseMethod || null,
    sc?.termMonths != null ? formatTerm(sc.termMonths) : null,
    monthly != null ? `월 ${formatMoney(monthly)}원` : null,
    sc?.lender || null,
    discountLabelOf(q.finalDiscount, q.discountLines),
    sentLabel,
    compare.length ? `비교안: ${compare.join(" / ")}` : null,
    recommend ? `추천이유: ${recommend}` : null,
    keyPoints.length ? `핵심포인트: ${keyPoints.join(", ")}` : null,
    services.length ? `서비스: ${services.join(", ")}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}


// ── 일정 청크(2026-07-06) ─────────────────────────────────────────────────────
// 일정당 1행(source_id = schedule_id). 날짜는 절대값으로 박는다(임베딩·생성 모두 시간 개념 없음) —
// "예정/지남" 같은 상대 라벨은 다음 날이면 스테일이라 쓰지 않고, 과거/미래 판단은 생성 프롬프트의
// 오늘 날짜(assistant-prompt withTodayContext)에 위임한다. 과거 일정도 전부 포함(이력 질문 답변 가치).
// 날짜 헬퍼(dateLabelOf/kstDateOf/kstDateLabel)는 4개 도메인이 교차 소비해 lib/kst-date.ts로 이동(배치 C).

export type ScheduleChunkSchedule = {
  scheduledDate: string | null; // drizzle date = "YYYY-MM-DD"
  scheduledTime: string | null;
  type: string | null;
  memo: string | null;
  done: boolean;
};

// 값 없는 항목 생략. 실질 필드(날짜·시간·타입·메모) 전무면 빈 문자열 — done만으로는 청크를 만들지
// 않는다(호출부가 빈 텍스트를 임베딩 행 삭제/미수집으로 처리). 미완료에 "예정" 라벨 금지(위 스테일 사유).
export function buildScheduleChunkText(s: ScheduleChunkSchedule): string {
  const when = [s.scheduledDate ? dateLabelOf(s.scheduledDate) : null, s.scheduledTime?.trim() || null]
    .filter(Boolean).join(" ");
  const parts: (string | null)[] = [
    when || null,
    s.type?.trim() || null,
    s.memo?.replace(/\s*\n+\s*/g, " ").trim() || null,
  ];
  if (!parts.some(Boolean)) return "";
  return [...parts, s.done ? "완료" : null].filter(Boolean).join(" · ");
}

// ── 앱 견적요청 청크(2026-07-06) ──────────────────────────────────────────────
// 요청당 1행(source_id = quote_request_id). 요청은 요청별 조건(차량·방식·기간·보증금·옵션) 밀도가
// 견적 청크와 동급이라 aggregate가 아닌 개별 청크(견적 선례) — 어느 요청의 조건인지 섞이지 않는다.
// status(open/completed/closed)는 미포함: 승격/발송 여부는 quote 청크가 커버하고, 앱이 write하는
// 전이를 CRM 훅이 못 쫓아 스테일로 박제된다(견적 열람 미포함과 동일 논리).
// 고객 연결은 customers.app_user_id 직접 연결만(phone 매칭은 표시용 휴리스틱 — 임베딩 부적합).

export type QuoteRequestChunkRequest = {
  createdAt: string; // public-app timestamptz mode:"string"
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  paymentMethod: string | null; // lease|rent|installment|cash 원값 — 라벨 변환은 빌더가 담당
  period: number | null;
  depositType: string | null; // deposit|advance|prepayment
  depositRatio: number | null; // 0~100 정수 %
  rentalDeposit: number | null; // 환산 금액(원)
  trimPrice: number | null;
  optionNames: string[];
};

// 보증금 파트: 유형 라벨 + 비율/금액 병기(클라 depositLabelOf 어휘 동일). 비율·금액 둘 다 0/없음이면
// 항목째 생략(값 없는 라벨 잔존 금지).
function requestDepositLabelOf(r: QuoteRequestChunkRequest): string | null {
  const name = r.depositType ? (DEPOSIT_TYPE_LABEL[r.depositType] ?? r.depositType) : null;
  if (!name) return null;
  const parts = [r.depositRatio ? `${r.depositRatio}%` : null, r.rentalDeposit ? `${formatMoney(r.rentalDeposit)}원` : null].filter(Boolean);
  return parts.length ? `${name} ${parts.join(" ")}` : null;
}

// 값 없는 항목 생략. createdAt이 notNull이라 텍스트는 항상 비지 않는다 — 삭제 경로는
// 고아 정리(요청 삭제/고객 연결 해제)만.
export function buildQuoteRequestChunkText(r: QuoteRequestChunkRequest): string {
  const vehicle = [r.brandName, r.modelName, r.trimName].filter(Boolean).join(" ");
  const parts: (string | null)[] = [
    `${kstDateOf(new Date(r.createdAt))} 요청`,
    vehicle || null,
    r.paymentMethod ? (PAYMENT_METHOD_LABEL[r.paymentMethod] ?? r.paymentMethod) : null,
    r.period != null ? formatTerm(r.period) : null,
    requestDepositLabelOf(r),
    r.optionNames.length ? `옵션: ${r.optionNames.join(", ")}` : null,
    r.trimPrice ? `차량가 ${formatMoney(r.trimPrice)}원` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

// ── 서류함 청크(2026-07-06) ───────────────────────────────────────────────────
// 고객당 1행(source_id = customer_id): 서류 메타 목록(분류·파일명·업로드일 — 내용 OCR 아님).
// "서류 뭐 들어왔어?"는 목록 질문이라 서류당 얇은 청크 대신 근거 1청크에 전체 목록을 싣는다(TOP_K 점유
// 최소화, customer_profile 선례). 목록 순서는 호출부가 업로드일(created_at, id)로 고정한다 —
// sortOrder(표시 순서)를 쓰면 reorder마다 content가 바뀌어 무의미한 재임베딩이 난다.

export type DocumentChunkDocument = {
  docType: string | null;
  fileName: string | null;
  createdAt: Date;
};

// 미분류(doc_type null)는 "미분류"로 표기, 파일명 없으면 생략. 서류 0건이면 빈 문자열 —
// 호출부가 빈 텍스트를 임베딩 행 삭제/미수집으로 처리한다.
export function buildCustomerDocumentsChunkText(docs: DocumentChunkDocument[]): string {
  return docs
    .map((d) => [d.docType?.trim() || "미분류", d.fileName?.trim() || null, `(${kstDateOf(d.createdAt)} 업로드)`].filter(Boolean).join(" "))
    .join(" · ");
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
