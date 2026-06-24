export type QuoteGuidance = {
  deliveryComment: string;
  stockNotice: string;
  expectedDelivery: string;
  customerRegion: string;
  keyPoint: string;
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
  customerRegion: ["서울", "인천", "경기", "부산", "대구", "광주", "대전", "기타"],
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
  keyPoint: QUOTE_GUIDANCE_OPTIONS.keyPoint[0],
  recommendReason: "",
  services: [
    "썬팅: 후퍼옵틱 KBR 전면 + 측후면 제공",
    "블랙박스: 기본 제공",
    "출고 기념품: 키케이스, 주차번호판, 머그컵",
    "담당 카매니저 출고 일정 개별 안내",
  ],
};
