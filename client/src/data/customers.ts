export type CustomerMode = "all" | "allDraft" | "consulting" | "contract" | "delivery" | "settlement" | "hold";
export type CustomerChanceOption = "높음" | "중간" | "낮음" | "보류" | "확정";
export type CustomerManageStatus = "정상" | "확인필요" | "재문의" | "지연" | "장기방치";

export type Customer = {
  id?: string;
  no: number;
  customerId: string;
  receivedAt: string;
  assignedAt: string;
  team: string;
  name: string;
  customerType: string;
  customerTypeDetail: string;
  phone: string;
  vehicle: string;
  method: string;
  advisor: string;
  statusGroup: string;
  status: string;
  date: string;
  source: string;
  talkCount: string;
  priority: string;
  chance?: string;
  nextAction: string;
  aiSummary: string;
  settlementStatus?: string;
  fee?: string;
  cost?: string;
  margin?: string;
};

export const customerStatusGroups: Record<string, string[]> = {
  신규: ["상담접수", "1차부재중", "지속적부재", "연락해야함"],
  상담중: ["구매방식상담중", "차량상담중", "견적상담중"],
  견적: ["준비중", "발송완료", "추후안내예정"],
  차량체크: ["재고확인중", "재고있음", "재고없음", "대기필요"],
  심사서류: ["서류상담중", "서류안내함", "서류대기중", "서류받음"],
  관리중: ["부결후관리", "구매시기미도래", "추후재컨택", "조건재확인"],
  상담완료: ["재상담대기", "구매시기미도래", "추후재컨택"],
  계약완료: ["딜러사계약중", "대리점발주중", "특판발주중", "배정완료", "출고완료"],
  불발: ["계약취소", "지속적부재", "추후재컨택", "구매철회"],
};

export const customerModeMeta: Record<CustomerMode, { title: string; desc: string }> = {
  all: { title: "전체 보기", desc: "모든 고객 DB를 한 화면에서 확인합니다." },
  allDraft: { title: "전체 보기", desc: "카드형 외곽을 걷어낸 라인 기반 고객 관리 화면을 검토합니다." },
  consulting: { title: "상담 필요", desc: "계약 전 상담, 견적, 재응대가 필요한 고객 업무함입니다." },
  contract: { title: "계약 관리", desc: "심사, 계약 완료, 계약 취소 고객의 계약 실무를 관리합니다." },
  delivery: { title: "출고 관리", desc: "출고 예정과 출고 완료 전후의 안내 업무를 관리합니다." },
  settlement: { title: "출고 정산", desc: "출고 완료 이후 수수료, 비용, 마진 정산이 필요한 고객입니다." },
  hold: { title: "보류 / 이탈", desc: "미응답, 미정, 불발, 계약취소 고객의 재컨택 여부를 관리합니다." },
};

