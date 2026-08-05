export type CustomerMode = "all" | "consulting" | "contract" | "delivery" | "settlement" | "hold";
export type CustomerChanceOption = "높음" | "중간" | "낮음" | "보류" | "확정";
export type CustomerManageStatus = "정상" | "확인필요" | "재문의" | "지연" | "장기방치";

export type Customer = {
  id?: string;
  appUserId?: string | null; // 앱 profiles.id. 수기 고객/목업은 없음 — 채팅 고객 매칭용
  no: number;
  customerId: string;
  receivedAt: string;
  assignedAt: string;
  team: string;
  name: string;
  customerType: string;
  customerTypeDetail: string;
  phone: string; // 주 번호 표시값 — 서버 합성(앱 연결이면 profiles.phone_number, 아니면 crm phone)
  phoneSecondary?: string; // 추가 연락처(상담사 소유·항상 편집 가능) — 매칭에 쓰지 않는다(2026-07-17 spec)
  vehicle: string;
  vehicleTrim?: string;
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
  // 최신 미완료 할일 id — 상담 메모 인라인 편집(0726 실저장)의 수정/삭제 대상. 실데이터 전용(목업 행 없음).
  nextActionTaskId?: string | null;
  aiSummary: string;
  lastActivityAt?: string | null; // 서버 파생 최근 담당자 활동(ISO) — 관리 상태 계산 입력
  recontacted?: boolean;
  manageStatus?: string | null; // 수동 관리 상태(⑦-① 스누즈) — manageStatusAt >= lastActivityAt일 때만 유효
  manageStatusAt?: string | null;
  deliveryMethod?: string; // need_delivery_method 표시값 — 출고 콘솔 '인도 방식' 컬럼(편집은 상세 니즈에서)
  nextDeliverySchedule?: NextDeliverySchedule | null; // 서버 파생 다음 출고 예정(목록 전용 — 상세엔 schedules 원본이 있다)
  delivery?: CustomerDeliveryInfo | null; // 서버 파생 출고 정보(목록 전용 — delivery mode가 소비)
  contractingQuote?: ContractingQuoteSummary | null; // 출고 정보 프리필 소스(소프트 파이프)
  /** 서버 파생 정산(목록 전용 — settlement mode가 소비). **admin 응답에만 값이 있다** — 그 외
   * 역할은 서버가 null로 비운다(`src/lib/settlement-visibility.ts`).
   * ⚠️ 구 목업 필드 `settlementStatus`/`fee`/`cost`/`margin`(자유 문자열 4개)을 대체한다 —
   * 그것들은 이사님 확정 어휘("미정산"·"정산요청"·"정산완료")·타입(금액=number, 비용=배열,
   * 마진=미저장 파생)과 전부 어긋나 있었고 실데이터 경로가 없어 화면이 늘 비어 있었다. */
  settlement?: CustomerSettlement | null;
};

// 계약 가능성 옵션. CustomerManagementPage 가능성 popover·필터, CustomerDetailPage 상태 편집에 공유.
export const CHANCE_OPTIONS: readonly CustomerChanceOption[] = ["높음", "중간", "낮음", "보류", "확정"];

// 서류 분류 종류(닫힌 집합 22종). classifyDocumentFile(파일명 자동분류) 반환값과 동일.
// CustomerDetailPage 분류 select + seed-lookups(category="doc_type") 공유 SSOT.
export const DOC_TYPE_OPTIONS: readonly string[] = [
  "면허증",
  "주민등록등본",
  "원천징수영수증",
  "사업자등록증",
  "부가세과세증명원",
  "소득금액증명원",
  "자동이체통장사본",
  "매매계약서",
  "리스승인서",
  "계약사실확인서",
  "법인(점)주주명부",
  "법인(점)등기부등본",
  "법인(점)법인인감증명서",
  "법인(점)개인인감증명서",
  "법인(점)재무제표(당해)",
  "법인(점)재무제표(전기)",
  "등록(점)자동차등록증",
  "등록(점)세금계산서",
  "등록(점)취득세납부영수증",
  "등록(점)등록비영수증",
  "등록(점)보험가입증명서",
  "기타서류",
];

