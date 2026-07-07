import { test, expect } from "bun:test";

import { buildChunkContent, stripChunkCustomerPrefix, buildCustomerDocumentsChunkText, buildCustomerProfileChunkText, buildQuoteChunkText, buildQuoteRequestChunkText, buildScheduleChunkText, contentHash, type CorpusRow, type CustomerProfileChunkCustomer, type DocumentChunkDocument, type QuoteChunkQuote, type QuoteChunkScenario, type QuoteRequestChunkRequest, type ScheduleChunkSchedule } from "./assistant-corpus";
import { dateLabelOf, kstDateLabel } from "./kst-date";

test("buildChunkContent: 소스타입별 라벨 + 고객명 + 본문", () => {
  const row: CorpusRow = { sourceType: "memo", sourceId: "s1", customerId: "c1", customerName: "김민준", text: "GLC 재고 문의" };
  expect(buildChunkContent(row)).toBe("고객 김민준 상담메모: GLC 재고 문의");
});

test("buildChunkContent: need_review_note 라벨", () => {
  const row: CorpusRow = { sourceType: "need_review_note", sourceId: "c1", customerId: "c1", customerName: "박서연", text: "보증금 30% 검토" };
  expect(buildChunkContent(row)).toBe("고객 박서연 심사메모: 보증금 30% 검토");
});

