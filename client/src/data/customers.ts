export type CustomerMode = "all" | "consulting" | "contract" | "delivery" | "settlement" | "hold";

export type Customer = {
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
  nextAction: string;
  aiSummary: string;
  settlementStatus?: string;
  fee?: string;
  cost?: string;
  margin?: string;
};

export const customerStatusGroups: Record<string, string[]> = {
  신규: ["신규"],
  상담: ["상담중", "관리중", "상담완료"],
  견적: ["견적준비중", "차량체크중", "견적발송"],
  "심사/계약": ["심사서류안내", "계약완료", "계약취소"],
  출고: ["출고예정", "출고완료"],
  재응대: ["부재(1차 부재중)", "부재(카톡인사)", "부재(미응답)", "재컨택완료"],
  종료: ["미정", "불발"],
};

export const customerModeMeta: Record<CustomerMode, { title: string; desc: string }> = {
  all: { title: "전체 보기", desc: "모든 고객 DB를 한 화면에서 확인합니다." },
  consulting: { title: "상담 필요", desc: "계약 전 상담, 견적, 재응대가 필요한 고객 업무함입니다." },
  contract: { title: "계약 관리", desc: "심사, 계약 완료, 계약 취소 고객의 계약 실무를 관리합니다." },
  delivery: { title: "출고 관리", desc: "출고 예정과 출고 완료 전후의 안내 업무를 관리합니다." },
  settlement: { title: "출고 정산", desc: "출고 완료 이후 수수료, 비용, 마진 정산이 필요한 고객입니다." },
  hold: { title: "보류 / 이탈", desc: "미응답, 미정, 불발, 계약취소 고객의 재컨택 여부를 관리합니다." },
};