// 유입 경로(source) — 자동/수동 + 합본. kim-status-fields가 re-export, seed/검증에 공유.
// 앱 견적요청 승격 고객의 source 값 — 서버 승격 INSERT(db/queries/quote-requests)와 클라 prefetch 비교
// (CustomerManagementPage)가 공유하는 named const. SOURCE_AUTOMATIC_OPTIONS[0]이 이 상수를 참조해
// 닫힌 집합(customers_source_check) 원소임이 구조적으로 보장된다 — 어휘 개명(0015 '앱 견적비교' 전례) 시
// 여기 한 곳 수정. 단 업무 AI 코퍼스 근거 라벨(assistant-corpus LABEL)은 별개 문자열(재임베딩 결합 금지).
export const APP_QUOTE_REQUEST_SOURCE = "앱 견적요청";
// 앱 상담신청(public.consultations) 승격 고객의 source 값. 견적요청과 같은 이유로 named const —
// 서버 승격 INSERT(db/queries/consultations)와 닫힌 집합(customers_source_check) 원소임이 구조적으로 보장.
export const APP_CONSULTATION_SOURCE = "앱 상담신청";
export const SOURCE_AUTOMATIC_OPTIONS: readonly string[] = [
  APP_QUOTE_REQUEST_SOURCE,
  APP_CONSULTATION_SOURCE,
  "앱 AI상담",
  "앱 상담원 연결",
  "디엘(상담)",
  "디엘(견적서)",
];
export const SOURCE_MANUAL_OPTIONS: readonly string[] = ["대표전화", "카카오", "소개", "추천", "재구매", "유튜브", "검색", "기타"];
export const SOURCE_OPTIONS: readonly string[] = [...SOURCE_AUTOMATIC_OPTIONS, ...SOURCE_MANUAL_OPTIONS];
export const SOURCE_LEGACY_AUTOMATIC_OPTIONS: readonly string[] = ["디엘홈페이지"];

// 할일 분류(tasks.category) — 닫힌 6종.
export const TASK_CATEGORY_OPTIONS: readonly string[] = ["체크", "견적", "안내", "요청", "내부", "심사"];

// 출고 일정 타입 값 — 출고 콘솔·서버 파생 쿼리가 공유하고, 스프레드로 닫힌 집합
// (customer_schedules_type_check) 원소임이 구조적으로 보장된다(APP_QUOTE_REQUEST_SOURCE 선례).
// 값 변경 = CHECK 마이그 동반.
export const DELIVERY_SCHEDULE_TYPE = "출고";

// 일정 종류(schedules.type) — 닫힌 9종(0035에서 '출고' 추가).
export const SCHEDULE_TYPE_OPTIONS: readonly string[] = ["재연락", "결정확인", "체크", "견적", "안내", "요청", "내부", "심사", DELIVERY_SCHEDULE_TYPE];

// 목록 파생 '다음 출고 예정' — 서버 listCustomers 서브쿼리 ↔ 클라 표시·팝오버가 공유하는 shape.
// date = 'YYYY-MM-DD'(plain date, tz 없음), time = 'HH:mm[:ss]' | null. id = 팝오버 수정/삭제 대상.
export type NextDeliverySchedule = { id: string; date: string; time: string | null };

// 출고 정보(crm.customer_deliveries) — 목록 파생·팝오버 편집 공유 shape(2026-07-20 출고 2단계 spec §3).
// ⚠️ **정산 필드(settledAt·feeAmount)를 여기 넣지 말 것**(2026-08-03) — 이 타입은 고객 목록 응답에
// 실려 전 역할에게 나가는데, 정산은 admin 전용 축이다. 아래 CustomerSettlement가 별도로 담당한다.
export type CustomerDeliveryInfo = {
  contractVehicle: string | null;
  contractDate: string | null; // YYYY-MM-DD
  lender: string | null;
  deliveredDate: string | null; // YYYY-MM-DD — 차량 인도일
  /** 계약 확정일 — **실적 귀속 기준**(2026-08-03 이사님). 인도 후 URL 인증까지 끝난 날.
   * 현장에서는 이 확정을 "출고"라고 부르지만(화면 라벨도 "전체 출고") 인도일과는 다른 사건이다. */
  contractConfirmedDate: string | null;
  deliveryMemo: string | null;
  sourceQuoteId: string | null;
};

