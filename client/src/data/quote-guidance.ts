export type QuoteGuidance = {
  deliveryComment: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  keyPoints: string[];
  recommendReason: string;
  services: string[];
};

export const QUOTE_GUIDANCE_OPTIONS = {
  deliveryComment: [
    "이 차량은 1주일 내 출고 가능해요",
    "배정 확인 후 출고 일정을 안내드릴게요",
    "주문 후 생산 일정 확인이 필요해요",
    "색상 확정 후 출고 가능 시점을 안내드릴게요",
  ],
  stockNotice: ["재고 확인 필요", "즉시 출고 가능", "배정 대기", "주문 필요"],
  expectedDelivery: ["확인 후 안내", "1주일 이내", "2주 이내", "1개월 이내", "1개월 이상"],
  customerRegion: ["확인 필요", "서울", "인천", "경기", "부산", "대구", "광주", "대전", "기타"],
  keyPoint: [
    "잔존가치 최대 조건으로 월 납입금을 낮춘 조건입니다.",
    "초기 부담을 낮추는 조건입니다.",
    "월 납입금과 초기 비용 균형을 맞춘 조건입니다.",
    "인수 선택까지 고려한 안정적인 조건입니다.",
  ],
} as const;

// 신규 견적 작성 시 기본 제안값(상담사가 수정). select는 첫 옵션, services는 자주 쓰는 제안.
export const DEFAULT_QUOTE_GUIDANCE: QuoteGuidance = {
  deliveryComment: QUOTE_GUIDANCE_OPTIONS.deliveryComment[0],
  stockNotice: QUOTE_GUIDANCE_OPTIONS.stockNotice[0],
  expectedDelivery: QUOTE_GUIDANCE_OPTIONS.expectedDelivery[0],
  customerRegion: QUOTE_GUIDANCE_OPTIONS.customerRegion[0],
  keyPoints: [QUOTE_GUIDANCE_OPTIONS.keyPoint[0]],
  recommendReason: "",
  services: [
    "썬팅: 후퍼옵틱 KBR 전면 + 측후면 제공",
    "블랙박스: 기본 제공",
    "출고 기념품: 키케이스, 주차번호판, 머그컵",
    "담당 카매니저 출고 일정 개별 안내",
  ],
};

// DB jsonb 하위호환 read normalizer: 구행(keyPoint 단일 문자열) → keyPoints 배열. null/undefined는 null.
export function normalizeQuoteGuidance(
  raw: (Partial<QuoteGuidance> & { keyPoint?: string }) | null | undefined,
): QuoteGuidance | null {
  if (raw == null) return null;
  const keyPoints = Array.isArray(raw.keyPoints)
    ? raw.keyPoints
    : (raw.keyPoint ?? "").trim() ? [(raw.keyPoint ?? "").trim()] : [];
  return {
    deliveryComment: raw.deliveryComment ?? "",
    stockNotice: raw.stockNotice ?? "",
    expectedDelivery: raw.expectedDelivery ?? "",
    customerRegion: raw.customerRegion ?? "",
    keyPoints,
    recommendReason: raw.recommendReason ?? "",
    services: Array.isArray(raw.services) ? raw.services : [],
  };
}

// 고객 거주지(crm.customers.residence, 예: "인천광역시") → 카드 고객 지역 옵션 파생.
// 미입력/placeholder는 "확인 필요"(임의 지역을 확정 표기하지 않는다 — 잘못된 정보 발송 방지),
// 옵션 밖 실지역(울산 등)은 "기타". 신규 워크벤치 기본값 시드용 — 저장된 guidance는 불변.
export function regionFromResidence(residence: string | null | undefined): string {
  const raw = residence?.trim() ?? "";
  if (!raw || raw === "확인 필요" || raw === "미정") return "확인 필요";
  const matched = QUOTE_GUIDANCE_OPTIONS.customerRegion.find(
    (region) => region !== "확인 필요" && region !== "기타" && raw.includes(region),
  );
  return matched ?? "기타";
}

// 저장 직전 정리: 동적 입력칸(+)의 빈 줄 제거 + trim (빈 문자열 영속 방지).
export function sanitizeQuoteGuidance(g: QuoteGuidance): QuoteGuidance {
  return {
    ...g,
    keyPoints: g.keyPoints.map((k) => k.trim()).filter(Boolean),
    services: g.services.map((s) => s.trim()).filter(Boolean),
  };
}