export const initialCustomers: Customer[] = [
  { no: 11417, customerId: "C-000128", receivedAt: "2026-05-14 12:56", assignedAt: "오늘 13:04", team: "인천본사", name: "김민준", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-4382-2190", vehicle: "BMW X3 / GLC", method: "운용리스", advisor: "지안", statusGroup: "견적", status: "견적발송", date: "오늘 14:20", source: "유튜브", talkCount: "3/1", priority: "긴급", nextAction: "GLC 재고 확인 후 비교 견적 재송출", aiSummary: "X3/GLC 비교, 중도해지 리스크와 총비용에 민감" },
  { no: 11416, customerId: "C-000129", receivedAt: "2026-05-14 11:05", assignedAt: "오늘 11:18", team: "인천본사", name: "박서연", customerType: "개인", customerTypeDetail: "프리랜서", phone: "010-7715-0931", vehicle: "Model Y", method: "장기렌트", advisor: "선생님", statusGroup: "견적", status: "견적준비중", date: "오늘 11:05", source: "앱 AI상담", talkCount: "1/0", priority: "높음", nextAction: "보증금 0/10/20% 조건별 견적 작성", aiSummary: "초기비용 0원 선호, 보험 포함 여부를 궁금해함" },
  { no: 11415, customerId: "C-000130", receivedAt: "2026-05-13 18:42", assignedAt: "어제 19:10", team: "견적팀", name: "이도윤", customerType: "개인사업자", customerTypeDetail: "도윤컴퍼니", phone: "010-2930-4418", vehicle: "GV80", method: "할부", advisor: "제프", statusGroup: "심사/계약", status: "심사서류안내", date: "어제 18:42", source: "검색", talkCount: "2/0", priority: "높음", nextAction: "개인사업자 심사 서류 체크리스트 발송", aiSummary: "사업자 증빙이 약해 승인 가능 금융사 우선 확인 필요" },
  { no: 11414, customerId: "C-000131", receivedAt: "2026-05-10 16:10", assignedAt: "5/10 16:30", team: "인천본사", name: "최유진", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-6251-8281", vehicle: "Model Y", method: "리스", advisor: "지안", statusGroup: "심사/계약", status: "계약완료", date: "5/10 16:10", source: "추천", talkCount: "4/1", priority: "완료", nextAction: "출고 전 시공 일정 안내", aiSummary: "계약 완료, 출고 경험 관리가 중요한 고객" },
  { no: 11413, customerId: "C-000132", receivedAt: "2026-05-09 09:35", assignedAt: "5/09 10:02", team: "출고팀", name: "한지훈", customerType: "법인사업자", customerTypeDetail: "HJ모빌리티", phone: "010-5190-3811", vehicle: "GV80", method: "장기렌트", advisor: "선생님", statusGroup: "출고", status: "출고예정", date: "5/09 09:35", source: "카카오", talkCount: "2/2", priority: "완료", nextAction: "탁송 시간 확정 및 보험 담보 확인", aiSummary: "출고 일정 확인 단계, 계약 조건 재확인 요청 가능성" },
  { no: 11412, customerId: "C-000133", receivedAt: "2026-05-14 09:48", assignedAt: "오늘 10:00", team: "인천본사", name: "정다은", customerType: "개인", customerTypeDetail: "주부", phone: "010-2487-7710", vehicle: "싼타페 Hybrid", method: "장기렌트", advisor: "지안", statusGroup: "재응대", status: "부재(카톡인사)", date: "오늘 09:48", source: "카카오", talkCount: "0/1", priority: "보류", nextAction: "카톡 인사 후 2차 재컨택 예약", aiSummary: "패밀리카 목적, 월 납입금 70만원 이하 희망" },
  { no: 11411, customerId: "C-000134", receivedAt: "2026-05-13 15:12", assignedAt: "어제 15:20", team: "상담팀", name: "오세린", customerType: "개인", customerTypeDetail: "프리랜서", phone: "010-6619-3240", vehicle: "MINI Cooper", method: "운용리스", advisor: "선생님", statusGroup: "상담", status: "상담중", date: "어제 15:12", source: "앱 상담원 연결", talkCount: "3/0", priority: "중간", nextAction: "리스/렌트 차이 설명 후 선호 방식 확정", aiSummary: "첫 차 구매, 월 납입과 만기 인수 구조 이해 필요" },
  { no: 11410, customerId: "C-000135", receivedAt: "2026-05-08 13:20", assignedAt: "5/08 13:45", team: "견적팀", name: "강현우", customerType: "개인사업자", customerTypeDetail: "현우스튜디오", phone: "010-9031-4208", vehicle: "911 Carrera", method: "리스", advisor: "제프", statusGroup: "종료", status: "불발", date: "5/08 13:20", source: "유튜브", talkCount: "1/0", priority: "낮음", nextAction: "30일 후 재컨택 후보", aiSummary: "희망 조건과 가능 금융 조건 차이가 커서 이탈" },
  { no: 11409, customerId: "C-000136", receivedAt: "2026-05-08 10:12", assignedAt: "5/08 10:30", team: "상담팀", name: "문태호", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-7130-2298", vehicle: "팰리세이드 Hybrid", method: "장기렌트", advisor: "지안", statusGroup: "신규", status: "신규", date: "5/08 10:12", source: "앱 AI상담", talkCount: "0/0", priority: "높음", nextAction: "상담 목적 확인 후 구매 방식 분류", aiSummary: "패밀리 SUV 탐색, 렌트와 리스 차이 질문" },
  { no: 11408, customerId: "C-000137", receivedAt: "2026-05-07 17:40", assignedAt: "5/07 18:00", team: "상담팀", name: "서하영", customerType: "개인", customerTypeDetail: "무직", phone: "010-9442-0185", vehicle: "C-Class", method: "리스", advisor: "선생님", statusGroup: "상담", status: "관리중", date: "5/12 10:25", source: "소개", talkCount: "2/1", priority: "중간", nextAction: "월 납입 예산 재확인", aiSummary: "수입 세단 선호, 초기비용 최소화 희망" },
  { no: 11407, customerId: "C-000138", receivedAt: "2026-05-07 13:05", assignedAt: "5/07 13:30", team: "견적팀", name: "장우진", customerType: "개인사업자", customerTypeDetail: "우진상사", phone: "010-8851-7202", vehicle: "K8 Hybrid", method: "장기렌트", advisor: "제프", statusGroup: "견적", status: "차량체크중", date: "5/12 09:40", source: "검색", talkCount: "2/0", priority: "높음", nextAction: "재고 가능 색상 확인", aiSummary: "빠른 출고 선호, 국산 하이브리드 비교 중" },
  { no: 11406, customerId: "C-000139", receivedAt: "2026-05-06 16:24", assignedAt: "5/06 16:40", team: "계약팀", name: "김도현", customerType: "법인사업자", customerTypeDetail: "도현테크", phone: "010-3320-8541", vehicle: "E-Class", method: "운용리스", advisor: "지안", statusGroup: "심사/계약", status: "계약완료", date: "5/11 15:10", source: "유튜브", talkCount: "5/1", priority: "완료", nextAction: "계약서 최종본 고객 발송", aiSummary: "조건 비교 후 계약 확정, 출고 전 안내 필요" },
  { no: 11405, customerId: "C-000140", receivedAt: "2026-05-06 10:55", assignedAt: "5/06 11:10", team: "계약팀", name: "박준영", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-5102-6674", vehicle: "쏘렌토 Hybrid", method: "할부", advisor: "선생님", statusGroup: "심사/계약", status: "계약취소", date: "5/10 13:35", source: "추천", talkCount: "3/1", priority: "보류", nextAction: "취소 사유 정리 후 2주 뒤 재컨택", aiSummary: "심사 조건은 가능했으나 가족 반대로 계약 취소" },
  { no: 11404, customerId: "C-000141", receivedAt: "2026-05-05 14:18", assignedAt: "5/05 14:35", team: "출고팀", name: "이나경", customerType: "개인", customerTypeDetail: "프리랜서", phone: "010-3021-8891", vehicle: "Tesla Model 3", method: "리스", advisor: "지안", statusGroup: "출고", status: "출고완료", date: "5/13 16:20", source: "앱 상담원 연결", talkCount: "4/2", priority: "완료", nextAction: "정산 입금 확인", aiSummary: "출고 완료, 고객 만족도 높음. 정산 확인 필요", settlementStatus: "정산대기", fee: "슬라이딩 118만원", cost: "시공비 42만원", margin: "예상 76만원" },
  { no: 11403, customerId: "C-000142", receivedAt: "2026-05-04 12:40", assignedAt: "5/04 13:00", team: "출고팀", name: "최민석", customerType: "개인사업자", customerTypeDetail: "민석디자인", phone: "010-9204-6811", vehicle: "BMW 520i", method: "운용리스", advisor: "제프", statusGroup: "출고", status: "출고완료", date: "5/12 11:10", source: "유튜브", talkCount: "6/2", priority: "완료", nextAction: "금융사 수수료 입금 확인", aiSummary: "사업자 리스 출고 완료, 세금계산서 안내 완료", settlementStatus: "입금확인", fee: "수수료 152만원", cost: "탁송비 12만원", margin: "예상 140만원" },
  { no: 11402, customerId: "C-000143", receivedAt: "2026-05-03 09:55", assignedAt: "5/03 10:20", team: "출고팀", name: "홍유라", customerType: "법인사업자", customerTypeDetail: "유라컴퍼니", phone: "010-7412-6355", vehicle: "GV70", method: "장기렌트", advisor: "선생님", statusGroup: "출고", status: "출고완료", date: "5/11 10:30", source: "검색", talkCount: "5/0", priority: "완료", nextAction: "렌트사 정산 내역 대조", aiSummary: "법인 장기렌트 출고 완료, 정산 자료 확인 필요", settlementStatus: "정산중", fee: "렌트 수수료 96만원", cost: "시공비 35만원", margin: "예상 61만원" },
  { no: 11401, customerId: "C-000144", receivedAt: "2026-05-02 17:25", assignedAt: "5/02 17:40", team: "상담팀", name: "조민재", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-6702-1149", vehicle: "카니발", method: "장기렌트", advisor: "지안", statusGroup: "재응대", status: "부재(미응답)", date: "5/08 10:00", source: "카카오", talkCount: "1/2", priority: "보류", nextAction: "일주일 뒤 마지막 재컨택", aiSummary: "다자녀 패밀리카 문의 후 응답 없음" },
  { no: 11400, customerId: "C-000145", receivedAt: "2026-05-02 11:08", assignedAt: "5/02 11:30", team: "상담팀", name: "윤세아", customerType: "개인", customerTypeDetail: "주부", phone: "010-8274-1102", vehicle: "Audi A6", method: "리스", advisor: "선생님", statusGroup: "재응대", status: "재컨택완료", date: "5/09 15:45", source: "소개", talkCount: "2/2", priority: "중간", nextAction: "배우자와 상의 후 다음주 조건 재확인", aiSummary: "수입 세단 선호, 배우자 의사결정 영향 큼" },
  { no: 11399, customerId: "C-000146", receivedAt: "2026-05-01 15:33", assignedAt: "5/01 16:00", team: "상담팀", name: "임채원", customerType: "개인", customerTypeDetail: "무직", phone: "010-5592-3041", vehicle: "Genesis G80", method: "현금", advisor: "제프", statusGroup: "종료", status: "미정", date: "5/07 12:20", source: "앱 AI상담", talkCount: "1/0", priority: "낮음", nextAction: "구매 시점 확정 전까지 보류", aiSummary: "구매 의사는 있으나 시점과 예산 미정" },
  { no: 11398, customerId: "C-000147", receivedAt: "2026-05-01 10:05", assignedAt: "5/01 10:30", team: "상담팀", name: "한소희", customerType: "개인사업자", customerTypeDetail: "소희샵", phone: "010-4037-5518", vehicle: "Volvo XC60", method: "운용리스", advisor: "지안", statusGroup: "상담", status: "상담완료", date: "5/06 18:10", source: "유튜브", talkCount: "3/1", priority: "중간", nextAction: "6월 프로모션 나오면 재안내", aiSummary: "안전성과 브랜드 이미지 중시, 6월 조건 대기" },
];