// 정산 정보(crm.customer_deliveries의 admin 전용 2필드) — 읽기·쓰기 모두 admin만(유슨생 결정 2026-08-03).
// 같은 테이블에 살지만 **타입을 분리**한다: 출고 팝오버가 쓰는 CustomerDeliveryInfo에 섞이면
// 비admin 저장 요청이 정산 필드를 빈 값으로 실어 보내 덮어쓴다.
export type CustomerSettlement = {
  settledAt: string | null; // 입금일 YYYY-MM-DD
  feeAmount: number | null; // 실입금액(원) — 리스·렌트는 슬라이딩 수수료, 할부·중고리스는 입금액 자체
  costs: SettlementCost[]; // 비용 항목(빈 배열 = 비용 없음, null 아님 — 아래 주석 참조)
  status: SettlementStatus; // 진행 단계(기본 "미정산")
};

// 정산 비용 항목 종류(이사님 확정 2026-08-04). 처음 여쭀을 때의 "시공비"는 **썬팅·블랙박스로
// 나눠 담는 것**으로 확정됐고, 광택·언더코팅·PPF처럼 덜 잦은 시공은 별도 칸을 만들지 않고
// **"직접입력"**(항목명을 상담사가 직접 쓴다)으로 흡수한다.
// ⚠️ 자주 나가는 시공이 새로 생기면 여기에 한 줄 추가하는 것이 의도된 유지 경로다 — 직접입력에
// 계속 쌓으면 "광택에 얼마 썼나"를 집계할 수 없다(이사님께 그 트레이드오프를 설명하고 받은 결정).
export const SETTLEMENT_COST_KINDS = ["썬팅", "블랙박스", "탁송", "페이백", "직접입력"] as const;
export type SettlementCostKind = (typeof SETTLEMENT_COST_KINDS)[number];

// 비용 1건. **jsonb 배열로 저장한다**(컬럼 분리 아님) — "직접입력"이 라벨+금액 쌍이라 개수가
// 가변이고, 항목이 늘어날 때 마이그레이션이 필요 없다(위 상수 한 줄 + CHECK 갱신으로 끝난다).
export type SettlementCost = {
  kind: SettlementCostKind;
  /** "직접입력"일 때 상담사가 쓴 항목명(광택·언더코팅 등). 고정 4종은 null. */
  label: string | null;
  /** 원 단위 양수. **페이백도 양수로 담는다** — 부호를 뒤집어 빼면 마진이 실제보다 커진다. */
  amount: number;
};

// 정산 진행 단계(이사님 확정 2026-08-04) — **각 단계의 주체가 다르다**:
// 미정산 → **정산요청**(담당자가 관리자에게) → **정산완료**(관리자가 입금 확인 후).
// ⚠️ 정산 축은 admin 단독인데 요청은 담당자 행위라, 요청 전이만 별도 경로로 연다(spec §6).
// 담당자에게 금액(수수료·비용·마진)은 계속 보이지 않는다.
export const SETTLEMENT_STATUS_OPTIONS = ["미정산", "정산요청", "정산완료"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUS_OPTIONS)[number];

// 저장용 부분 patch — **읽기 타입(CustomerSettlement)과 분리한다.** 정산 팝오버는 입금일·실입금액만
// 보내고 비용·단계는 건드리지 않는 식으로 경로가 갈리는데, 전체 타입을 쓰면 안 보낸 필드가 빈 값으로
// 실려 나가 기존 값을 덮는다(출고 팝오버가 정산 필드를 덮지 않는 것과 같은 사유).
// 서버 upsert는 **전달된 키만 SET**한다.
export type CustomerSettlementPatch = Partial<CustomerSettlement>;

// 계약 진행(decision_status='contracting') 견적 요약 — 출고 정보 팝오버 프리필 소스(소프트 파이프, spec §4).
export type ContractingQuoteSummary = {
  id: string;
  brandName: string | null;
  modelName: string | null;
  trimName: string | null;
  purchaseMethod: string | null; // 대표 시나리오의 구매방식 — 계약·출고 목록의 구매방식 줄 정본(니즈보다 우선)
  lender: string | null; // 대표 시나리오(primary_scenario_id)의 금융사
};

// 고객 유형(customers.customer_type) — 닫힌 3종. 백엔드 zod·DB CHECK 공유.
export const CUSTOMER_TYPE_OPTIONS = ["개인", "개인사업자", "법인사업자"] as const;

// 구매 방식(quote_scenarios.purchase_method) — 닫힌 6종. CustomerDetailPage·백엔드 zod 공유.
export const PURCHASE_METHOD_OPTIONS = ["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"] as const;
export type PurchaseMethod = (typeof PURCHASE_METHOD_OPTIONS)[number];