test("stripChunkCustomerPrefix: '고객 {이름} ' 접두 제거(타입 라벨은 유지)", () => {
  expect(stripChunkCustomerPrefix("고객 김지안 견적: QT-2607-0005 · BMW", "김지안")).toBe("견적: QT-2607-0005 · BMW");
  expect(stripChunkCustomerPrefix("고객 김지안 프로필: 거주지 서울", "김지안")).toBe("프로필: 거주지 서울");
  // 이름 불일치(표시 폴백 '고객' 등)면 원문 유지 — 잘못 벗기지 않는다.
  expect(stripChunkCustomerPrefix("고객 김지안 견적: X", "고객")).toBe("고객 김지안 견적: X");
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
  discountLines: [{ label: "재구매 할인", amount: 200000, unit: "amount" }],
  finalDiscount: "6700000",
};
const FULL_SC: QuoteChunkScenario = { purchaseMethod: "운용리스", termMonths: 60, monthlyPayment: "2350000", lender: "하나캐피탈" };

test("buildQuoteChunkText: 풀필드 — 헤더+대표 시나리오+할인 구성+발송(KST)+guidance", () => {
  expect(buildQuoteChunkText(FULL_QUOTE, FULL_SC)).toBe(
    "QT-2607-0001 · BMW 320i M Sport · 운용리스 · 60개월 · 월 2,350,000원 · 하나캐피탈 · 할인 6,700,000원 (재구매 할인 200,000원) · 26/07/05 09:30 발송"
    + " · 추천이유: 재고 확보 차량 조건 우수 · 핵심포인트: 즉시 출고, 보증 연장 · 서비스: 썬팅: 후퍼옵틱",
  );
});

test("buildQuoteChunkText: 최소 필드 — 차량 미선택·시나리오 없음·할인 없음·draft", () => {
  const q: QuoteChunkQuote = { quoteCode: "QT-2607-0002", brandName: null, modelName: null, trimName: null, appStatus: "draft", sentAt: null, guidance: null, discountLines: null, finalDiscount: null };
  expect(buildQuoteChunkText(q, null)).toBe("QT-2607-0002 · 차량 미선택 · 작성 중");
});

test("buildQuoteChunkText: 할인 — percent 행 표기·총액 0은 생략(행만 병기)·비정형 jsonb 방어", () => {
  expect(buildQuoteChunkText({ ...FULL_QUOTE, discountLines: [{ label: "프로모션", amount: 1.5, unit: "percent" }], finalDiscount: null }, null))
    .toContain("할인 (프로모션 1.5%)");
  expect(buildQuoteChunkText({ ...FULL_QUOTE, discountLines: null, finalDiscount: "0" }, null)).not.toContain("할인");
  expect(buildQuoteChunkText({ ...FULL_QUOTE, discountLines: [{ broken: true }, "x"], finalDiscount: "500000" }, null))
    .toContain("할인 500,000원 ·");
});

test("buildQuoteChunkText: 비교 시나리오 2·3안 — 대표 제외 목록, 값 없는 안 생략", () => {
  const others: QuoteChunkScenario[] = [
    { purchaseMethod: "할부", termMonths: 60, monthlyPayment: "2100000", lender: "우리캐피탈" },
    { purchaseMethod: null, termMonths: null, monthlyPayment: null, lender: null }, // 빈 안은 생략
  ];
  const text = buildQuoteChunkText(FULL_QUOTE, FULL_SC, others);
  expect(text).toContain("비교안: 할부 60개월 월 2,100,000원 우리캐피탈");
  expect(text).not.toContain("비교안: 할부 60개월 월 2,100,000원 우리캐피탈 /");
  expect(buildQuoteChunkText(FULL_QUOTE, FULL_SC, [])).not.toContain("비교안");
});

test("buildQuoteChunkText: sent인데 sentAt 없으면 작성 중(방어), 열람 어휘 미포함", () => {
  const noStamp: QuoteChunkQuote = { ...FULL_QUOTE, appStatus: "sent", sentAt: null };
  expect(buildQuoteChunkText(noStamp, null)).toContain("작성 중");
  // 열람 여부는 절대 미포함(스펙 결정 1 — 앱이 advisor_quotes에 직접 써 CRM 훅 없음).
  // "viewed" 어휘 자체가 crm.quotes에서 축소됨(배치 E) — 열람은 advisor_quotes.viewed_at SSOT.
  const sent: QuoteChunkQuote = { ...FULL_QUOTE, appStatus: "sent" };
  expect(buildQuoteChunkText(sent, null)).toContain("26/07/05 09:30 발송");
  expect(buildQuoteChunkText(sent, null)).not.toContain("열람");
});

test("buildQuoteChunkText: legacy keyPoint(단수) 승격 — normalizeQuoteGuidance 재현", () => {
  const q: QuoteChunkQuote = { ...FULL_QUOTE, guidance: { keyPoint: "구형 단수 포인트" } };
  expect(buildQuoteChunkText(q, FULL_SC)).toContain("핵심포인트: 구형 단수 포인트");
});

test("buildQuoteChunkText: 값 없는 항목 생략 — 빈 라벨 나열 금지", () => {
  const sc: QuoteChunkScenario = { purchaseMethod: "할부", termMonths: null, monthlyPayment: null, lender: null };
  const text = buildQuoteChunkText({ ...FULL_QUOTE, appStatus: "draft", sentAt: null, guidance: null, discountLines: null, finalDiscount: null }, sc);
  expect(text).toBe("QT-2607-0001 · BMW 320i M Sport · 할부 · 작성 중");
});

// ── 고객 프로필 청크(2026-07-06) — 프로필 + 구조화 니즈. 서술형 니즈 3필드는 별도 청크라 미포함. ──

const FULL_PROFILE: CustomerProfileChunkCustomer = {
  residence: "인천광역시",
  customerType: "개인",
  customerTypeDetail: "4대보험",
  source: "유튜브",
  advisorName: "김지안",
  needModel: "Maybach S-Class",
  needTrim: "S 500 4M Long",
  needMethod: "운용리스",
  needTiming: "좋은 조건 즉시",
  needColors: "외장 블랙 · 내장 베이지",
  needCompare: "GLC/X3",
  needContractTerm: "60개월",
  needInitialCost: "300만원 이하",
  needAnnualMileage: "20,000km",
  needDeliveryMethod: "방문 수령",
  needContractFocus: "월 납입금 최소",
};

test("buildCustomerProfileChunkText: 풀필드 — 프로필+관심 차종 조합+구조화 니즈", () => {
  expect(buildCustomerProfileChunkText(FULL_PROFILE)).toBe(
    "거주지 인천광역시 · 직군 개인·4대보험 · 상담경로 유튜브 · 담당자 김지안 · 관심 차종 Maybach S-Class S 500 4M Long · 구매방식 운용리스 · 구매시기 좋은 조건 즉시 · 컬러 외장 블랙 · 내장 베이지 · 비교 차종 GLC/X3 · 계약기간 60개월 · 초기비용 300만원 이하 · 연간 주행거리 20,000km · 출고 방식 방문 수령 · 계약 중점 월 납입금 최소",
  );
});

test("buildCustomerProfileChunkText: 빈 값·공백·'확인 필요' 센티널은 항목째 생략", () => {
  const text = buildCustomerProfileChunkText({
    ...FULL_PROFILE,
    advisorName: null,
    needCompare: "  ",
    needAnnualMileage: "확인 필요",
    needDeliveryMethod: "확인 필요",
    needContractFocus: null,
  });
  expect(text).not.toContain("담당자");
  expect(text).not.toContain("비교 차종");
  expect(text).not.toContain("확인 필요");
  expect(text).toContain("거주지 인천광역시");
});

test("buildCustomerProfileChunkText: 트림만 있으면 관심 차종은 트림만, 전부 비면 빈 문자열(→임베딩 행 삭제)", () => {
  const empty = Object.fromEntries(Object.keys(FULL_PROFILE).map((k) => [k, null])) as CustomerProfileChunkCustomer;
  expect(buildCustomerProfileChunkText(empty)).toBe("");
  expect(buildCustomerProfileChunkText({ ...empty, needTrim: "S 500 4M Long" })).toBe("관심 차종 S 500 4M Long");
});

test("buildChunkContent: customer_profile 라벨", () => {
  const row: CorpusRow = { sourceType: "customer_profile", sourceId: "c1", customerId: "c1", customerName: "김민준", text: "거주지 인천광역시" };
  expect(buildChunkContent(row)).toBe("고객 김민준 프로필: 거주지 인천광역시");
});

// ── 일정 청크(2026-07-06) — 일정당 1행. 날짜는 절대값(요일 병기), 상대 라벨(예정/지남) 금지. ──

const FULL_SCHEDULE: ScheduleChunkSchedule = {
  scheduledDate: "2026-05-26",
  scheduledTime: "16:00",
  type: "견적",
  memo: "GLC 재고 확인 후 X3 조건과 총비용 비교 견적 재발송",
  done: false,
};

test("dateLabelOf: YYYY-MM-DD → 요일 병기, 파싱 불가는 원문 유지", () => {
  expect(dateLabelOf("2026-05-26")).toBe("2026-05-26(화)");
  expect(dateLabelOf("2026-07-06")).toBe("2026-07-06(월)");
  expect(dateLabelOf("미정")).toBe("미정");
});

test("kstDateLabel: UTC 자정 직전도 KST 달력일 기준(요일 포함)", () => {
  // 2026-07-05T23:30Z = KST 2026-07-06 08:30(월) — 로컬(UTC) getDay였다면 일요일로 밀린다.
  expect(kstDateLabel(new Date("2026-07-05T23:30:00Z"))).toBe("2026-07-06(월)");
  expect(kstDateLabel(new Date("2026-07-06T00:30:00Z"))).toBe("2026-07-06(월)");
});

test("buildScheduleChunkText: 풀필드 — 날짜(요일) 시간 · 타입 · 메모", () => {
  expect(buildScheduleChunkText(FULL_SCHEDULE)).toBe(
    "2026-05-26(화) 16:00 · 견적 · GLC 재고 확인 후 X3 조건과 총비용 비교 견적 재발송",
  );
});

test("buildScheduleChunkText: done=true면 완료 라벨, 미완료는 라벨 없음(스테일 방지 — 예정 표기 금지)", () => {
  expect(buildScheduleChunkText({ ...FULL_SCHEDULE, done: true })).toBe(
    "2026-05-26(화) 16:00 · 견적 · GLC 재고 확인 후 X3 조건과 총비용 비교 견적 재발송 · 완료",
  );
  expect(buildScheduleChunkText(FULL_SCHEDULE)).not.toContain("예정");
});

test("buildScheduleChunkText: 값 없는 항목 생략 — 날짜 없이 메모만, 메모 개행은 공백 접기", () => {
  expect(buildScheduleChunkText({ scheduledDate: null, scheduledTime: null, type: null, memo: "재연락\n오후 중", done: false })).toBe("재연락 오후 중");
  expect(buildScheduleChunkText({ ...FULL_SCHEDULE, scheduledTime: null, memo: null })).toBe("2026-05-26(화) · 견적");
});

test("buildScheduleChunkText: 실질 필드 전무면 빈 문자열(→임베딩 행 삭제) — done만으로는 청크 없음", () => {
  expect(buildScheduleChunkText({ scheduledDate: null, scheduledTime: "  ", type: null, memo: null, done: true })).toBe("");
});

test("buildChunkContent: schedule 라벨", () => {
  const row: CorpusRow = { sourceType: "schedule", sourceId: "s1", customerId: "c1", customerName: "김민준", text: "2026-05-26(화) 16:00 · 견적" };
  expect(buildChunkContent(row)).toBe("고객 김민준 일정: 2026-05-26(화) 16:00 · 견적");
});

// ── 서류함 청크(2026-07-06) — 고객당 1행, 서류 메타 목록(내용 OCR 아님). 순서는 호출부(업로드일 고정). ──

test("buildCustomerDocumentsChunkText: 목록 — 분류 파일명 (업로드일 KST)", () => {
  const docs: DocumentChunkDocument[] = [
    { docType: "법인(점)등기부등본", fileName: "4.pdf", createdAt: new Date("2026-07-01T05:00:00Z") },
    // UTC 2026-07-01 23:30 = KST 2026-07-02 — 업로드일은 KST 달력일 기준
    { docType: "법인(점)주주명부", fileName: "1.png", createdAt: new Date("2026-07-01T23:30:00Z") },
  ];
  expect(buildCustomerDocumentsChunkText(docs)).toBe(
    "법인(점)등기부등본 4.pdf (2026-07-01 업로드) · 법인(점)주주명부 1.png (2026-07-02 업로드)",
  );
});

test("buildCustomerDocumentsChunkText: doc_type null은 미분류, 파일명 없으면 생략, 0건이면 빈 문자열", () => {
  expect(buildCustomerDocumentsChunkText([{ docType: null, fileName: "  ", createdAt: new Date("2026-07-01T05:00:00Z") }]))
    .toBe("미분류 (2026-07-01 업로드)");
  expect(buildCustomerDocumentsChunkText([])).toBe("");
});

test("buildChunkContent: customer_documents 라벨", () => {
  const row: CorpusRow = { sourceType: "customer_documents", sourceId: "c1", customerId: "c1", customerName: "김민준", text: "운전면허증 a.jpg (2026-07-01 업로드)" };
  expect(buildChunkContent(row)).toBe("고객 김민준 서류함: 운전면허증 a.jpg (2026-07-01 업로드)");
});

// ── 앱 견적요청 청크(2026-07-06) — 요청당 1행, status 미포함(발송/승격은 quote 청크가 커버). ──

const FULL_REQUEST: QuoteRequestChunkRequest = {
  createdAt: "2026-06-29T05:00:00+00:00", // KST 2026-06-29 14:00
  brandName: "BMW",
  modelName: "5 Series",
  trimName: "520i",
  paymentMethod: "lease",
  period: 60,
  depositType: "deposit",
  depositRatio: 20,
  rentalDeposit: 10496000,
  trimPrice: 52480000,
  optionNames: ["썬루프", "하이패스"],
};

test("buildQuoteRequestChunkText: 풀필드 — 요청일(KST)·차량·방식 한글·기간·보증금 병기·옵션·차량가", () => {
  expect(buildQuoteRequestChunkText(FULL_REQUEST)).toBe(
    "2026-06-29 요청 · BMW 5 Series 520i · 운용리스 · 60개월 · 보증금 20% 10,496,000원 · 옵션: 썬루프, 하이패스 · 차량가 52,480,000원",
  );
});

test("buildQuoteRequestChunkText: 값 없는 항목 생략 — 트림 소실·무옵션·보증금 0", () => {
  const text = buildQuoteRequestChunkText({
    ...FULL_REQUEST,
    brandName: null, modelName: null, trimName: null,
    depositType: "advance", depositRatio: 0, rentalDeposit: 0,
    trimPrice: null, optionNames: [],
  });
  expect(text).toBe("2026-06-29 요청 · 운용리스 · 60개월"); // 보증금 0/0은 항목째 생략(선수금 라벨 잔존 금지)
});

test("buildQuoteRequestChunkText: 선납금(prepayment) 금액만·미지 코드는 원값 유지", () => {
  const text = buildQuoteRequestChunkText({ ...FULL_REQUEST, paymentMethod: "installment", depositType: "prepayment", depositRatio: 0, rentalDeposit: 5000000 });
  expect(text).toContain("할부");
  expect(text).toContain("선납금 5,000,000원");
  expect(buildQuoteRequestChunkText({ ...FULL_REQUEST, paymentMethod: "custom" })).toContain("custom");
});

test("buildChunkContent: quote_request 라벨", () => {
  const row: CorpusRow = { sourceType: "quote_request", sourceId: "r1", customerId: "c1", customerName: "제임스", text: "2026-06-29 요청 · BMW 5 Series 520i" };
  expect(buildChunkContent(row)).toBe("고객 제임스 앱 견적요청: 2026-06-29 요청 · BMW 5 Series 520i");
});