export const initialCustomers: Customer[] = [
  { no: 11417, customerId: "CU-2605-0020", receivedAt: "2026-05-14 12:56", assignedAt: "오늘 13:04", team: "인천본사", name: "김민준", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-9588-0812", vehicle: "Maybach S-Class", method: "운용리스", advisor: "미배정", statusGroup: "견적", status: "발송완료", date: "오늘 14:20", source: "디엘(견적서)", talkCount: "3/1", priority: "긴급", nextAction: "GLC 재고 확인 후 X3 조건과 총비용 비교 견적 다시 보내고 리스 해지 리스크까지 함께 안내, 그리고 영실아 이거 일부러 3줄 만들었어", aiSummary: "X3와 GLC를 함께 비교 중이며 중도해지 리스크, 월 납입액, 총비용 차이에 민감" },
  { no: 11416, customerId: "CU-2605-0019", receivedAt: "2026-05-14 11:05", assignedAt: "오늘 11:18", team: "인천본사", name: "박서연", customerType: "개인", customerTypeDetail: "프리랜서", phone: "010-9588-0813", vehicle: "Model Y", method: "장기렌트", advisor: "이주선", statusGroup: "견적", status: "준비중", date: "오늘 11:05", source: "앱 AI상담", talkCount: "1/0", priority: "높음", nextAction: "보증금 0/10/20% 월납입표와 보험 포함 여부 확인", aiSummary: "초기비용 0원 선호가 강하고 보험 포함 여부와 만기 인수 선택지를 함께 확인하고 있음" },
  { no: 11415, customerId: "CU-2605-0018", receivedAt: "2026-05-13 18:42", assignedAt: "어제 19:10", team: "견적팀", name: "홍빛나리", customerType: "개인사업자", customerTypeDetail: "도윤컴퍼니", phone: "010-2930-0814", vehicle: "GV80", method: "할부", advisor: "이건수", statusGroup: "심사서류", status: "서류안내함", date: "어제 18:42", source: "대표전화", talkCount: "2/0", priority: "높음", nextAction: "사업자 매출 증빙 가능 서류 확인 후 심사 체크리스트 발송하고 할부 가능 금융사 먼저 좁히기", aiSummary: "사업자 증빙이 약해 승인 가능 금융사를 먼저 좁혀야 하며 할부 조건 변동 가능성이 있음" },
  { no: 11414, customerId: "CU-2605-0017", receivedAt: "2026-05-10 16:10", assignedAt: "5/10 16:30", team: "인천본사", name: "최유진", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-6251-8281", vehicle: "Model Y", method: "운용리스", advisor: "김지안", statusGroup: "계약완료", status: "출고완료", date: "5/10 16:10", source: "추천", talkCount: "4/1", priority: "완료", nextAction: "출고 전 시공 일정 안내와 인수 당일 안내 톤 친절하게 정리", aiSummary: "계약은 완료됐고 출고 전 시공 일정, 인수 안내, 첫 출고 경험 관리가 중요함" },
  { no: 11413, customerId: "CU-2605-0016", receivedAt: "2026-05-09 09:35", assignedAt: "5/09 10:02", team: "출고팀", name: "한지훈", customerType: "법인사업자", customerTypeDetail: "HJ모빌리티", phone: "010-5190-3811", vehicle: "GV80 Coupe", method: "장기렌트", advisor: "이주선", statusGroup: "계약완료", status: "배정완료", date: "5/09 09:35", source: "카카오", talkCount: "2/2", priority: "완료", nextAction: "탁송 시간 확정 후 보험 담보 재확인하고 법인 인수자 연락처 최종 체크", aiSummary: "출고 일정은 잡혔지만 법인 인수자 정보와 보험 담보 조건을 다시 확인할 필요가 있음" },
  { no: 11412, customerId: "CU-2605-0015", receivedAt: "2026-05-14 09:48", assignedAt: "오늘 10:00", team: "인천본사", name: "정다은", customerType: "개인", customerTypeDetail: "주부", phone: "010-2487-7710", vehicle: "싼타페", method: "장기렌트", advisor: "김지안", statusGroup: "관리중", status: "추후재컨택", date: "오늘 09:48", source: "카카오", talkCount: "0/1", priority: "보류", nextAction: "카톡 인사 완료 후 오후 6시 전 2차 재컨택", aiSummary: "패밀리카 목적이 뚜렷하고 월 납입금 70만원 이하를 희망하나 응답 대기 중" },
  { no: 11411, customerId: "CU-2605-0014", receivedAt: "2026-05-13 15:12", assignedAt: "어제 15:20", team: "상담팀", name: "오세린", customerType: "개인", customerTypeDetail: "프리랜서", phone: "010-6619-3240", vehicle: "Cooper Convertible", method: "운용리스", advisor: "이주선", statusGroup: "상담중", status: "구매방식상담중", date: "어제 15:12", source: "앱 상담원 연결", talkCount: "3/0", priority: "중간", nextAction: "리스와 렌트 차이 설명 후 첫 차 만기 인수 구조를 쉽게 안내하고 선호 방식 확정 필요", aiSummary: "첫 차 구매라 월 납입 구조와 만기 인수 방식을 이해하면 결정 속도가 빨라질 가능성" },
  { no: 11410, customerId: "CU-2605-0013", receivedAt: "2026-05-08 13:20", assignedAt: "5/08 13:45", team: "견적팀", name: "Daniel Kang", customerType: "개인사업자", customerTypeDetail: "현우스튜디오", phone: "010-9031-4208", vehicle: "Panamera", method: "운용리스", advisor: "이건수", statusGroup: "불발", status: "추후재컨택", date: "5/08 13:20", source: "디엘(상담)", talkCount: "1/0", priority: "낮음", nextAction: "희망 월납 조건 기록 후 30일 뒤 재컨택 후보로 보류", aiSummary: "희망 조건과 가능 금융 조건 차이가 커서 이탈했으며 단기 계약 가능성은 낮음" },
  { no: 11409, customerId: "CU-2605-0012", receivedAt: "2026-05-08 10:12", assignedAt: "5/08 10:30", team: "상담팀", name: "문태호", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-7130-2298", vehicle: "팰리세이드", method: "장기렌트", advisor: "김지안", statusGroup: "신규", status: "상담접수", date: "5/08 10:12", source: "앱 AI상담", talkCount: "0/0", priority: "높음", nextAction: "상담 목적 확인 후 렌트와 리스 차이 먼저 정리하고 패밀리 SUV 후보 유지", aiSummary: "패밀리 SUV를 탐색 중이며 렌트와 리스 차이를 먼저 이해해야 다음 견적 단계로 이동 가능" },
  { no: 11408, customerId: "CU-2605-0011", receivedAt: "2026-05-07 17:40", assignedAt: "5/07 18:00", team: "상담팀", name: "서하영", customerType: "개인", customerTypeDetail: "무직", phone: "010-9442-0185", vehicle: "E-Class", method: "운용리스", advisor: "이주선", statusGroup: "관리중", status: "조건재확인", date: "5/12 10:25", source: "소개", talkCount: "2/1", priority: "중간", nextAction: "월 납입 예산과 초기비용 상한선 다시 묻기", aiSummary: "수입 세단 선호가 강하지만 초기비용 최소화 요구가 있어 조건 재확인이 필요함" },
  { no: 11407, customerId: "CU-2605-0010", receivedAt: "2026-05-07 13:05", assignedAt: "5/07 13:30", team: "견적팀", name: "장우진", customerType: "개인사업자", customerTypeDetail: "우진상사", phone: "010-8851-7202", vehicle: "K8", method: "장기렌트", advisor: "이건수", statusGroup: "차량체크", status: "재고확인중", date: "5/12 09:40", source: "대표전화", talkCount: "2/0", priority: "높음", nextAction: "재고 가능 색상 확인 후 빠른 출고 조건 먼저 안내하고 국산 하이브리드 비교 유지", aiSummary: "빠른 출고 선호가 강하고 국산 하이브리드 후보를 함께 비교 중" },
  { no: 11406, customerId: "CU-2605-0009", receivedAt: "2026-05-06 16:24", assignedAt: "5/06 16:40", team: "계약팀", name: "김도현", customerType: "법인사업자", customerTypeDetail: "도현테크", phone: "010-3320-8541", vehicle: "GLE", method: "운용리스", advisor: "김지안", statusGroup: "계약완료", status: "딜러사계약중", date: "5/11 15:10", source: "앱 견적비교", talkCount: "5/1", priority: "완료", nextAction: "계약서 최종본 발송 후 출고 전 안내사항 정리하고 법인 서류 보관 확인", aiSummary: "조건 비교 후 계약 확정됐고 출고 전 일정 안내와 법인 서류 보관만 남아 있음" },
  { no: 11405, customerId: "CU-2605-0008", receivedAt: "2026-05-06 10:55", assignedAt: "5/06 11:10", team: "계약팀", name: "박준영", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-5102-6674", vehicle: "쏘렌토", method: "할부", advisor: "이주선", statusGroup: "불발", status: "계약취소", date: "5/10 13:35", source: "추천", talkCount: "3/1", priority: "보류", nextAction: "가족 반대 이슈 메모 후 2주 뒤 재컨택 명분 정리", aiSummary: "심사 조건은 가능했지만 가족 반대로 계약이 취소되어 재상담은 명분 정리가 필요함" },
  { no: 11404, customerId: "CU-2605-0007", receivedAt: "2026-05-05 14:18", assignedAt: "5/05 14:35", team: "출고팀", name: "이나경", customerType: "개인", customerTypeDetail: "프리랜서", phone: "010-3021-8891", vehicle: "Cybertruck", method: "운용리스", advisor: "김지안", statusGroup: "계약완료", status: "출고완료", date: "5/13 16:20", source: "앱 상담원 연결", talkCount: "4/2", priority: "완료", nextAction: "정산 입금 확인", aiSummary: "출고 완료 후 만족도는 높지만 정산 입금 확인과 후기 요청 타이밍을 함께 관리해야 함", settlementStatus: "정산대기", fee: "슬라이딩 118만원", cost: "시공비 42만원", margin: "예상 76만원" },
  { no: 11403, customerId: "CU-2605-0006", receivedAt: "2026-05-04 12:40", assignedAt: "5/04 13:00", team: "출고팀", name: "최민석", customerType: "개인사업자", customerTypeDetail: "민석디자인", phone: "010-9204-6811", vehicle: "5 Series", method: "운용리스", advisor: "이건수", statusGroup: "계약완료", status: "출고완료", date: "5/12 11:10", source: "유튜브", talkCount: "6/2", priority: "완료", nextAction: "수수료 입금 확인 후 세금계산서 보관 메모", aiSummary: "사업자 리스 출고가 완료됐고 세금계산서 안내는 끝났으며 정산 상태 확인만 남음", settlementStatus: "입금확인", fee: "수수료 152만원", cost: "탁송비 12만원", margin: "예상 140만원" },
  { no: 11402, customerId: "CU-2605-0005", receivedAt: "2026-05-03 09:55", assignedAt: "5/03 10:20", team: "출고팀", name: "홍유라", customerType: "법인사업자", customerTypeDetail: "유라컴퍼니", phone: "010-7412-6355", vehicle: "GV70", method: "장기렌트", advisor: "이주선", statusGroup: "계약완료", status: "출고완료", date: "5/11 10:30", source: "대표전화", talkCount: "5/0", priority: "완료", nextAction: "렌트사 정산 내역 대조 후 법인 증빙 파일 확인하고 정산 자료 누락 여부 체크", aiSummary: "법인 장기렌트 출고 완료 건으로 정산 자료와 법인 증빙 파일 확인이 필요함", settlementStatus: "정산중", fee: "렌트 수수료 96만원", cost: "시공비 35만원", margin: "예상 61만원" },
  { no: 11401, customerId: "CU-2605-0004", receivedAt: "2026-05-02 17:25", assignedAt: "5/02 17:40", team: "상담팀", name: "조민재", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-6702-1149", vehicle: "카니발", method: "장기렌트", advisor: "김지안", statusGroup: "불발", status: "지속적부재", date: "5/08 10:00", source: "카카오", talkCount: "1/2", priority: "보류", nextAction: "다자녀 패밀리카 문의 후 일주일 뒤 마지막 재컨택", aiSummary: "다자녀 패밀리카 문의 후 응답이 없어 마지막 재컨택 전까지 보류 관리가 적합함" },
  { no: 11400, customerId: "CU-2605-0003", receivedAt: "2026-05-02 11:08", assignedAt: "5/02 11:30", team: "상담팀", name: "윤세아", customerType: "개인", customerTypeDetail: "주부", phone: "010-8274-1102", vehicle: "A6", method: "운용리스", advisor: "이주선", statusGroup: "상담완료", status: "추후재컨택", date: "5/09 15:45", source: "소개", talkCount: "2/2", priority: "중간", nextAction: "배우자 상의 결과 확인 후 다음주 조건 재정리", aiSummary: "수입 세단 선호는 명확하지만 배우자 의사결정 영향이 커서 일정 관리가 중요함" },
  { no: 11399, customerId: "CU-2605-0002", receivedAt: "2026-05-01 15:33", assignedAt: "5/01 16:00", team: "상담팀", name: "임채원", customerType: "개인", customerTypeDetail: "무직", phone: "010-5592-3041", vehicle: "G80", method: "일시불", advisor: "이건수", statusGroup: "관리중", status: "구매시기미도래", date: "5/07 12:20", source: "앱 AI상담", talkCount: "1/0", priority: "낮음", nextAction: "구매 시점과 예산이 모두 미정이라 확정 전까지 보류하고 단기 후속 우선순위 낮게 관리", aiSummary: "구매 의사는 있으나 시점과 예산이 모두 미정이라 단기 후속 업무 우선순위는 낮음" },
  { no: 11398, customerId: "CU-2605-0001", receivedAt: "2026-05-01 10:05", assignedAt: "5/01 10:30", team: "상담팀", name: "한소희", customerType: "개인사업자", customerTypeDetail: "소희샵", phone: "010-4037-5518", vehicle: "XC90", method: "운용리스", advisor: "김지안", statusGroup: "상담완료", status: "재상담대기", date: "5/06 18:10", source: "디엘(상담)", talkCount: "3/1", priority: "중간", nextAction: "6월 프로모션 공개 시 XC90 조건 재안내하고 안전성/브랜드 이미지 선호 반영", aiSummary: "안전성과 브랜드 이미지를 중시하며 6월 조건을 기다리는 상담완료 고객" },
];