// 실적(취급 규모) 산정 기준 — 이사님 확정 2026-08-03(spec 2026-08-03-crm-delivery-revenue-design §1a).
// 운용리스는 취득원가, 장기렌트는 최종 차량가로 센다.
//
// ⚠️ **여기 없는 구매방식은 실적이 0이 아니라 "집계 대상이 아니다"**. 할부·중고리스는 슬라이딩 수수료
// 개념이 없어 실입금액 자체가 매출이고 실적 지표를 따로 두지 않는다(이사님 명시). 금융리스·일시불은
// 아직 언급된 적이 없어 같은 취급으로 둔다 — 정의가 오면 여기 한 줄을 더한다.
// 단 **출고 대수에는 전 구매방식이 포함된다**(실적 금액만 갈린다).
export const REVENUE_BASIS_BY_PURCHASE_METHOD: Readonly<Record<string, "acquisitionCost" | "finalVehiclePrice">> = {
  운용리스: "acquisitionCost",
  장기렌트: "finalVehiclePrice",
};

// 계약기간(need_contract_term) — 다중선택 닫힌 5종. DB CHECK 없음(' · ' 구분 다중 저장, 0010서 CHECK DROP). purchase-meta SSOT 공유.
export const CONTRACT_TERM_OPTIONS: readonly string[] = ["12개월", "24개월", "36개월", "48개월", "60개월"];

// 연간 주행거리(need_annual_mileage) — 단일선택 닫힌 8종. DB CHECK·purchase-meta 공유 SSOT.
export const ANNUAL_MILEAGE_OPTIONS: readonly string[] = ["10,000km", "15,000km", "20,000km", "25,000km", "30,000km", "35,000km", "40,000km", "무제한"];

// 인도 방식(need_delivery_method) — 단일선택 닫힌 4종. DB CHECK·purchase-meta 공유 SSOT.
export const DELIVERY_METHOD_OPTIONS: readonly string[] = ["탁송 요청", "매장 출고", "직접 수령", "협의 필요"];

// 단·다중선택 구매조건 공통 "아무것도 선택 안함" sentinel. 단일선택(연간주행·인도방식) CHECK 집합에만 옵션과 함께 포함(선택 해제 시 저장값).
export const PURCHASE_UNSET_SENTINEL = "확인 필요";

// 관리 상태(최종 업데이트) 옵션. CustomerManageStatus 유니온과 값이 1:1.
export const CUSTOMER_MANAGE_STATUSES: readonly CustomerManageStatus[] = ["정상", "확인필요", "재문의", "지연", "장기방치"];

// "아직 담당자 액션이 없는" 상태(1차 신규 + 2차 상담접수) — 목록 배지·필터·AI stale 리포트가 공통으로
// 제외하는 게이트. 클라(manage-status.deriveFinalUpdateInfo)와 서버(assistant-tools stale_customers)가
// 이 함수 1벌을 공유한다(리터럴 이중 정의 → 한쪽만 바뀌면 배지↔리포트가 조용히 드리프트하던 것 방지, 0714 배치5 3-A).
export function isPreActionStatus(statusGroup: string | null | undefined, status: string | null | undefined): boolean {
  return statusGroup === "신규" && status === "상담접수";
}

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

// 발주 경로 3종 — 견적함 "계약 진행" 마킹 넛지가 전이시킬 계약완료 2차 상태 후보(2026-07-21 이사님 ①ⓑ,
// delivery-step2 spec §8). 배정완료·출고완료는 발주 이후 단계라 제외. 계약완료 어휘의 부분집합 —
// customers.test.ts가 드리프트를 잠근다.
export const CONTRACT_ORDER_PATH_STATUSES: readonly string[] = ["딜러사계약중", "대리점발주중", "특판발주중"];

// 종결 3그룹 — 더 이상 담당자 액션이 남지 않은 상태. 아래 진행중 파생의 재료라 export하지 않는다
// (밖에서 넓히면 "진행중"의 정의가 두 곳에서 결정된다).
const CLOSED_STATUS_GROUPS: readonly string[] = ["상담완료", "계약완료", "불발"];

// 경영 리포트 "상담 진행중" 집계 대상(2026-08-02 리포트 spec §2). 리터럴 사본이 아니라
// customerStatusGroups에서 종결 3그룹을 뺀 **파생**이다(delivery-console의 DELIVERY_STAGES 선례) —
// 새 상태 그룹이 추가되면 자동으로 진행중에 들어오고, 그게 종결 성격이면 위 CLOSED에 넣어야 한다.
export const IN_PROGRESS_STATUS_GROUPS: readonly string[] = Object.keys(customerStatusGroups).filter(
  (group) => !CLOSED_STATUS_GROUPS.includes(group),
);

