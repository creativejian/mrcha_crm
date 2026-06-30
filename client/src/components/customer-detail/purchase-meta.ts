// 구매조건(상세 구매조건) 영역의 순수 메타/타입/유틸. 훅(useCustomerPurchase)·컴포넌트(PurchaseConditions)가 공유한다.
// 부모(CustomerDetailPage)도 일부를 import한다: 니즈 편집 폼의 구매방식 select(kimMethodOptions),
// 워크벤치 기본 구매방식 시드(kimMinjunPurchaseFields). (본체에서 추출 — 동작/값 무변경.)

export type KimInitialCostKind = "무보증" | "보증금" | "선수금";
export type KimInitialCostSelection = KimInitialCostKind | "";
export type KimInitialCostUnit = "%" | "금액";

// 구매방식·출고 희망 시기는 purchaseFields 초기화에서 detail.needMethod/needTiming로 덮어씀.
// 나머지는 crm 컬럼 없는 견적 도메인 값이라 데이터 소스 없음 → 빈값(렌더 시 "미정").
export const kimMinjunPurchaseFields = [
  { label: "구매방식", value: "" },
  { label: "계약기간", value: "" },
  { label: "초기비용", value: "" },
  { label: "연간 주행거리", value: "" },
  { label: "인도 방식", value: "" },
  { label: "출고 희망 시기", value: "" },
  { label: "계약 포커스", value: "" },
  { label: "고객 특이사항", value: "" },
  { label: "심사 특이사항", value: "" },
];

export const kimMethodOptions = ["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"];
export const kimContractTermOptions = ["12개월", "24개월", "36개월", "48개월", "60개월"];
export const kimInitialCostKindOptions: KimInitialCostKind[] = ["무보증", "보증금", "선수금"];
export const kimInitialCostUnitOptions: KimInitialCostUnit[] = ["%", "금액"];
export const kimAnnualMileageOptions = ["10,000km", "15,000km", "20,000km", "25,000km", "30,000km", "35,000km", "40,000km", "무제한"];
export const kimDeliveryMethodOptions = ["탁송 요청", "매장 출고", "직접 수령", "협의 필요"];
export const kimTimingPresetOptions = ["좋은 조건 즉시", "이번 달", "다음 달", "3개월 이후"];
export const kimTimingMonthOptions = Array.from({ length: 12 }, (_, index) => `${index + 1}월`);
export const kimContractFocusOptions = ["무보증 선호", "월 납입 최소", "총 비용 최소", "반납 확정", "인수 확정", "승계 고려", "빠른 출고", "할인 민감", "승인 여부"];
export const kimCustomerNoteOptions = ["연락 잘 됨", "연락 어려움", "특정 시간 연락", "카톡 선호", "통화 선호", "문자 선호", "가족과 상의", "비교 많음", "결정 빠름", "조건 수용 빠름", "신중함", "진행 잘 따라옴"];
export const kimReviewNoteOptions = ["4대보험 확인", "재직 확인 전", "소득 증빙 필요", "신용점수 확인", "기대출 확인", "연체 이력 확인", "사업자 매출 확인", "공동명의 검토", "승인 우선"];
export const kimPurchaseTagSelectionLimit = 4;

export function parseKimInitialCost(value: string) {
  if (value === "확인 필요") {
    return { kind: "" as KimInitialCostSelection, unit: "%" as KimInitialCostUnit, amount: "" };
  }
  if (value.includes("무보증")) {
    return { kind: "무보증" as KimInitialCostKind, unit: "%" as KimInitialCostUnit, amount: "" };
  }
  const kind = value.includes("선수금") ? "선수금" : "보증금";
  const amount = value.replace(kind, "").replace("만원", "").replace("%", "").replace(/,/g, "").trim();
  const unit = value.includes("만원") ? "금액" : "%";
  return { kind: kind as KimInitialCostKind, unit: unit as KimInitialCostUnit, amount: amount || "30" };
}
