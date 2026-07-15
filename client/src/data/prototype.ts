export const brands = [
  ["BMW", 28],
  ["Mercedes", 22],
  ["Tesla", 19],
  ["Genesis", 15],
  ["Hyundai", 10],
  ["MINI", 6],
] as const;

export const advisors = [
  ["지안", "담당 18명 · 계약률 21% · 평균 응답 7분", "J"],
  ["선생님", "담당 14명 · 계약률 18% · 평균 응답 11분", "S"],
  ["제프", "담당 9명 · 견적 계산 32건 · 평균 응답 15분", "Z"],
] as const;

export const adminBriefs = [
  ["김민준 · X3/GLC 비교", "월납입보다 중도해지 리스크를 중요하게 봅니다. 총비용 중심 설명이 필요합니다."],
  ["박서연 · Model Y 렌트", "초기비용을 낮추고 싶어하지만 보험/정비 포함 구조를 잘 모릅니다."],
  ["이도윤 · GV80 심사", "개인사업자 증빙이 약합니다. 승인 가능 금융사 우선순위가 필요합니다."],
] as const;

export const quotes = [
  { vehicle: "BMW X3 20i", finance: "A캐피탈", period: "48개월", initial: "보증금 20%", residual: "52%", monthly: "842,000원", stock: "가능", verdict: "추천" },
  { vehicle: "Benz GLC 300", finance: "B캐피탈", period: "48개월", initial: "보증금 20%", residual: "49%", monthly: "879,000원", stock: "확인 필요", verdict: "재고 변수" },
  { vehicle: "BMW X3 20i", finance: "C캐피탈", period: "60개월", initial: "보증금 10%", residual: "44%", monthly: "792,000원", stock: "가능", verdict: "월납 낮음" },
];