// 리포트 "계약 완료" 집계 대상. 전이 시각이 없어 월 스코프가 불가능한 스냅샷 지표다(spec §2a).
export const CONTRACTED_STATUS_GROUP = "계약완료";

// 고객 관리 서브메뉴·헤더 타이틀/서브타이틀의 단일 소스. 키 순서 = 사이드바 서브메뉴 순서.
export const customerModeMeta: Record<CustomerMode, { title: string; desc: string }> = {
  all: { title: "전체 보기", desc: "고객 정보, 상담 상태, 담당자, 유입 경로를 빠르게 찾고 분류합니다." },
  consulting: { title: "상담 필요", desc: "계약 전 상담, 견적, 재응대가 필요한 미배정 고객 업무함입니다. 담당자가 배정되면 목록에서 빠집니다." },
  contract: { title: "계약 관리", desc: "심사, 계약 완료, 계약 취소 고객의 계약 실무를 관리합니다." },
  delivery: { title: "출고 관리", desc: "계약완료 고객의 발주·배정·출고 일정을 단계별로 처리합니다." },
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
  { no: 11406, customerId: "CU-2605-0009", receivedAt: "2026-05-06 16:24", assignedAt: "5/06 16:40", team: "계약팀", name: "김도현", customerType: "법인사업자", customerTypeDetail: "도현테크", phone: "010-3320-8541", vehicle: "GLE", method: "운용리스", advisor: "김지안", statusGroup: "계약완료", status: "딜러사계약중", date: "5/11 15:10", source: "앱 견적요청", talkCount: "5/1", priority: "완료", nextAction: "계약서 최종본 발송 후 출고 전 안내사항 정리하고 법인 서류 보관 확인", aiSummary: "조건 비교 후 계약 확정됐고 출고 전 일정 안내와 법인 서류 보관만 남아 있음" },
  { no: 11405, customerId: "CU-2605-0008", receivedAt: "2026-05-06 10:55", assignedAt: "5/06 11:10", team: "계약팀", name: "박준영", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-5102-6674", vehicle: "쏘렌토", method: "할부", advisor: "이주선", statusGroup: "불발", status: "계약취소", date: "5/10 13:35", source: "추천", talkCount: "3/1", priority: "보류", nextAction: "가족 반대 이슈 메모 후 2주 뒤 재컨택 명분 정리", aiSummary: "심사 조건은 가능했지만 가족 반대로 계약이 취소되어 재상담은 명분 정리가 필요함" },
  { no: 11404, customerId: "CU-2605-0007", receivedAt: "2026-05-05 14:18", assignedAt: "5/05 14:35", team: "출고팀", name: "이나경", customerType: "개인", customerTypeDetail: "프리랜서", phone: "010-3021-8891", vehicle: "Cybertruck", method: "운용리스", advisor: "김지안", statusGroup: "계약완료", status: "출고완료", date: "5/13 16:20", source: "앱 상담원 연결", talkCount: "4/2", priority: "완료", nextAction: "정산 입금 확인", aiSummary: "출고 완료 후 만족도는 높지만 정산 입금 확인과 후기 요청 타이밍을 함께 관리해야 함", delivery: { contractVehicle: "Cybertruck", contractDate: "2026-05-05", lender: "iM캐피탈", deliveredDate: "2026-05-13", contractConfirmedDate: "2026-05-15", deliveryMemo: null, sourceQuoteId: null }, settlement: { settledAt: null, feeAmount: 1180000, costs: [{ kind: "썬팅", label: null, amount: 420000 }], status: "정산요청" } },
  { no: 11403, customerId: "CU-2605-0006", receivedAt: "2026-05-04 12:40", assignedAt: "5/04 13:00", team: "출고팀", name: "최민석", customerType: "개인사업자", customerTypeDetail: "민석디자인", phone: "010-9204-6811", vehicle: "5 Series", method: "운용리스", advisor: "이건수", statusGroup: "계약완료", status: "출고완료", date: "5/12 11:10", source: "유튜브", talkCount: "6/2", priority: "완료", nextAction: "수수료 입금 확인 후 세금계산서 보관 메모", aiSummary: "사업자 리스 출고가 완료됐고 세금계산서 안내는 끝났으며 정산 상태 확인만 남음", delivery: { contractVehicle: "5 Series", contractDate: "2026-05-04", lender: "BNK캐피탈", deliveredDate: "2026-05-12", contractConfirmedDate: "2026-05-14", deliveryMemo: null, sourceQuoteId: null }, settlement: { settledAt: "2026-05-20", feeAmount: 1520000, costs: [{ kind: "탁송", label: null, amount: 120000 }], status: "정산완료" } },
  { no: 11402, customerId: "CU-2605-0005", receivedAt: "2026-05-03 09:55", assignedAt: "5/03 10:20", team: "출고팀", name: "홍유라", customerType: "법인사업자", customerTypeDetail: "유라컴퍼니", phone: "010-7412-6355", vehicle: "GV70", method: "장기렌트", advisor: "이주선", statusGroup: "계약완료", status: "출고완료", date: "5/11 10:30", source: "대표전화", talkCount: "5/0", priority: "완료", nextAction: "렌트사 정산 내역 대조 후 법인 증빙 파일 확인하고 정산 자료 누락 여부 체크", aiSummary: "법인 장기렌트 출고 완료 건으로 정산 자료와 법인 증빙 파일 확인이 필요함", delivery: { contractVehicle: "GV70", contractDate: "2026-05-03", lender: "우리카드", deliveredDate: "2026-05-11", contractConfirmedDate: "2026-05-13", deliveryMemo: null, sourceQuoteId: null }, settlement: { settledAt: null, feeAmount: 960000, costs: [{ kind: "블랙박스", label: null, amount: 350000 }], status: "미정산" } },
  { no: 11401, customerId: "CU-2605-0004", receivedAt: "2026-05-02 17:25", assignedAt: "5/02 17:40", team: "상담팀", name: "조민재", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-6702-1149", vehicle: "카니발", method: "장기렌트", advisor: "김지안", statusGroup: "불발", status: "지속적부재", date: "5/08 10:00", source: "카카오", talkCount: "1/2", priority: "보류", nextAction: "다자녀 패밀리카 문의 후 일주일 뒤 마지막 재컨택", aiSummary: "다자녀 패밀리카 문의 후 응답이 없어 마지막 재컨택 전까지 보류 관리가 적합함" },
  { no: 11400, customerId: "CU-2605-0003", receivedAt: "2026-05-02 11:08", assignedAt: "5/02 11:30", team: "상담팀", name: "윤세아", customerType: "개인", customerTypeDetail: "주부", phone: "010-8274-1102", vehicle: "A6", method: "운용리스", advisor: "이주선", statusGroup: "상담완료", status: "추후재컨택", date: "5/09 15:45", source: "소개", talkCount: "2/2", priority: "중간", nextAction: "배우자 상의 결과 확인 후 다음주 조건 재정리", aiSummary: "수입 세단 선호는 명확하지만 배우자 의사결정 영향이 커서 일정 관리가 중요함" },
  { no: 11399, customerId: "CU-2605-0002", receivedAt: "2026-05-01 15:33", assignedAt: "5/01 16:00", team: "상담팀", name: "임채원", customerType: "개인", customerTypeDetail: "무직", phone: "010-5592-3041", vehicle: "G80", method: "일시불", advisor: "이건수", statusGroup: "관리중", status: "구매시기미도래", date: "5/07 12:20", source: "앱 AI상담", talkCount: "1/0", priority: "낮음", nextAction: "구매 시점과 예산이 모두 미정이라 확정 전까지 보류하고 단기 후속 우선순위 낮게 관리", aiSummary: "구매 의사는 있으나 시점과 예산이 모두 미정이라 단기 후속 업무 우선순위는 낮음" },
  { no: 11398, customerId: "CU-2605-0001", receivedAt: "2026-05-01 10:05", assignedAt: "5/01 10:30", team: "상담팀", name: "한소희", customerType: "개인사업자", customerTypeDetail: "소희샵", phone: "010-4037-5518", vehicle: "XC90", method: "운용리스", advisor: "김지안", statusGroup: "상담완료", status: "재상담대기", date: "5/06 18:10", source: "디엘(상담)", talkCount: "3/1", priority: "중간", nextAction: "6월 프로모션 공개 시 XC90 조건 재안내하고 안전성/브랜드 이미지 선호 반영", aiSummary: "안전성과 브랜드 이미지를 중시하며 6월 조건을 기다리는 상담완료 고객" },
];
