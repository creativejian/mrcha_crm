import { ArrowLeft, Bot, BriefcaseBusiness, CalendarClock, CarFront, Check, ChevronRight, FileText, FolderOpen, History, ListChecks, MapPin, Maximize2, MessageSquareText, Phone, RefreshCcw, Route, Send, Trash2, UserRound, Upload, X } from "lucide-react";
import { type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { customerStatusGroups, type Customer, type CustomerChanceOption, type CustomerManageStatus } from "@/data/customers";

type CustomerDetailPageProps = {
  customer: Customer;
  chanceOverride?: CustomerChanceOption;
  manageStatusOverride?: CustomerManageStatus;
  onBack: () => void;
  onFullScreen?: () => void;
  onEditorOpenChange?: (open: boolean) => void;
  onToast: (message: string) => void;
  onWorkflowChange?: (customerNo: number, next: { statusGroup?: string; status?: string; chance?: CustomerChanceOption; manageStatus?: CustomerManageStatus }) => void;
  variant?: "page" | "drawer";
};

type DetailMetric = {
  label: string;
  value: string;
  tone?: "accent" | "quiet";
};

type KimStatusFieldKey = "phone" | "job" | "location" | "source" | "advisor" | "assignedAt";
type KimWorkflowKey = "stage" | "chance" | "manage";
type KimCustomerType = "개인" | "개인사업자" | "법인사업자";
type KimAdvisorTeam = "인천본사" | "상담팀" | "견적팀" | "계약팀" | "출고팀";
type KimInitialCostKind = "무보증" | "보증금" | "선수금";
type KimInitialCostSelection = KimInitialCostKind | "";
type KimInitialCostUnit = "%" | "금액";
type KimPurchaseFloatingKind = "purchaseMethod" | "purchaseTiming" | "purchaseCostFocus" | "purchaseTerm" | "purchaseInitialCost" | "purchaseAnnualMileage" | "purchaseDeliveryMethod" | "purchaseCustomerNotes" | "purchaseReviewNotes";
type KimPurchasePopoverFrame = { align?: "left" | "right"; top: number; left: number };
type KimOpenEditor =
  | { kind: "status"; key: KimStatusFieldKey }
  | { kind: "workflow"; key: KimWorkflowKey }
  | { kind: "needs" }
  | { kind: "purchase" }
  | { kind: "purchaseMethod" }
  | { kind: "purchaseTiming" }
  | { kind: "purchaseCostFocus" }
  | { kind: "purchaseTerm" }
  | { kind: "purchaseInitialCost" }
  | { kind: "purchaseAnnualMileage" }
  | { kind: "purchaseDeliveryMethod" }
  | { kind: "purchaseCustomerNotes" }
  | { kind: "purchaseReviewNotes" }
  | { kind: "timeline" }
  | { kind: "schedule" };

type KimNeedsState = {
  model: string;
  trim: string;
  colors: string;
  method: string;
  memo: string;
};

type KimScheduleItem = {
  id: string;
  date: string;
  time: string;
  type: string;
  memo: string;
};

type KimCheckItem = {
  id: string;
  category: string;
  due: string;
  body: string;
};

type KimTimelineItem = {
  id?: string;
  kind: string;
  title: string;
  meta: string;
  body: string;
};

type KimCustomerMemoItem = {
  id: string;
  body: string;
  createdAt: string;
};

type KimRecentUpdate = {
  section: string;
  updatedAt: number;
};

const chanceByPriority: Record<string, string> = {
  긴급: "높음",
  높음: "높음",
  중간: "중간",
  낮음: "낮음",
  보류: "보류",
  완료: "확정",
};

const vehicleDetailByName: Record<string, DetailMetric[]> = {
  "Maybach S-Class": [
    { label: "모델", value: "Maybach S-Class" },
    { label: "트림", value: "S 500 4M Long" },
    { label: "비교 차종", value: "GLC · X3", tone: "accent" },
    { label: "핵심 조건", value: "총비용 · 중도해지 리스크" },
  ],
  팰리세이드: [
    { label: "모델", value: "팰리세이드" },
    { label: "트림", value: "2.5T 하이브리드 · 9인승" },
    { label: "용도", value: "패밀리 SUV" },
    { label: "핵심 조건", value: "렌트와 리스 차이 이해" },
  ],
  GV80: [
    { label: "모델", value: "GV80" },
    { label: "트림", value: "2.5T 가솔린" },
    { label: "심사 포인트", value: "사업자 증빙", tone: "accent" },
    { label: "핵심 조건", value: "승인 금융사 우선 압축" },
  ],
};

function chanceLabel(customer: Customer) {
  if (customer.statusGroup === "계약완료" || customer.status === "출고완료") return "확정";
  if (customer.statusGroup === "불발") return "낮음";
  return chanceByPriority[customer.priority] ?? "중간";
}

function phoneChunks(phone: string) {
  const chunks = phone.split("-");
  return chunks.length === 3 ? chunks : [phone.slice(0, 3), phone.slice(3, 7), phone.slice(7)];
}

function sourceType(source: string) {
  if (source.includes("앱")) return "앱 유입";
  if (source.includes("카카오")) return "카카오";
  if (source.includes("대표전화")) return "전화";
  if (source.includes("디엘")) return "구DB";
  return "직접/소개";
}

function detailRows(customer: Customer): DetailMetric[] {
  return [
    { label: "고객번호", value: customer.customerId },
    { label: "고객유형", value: [customer.customerType, customer.customerTypeDetail].filter(Boolean).join(" · ") },
    { label: "연락처", value: customer.phone },
    { label: "접수", value: `${customer.source} · ${customer.receivedAt}` },
    { label: "배정", value: `${customer.advisor} · ${customer.assignedAt}` },
    { label: "응답", value: customer.talkCount === "0/0" ? "상담 시작 전" : `상담 ${customer.talkCount}` },
  ];
}

function vehicleRows(customer: Customer): DetailMetric[] {
  return vehicleDetailByName[customer.vehicle] ?? [
    { label: "모델", value: customer.vehicle },
    { label: "구매방식", value: customer.method },
    { label: "상담 상태", value: customer.status },
    { label: "핵심 조건", value: customer.nextAction },
  ];
}

function timelineRows(customer: Customer) {
  return [
    { kind: "접수", title: `${sourceType(customer.source)} 접수`, meta: customer.receivedAt, body: `${customer.source} 경로로 고객 문의가 들어왔습니다.` },
    { kind: "배정", title: `${customer.advisor} 상담사 배정`, meta: customer.assignedAt, body: `${customer.team} 기준으로 담당자를 배정했습니다.` },
    { kind: "상태", title: `${customer.statusGroup} > ${customer.status}`, meta: customer.date, body: "전체 보기의 진행 상태 컬럼과 동일한 업무 단계입니다." },
    { kind: "메모", title: "상담 메모 업데이트", meta: "최근", body: customer.nextAction },
  ];
}

const kimMinjunCustomerFields = [
  { label: "이름", value: "김민준" },
  { label: "연락처", value: "010-9588-0812" },
  { label: "거주지", value: "인천 · 상세 미확인" },
  { label: "고객유형", value: "개인 · 4대보험" },
  { label: "상담경로", value: "디엘(견적서)" },
  { label: "담당자", value: "미배정" },
];

const kimMinjunPurchaseFields = [
  { label: "구매방식", value: "운용리스" },
  { label: "계약기간", value: "60개월" },
  { label: "초기비용", value: "보증금 30%" },
  { label: "연간 주행거리", value: "확인 필요" },
  { label: "인도 방식", value: "협의 필요" },
  { label: "출고 희망 시기", value: "좋은 조건 즉시" },
  { label: "계약 포커스", value: "#월 납입 최소 #총 비용 최소 #빠른 출고" },
  { label: "고객 특이사항", value: "#카톡 선호 #가족과 상의" },
  { label: "심사 특이사항", value: "#4대보험 확인 #재직 확인 전" },
];

const kimMinjunCoreConditionFields = [
  { label: "관심 차종", value: "Maybach S-Class" },
  { label: "비교 차종", value: "GLC · X3" },
  { label: "구매방식", value: "운용리스" },
  { label: "구매시기", value: "좋은 조건 즉시" },
  { label: "예산 기준", value: "월 납입액 비교 필요" },
  { label: "확인 필요", value: "GLC 재고 · 보험 포함 · 해지 조건" },
];

const kimMinjunActionFields = [
  { label: "다음 액션", value: "GLC 재고 확인 후 X3 조건과 총비용 비교 견적 재송출" },
  { label: "처리 기한", value: "오늘 16:00 전" },
  { label: "담당", value: "김지안" },
  { label: "상태", value: "견적 재정리 필요" },
];

const kimMinjunStatusFieldMeta = [
  { key: "phone", label: "연락처", icon: Phone },
  { key: "job", label: "직군", icon: BriefcaseBusiness },
  { key: "location", label: "거주지", icon: MapPin },
  { key: "source", label: "상담경로", icon: Route },
  { key: "advisor", label: "담당자", icon: UserRound },
  { key: "assignedAt", label: "배정시간", icon: CalendarClock },
] satisfies { key: KimStatusFieldKey; label: string; icon: typeof Phone }[];

const kimMinjunInitialStatusValues: Record<KimStatusFieldKey, string> = {
  phone: "010-9588-0812",
  job: "개인 · 4대보험",
  location: "인천광역시",
  source: "디엘(견적서)",
  advisor: "미배정",
  assignedAt: "미배정",
};

const kimMinjunWorkflowMeta = [
  { key: "stage", label: "진행 상태", tone: "stage" },
  { key: "chance", label: "계약 가능성", tone: "chance" },
  { key: "manage", label: "관리 상태", tone: "normal" },
] satisfies { key: KimWorkflowKey; label: string; tone: string }[];

const kimChanceOptions: CustomerChanceOption[] = ["높음", "중간", "낮음", "보류", "확정"];
const kimMethodOptions = ["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"];
const kimContractTermOptions = ["12개월", "24개월", "36개월", "48개월", "60개월"];
const kimInitialCostKindOptions: KimInitialCostKind[] = ["무보증", "보증금", "선수금"];
const kimInitialCostUnitOptions: KimInitialCostUnit[] = ["%", "금액"];
const kimAnnualMileageOptions = ["10,000km", "15,000km", "20,000km", "25,000km", "30,000km", "35,000km", "40,000km", "무제한"];
const kimDeliveryMethodOptions = ["탁송 요청", "매장 출고", "직접 수령", "협의 필요"];
const kimTimingPresetOptions = ["좋은 조건 즉시", "이번 달", "다음 달", "3개월 이후"];
const kimTimingMonthOptions = Array.from({ length: 12 }, (_, index) => `${index + 1}월`);
const kimContractFocusOptions = ["무보증 선호", "월 납입 최소", "총 비용 최소", "반납 확정", "인수 확정", "승계 고려", "빠른 출고", "할인 민감", "승인 여부"];
const kimCustomerNoteOptions = ["연락 잘 됨", "연락 어려움", "특정 시간 연락", "카톡 선호", "통화 선호", "문자 선호", "가족과 상의", "비교 많음", "결정 빠름", "조건 수용 빠름", "신중함", "진행 잘 따라옴"];
const kimReviewNoteOptions = ["4대보험 확인", "재직 확인 전", "소득 증빙 필요", "신용점수 확인", "기대출 확인", "연체 이력 확인", "사업자 매출 확인", "공동명의 검토", "승인 우선"];
const kimPurchaseTagSelectionLimit = 4;
const kimCustomerTypeOptions: KimCustomerType[] = ["개인", "개인사업자", "법인사업자"];
const kimPersonalJobDetailOptions = ["4대보험", "프리랜서", "무직", "주부", "기타"];
const kimAutomaticSourceOptions = ["앱 견적비교", "앱 AI상담", "앱 상담원 연결", "디엘(상담)", "디엘(견적서)"];
const kimLegacyAutomaticSourceOptions = ["디엘홈페이지"];
const kimManualSourceOptions = ["대표전화", "카카오", "소개", "추천", "재구매", "유튜브", "검색", "기타"];
const kimAdvisorOptions: Record<KimAdvisorTeam, string[]> = {
  인천본사: ["김지안", "이주선"],
  상담팀: ["이주선", "김지안", "문태호"],
  견적팀: ["이건수", "김지안"],
  계약팀: ["김지안", "이주선"],
  출고팀: ["한지훈", "김지안"],
};
const kimRegionOptions: Record<string, string[]> = {
  "확인 필요": ["확인 필요"],
  서울특별시: ["확인 필요", "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"],
  경기도: ["확인 필요", "수원시", "성남시", "고양시", "용인시", "부천시", "안산시", "안양시", "남양주시", "화성시", "평택시", "의정부시", "시흥시", "파주시", "김포시", "광명시", "광주시", "군포시", "하남시", "오산시", "이천시", "안성시", "구리시", "의왕시", "양주시", "포천시", "여주시", "동두천시", "과천시"],
  인천광역시: ["확인 필요", "중구", "동구", "미추홀구", "연수구", "남동구", "부평구", "계양구", "서구", "강화군", "옹진군"],
  대전광역시: ["확인 필요", "동구", "중구", "서구", "유성구", "대덕구"],
  대구광역시: ["확인 필요", "중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군", "군위군"],
  울산광역시: ["확인 필요", "중구", "남구", "동구", "북구", "울주군"],
  부산광역시: ["확인 필요", "중구", "서구", "동구", "영도구", "부산진구", "동래구", "남구", "북구", "해운대구", "사하구", "금정구", "강서구", "연제구", "수영구", "사상구", "기장군"],
  광주광역시: ["확인 필요", "동구", "서구", "남구", "북구", "광산구"],
  강원도: ["확인 필요", "춘천시", "원주시", "강릉시", "동해시", "태백시", "속초시", "삼척시"],
  충북: ["확인 필요", "청주시", "충주시", "제천시"],
  "충남(세종)": ["확인 필요", "천안시", "공주시", "보령시", "아산시", "서산시", "논산시", "계룡시", "당진시", "세종시"],
  경북: ["확인 필요", "포항시", "경주시", "김천시", "안동시", "구미시", "영주시", "영천시", "상주시", "문경시", "경산시"],
  경남: ["확인 필요", "창원시", "진주시", "통영시", "사천시", "김해시", "밀양시", "거제시", "양산시"],
  전북: ["확인 필요", "전주시", "군산시", "익산시", "정읍시", "남원시", "김제시"],
  전남: ["확인 필요", "목포시", "여수시", "순천시", "나주시", "광양시"],
  제주: ["확인 필요", "제주시", "서귀포시"],
};

const kimInitialNeeds: KimNeedsState = {
  model: "Maybach S-Class",
  trim: "S 500 4M Long",
  colors: "외장 컬러 미정 · 내장 컬러 미정",
  method: "운용리스",
  memo: "월 납입액, 총비용, 중도해지 조건 차이를 비교하고 싶어함. GLC 재고 확인 후 X3 조건과 함께 다시 정리 필요.",
};

const kimMinjunQuoteHistory = [
  { title: "Maybach S 500 운용리스 1차 견적", meta: "오늘 14:20 · 앱 발송완료", status: "고객 확인 전" },
  { title: "GLC 재고 확인 후 비교 견적 예정", meta: "오늘 16:00 전 · 준비 필요", status: "대기" },
];

const kimMinjunDocumentVault = [
  { title: "운전면허증", status: "미수령" },
  { title: "재직/소득 서류", status: "미수령" },
  { title: "심사 신청서", status: "준비 전" },
  { title: "계약 서류", status: "준비 전" },
];

const kimCheckCategoryOptions = ["체크", "견적", "안내", "요청", "내부", "심사"];
const kimCheckDueOptions = ["오늘", "내일", "이번 주", "급함", "지정"];
const kimScheduleTypeOptions = ["재연락", "결정확인", "체크", "견적", "안내", "요청", "내부", "심사"];
const kimScheduleHourOptions = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const kimScheduleMinuteOptions = ["00", "10", "20", "30", "40", "50"];

const kimMinjunCheckItems: KimCheckItem[] = [
  { id: "glc-stock", category: "체크", due: "오늘", body: "GLC 재고 가능 여부 확인" },
  { id: "x3-cost", category: "견적", due: "오늘", body: "X3 조건과 총비용 비교" },
  { id: "insurance", category: "체크", due: "내일", body: "보험 포함 여부 확인" },
  { id: "lease-risk", category: "안내", due: "이번 주", body: "중도해지 조건 설명" },
];

const kimInitialCustomerMemos: KimCustomerMemoItem[] = [
  { id: "repurchase", body: "기존 고객 재구매 혜택 적용 가능성 확인 필요", createdAt: "오늘 13:18" },
  { id: "decision", body: "가족과 최종 조건을 상의한 뒤 진행 예정", createdAt: "오늘 13:42" },
  { id: "contact", body: "카톡 선호, 통화는 오후 시간대가 비교적 수월함", createdAt: "오늘 14:05" },
];

const kimInitialSchedules: KimScheduleItem[] = [
  { id: "glc-quote-followup", date: "2026-05-26", time: "16:00", type: "견적", memo: "GLC 재고 확인 후 X3 조건과 총비용 비교 견적 재발송" },
];

function formatKimRecentUpdateTime(updatedAt: number, now: number) {
  const elapsedMinutes = Math.max(0, Math.floor((now - updatedAt) / 60000));
  if (elapsedMinutes < 10) return "방금 전";
  if (elapsedMinutes < 60) return `${Math.floor(elapsedMinutes / 10) * 10}분 전`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}시간 전`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}일 전`;
  const date = new Date(updatedAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function KimMinjunDetailHeader({ now, recentUpdate }: { now: number; recentUpdate: KimRecentUpdate }) {
  return (
    <section className="customer-detail-summary kim-detail-summary">
      <div className="kim-header-main">
        <div className="kim-header-read">
          <div className="kim-header-primary">
            <h2 className="kim-header-breadcrumb">
              <span>고객 관리</span>
              <ChevronRight size={18} strokeWidth={2.2} />
              <span>김민준</span>
              <em className="kim-header-code-text num">CU-2605-0020</em>
              <em className="kim-header-received-text num">· 2026/06/09 12:56:39 접수</em>
            </h2>
            <p>
              {formatKimRecentUpdateTime(recentUpdate.updatedAt, now)}{" "}
              <span className="kim-header-update-mark">{recentUpdate.section} 업데이트</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function kimEditorMatches(openEditor: KimOpenEditor | null, next: KimOpenEditor) {
  if (!openEditor || openEditor.kind !== next.kind) return false;
  if (openEditor.kind === "needs" && next.kind === "needs") return true;
  if (openEditor.kind === "purchase" && next.kind === "purchase") return true;
  if (openEditor.kind === "purchaseMethod" && next.kind === "purchaseMethod") return true;
  if (openEditor.kind === "purchaseTiming" && next.kind === "purchaseTiming") return true;
  if (openEditor.kind === "purchaseCostFocus" && next.kind === "purchaseCostFocus") return true;
  if (openEditor.kind === "purchaseTerm" && next.kind === "purchaseTerm") return true;
  if (openEditor.kind === "purchaseInitialCost" && next.kind === "purchaseInitialCost") return true;
  if (openEditor.kind === "purchaseAnnualMileage" && next.kind === "purchaseAnnualMileage") return true;
  if (openEditor.kind === "purchaseDeliveryMethod" && next.kind === "purchaseDeliveryMethod") return true;
  if (openEditor.kind === "purchaseCustomerNotes" && next.kind === "purchaseCustomerNotes") return true;
  if (openEditor.kind === "purchaseReviewNotes" && next.kind === "purchaseReviewNotes") return true;
  if (openEditor.kind === "timeline" && next.kind === "timeline") return true;
  if (openEditor.kind === "schedule" && next.kind === "schedule") return true;
  if (openEditor.kind === "status" && next.kind === "status") return openEditor.key === next.key;
  if (openEditor.kind === "workflow" && next.kind === "workflow") return openEditor.key === next.key;
  return false;
}

function fieldLabel(key: KimStatusFieldKey) {
  return kimMinjunStatusFieldMeta.find((field) => field.key === key)?.label ?? "항목";
}

function formatKimNumberWithCommas(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("ko-KR");
}

function parseKimInitialCost(value: string) {
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

function kimPurchaseValueClass(value: string) {
  if (value === "미정") return "is-empty";
  if (value === "확인 필요") return "needs-confirmation";
  return "";
}

function isKimPurchaseTagField(label: string) {
  return label === "계약 포커스" || label === "고객 특이사항" || label === "심사 특이사항";
}

function kimPurchaseTags(value: string) {
  return value.split("#").map((tag) => tag.trim()).filter(Boolean).map((tag) => `#${tag}`);
}

function isKimPurchaseFloatingKind(kind: KimOpenEditor["kind"]): kind is KimPurchaseFloatingKind {
  return ["purchaseMethod", "purchaseTiming", "purchaseCostFocus", "purchaseTerm", "purchaseInitialCost", "purchaseAnnualMileage", "purchaseDeliveryMethod", "purchaseCustomerNotes", "purchaseReviewNotes"].includes(kind);
}

function kimPurchasePopoverSize(kind: KimPurchaseFloatingKind) {
  switch (kind) {
    case "purchaseMethod":
      return { width: 390, height: 48 };
    case "purchaseTiming":
      return { width: 318, height: 108 };
    case "purchaseCostFocus":
      return { width: 360, height: 118 };
    case "purchaseTerm":
      return { width: 352, height: 48 };
    case "purchaseInitialCost":
      return { width: 330, height: 146 };
    case "purchaseAnnualMileage":
      return { width: 360, height: 88 };
    case "purchaseDeliveryMethod":
      return { width: 340, height: 48 };
    case "purchaseCustomerNotes":
      return { width: 380, height: 154 };
    case "purchaseReviewNotes":
      return { width: 380, height: 118 };
    default:
      return { width: 340, height: 120 };
  }
}

function calculateKimPurchasePopoverFrame(target: HTMLElement, kind: KimPurchaseFloatingKind): KimPurchasePopoverFrame {
  const rect = target.getBoundingClientRect();
  const gap = 8;
  const margin = 14;
  const { width, height } = kimPurchasePopoverSize(kind);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const alignRight = kind === "purchaseInitialCost" || kind === "purchaseTiming" || kind === "purchaseReviewNotes";
  const preferredLeft = alignRight
    ? rect.right
    : kind === "purchaseMethod" || kind === "purchaseTerm" || kind === "purchaseAnnualMileage" || kind === "purchaseDeliveryMethod" || kind === "purchaseCostFocus" || kind === "purchaseCustomerNotes"
    ? rect.left
    : rect.left + rect.width / 2 - width / 2;
  const maxLeft = alignRight ? viewportWidth - margin : Math.max(margin, viewportWidth - width - margin);
  const left = Math.min(Math.max(preferredLeft, margin), maxLeft);
  const belowTop = rect.bottom + gap;
  const aboveTop = rect.top - height - gap;
  const preferAbove = false;
  const top = (preferAbove || belowTop + height > viewportHeight - margin) && aboveTop >= margin
    ? aboveTop
    : Math.min(belowTop, Math.max(margin, viewportHeight - height - margin));
  return { align: alignRight ? "right" : "left", top, left };
}

function kimConsultKindClass(kind: string) {
  if (kind === "통화") return " call";
  if (kind === "카톡" || kind === "앱상담") return " chat";
  if (kind === "상태변경" || kind === "상태") return " status";
  if (kind === "메모") return " memo";
  return "";
}

function scheduleRecordKey(item: KimScheduleItem) {
  return item.id;
}

function formatKoreanPhoneInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function formatKoreanShortTime(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `오늘 ${hours}:${minutes}`;
}

function formatShortDateLabel(value: string) {
  const [, month, day] = value.split("-");
  if (!month || !day) return "지정";
  return `${Number(month)}/${Number(day)}`;
}

function formatScheduleDateLabel(value: string) {
  const [, month, day] = value.split("-");
  if (!month || !day) return value;
  return `${Number(month)}/${Number(day)}`;
}

function formatDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseScheduleTimeParts(value?: string) {
  const [rawHour, rawMinute] = (value || "10:00").split(":");
  const hour = kimScheduleHourOptions.includes(rawHour) ? rawHour : "10";
  const minute = kimScheduleMinuteOptions.includes(rawMinute) ? rawMinute : "00";
  return { hour, minute };
}

function scheduleTimeFromFormData(formData: FormData) {
  const hour = String(formData.get("scheduleHour") ?? "10");
  const minute = String(formData.get("scheduleMinute") ?? "00");
  const safeHour = kimScheduleHourOptions.includes(hour) ? hour : "10";
  const safeMinute = kimScheduleMinuteOptions.includes(minute) ? minute : "00";
  return `${safeHour}:${safeMinute}`;
}

function kimCheckDueSelection(value: string) {
  return kimCheckDueOptions.includes(value) ? value : "지정";
}

function parseKimCheckDueDate(value: string, date = new Date()) {
  const [month, day] = value.split("/");
  if (!month || !day) return "";
  return `${date.getFullYear()}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

function parseKimJobValue(value: string): { type: KimCustomerType; detail: string } {
  const [typeValue, detailValue] = value.split("·").map((part) => part.trim());
  const type = kimCustomerTypeOptions.includes(typeValue as KimCustomerType) ? typeValue as KimCustomerType : "개인";
  const fallbackDetail = type === "개인" ? "4대보험" : "";
  return { type, detail: detailValue || fallbackDetail };
}

function formatKimJobValue(type: KimCustomerType, detail: string) {
  const normalizedDetail = detail.trim() || (type === "개인" ? "4대보험" : "미입력");
  return `${type} · ${normalizedDetail}`;
}

function parseKimLocationValue(value: string) {
  const [provinceValue, detailValue] = value.split("·").map((part) => part.trim());
  const province = kimRegionOptions[provinceValue] ? provinceValue : "확인 필요";
  const detailOptions = kimRegionOptions[province];
  const detail = detailOptions.includes(detailValue) ? detailValue : "확인 필요";
  return { province, detail };
}

function formatKimLocationValue(province: string, detail: string) {
  if (province === "확인 필요") return "확인 필요";
  if (!detail || detail === "확인 필요") return province;
  return `${province} · ${detail}`;
}

function parseKimSourceValue(value: string) {
  const allOptions = [...kimAutomaticSourceOptions, ...kimManualSourceOptions];
  if (allOptions.includes(value)) return { selected: value, custom: "" };
  if (value === "디엘홈페이지") return { selected: "디엘(상담)", custom: "" };
  return { selected: "기타", custom: value };
}

function parseKimAdvisorValue(value: string): { team: KimAdvisorTeam; advisor: string } {
  const [advisorValue, teamValue] = value.split("·").map((part) => part.trim());
  const fallbackTeam: KimAdvisorTeam = "인천본사";
  const team = kimAdvisorOptions[teamValue as KimAdvisorTeam] ? teamValue as KimAdvisorTeam : fallbackTeam;
  const advisors = kimAdvisorOptions[team];
  const advisor = advisors.includes(advisorValue) ? advisorValue : advisors[0];
  return { team, advisor };
}

function formatKimAdvisorValue(team: KimAdvisorTeam, advisor: string) {
  if (!advisor || advisor === "미배정") return "미배정";
  return `${advisor} · ${team}`;
}

function formatKimAssignmentTime(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `오늘 ${hours}:${minutes}`;
}

function kimChanceOptionClass(option: CustomerChanceOption, selected: boolean) {
  const toneByChance: Record<CustomerChanceOption, string> = {
    높음: "chance-purple",
    중간: "chance-neutral",
    낮음: "chance-red",
    보류: "chance-yellow",
    확정: "chance-green",
  };
  return ["kim-chance-option", toneByChance[option], selected ? "active" : ""].filter(Boolean).join(" ");
}

function kimChanceValueClass(option: CustomerChanceOption) {
  const toneByChance: Record<CustomerChanceOption, string> = {
    높음: "chance-purple",
    중간: "chance-neutral",
    낮음: "chance-red",
    보류: "chance-yellow",
    확정: "chance-green",
  };
  return `kim-chance-value ${toneByChance[option]}`;
}

function isKimUnassignedStatus(key: KimStatusFieldKey, value: string) {
  return (key === "advisor" || key === "assignedAt") && value === "미배정";
}

function isKimAutomaticSource(value: string) {
  return kimAutomaticSourceOptions.includes(value) || kimLegacyAutomaticSourceOptions.includes(value);
}

function hasKimAppSourceQueue(value: string) {
  return value.includes("앱");
}

function hasKimQuoteAttachments(value: string) {
  return value === "디엘(견적서)";
}

const kimMockQuoteAttachments = [
  { label: "첨부 견적서 1", fileName: "첨부파일1" },
  { label: "첨부 견적서 2", fileName: "첨부파일2" },
];

function KimPhoneStatusInput({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const [replaceOnInput, setReplaceOnInput] = useState(true);

  function replaceInitialValue(nextValue: string) {
    setValue(formatKoreanPhoneInput(nextValue));
    setReplaceOnInput(false);
  }

  return (
    <input
      autoComplete="tel"
      autoFocus
      className={replaceOnInput ? "is-preview-value" : ""}
      inputMode="numeric"
      name="value"
      onBeforeInput={(event) => {
        if (!replaceOnInput || event.nativeEvent.inputType !== "insertText") return;
        event.preventDefault();
        replaceInitialValue(event.nativeEvent.data ?? "");
      }}
      onChange={(event) => {
        setValue(formatKoreanPhoneInput(event.currentTarget.value));
        setReplaceOnInput(false);
      }}
      onFocus={(event) => {
        event.currentTarget.setSelectionRange(0, 0);
      }}
      onKeyDown={(event) => {
        if (!replaceOnInput) return;
        if (/^\d$/.test(event.key)) {
          event.preventDefault();
          replaceInitialValue(event.key);
          return;
        }
        if (event.key !== "Backspace" && event.key !== "Delete") return;
        event.preventDefault();
        replaceInitialValue("");
      }}
      onPaste={(event: ReactClipboardEvent<HTMLInputElement>) => {
        if (!replaceOnInput) return;
        event.preventDefault();
        replaceInitialValue(event.clipboardData.getData("text"));
      }}
      placeholder="010-0000-0000"
      type="tel"
      value={value}
    />
  );
}

function KimJobStatusEditor({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const initialJob = parseKimJobValue(initialValue);
  const [customerType, setCustomerType] = useState<KimCustomerType>(initialJob.type);

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>직군 분류</span>
        <select
          autoFocus
          defaultValue={initialJob.type}
          name="customerType"
          onChange={(event) => setCustomerType(event.currentTarget.value as KimCustomerType)}
        >
          {kimCustomerTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      {customerType === "개인" ? (
        <label>
          <span>상세 분류</span>
          <select defaultValue={kimPersonalJobDetailOptions.includes(initialJob.detail) ? initialJob.detail : "4대보험"} name="customerTypeDetail">
            {kimPersonalJobDetailOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      ) : (
        <label>
          <span>{customerType === "개인사업자" ? "사업자명" : "법인명"}</span>
          <input defaultValue={initialJob.type === customerType ? initialJob.detail : ""} name="customerTypeDetail" placeholder={customerType === "개인사업자" ? "예: 도윤컴퍼니" : "예: HJ모빌리티"} />
        </label>
      )}
      <div className="kim-edit-actions">
        <button type="button" onClick={onCancel}>취소</button>
        <button className="primary" type="submit">저장</button>
      </div>
    </form>
  );
}

function KimLocationStatusEditor({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const initialLocation = parseKimLocationValue(initialValue);
  const [province, setProvince] = useState(initialLocation.province);
  const detailOptions = kimRegionOptions[province] ?? kimRegionOptions["확인 필요"];
  const detailValue = detailOptions.includes(initialLocation.detail) ? initialLocation.detail : "확인 필요";

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>거주지 수정</span>
        <select
          autoFocus
          defaultValue={initialLocation.province}
          name="province"
          onChange={(event) => setProvince(event.currentTarget.value)}
        >
          {Object.keys(kimRegionOptions).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>구/시 선택</span>
        <select key={province} defaultValue={detailValue} name="detail">
          {detailOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <div className="kim-edit-actions">
        <button type="button" onClick={onCancel}>취소</button>
        <button className="primary" type="submit">저장</button>
      </div>
    </form>
  );
}

function KimSourceStatusEditor({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const initialSource = parseKimSourceValue(initialValue);
  const [selectedSource, setSelectedSource] = useState(initialSource.selected);

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>상담경로 수정</span>
        <select
          autoFocus
          defaultValue={initialSource.selected}
          name="source"
          onChange={(event) => setSelectedSource(event.currentTarget.value)}
        >
          <optgroup label="자동 접수">
            {kimAutomaticSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </optgroup>
          <optgroup label="수동 접수">
            {kimManualSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </optgroup>
        </select>
      </label>
      {selectedSource === "기타" ? (
        <label>
          <span>기타 경로</span>
          <input defaultValue={initialSource.custom} name="customSource" placeholder="예: 블로그, 전시장 방문, 딜러 소개" />
        </label>
      ) : null}
      <div className="kim-edit-actions">
        <button type="button" onClick={onCancel}>취소</button>
        <button className="primary" type="submit">저장</button>
      </div>
    </form>
  );
}

function KimAdvisorStatusEditor({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const initialAdvisor = parseKimAdvisorValue(initialValue);
  const [team, setTeam] = useState<KimAdvisorTeam>(initialAdvisor.team);
  const advisorOptions = kimAdvisorOptions[team];
  const advisorValue = advisorOptions.includes(initialAdvisor.advisor) ? initialAdvisor.advisor : advisorOptions[0];

  return (
    <form className="kim-edit-form" onSubmit={onSubmit}>
      <label>
        <span>팀 선택</span>
        <select
          autoFocus
          defaultValue={initialAdvisor.team}
          name="team"
          onChange={(event) => setTeam(event.currentTarget.value as KimAdvisorTeam)}
        >
          {Object.keys(kimAdvisorOptions).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>담당자 선택</span>
        <select key={team} defaultValue={advisorValue} name="advisor">
          {advisorOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <div className="kim-edit-actions">
        <button type="button" onClick={onCancel}>취소</button>
        <button className="primary" type="submit">배정</button>
      </div>
    </form>
  );
}

function KimMinjunDetailContent({
  chanceOverride,
  customer,
  manageStatusOverride,
  onEditorOpenChange,
  onToast,
  onWorkflowChange,
}: {
  chanceOverride?: CustomerChanceOption;
  customer: Customer;
  manageStatusOverride?: CustomerManageStatus;
  onEditorOpenChange?: CustomerDetailPageProps["onEditorOpenChange"];
  onToast: (message: string) => void;
  onWorkflowChange?: CustomerDetailPageProps["onWorkflowChange"];
}) {
  const [statusValues, setStatusValues] = useState(kimMinjunInitialStatusValues);
  const [stageGroup, setStageGroup] = useState(customer.statusGroup);
  const [stageStatus, setStageStatus] = useState(customer.status);
  const [chance, setChance] = useState<CustomerChanceOption>(chanceOverride ?? chanceLabel(customer) as CustomerChanceOption);
  const [manage, setManage] = useState<CustomerManageStatus>(manageStatusOverride ?? "정상");
  const [needs, setNeeds] = useState<KimNeedsState>(kimInitialNeeds);
  const [purchaseFields, setPurchaseFields] = useState(kimMinjunPurchaseFields);
  const [showTimingMonths, setShowTimingMonths] = useState(false);
  const [initialCostKind, setInitialCostKind] = useState<KimInitialCostSelection>("보증금");
  const [initialCostUnit, setInitialCostUnit] = useState<KimInitialCostUnit>("%");
  const [initialCostAmount, setInitialCostAmount] = useState("30");
  const [purchasePopoverFrame, setPurchasePopoverFrame] = useState<KimPurchasePopoverFrame | null>(null);
  const [schedules, setSchedules] = useState<KimScheduleItem[]>(kimInitialSchedules);
  const [completedScheduleKeys, setCompletedScheduleKeys] = useState<string[]>([]);
  const [addingScheduleItem, setAddingScheduleItem] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [confirmingScheduleCompleteId, setConfirmingScheduleCompleteId] = useState<string | null>(null);
  const [confirmingScheduleDeleteId, setConfirmingScheduleDeleteId] = useState<string | null>(null);
  const [checkItems, setCheckItems] = useState<KimCheckItem[]>(kimMinjunCheckItems);
  const [completedCheckItems, setCompletedCheckItems] = useState<string[]>([]);
  const [addingCheckItem, setAddingCheckItem] = useState(false);
  const [selectedCheckDue, setSelectedCheckDue] = useState("오늘");
  const [selectedEditingCheckDue, setSelectedEditingCheckDue] = useState("오늘");
  const [editingCheckItemId, setEditingCheckItemId] = useState<string | null>(null);
  const [confirmingCheckItemTitle, setConfirmingCheckItemTitle] = useState<string | null>(null);
  const [confirmingCheckItemDeleteId, setConfirmingCheckItemDeleteId] = useState<string | null>(null);
  const [customerMemos, setCustomerMemos] = useState<KimCustomerMemoItem[]>(kimInitialCustomerMemos);
  const [addingCustomerMemo, setAddingCustomerMemo] = useState(false);
  const [editingCustomerMemoId, setEditingCustomerMemoId] = useState<string | null>(null);
  const [confirmingCustomerMemoDeleteId, setConfirmingCustomerMemoDeleteId] = useState<string | null>(null);
  const [openEditor, setOpenEditor] = useState<KimOpenEditor | null>(null);
  const [recentUpdate, setRecentUpdate] = useState<KimRecentUpdate>(() => ({ section: "고객 메모", updatedAt: Date.now() }));
  const [recentUpdateNow, setRecentUpdateNow] = useState(() => Date.now());
  const editorRef = useRef<HTMLDivElement>(null);
  const checkConfirmRef = useRef<HTMLDivElement>(null);
  const checkDeleteRef = useRef<HTMLDivElement>(null);
  const checkEditRef = useRef<HTMLFormElement>(null);
  const scheduleCompleteRef = useRef<HTMLDivElement>(null);
  const scheduleDeleteRef = useRef<HTMLDivElement>(null);
  const scheduleEditRef = useRef<HTMLFormElement>(null);
  const customerMemoDeleteRef = useRef<HTMLDivElement>(null);
  const customerMemoEditRef = useRef<HTMLFormElement>(null);
  const consultBodyRef = useRef<HTMLDivElement>(null);
  const customerMemoBodyRef = useRef<HTMLDivElement>(null);
  const checkBodyRef = useRef<HTMLDivElement>(null);
  const scheduleBodyRef = useRef<HTMLDivElement>(null);
  const timelineItems = timelineRows(customer);
  const remainingCheckCount = checkItems.filter((item) => !completedCheckItems.includes(item.id)).length;

  function markRecentUpdate(section: string) {
    const updatedAt = Date.now();
    setRecentUpdate({ section, updatedAt });
    setRecentUpdateNow(updatedAt);
  }

  function openCheckItemEdit(item: KimCheckItem) {
    setAddingCheckItem(false);
    setConfirmingCheckItemTitle(null);
    setSelectedEditingCheckDue(kimCheckDueSelection(item.due));
    setEditingCheckItemId(item.id);
  }

  function cancelCheckItemEdit() {
    setEditingCheckItemId(null);
    setSelectedEditingCheckDue("오늘");
  }

  useEffect(() => {
    setStageGroup(customer.statusGroup);
    setStageStatus(customer.status);
  }, [customer.status, customer.statusGroup]);

  useEffect(() => {
    setChance(chanceOverride ?? chanceLabel(customer) as CustomerChanceOption);
  }, [chanceOverride, customer]);

  useEffect(() => {
    setManage(manageStatusOverride ?? "정상");
  }, [manageStatusOverride]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRecentUpdateNow(Date.now());
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    onEditorOpenChange?.(openEditor !== null || addingCustomerMemo || addingCheckItem || addingScheduleItem || editingCheckItemId !== null || editingCustomerMemoId !== null || editingScheduleId !== null || confirmingCustomerMemoDeleteId !== null || confirmingScheduleDeleteId !== null);
    return () => onEditorOpenChange?.(false);
  }, [addingCheckItem, addingCustomerMemo, addingScheduleItem, confirmingCustomerMemoDeleteId, confirmingScheduleDeleteId, editingCheckItemId, editingCustomerMemoId, editingScheduleId, onEditorOpenChange, openEditor]);

  useEffect(() => {
    const container = consultBodyRef.current;
    if (openEditor?.kind !== "timeline") return;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openEditor?.kind, timelineItems.length]);

  useEffect(() => {
    const container = customerMemoBodyRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [customerMemos.length, addingCustomerMemo]);

  useEffect(() => {
    const containers = [checkBodyRef.current, scheduleBodyRef.current];
    const frame = window.requestAnimationFrame(() => {
      containers.forEach((container) => {
        if (!container) return;
        container.scrollTop = container.scrollHeight;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [addingCheckItem, addingScheduleItem, checkItems.length, schedules.length]);

  useEffect(() => {
    if (!openEditor) return;

    function closeEditor(event: PointerEvent) {
      if (editorRef.current?.contains(event.target as Node)) return;
      setOpenEditor(null);
      setPurchasePopoverFrame(null);
    }

    function closeEditorByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenEditor(null);
        setPurchasePopoverFrame(null);
      }
    }

    document.addEventListener("pointerdown", closeEditor, true);
    document.addEventListener("keydown", closeEditorByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeEditor, true);
      document.removeEventListener("keydown", closeEditorByKeyboard);
    };
  }, [openEditor]);

  useEffect(() => {
    if (!confirmingCustomerMemoDeleteId) return;

    function closeConfirm(event: PointerEvent) {
      if (customerMemoDeleteRef.current?.contains(event.target as Node)) return;
      setConfirmingCustomerMemoDeleteId(null);
    }

    function closeConfirmByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingCustomerMemoDeleteId(null);
    }

    document.addEventListener("pointerdown", closeConfirm, true);
    document.addEventListener("keydown", closeConfirmByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeConfirm, true);
      document.removeEventListener("keydown", closeConfirmByKeyboard);
    };
  }, [confirmingCustomerMemoDeleteId]);

  useEffect(() => {
    if (!editingCustomerMemoId) return;

    function cancelMemoEdit(event: PointerEvent) {
      if (customerMemoEditRef.current?.contains(event.target as Node)) return;
      setEditingCustomerMemoId(null);
    }

    function cancelMemoEditByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setEditingCustomerMemoId(null);
    }

    document.addEventListener("pointerdown", cancelMemoEdit, true);
    document.addEventListener("keydown", cancelMemoEditByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", cancelMemoEdit, true);
      document.removeEventListener("keydown", cancelMemoEditByKeyboard);
    };
  }, [editingCustomerMemoId]);

  useEffect(() => {
    if (!confirmingCheckItemTitle) return;

    function closeCheckConfirm(event: PointerEvent) {
      if (checkConfirmRef.current?.contains(event.target as Node)) return;
      setConfirmingCheckItemTitle(null);
    }

    function closeCheckConfirmByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingCheckItemTitle(null);
    }

    document.addEventListener("pointerdown", closeCheckConfirm, true);
    document.addEventListener("keydown", closeCheckConfirmByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeCheckConfirm, true);
      document.removeEventListener("keydown", closeCheckConfirmByKeyboard);
    };
  }, [confirmingCheckItemTitle]);

  useEffect(() => {
    if (!confirmingCheckItemDeleteId) return;

    function closeCheckDelete(event: PointerEvent) {
      if (checkDeleteRef.current?.contains(event.target as Node)) return;
      setConfirmingCheckItemDeleteId(null);
    }

    function closeCheckDeleteByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingCheckItemDeleteId(null);
    }

    document.addEventListener("pointerdown", closeCheckDelete, true);
    document.addEventListener("keydown", closeCheckDeleteByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeCheckDelete, true);
      document.removeEventListener("keydown", closeCheckDeleteByKeyboard);
    };
  }, [confirmingCheckItemDeleteId]);

  useEffect(() => {
    if (!editingCheckItemId) return;

    const frame = window.requestAnimationFrame(() => {
      const container = checkBodyRef.current;
      const form = checkEditRef.current;
      if (!container || !form) return;
      const containerRect = container.getBoundingClientRect();
      const formRect = form.getBoundingClientRect();
      const bottomOverflow = formRect.bottom - containerRect.bottom + 8;
      const topOverflow = containerRect.top - formRect.top + 8;
      if (bottomOverflow > 0) container.scrollTop += bottomOverflow;
      else if (topOverflow > 0) container.scrollTop -= topOverflow;
    });

    function cancelCheckEdit(event: PointerEvent) {
      if (checkEditRef.current?.contains(event.target as Node)) return;
      cancelCheckItemEdit();
    }

    function cancelCheckEditByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") cancelCheckItemEdit();
    }

    document.addEventListener("pointerdown", cancelCheckEdit, true);
    document.addEventListener("keydown", cancelCheckEditByKeyboard);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", cancelCheckEdit, true);
      document.removeEventListener("keydown", cancelCheckEditByKeyboard);
    };
  }, [editingCheckItemId]);

  useEffect(() => {
    if (!confirmingScheduleCompleteId) return;

    function closeScheduleComplete(event: PointerEvent) {
      if (scheduleCompleteRef.current?.contains(event.target as Node)) return;
      setConfirmingScheduleCompleteId(null);
    }

    function closeScheduleCompleteByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingScheduleCompleteId(null);
    }

    document.addEventListener("pointerdown", closeScheduleComplete, true);
    document.addEventListener("keydown", closeScheduleCompleteByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeScheduleComplete, true);
      document.removeEventListener("keydown", closeScheduleCompleteByKeyboard);
    };
  }, [confirmingScheduleCompleteId]);

  useEffect(() => {
    if (!confirmingScheduleDeleteId) return;

    function closeScheduleDelete(event: PointerEvent) {
      if (scheduleDeleteRef.current?.contains(event.target as Node)) return;
      setConfirmingScheduleDeleteId(null);
    }

    function closeScheduleDeleteByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingScheduleDeleteId(null);
    }

    document.addEventListener("pointerdown", closeScheduleDelete, true);
    document.addEventListener("keydown", closeScheduleDeleteByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeScheduleDelete, true);
      document.removeEventListener("keydown", closeScheduleDeleteByKeyboard);
    };
  }, [confirmingScheduleDeleteId]);

  useEffect(() => {
    if (!editingScheduleId) return;

    const frame = window.requestAnimationFrame(() => {
      const container = scheduleBodyRef.current;
      const form = scheduleEditRef.current;
      if (!container || !form) return;
      const containerRect = container.getBoundingClientRect();
      const formRect = form.getBoundingClientRect();
      const bottomOverflow = formRect.bottom - containerRect.bottom + 8;
      const topOverflow = containerRect.top - formRect.top + 8;
      if (bottomOverflow > 0) container.scrollTop += bottomOverflow;
      else if (topOverflow > 0) container.scrollTop -= topOverflow;
    });

    function cancelScheduleEdit(event: PointerEvent) {
      if (scheduleEditRef.current?.contains(event.target as Node)) return;
      setEditingScheduleId(null);
    }

    function cancelScheduleEditByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setEditingScheduleId(null);
    }

    document.addEventListener("pointerdown", cancelScheduleEdit, true);
    document.addEventListener("keydown", cancelScheduleEditByKeyboard);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", cancelScheduleEdit, true);
      document.removeEventListener("keydown", cancelScheduleEditByKeyboard);
    };
  }, [editingScheduleId]);

  function toggleEditor(next: KimOpenEditor) {
    if (!isKimPurchaseFloatingKind(next.kind)) {
      setPurchasePopoverFrame(null);
    }
    setOpenEditor((current) => kimEditorMatches(current, next) ? null : next);
  }

  function openPurchaseFloatingEditor(event: ReactMouseEvent<HTMLButtonElement>, next: Extract<KimOpenEditor, { kind: KimPurchaseFloatingKind }>) {
    if (openEditor && kimEditorMatches(openEditor, next)) {
      setOpenEditor(null);
      setPurchasePopoverFrame(null);
      return;
    }
    setPurchasePopoverFrame(calculateKimPurchasePopoverFrame(event.currentTarget, next.kind));
    setOpenEditor(next);
  }

  function openStatusEditor(next: KimOpenEditor) {
    if (next.kind === "status" && next.key === "source" && isKimAutomaticSource(statusValues.source)) {
      setOpenEditor(null);
      onToast("자동 접수 경로는 수정할 수 없습니다.");
      return;
    }
    if (next.kind === "status" && next.key === "assignedAt") {
      setOpenEditor(null);
      onToast("배정시간은 담당자 배정 시 자동 기록됩니다.");
      return;
    }
    toggleEditor(next);
  }

  function openSourceEditorByKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openStatusEditor({ kind: "status", key: "source" });
  }

  function saveStatusField(event: FormEvent<HTMLFormElement>, key: KimStatusFieldKey) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = String(formData.get("value") ?? "").trim();
    if (!value) return;
    setStatusValues((current) => ({ ...current, [key]: value }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast(`${fieldLabel(key)} 수정 완료`);
  }

  function saveJobField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const customerType = String(formData.get("customerType") ?? "개인") as KimCustomerType;
    const customerTypeDetail = String(formData.get("customerTypeDetail") ?? "").trim();
    const nextJobValue = formatKimJobValue(customerType, customerTypeDetail);
    setStatusValues((current) => ({ ...current, job: nextJobValue }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("직군 수정 완료");
  }

  function saveLocationField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const province = String(formData.get("province") ?? "확인 필요");
    const detail = String(formData.get("detail") ?? "확인 필요");
    setStatusValues((current) => ({ ...current, location: formatKimLocationValue(province, detail) }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("거주지 수정 완료");
  }

  function saveSourceField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const source = String(formData.get("source") ?? "").trim();
    const customSource = String(formData.get("customSource") ?? "").trim();
    const nextSource = source === "기타" ? customSource || "기타" : source;
    if (!nextSource) return;
    setStatusValues((current) => ({ ...current, source: nextSource }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("상담경로 수정 완료");
  }

  function saveAdvisorField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const team = String(formData.get("team") ?? "인천본사") as KimAdvisorTeam;
    const advisor = String(formData.get("advisor") ?? "").trim();
    const nextAdvisor = formatKimAdvisorValue(team, advisor);
    setStatusValues((current) => ({ ...current, advisor: nextAdvisor, assignedAt: formatKimAssignmentTime() }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("담당자 배정 완료");
  }

  function selectStageGroup(nextGroup: string) {
    const nextStatus = customerStatusGroups[nextGroup]?.[0] ?? nextGroup;
    setStageGroup(nextGroup);
    setStageStatus(nextStatus);
    onWorkflowChange?.(customer.no, { statusGroup: nextGroup, status: nextStatus });
    markRecentUpdate("진행 상태");
    onToast("진행 상태 수정 완료");
  }

  function selectStageStatus(nextStatus: string) {
    setStageStatus(nextStatus);
    setOpenEditor(null);
    onWorkflowChange?.(customer.no, { statusGroup: stageGroup, status: nextStatus });
    markRecentUpdate("진행 상태");
    onToast("진행 상태 수정 완료");
  }

  function saveNeeds(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setNeeds({
      model: String(formData.get("model") ?? "").trim() || needs.model,
      trim: String(formData.get("trim") ?? "").trim() || needs.trim,
      colors: String(formData.get("colors") ?? "").trim() || needs.colors,
      method: String(formData.get("method") ?? "").trim() || needs.method,
      memo: String(formData.get("memo") ?? "").trim() || needs.memo,
    });
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("고객 니즈 수정 완료");
  }

  function savePurchaseConditions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPurchaseFields((current) => current.map((field) => {
      const value = String(formData.get(field.label) ?? "").trim();
      return { ...field, value: value || "미정" };
    }));
    setOpenEditor(null);
    markRecentUpdate("상세 구매조건");
    onToast("상세 구매조건 수정 완료");
  }

  function togglePurchaseMethod(option: string) {
    const currentMethodField = purchaseFields.find((field) => field.label === "구매방식");
    const selectedMethods = new Set((currentMethodField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => kimMethodOptions.includes(value)));
    if (selectedMethods.has(option)) {
      selectedMethods.delete(option);
    } else {
      selectedMethods.add(option);
    }
    const orderedMethods = kimMethodOptions.filter((method) => selectedMethods.has(method));
    const nextValue = orderedMethods.length > 0 ? orderedMethods.join(" · ") : "확인 필요";
    setPurchaseFields((current) => current.map((field) => (
      field.label === "구매방식" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("구매방식 수정 완료");
  }

  function togglePurchaseTerm(option: string) {
    const currentTermField = purchaseFields.find((field) => field.label === "계약기간");
    const selectedTerms = new Set((currentTermField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => kimContractTermOptions.includes(value)));
    if (selectedTerms.has(option)) {
      selectedTerms.delete(option);
    } else {
      selectedTerms.add(option);
    }
    const orderedTerms = kimContractTermOptions.filter((term) => selectedTerms.has(term));
    const nextValue = orderedTerms.length > 0 ? orderedTerms.join(" · ") : "확인 필요";
    setPurchaseFields((current) => current.map((field) => (
      field.label === "계약기간" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("계약기간 수정 완료");
  }

  function openPurchaseInitialCostEditor(event: ReactMouseEvent<HTMLButtonElement>) {
    const nextEditor = { kind: "purchaseInitialCost" } as const;
    if (openEditor && kimEditorMatches(openEditor, nextEditor)) {
      setOpenEditor(null);
      setPurchasePopoverFrame(null);
      return;
    }
    const currentInitialCostField = purchaseFields.find((field) => field.label === "초기비용");
    const parsedInitialCost = parseKimInitialCost(currentInitialCostField?.value ?? "보증금 30%");
    setInitialCostKind(parsedInitialCost.kind);
    setInitialCostUnit(parsedInitialCost.unit);
    setInitialCostAmount(parsedInitialCost.amount);
    setPurchasePopoverFrame(calculateKimPurchasePopoverFrame(event.currentTarget, "purchaseInitialCost"));
    setOpenEditor(nextEditor);
  }

  function selectInitialCostKind(option: KimInitialCostKind) {
    const nextKind: KimInitialCostSelection = initialCostKind === option ? "" : option;
    setInitialCostKind(nextKind);
    if (!nextKind || nextKind === "무보증") {
      setInitialCostAmount("");
    } else if (!initialCostAmount) {
      setInitialCostAmount(initialCostUnit === "%" ? "30" : "");
    }
  }

  function applyPurchaseInitialCost() {
    const trimmedAmount = initialCostAmount.replace(/[^\d]/g, "");
    if (initialCostKind && initialCostKind !== "무보증" && !trimmedAmount) {
      onToast("초기비용 값을 입력해 주세요.");
      return;
    }
    const formattedAmount = initialCostUnit === "금액" ? formatKimNumberWithCommas(trimmedAmount) : trimmedAmount;
    const nextValue = !initialCostKind
      ? "확인 필요"
      : initialCostKind === "무보증"
      ? "무보증"
      : `${initialCostKind} ${formattedAmount}${initialCostUnit === "%" ? "%" : "만원"}`;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "초기비용" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("초기비용 수정 완료");
  }

  function selectPurchaseTiming(option: string) {
    if (option === "특정 월") {
      setShowTimingMonths(true);
      return;
    }
    const currentTimingField = purchaseFields.find((field) => field.label === "출고 희망 시기");
    const nextValue = currentTimingField?.value === option ? "확인 필요" : option;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
  }

  function selectPurchaseTimingMonth(month: string) {
    const currentTimingField = purchaseFields.find((field) => field.label === "출고 희망 시기");
    const monthValue = `${month} 출고 희망`;
    const nextValue = currentTimingField?.value === monthValue ? "확인 필요" : monthValue;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
  }

  function togglePurchaseCostFocus(option: string) {
    const currentCostFocusField = purchaseFields.find((field) => field.label === "계약 포커스");
    const selectedFocuses = new Set((currentCostFocusField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimContractFocusOptions.includes(value)));
    if (selectedFocuses.has(option)) {
      selectedFocuses.delete(option);
    } else {
      if (selectedFocuses.size >= kimPurchaseTagSelectionLimit) {
        onToast("최대 4개까지만 선택 가능합니다.");
        return;
      }
      selectedFocuses.add(option);
    }
    const orderedFocuses = kimContractFocusOptions.filter((focus) => selectedFocuses.has(focus));
    const nextValue = orderedFocuses.length > 0 ? orderedFocuses.map((focus) => `#${focus}`).join(" ") : "확인 필요";
    setPurchaseFields((current) => current.map((field) => (
      field.label === "계약 포커스" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("계약 포커스 수정 완료");
  }

  function togglePurchaseCustomerNote(option: string) {
    const currentCustomerNoteField = purchaseFields.find((field) => field.label === "고객 특이사항");
    const selectedNotes = new Set((currentCustomerNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimCustomerNoteOptions.includes(value)));
    if (selectedNotes.has(option)) {
      selectedNotes.delete(option);
    } else {
      if (selectedNotes.size >= kimPurchaseTagSelectionLimit) {
        onToast("최대 4개까지만 선택 가능합니다.");
        return;
      }
      selectedNotes.add(option);
    }
    const orderedNotes = kimCustomerNoteOptions.filter((note) => selectedNotes.has(note));
    const nextValue = orderedNotes.length > 0 ? orderedNotes.map((note) => `#${note}`).join(" ") : "확인 필요";
    setPurchaseFields((current) => current.map((field) => (
      field.label === "고객 특이사항" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("고객 특이사항 수정 완료");
  }

  function togglePurchaseReviewNote(option: string) {
    const currentReviewNoteField = purchaseFields.find((field) => field.label === "심사 특이사항");
    const selectedNotes = new Set((currentReviewNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimReviewNoteOptions.includes(value)));
    if (selectedNotes.has(option)) {
      selectedNotes.delete(option);
    } else {
      if (selectedNotes.size >= kimPurchaseTagSelectionLimit) {
        onToast("최대 4개까지만 선택 가능합니다.");
        return;
      }
      selectedNotes.add(option);
    }
    const orderedNotes = kimReviewNoteOptions.filter((note) => selectedNotes.has(note));
    const nextValue = orderedNotes.length > 0 ? orderedNotes.map((note) => `#${note}`).join(" ") : "확인 필요";
    setPurchaseFields((current) => current.map((field) => (
      field.label === "심사 특이사항" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("심사 특이사항 수정 완료");
  }

  function selectPurchaseAnnualMileage(option: string) {
    const currentMileageField = purchaseFields.find((field) => field.label === "연간 주행거리");
    const nextValue = currentMileageField?.value === option ? "확인 필요" : option;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "연간 주행거리" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("연간 주행거리 수정 완료");
  }

  function selectPurchaseDeliveryMethod(option: string) {
    const currentDeliveryField = purchaseFields.find((field) => field.label === "인도 방식");
    const nextValue = currentDeliveryField?.value === option ? "확인 필요" : option;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "인도 방식" ? { ...field, value: nextValue } : field
    )));
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("인도 방식 수정 완료");
  }

  function attachQuoteFile(event: ChangeEvent<HTMLInputElement>, quoteTitle: string) {
    const fileName = event.target.files?.[0]?.name;
    if (!fileName) return;
    markRecentUpdate("견적함");
    onToast(`${quoteTitle} 원본 첨부: ${fileName}`);
    event.target.value = "";
  }

  function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextSchedule = {
      id: `kim-schedule-${Date.now()}`,
      date: String(formData.get("date") ?? ""),
      time: scheduleTimeFromFormData(formData),
      type: String(formData.get("type") ?? "재연락"),
      memo: String(formData.get("memo") ?? "").trim(),
    };
    if (!nextSchedule.date) {
      onToast("예정 날짜를 선택해주세요.");
      return;
    }
    if (!nextSchedule.memo) return;
    setSchedules((current) => [...current, nextSchedule]);
    setAddingScheduleItem(false);
    setOpenEditor(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정이 생성되었습니다.");
  }

  function updateSchedule(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const date = String(formData.get("date") ?? "");
    const time = scheduleTimeFromFormData(formData);
    const type = String(formData.get("type") ?? "재연락");
    const memo = String(formData.get("memo") ?? "").trim();
    if (!date) {
      onToast("예정 날짜를 선택해주세요.");
      return;
    }
    if (!memo) return;
    setSchedules((current) => current.map((item) => (
      item.id === id ? { ...item, date, time, type, memo } : item
    )));
    setEditingScheduleId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 수정했습니다.");
  }

  function deleteSchedule(id: string) {
    setSchedules((current) => current.filter((item) => item.id !== id));
    setCompletedScheduleKeys((current) => current.filter((key) => key !== id));
    setEditingScheduleId((current) => (current === id ? null : current));
    setConfirmingScheduleDeleteId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 삭제했습니다.");
  }

  function saveCheckItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    const category = String(formData.get("category") ?? "체크");
    const dueSelection = String(formData.get("due") ?? "오늘");
    const dueDate = String(formData.get("dueDate") ?? "");
    if (dueSelection === "지정" && !dueDate) {
      onToast("마감 날짜를 선택해주세요.");
      return;
    }
    const due = dueSelection === "지정" ? formatShortDateLabel(dueDate) : dueSelection;
    setCheckItems((current) => [...current, {
      id: `kim-check-${Date.now()}`,
      category,
      due,
      body,
    }]);
    setAddingCheckItem(false);
    setSelectedCheckDue("오늘");
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일이 추가되었습니다.");
  }

  function updateCheckItem(event: FormEvent<HTMLFormElement>, id: string, currentDue: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    const category = String(formData.get("category") ?? "체크");
    const dueSelection = String(formData.get("due") ?? currentDue);
    const dueDate = String(formData.get("dueDate") ?? "");
    const currentDueIsCustom = !kimCheckDueOptions.includes(currentDue);
    if (dueSelection === "지정" && !dueDate && !currentDueIsCustom) {
      onToast("마감 날짜를 선택해주세요.");
      return;
    }
    const due = dueSelection === "지정" ? (dueDate ? formatShortDateLabel(dueDate) : currentDue) : dueSelection;
    setCheckItems((current) => current.map((item) => (
      item.id === id ? { ...item, category, due, body } : item
    )));
    cancelCheckItemEdit();
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 수정했습니다.");
  }

  function saveCustomerMemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    setCustomerMemos((current) => [...current, {
      id: `kim-customer-memo-${Date.now()}`,
      body,
      createdAt: formatKoreanShortTime(),
    }]);
    setAddingCustomerMemo(false);
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모가 추가되었습니다.");
  }

  function updateCustomerMemo(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    setCustomerMemos((current) => current.map((item) => (
      item.id === id ? { ...item, body } : item
    )));
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 수정했습니다.");
  }

  function deleteCustomerMemo(id: string) {
    setCustomerMemos((current) => current.filter((item) => item.id !== id));
    setEditingCustomerMemoId((current) => (current === id ? null : current));
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 삭제했습니다.");
  }

  function toggleScheduleComplete(item: KimScheduleItem) {
    const key = scheduleRecordKey(item);
    setCompletedScheduleKeys((current) => (
      current.includes(key) ? current.filter((completedKey) => completedKey !== key) : [...current, key]
    ));
    setConfirmingScheduleCompleteId(null);
    markRecentUpdate("예정 일정");
  }

  function renderScheduleInlineForm(item?: KimScheduleItem) {
    const isEditing = Boolean(item);
    const timeParts = parseScheduleTimeParts(item?.time);
    return (
      <form
        className="kim-schedule-composer"
        key={item ? `${item.id}-edit` : "schedule-add"}
        ref={isEditing ? scheduleEditRef : undefined}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          if (isEditing) setEditingScheduleId(null);
          else setAddingScheduleItem(false);
        }}
        onSubmit={(event) => (item ? updateSchedule(event, item.id) : saveSchedule(event))}
      >
        <div className="kim-schedule-composer-top">
          <div className="kim-schedule-datetime-group">
            <label className="kim-schedule-date-field">
              <input aria-label="예정 날짜" autoFocus defaultValue={item?.date ?? formatDateInputValue()} name="date" type="date" />
            </label>
            <label className="kim-schedule-time-field">
              <span className="kim-schedule-time-picker">
                <select aria-label="예정 일정 시" defaultValue={timeParts.hour} name="scheduleHour">
                  {kimScheduleHourOptions.map((hour) => (
                    <option key={hour} value={hour}>{hour}</option>
                  ))}
                </select>
                <b aria-hidden="true">:</b>
                <select aria-label="예정 일정 분" defaultValue={timeParts.minute} name="scheduleMinute">
                  {kimScheduleMinuteOptions.map((minute) => (
                    <option key={minute} value={minute}>{minute}</option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          <div className="kim-check-composer-controls kim-schedule-type-controls" aria-label="예정 일정 분류">
            {kimScheduleTypeOptions.map((option) => (
              <label key={option}>
                <input defaultChecked={(item?.type ?? "재연락") === option} name="type" type="radio" value={option} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="kim-check-composer-main">
          <textarea
            aria-label="예정 일정 메모"
            defaultValue={item?.memo ?? ""}
            name="memo"
            rows={2}
          />
        </div>
        <div className="kim-check-composer-actions">
          <button type="button" onClick={() => {
            if (isEditing) setEditingScheduleId(null);
            else setAddingScheduleItem(false);
          }}>취소</button>
          <button className="primary" type="submit">저장</button>
        </div>
      </form>
    );
  }

  function toggleCheckItem(id: string) {
    setCompletedCheckItems((current) => (
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]
    ));
    setConfirmingCheckItemTitle(null);
    markRecentUpdate("해야 할 일");
  }

  function deleteCheckItem(id: string) {
    setCheckItems((current) => current.filter((item) => item.id !== id));
    setCompletedCheckItems((current) => current.filter((itemId) => itemId !== id));
    setEditingCheckItemId((current) => (current === id ? null : current));
    setConfirmingCheckItemTitle(null);
    setConfirmingCheckItemDeleteId(null);
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 삭제했습니다.");
  }

  function renderCheckItemEditForm(item: KimCheckItem) {
    return (
      <form
        className="kim-check-edit-row"
        key={`${item.id}-edit`}
        ref={checkEditRef}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          cancelCheckItemEdit();
        }}
        onSubmit={(event) => updateCheckItem(event, item.id, item.due)}
      >
        <div className="kim-check-composer-pickers">
          <div className="kim-check-due-stack">
            <div className="kim-check-composer-controls due" aria-label="해야 할 일 마감 수정">
              {kimCheckDueOptions.map((option) => (
                <label key={option}>
                  <input checked={selectedEditingCheckDue === option} name="due" onChange={() => setSelectedEditingCheckDue(option)} type="radio" value={option} />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {selectedEditingCheckDue === "지정" ? (
              <label className="kim-check-date-field compact">
                <span>마감 날짜</span>
                <input defaultValue={parseKimCheckDueDate(item.due)} name="dueDate" type="date" />
              </label>
            ) : null}
          </div>
          <div className="kim-check-composer-controls" aria-label="해야 할 일 분류 수정">
            {kimCheckCategoryOptions.map((option) => (
              <label key={option}>
                <input defaultChecked={item.category === option} name="category" type="radio" value={option} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="kim-check-composer-main">
          <textarea
            aria-label="해야 할 일 내용 수정"
            autoFocus
            defaultValue={item.body}
            name="body"
            onFocus={(event) => {
              const target = event.currentTarget;
              window.requestAnimationFrame(() => {
                target.setSelectionRange(target.value.length, target.value.length);
              });
            }}
            rows={2}
          />
        </div>
        <div className="kim-check-composer-actions">
          <button type="button" onClick={cancelCheckItemEdit}>취소</button>
          <button className="primary" type="submit">저장</button>
        </div>
      </form>
    );
  }

  function workflowValue(key: KimWorkflowKey) {
    if (key === "stage") return `${stageGroup} · ${stageStatus}`;
    if (key === "chance") return chance;
    return manage;
  }

  function openWorkflowEditor(key: KimWorkflowKey) {
    if (key === "manage") {
      setOpenEditor(null);
      onToast("관리 상태는 상담 메모와 최근 업데이트 기준으로 자동 반영됩니다.");
      return;
    }
    toggleEditor({ kind: "workflow", key });
  }

  function renderStatusEditor(key: KimStatusFieldKey) {
    return (
      <div className="kim-edit-popover compact" role="dialog" aria-label={`${fieldLabel(key)} 수정`}>
        {key === "job" ? (
          <KimJobStatusEditor
            initialValue={statusValues.job}
            onCancel={() => setOpenEditor(null)}
            onSubmit={saveJobField}
          />
        ) : key === "location" ? (
          <KimLocationStatusEditor
            initialValue={statusValues.location}
            onCancel={() => setOpenEditor(null)}
            onSubmit={saveLocationField}
          />
        ) : key === "source" ? (
          <KimSourceStatusEditor
            initialValue={statusValues.source}
            onCancel={() => setOpenEditor(null)}
            onSubmit={saveSourceField}
          />
        ) : key === "advisor" ? (
          <KimAdvisorStatusEditor
            initialValue={statusValues.advisor}
            onCancel={() => setOpenEditor(null)}
            onSubmit={saveAdvisorField}
          />
        ) : (
        <form className="kim-edit-form" onSubmit={(event) => saveStatusField(event, key)}>
          <label>
            <span>{key === "phone" ? "연락처 수정" : fieldLabel(key)}</span>
            {key === "phone" ? (
              <KimPhoneStatusInput initialValue={statusValues[key]} />
            ) : (
              <input autoFocus defaultValue={statusValues[key]} name="value" />
            )}
          </label>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">저장</button>
          </div>
        </form>
        )}
      </div>
    );
  }

  function renderWorkflowEditor(key: KimWorkflowKey) {
    if (key === "stage") {
      const secondaryOptions = customerStatusGroups[stageGroup] ?? [];
      return (
        <div className="kim-edit-popover stage" role="dialog" aria-label="진행 상태 수정">
          <div className="kim-choice-editor two-column">
            <div>
              <span className="kim-edit-label">1단계</span>
              <div className="kim-choice-list">
                {Object.keys(customerStatusGroups).map((group) => (
                  <button className={group === stageGroup ? "active" : ""} key={group} onClick={() => selectStageGroup(group)} type="button">
                    <span>{group}</span>
                    {group === stageGroup && <Check size={13} strokeWidth={2.7} />}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="kim-edit-label">2단계</span>
              <div className="kim-choice-list">
                {secondaryOptions.map((status) => (
                  <button className={status === stageStatus ? "active" : ""} key={status} onClick={() => selectStageStatus(status)} type="button">
                    <span>{status}</span>
                    {status === stageStatus && <Check size={13} strokeWidth={2.7} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (key !== "chance") return null;

    return (
      <div className="kim-edit-popover compact" role="dialog" aria-label={`${key === "chance" ? "계약 가능성" : "관리 상태"} 수정`}>
        <div className="kim-choice-list single">
          {kimChanceOptions.map((option) => {
            const selected = option === chance;
            return (
              <button
                className={kimChanceOptionClass(option, selected)}
                key={option}
                onClick={() => {
                  if (option === "확정" && stageGroup !== "계약완료") {
                    onToast("계약완료 단계에서만 확정으로 변경할 수 있습니다.");
                    return;
                  }
                  setChance(option);
                  onWorkflowChange?.(customer.no, { chance: option });
                  setOpenEditor(null);
                  markRecentUpdate("계약 가능성");
                  onToast("계약 가능성 수정 완료");
                }}
                type="button"
              >
                <span>{option}</span>
                {selected && <Check size={13} strokeWidth={2.7} />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderTimelinePanel() {
    return (
      <div className="kim-timeline-popover" role="dialog" aria-label="상담 타임라인">
        <div className="kim-timeline-popover-head">
          <div className="kim-timeline-popover-title">
            <i aria-hidden="true"><History size={17} strokeWidth={2.3} /></i>
            <h3>상담 타임라인</h3>
          </div>
        </div>
        <div className={`kim-consult-body kim-timeline-popover-body${timelineItems.length > 10 ? " is-scrollable" : ""}`} ref={consultBodyRef}>
          <div className="kim-consult-timeline">
            {timelineItems.map((item, index) => {
              const isLatestMemo = item.kind === "메모" && !timelineItems.slice(index + 1).some((nextItem) => nextItem.kind === "메모");
              return (
                <article
                  className={`kim-consult-event${kimConsultKindClass(item.kind)}${isLatestMemo ? " is-latest-memo" : " is-muted-history"}`}
                  key={`${item.kind}-${item.title}-${item.meta}-${index}`}
                >
                  <span>{item.kind}</span>
                  <div>
                    <div className="kim-consult-event-head">
                      <div>
                        <strong>{item.title}</strong>
                        <em>{item.meta}</em>
                      </div>
                    </div>
                    <p>{item.body}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function renderNeedsEditor() {
    return (
      <div className="kim-edit-popover needs" role="dialog" aria-label="고객 니즈 수정">
        <form className="kim-edit-form needs" onSubmit={saveNeeds}>
          <div className="kim-edit-grid">
            <label>
              <span>관심 차종</span>
              <input autoFocus defaultValue={needs.model} name="model" />
            </label>
            <label>
              <span>트림</span>
              <input defaultValue={needs.trim} name="trim" />
            </label>
            <label>
              <span>색상</span>
              <input defaultValue={needs.colors} name="colors" />
            </label>
            <label>
              <span>구매방식</span>
              <select defaultValue={needs.method} name="method">
                {kimMethodOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>문의사항</span>
            <textarea defaultValue={needs.memo} name="memo" rows={4} />
          </label>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">저장</button>
          </div>
        </form>
      </div>
    );
  }

  function renderPurchaseEditor() {
    return (
      <div className="kim-edit-popover purchase" role="dialog" aria-label="상세 구매조건 수정">
        <form className="kim-edit-form purchase" onSubmit={savePurchaseConditions}>
          <div className="kim-edit-grid purchase">
            {purchaseFields.map((field, index) => (
              <label key={field.label}>
                <span>{field.label}</span>
                <input autoFocus={index === 0} defaultValue={field.value === "미정" ? "" : field.value} name={field.label} placeholder="미정" />
              </label>
            ))}
          </div>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">저장</button>
          </div>
        </form>
      </div>
    );
  }

  function renderPurchaseMethodEditor() {
    const currentMethodField = purchaseFields.find((field) => field.label === "구매방식");
    const selectedMethods = new Set((currentMethodField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => kimMethodOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-method" role="dialog" aria-label="구매방식 수정">
        <div className="kim-method-segmented" role="group" aria-label="구매방식 선택">
          {kimMethodOptions.map((option) => (
            <button
              aria-pressed={selectedMethods.has(option)}
              className={selectedMethods.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseMethod(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseTermEditor() {
    const currentTermField = purchaseFields.find((field) => field.label === "계약기간");
    const selectedTerms = new Set((currentTermField?.value ?? "").split("·").map((value) => value.trim()).filter((value) => kimContractTermOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-term" role="dialog" aria-label="계약기간 수정">
        <div className="kim-method-segmented" role="group" aria-label="계약기간 선택">
          {kimContractTermOptions.map((option) => (
            <button
              aria-pressed={selectedTerms.has(option)}
              className={selectedTerms.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseTerm(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseInitialCostEditor() {
    return (
      <div className="kim-edit-popover purchase-initial-cost" role="dialog" aria-label="초기비용 수정">
        <div className="kim-initial-cost-editor">
          <div className="kim-initial-cost-group" role="group" aria-label="초기비용 유형 선택">
            {kimInitialCostKindOptions.map((option) => (
              <button
                aria-pressed={initialCostKind === option}
                className={initialCostKind === option ? "active" : ""}
                key={option}
                onClick={() => selectInitialCostKind(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
          {initialCostKind && initialCostKind !== "무보증" ? (
            <div className="kim-initial-cost-entry">
              <div className="kim-initial-cost-unit" role="group" aria-label="초기비용 입력 방식">
                {kimInitialCostUnitOptions.map((option) => (
                  <button
                    aria-pressed={initialCostUnit === option}
                    className={initialCostUnit === option ? "active" : ""}
                    key={option}
                    onClick={() => setInitialCostUnit(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
              <label className="kim-initial-cost-input">
                <span>{initialCostUnit === "%" ? "비율" : "금액"}</span>
                <div>
                  <input
                    inputMode="numeric"
                    onChange={(event) => setInitialCostAmount(event.target.value.replace(/[^\d]/g, ""))}
                    placeholder={initialCostUnit === "%" ? "30" : "1000"}
                    value={initialCostUnit === "금액" ? formatKimNumberWithCommas(initialCostAmount) : initialCostAmount}
                  />
                  <em>{initialCostUnit === "%" ? "%" : "만원"}</em>
                </div>
              </label>
            </div>
          ) : null}
          <div className="kim-edit-actions compact">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="button" onClick={applyPurchaseInitialCost}>적용</button>
          </div>
        </div>
      </div>
    );
  }

  function renderPurchaseAnnualMileageEditor() {
    const currentMileageField = purchaseFields.find((field) => field.label === "연간 주행거리");
    const currentValue = currentMileageField?.value ?? "확인 필요";

    return (
      <div className="kim-edit-popover purchase-annual-mileage" role="dialog" aria-label="연간 주행거리 수정">
        <div className="kim-mileage-picker" role="group" aria-label="연간 주행거리 선택">
          {kimAnnualMileageOptions.map((option) => (
            <button
              aria-pressed={currentValue === option}
              className={currentValue === option ? "active" : ""}
              key={option}
              onClick={() => selectPurchaseAnnualMileage(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseDeliveryMethodEditor() {
    const currentDeliveryField = purchaseFields.find((field) => field.label === "인도 방식");
    const currentValue = currentDeliveryField?.value ?? "확인 필요";

    return (
      <div className="kim-edit-popover purchase-delivery-method" role="dialog" aria-label="인도 방식 수정">
        <div className="kim-delivery-method-picker" role="group" aria-label="인도 방식 선택">
          {kimDeliveryMethodOptions.map((option) => (
            <button
              aria-pressed={currentValue === option}
              className={currentValue === option ? "active" : ""}
              key={option}
              onClick={() => selectPurchaseDeliveryMethod(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseTimingEditor() {
    const currentTimingField = purchaseFields.find((field) => field.label === "출고 희망 시기");
    const currentValue = currentTimingField?.value ?? "좋은 조건 즉시";
    const selectedOption = currentValue.endsWith("출고 희망") ? "특정 월" : currentValue;
    const selectedMonth = currentValue.endsWith("출고 희망") ? currentValue.replace(" 출고 희망", "") : "";
    const showMonthPicker = showTimingMonths || selectedOption === "특정 월";

    return (
      <div className="kim-edit-popover purchase-timing" role="dialog" aria-label="출고 희망 시기 수정">
        <div className="kim-timing-picker">
          <div className="kim-timing-options" role="group" aria-label="출고 희망 시기 선택">
            {kimTimingPresetOptions.map((option) => (
              <button
                aria-pressed={selectedOption === option}
                className={selectedOption === option ? "active" : ""}
                key={option}
                onClick={() => selectPurchaseTiming(option)}
                type="button"
              >
                {option}
              </button>
            ))}
            <button
              aria-expanded={showMonthPicker}
              aria-pressed={selectedOption === "특정 월"}
              className={`kim-timing-month-trigger${showMonthPicker ? " active" : ""}`}
              onClick={() => selectPurchaseTiming("특정 월")}
              type="button"
            >
              특정 월
            </button>
          </div>
          {showMonthPicker ? (
            <div className="kim-month-options" role="group" aria-label="특정 월 선택">
              {kimTimingMonthOptions.map((month) => (
                <button
                  aria-pressed={selectedMonth === month}
                  className={selectedMonth === month ? "active" : ""}
                  key={month}
                  onClick={() => selectPurchaseTimingMonth(month)}
                  type="button"
                >
                  {month}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderPurchaseCostFocusEditor() {
    const currentCostFocusField = purchaseFields.find((field) => field.label === "계약 포커스");
    const selectedFocuses = new Set((currentCostFocusField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimContractFocusOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-cost-focus" role="dialog" aria-label="계약 포커스 수정">
        <div className="kim-cost-focus-picker" role="group" aria-label="계약 포커스 선택">
          {kimContractFocusOptions.map((option) => (
            <button
              aria-pressed={selectedFocuses.has(option)}
              className={selectedFocuses.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseCostFocus(option)}
              type="button"
            >
              #{option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseCustomerNotesEditor() {
    const currentCustomerNoteField = purchaseFields.find((field) => field.label === "고객 특이사항");
    const selectedNotes = new Set((currentCustomerNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimCustomerNoteOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-customer-notes" role="dialog" aria-label="고객 특이사항 수정">
        <div className="kim-customer-note-picker" role="group" aria-label="고객 특이사항 선택">
          {kimCustomerNoteOptions.map((option) => (
            <button
              aria-pressed={selectedNotes.has(option)}
              className={selectedNotes.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseCustomerNote(option)}
              type="button"
            >
              #{option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPurchaseReviewNotesEditor() {
    const currentReviewNoteField = purchaseFields.find((field) => field.label === "심사 특이사항");
    const selectedNotes = new Set((currentReviewNoteField?.value ?? "").split("#").map((value) => value.trim()).filter((value) => kimReviewNoteOptions.includes(value)));

    return (
      <div className="kim-edit-popover purchase-review-notes" role="dialog" aria-label="심사 특이사항 수정">
        <div className="kim-review-note-picker" role="group" aria-label="심사 특이사항 선택">
          {kimReviewNoteOptions.map((option) => (
            <button
              aria-pressed={selectedNotes.has(option)}
              className={selectedNotes.has(option) ? "active" : ""}
              key={option}
              onClick={() => togglePurchaseReviewNote(option)}
              type="button"
            >
              #{option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderFloatingPurchaseEditor() {
    if (!openEditor || !isKimPurchaseFloatingKind(openEditor.kind) || !purchasePopoverFrame) return null;

    return (
      <div
        className={`kim-purchase-floating-popover align-${purchasePopoverFrame.align ?? "left"}`}
        ref={editorRef}
        style={{ left: purchasePopoverFrame.left, top: purchasePopoverFrame.top }}
      >
        {openEditor.kind === "purchaseMethod" ? renderPurchaseMethodEditor() : null}
        {openEditor.kind === "purchaseTiming" ? renderPurchaseTimingEditor() : null}
        {openEditor.kind === "purchaseCostFocus" ? renderPurchaseCostFocusEditor() : null}
        {openEditor.kind === "purchaseTerm" ? renderPurchaseTermEditor() : null}
        {openEditor.kind === "purchaseInitialCost" ? renderPurchaseInitialCostEditor() : null}
        {openEditor.kind === "purchaseAnnualMileage" ? renderPurchaseAnnualMileageEditor() : null}
        {openEditor.kind === "purchaseDeliveryMethod" ? renderPurchaseDeliveryMethodEditor() : null}
        {openEditor.kind === "purchaseCustomerNotes" ? renderPurchaseCustomerNotesEditor() : null}
        {openEditor.kind === "purchaseReviewNotes" ? renderPurchaseReviewNotesEditor() : null}
      </div>
    );
  }

  function renderScheduleEditor() {
    return (
      <div className="kim-edit-popover schedule" role="dialog" aria-label="일정 추가">
        <form className="kim-edit-form schedule" onSubmit={saveSchedule}>
          <div className="kim-edit-grid">
            <label>
              <span>날짜</span>
              <input autoFocus defaultValue="2026-05-26" name="date" type="date" />
            </label>
            <label>
              <span>시간</span>
              <input defaultValue="16:00" name="time" type="time" />
            </label>
            <label>
              <span>유형</span>
              <select defaultValue="통화" name="type">
                {["통화", "할 일", "재연락", "견적", "서류"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>메모</span>
            <textarea defaultValue="GLC 재고 확인 후 비교 견적 재안내" name="memo" rows={3} />
          </label>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">생성</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="kim-customer-dashboard">
      <div className="kim-left-dashboard">
        <KimMinjunDetailHeader now={recentUpdateNow} recentUpdate={recentUpdate} />
        <section className="detail-section kim-status-dashboard">
          <div className="kim-status-grid">
            {kimMinjunStatusFieldMeta.map((field) => {
              const Icon = field.icon;
              if (field.key === "source") {
                return (
                  <div className="kim-edit-anchor" key={field.key} ref={openEditor?.kind === "status" && openEditor.key === field.key ? editorRef : undefined}>
                    <div className="kim-status-field" onClick={() => openStatusEditor({ kind: "status", key: field.key })} onKeyDown={openSourceEditorByKeyboard} role="button" tabIndex={0}>
                      <span className="kim-status-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.9} /></span>
                      <span className="kim-status-copy">
                      <span>{field.label}</span>
                      <strong className={`has-inline-actions${isKimUnassignedStatus(field.key, statusValues[field.key]) ? " is-unassigned" : ""}`}>
                        {statusValues[field.key]}
                        {hasKimAppSourceQueue(statusValues[field.key]) ? (
                        <button
                          aria-label="앱 상담 큐 보기"
                          className="kim-app-queue-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onToast("차선생 앱 상담 큐 패널 자리입니다.");
                          }}
                          type="button"
                        >
                          <MessageSquareText size={13} strokeWidth={2.4} />
                        </button>
                        ) : null}
                        {hasKimQuoteAttachments(statusValues[field.key]) ? (
                          <span className="kim-quote-attachment-actions" aria-label="첨부 견적서">
                            {kimMockQuoteAttachments.map((attachment, index) => (
                              <button
                                aria-label={`${attachment.label} 보기`}
                                className="kim-quote-attachment-button"
                                key={attachment.label}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onToast(`${attachment.fileName} 팝업 자리입니다.`);
                                }}
                                type="button"
                              >
                                <span>{index + 1}</span>
                              </button>
                            ))}
                          </span>
                        ) : null}
                      </strong>
                      </span>
                    </div>
                    {openEditor?.kind === "status" && openEditor.key === field.key ? renderStatusEditor(field.key) : null}
                  </div>
                );
              }
              return (
                <div className="kim-edit-anchor" key={field.key} ref={openEditor?.kind === "status" && openEditor.key === field.key ? editorRef : undefined}>
                  <button className="kim-status-field" onClick={() => openStatusEditor({ kind: "status", key: field.key })} type="button">
                    <span className="kim-status-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.9} /></span>
                    <span className="kim-status-copy">
                    <span>{field.label}</span>
                    <strong className={isKimUnassignedStatus(field.key, statusValues[field.key]) ? "is-unassigned" : undefined}>{statusValues[field.key]}</strong>
                    </span>
                  </button>
                  {openEditor?.kind === "status" && openEditor.key === field.key ? renderStatusEditor(field.key) : null}
                </div>
              );
            })}
          </div>
          <div className="kim-workflow-strip" aria-label="김민준 업무 상태">
            {kimMinjunWorkflowMeta.map((field) => (
              <div className="kim-edit-anchor workflow" key={field.key} ref={openEditor?.kind === "workflow" && openEditor.key === field.key ? editorRef : undefined}>
                <button className={`kim-workflow-card ${field.tone}`} onClick={() => openWorkflowEditor(field.key)} type="button">
                  <span>{field.label}</span>
                  <strong className={field.key === "chance" ? kimChanceValueClass(chance) : undefined}>{workflowValue(field.key)}</strong>
                </button>
                {openEditor?.kind === "workflow" && openEditor.key === field.key ? renderWorkflowEditor(field.key) : null}
              </div>
            ))}
            <div className="kim-edit-anchor workflow timeline-action" ref={openEditor?.kind === "timeline" ? editorRef : undefined}>
              <button
                aria-label={`상담 타임라인 열기, ${timelineItems.length}개 이력`}
                className="kim-timeline-open-button"
                onClick={() => toggleEditor({ kind: "timeline" })}
                type="button"
              >
                <History size={18} strokeWidth={2.2} />
                <span>{timelineItems.length}</span>
              </button>
              {openEditor?.kind === "timeline" ? renderTimelinePanel() : null}
            </div>
          </div>
        </section>
      </div>

      <section className="detail-section kim-needs-dashboard">
        <div className="kim-needs-field">
          <div className="kim-edit-anchor needs" ref={openEditor?.kind === "needs" ? editorRef : undefined}>
          <button className="kim-needs-floating-card" onClick={() => toggleEditor({ kind: "needs" })} type="button">
            <div className="kim-needs-card-main">
              <span className="kim-needs-car-icon" aria-hidden="true"><CarFront size={22} strokeWidth={2.1} /></span>
              <div className="kim-needs-card-copy">
                <h3>{needs.model}</h3>
                <p>{needs.trim}</p>
                <span>{needs.colors}</span>
              </div>
              <span className="kim-needs-method-badge">{needs.method}</span>
            </div>
            <div className="kim-needs-card-memo">
              <span>문의사항</span>
              <p>{needs.memo}</p>
            </div>
          </button>
          {openEditor?.kind === "needs" ? renderNeedsEditor() : null}
          </div>
        </div>
      </section>

      <section className="kim-workspace-band" aria-label="김민준 실무 영역">
        <section className="kim-condition-consult-grid" aria-label="김민준 구매조건과 고객 메모">
          <section className="detail-section kim-purchase-conditions" aria-label="상세 구매조건" ref={openEditor?.kind === "purchase" ? editorRef : undefined}>
            <div className="kim-mvp-card-head">
              <div className="kim-mvp-title-row">
                <i aria-hidden="true" className="kim-mvp-title-icon"><ListChecks size={14} strokeWidth={2.2} /></i>
                <h3>상세 구매조건</h3>
              </div>
            </div>
            <div className="kim-purchase-condition-body">
              {purchaseFields.map((field) => {
                const itemButton = (
                  <button
                    className="kim-purchase-condition-item"
                    onClick={(event) => {
                      if (field.label === "구매방식") {
                        openPurchaseFloatingEditor(event, { kind: "purchaseMethod" });
                        return;
                      }
                      if (field.label === "출고 희망 시기") {
                        setShowTimingMonths(field.value.endsWith("출고 희망"));
                        openPurchaseFloatingEditor(event, { kind: "purchaseTiming" });
                        return;
                      }
                      if (field.label === "계약 포커스") {
                        openPurchaseFloatingEditor(event, { kind: "purchaseCostFocus" });
                        return;
                      }
                      if (field.label === "계약기간") {
                        openPurchaseFloatingEditor(event, { kind: "purchaseTerm" });
                        return;
                      }
                      if (field.label === "초기비용") {
                        openPurchaseInitialCostEditor(event);
                        return;
                      }
                      if (field.label === "연간 주행거리") {
                        openPurchaseFloatingEditor(event, { kind: "purchaseAnnualMileage" });
                        return;
                      }
                      if (field.label === "인도 방식") {
                        openPurchaseFloatingEditor(event, { kind: "purchaseDeliveryMethod" });
                        return;
                      }
                      if (field.label === "고객 특이사항") {
                        openPurchaseFloatingEditor(event, { kind: "purchaseCustomerNotes" });
                        return;
                      }
                      if (field.label === "심사 특이사항") {
                        openPurchaseFloatingEditor(event, { kind: "purchaseReviewNotes" });
                        return;
                      }
                      onToast(`${field.label} 수정은 다음 단계에서 연결합니다.`);
                    }}
                    type="button"
                  >
                    <span>{field.label}</span>
                    {isKimPurchaseTagField(field.label) && field.value !== "확인 필요" ? (
                      <strong className="is-tag-list">
                        {kimPurchaseTags(field.value).map((tag) => <span key={tag}>{tag}</span>)}
                      </strong>
                    ) : (
                      <strong className={kimPurchaseValueClass(field.value)}>{field.value}</strong>
                    )}
                  </button>
                );

                return (
                  <div
                    className={`kim-purchase-condition-anchor editable${isKimPurchaseTagField(field.label) ? " judgment" : ""}${(field.label === "구매방식" && openEditor?.kind === "purchaseMethod") || (field.label === "출고 희망 시기" && openEditor?.kind === "purchaseTiming") || (field.label === "계약 포커스" && openEditor?.kind === "purchaseCostFocus") || (field.label === "계약기간" && openEditor?.kind === "purchaseTerm") || (field.label === "초기비용" && openEditor?.kind === "purchaseInitialCost") || (field.label === "연간 주행거리" && openEditor?.kind === "purchaseAnnualMileage") || (field.label === "인도 방식" && openEditor?.kind === "purchaseDeliveryMethod") || (field.label === "고객 특이사항" && openEditor?.kind === "purchaseCustomerNotes") || (field.label === "심사 특이사항" && openEditor?.kind === "purchaseReviewNotes") ? " active" : ""}`}
                    key={field.label}
                  >
                    {itemButton}
                  </div>
                );
              })}
            </div>
            {openEditor?.kind === "purchase" ? renderPurchaseEditor() : null}
          </section>

          <section className="detail-section kim-mvp-section kim-customer-memo-section">
            <div className="kim-mvp-section-head">
              <div className="kim-mvp-title-row">
                <i aria-hidden="true" className="kim-mvp-title-icon"><FileText size={14} strokeWidth={2.2} /></i>
                <h3>고객 메모</h3>
                <span className="kim-customer-memo-count">{customerMemos.length}개</span>
                <em>고객별 참고사항</em>
              </div>
              <button
                aria-label="고객 메모 추가"
                className="kim-customer-memo-add-button"
                onClick={() => {
                  setEditingCustomerMemoId(null);
                  setAddingCustomerMemo((current) => !current);
                }}
                type="button"
              >
                <span aria-hidden="true">{addingCustomerMemo ? "×" : "+"}</span>
              </button>
            </div>
            <div className="kim-customer-memo-body" ref={customerMemoBodyRef}>
              <div className="kim-customer-memo-list">
                {customerMemos.map((item, index) => {
                  const shouldOpenDeletePopoverAbove = !addingCustomerMemo && index === customerMemos.length - 1;

                  if (editingCustomerMemoId === item.id) {
                    return (
                      <form
                        className="kim-customer-memo-edit-row"
                        key={item.id}
                        ref={customerMemoEditRef}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          event.preventDefault();
                          setEditingCustomerMemoId(null);
                        }}
                        onSubmit={(event) => updateCustomerMemo(event, item.id)}
                      >
                        <span>{item.createdAt}</span>
                        <textarea aria-label="고객 메모 내용" autoFocus defaultValue={item.body} name="body" rows={2} />
                        <div className="kim-customer-memo-edit-actions">
                          <button type="button" onClick={() => setEditingCustomerMemoId(null)}>취소</button>
                          <button className="primary" type="submit">저장</button>
                        </div>
                      </form>
                    );
                  }

                  return (
                    <article
                      className="kim-customer-memo-row"
                      key={item.id}
                      onClick={() => {
                        setAddingCustomerMemo(false);
                        setEditingCustomerMemoId(item.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setAddingCustomerMemo(false);
                        setEditingCustomerMemoId(item.id);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span>{item.createdAt}</span>
                      <p>{item.body}</p>
                      <button
                        aria-label="고객 메모 삭제"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingCustomerMemoId(null);
                          setConfirmingCustomerMemoDeleteId((current) => (current === item.id ? null : item.id));
                        }}
                        type="button"
                      >
                        <Trash2 size={13} strokeWidth={2.3} />
                      </button>
                      {confirmingCustomerMemoDeleteId === item.id ? (
                        <div
                          className={`kim-customer-memo-delete-popover${shouldOpenDeletePopoverAbove ? " is-above" : ""}`}
                          ref={customerMemoDeleteRef}
                          role="dialog"
                          aria-label="고객 메모 삭제 확인"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <p>해당 메모를 삭제하시겠습니까?</p>
                          <div>
                            <button type="button" onClick={(event) => {
                              event.stopPropagation();
                              setConfirmingCustomerMemoDeleteId(null);
                            }}>아니요</button>
                            <button className="danger" type="button" onClick={(event) => {
                              event.stopPropagation();
                              deleteCustomerMemo(item.id);
                            }}>삭제</button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
              {addingCustomerMemo ? (
                <form className="kim-customer-memo-composer" onSubmit={saveCustomerMemo}>
                  <label>
                    <textarea aria-label="고객 메모" autoFocus name="body" rows={3} />
                  </label>
                  <div className="kim-customer-memo-composer-actions">
                    <button type="button" onClick={() => setAddingCustomerMemo(false)}>취소</button>
                    <button className="primary" type="submit">저장</button>
                  </div>
                </form>
              ) : null}
            </div>
          </section>
        </section>

        <section className="kim-mvp-ops-grid" aria-label="김민준 고객 운영 기능">
        <article className="detail-section kim-mvp-card kim-check-card">
          <div className="kim-mvp-card-head">
            <div className="kim-mvp-title-row">
              <i aria-hidden="true" className="kim-mvp-title-icon"><Check size={14} strokeWidth={2.2} /></i>
              <h3>해야 할 일</h3>
              <span>{remainingCheckCount}개</span>
              <em>상담사가 처리할 업무</em>
            </div>
            <button
              aria-label="해야 할 일 추가"
              className="kim-mvp-add-circle"
              onClick={() => {
                cancelCheckItemEdit();
                setAddingCheckItem((current) => {
                  if (current) setSelectedCheckDue("오늘");
                  return !current;
                });
              }}
              type="button"
            >{addingCheckItem ? "×" : "+"}</button>
          </div>
          <div className="kim-mvp-card-body" ref={checkBodyRef}>
            <div className="kim-check-list">
              {checkItems.map((item, index) => {
                const isCompleted = completedCheckItems.includes(item.id);
                const shouldOpenCheckConfirmAbove = !addingCheckItem && index === checkItems.length - 1;
                const shouldOpenCheckDeleteAbove = !addingCheckItem && index === checkItems.length - 1;
                const isEditing = editingCheckItemId === item.id;
                if (isEditing) return renderCheckItemEditForm(item);

                return (
                  <div
                    className={`kim-check-row${isCompleted ? " is-completed" : ""}`}
                    key={item.id}
                    onClick={() => {
                      openCheckItemEdit(item);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openCheckItemEdit(item);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span>{item.due} · {item.category}</span>
                    <div>
                      <strong>{item.body}</strong>
                    </div>
                    <div className="kim-check-row-actions">
                      <button
                        aria-label={isCompleted ? "해야 할 일 완료 취소" : "해야 할 일 완료"}
                        aria-pressed={isCompleted}
                        onClick={(event) => {
                          event.stopPropagation();
                          cancelCheckItemEdit();
                          setConfirmingCheckItemDeleteId(null);
                          setConfirmingCheckItemTitle((current) => (current === item.id ? null : item.id));
                        }}
                        type="button"
                      >
                        <Check size={13} strokeWidth={2.6} />
                      </button>
                      <button
                        aria-label="해야 할 일 삭제"
                        className="delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          cancelCheckItemEdit();
                          setConfirmingCheckItemTitle(null);
                          setConfirmingCheckItemDeleteId((current) => (current === item.id ? null : item.id));
                        }}
                        type="button"
                      >
                        <Trash2 size={13} strokeWidth={2.3} />
                      </button>
                    </div>
                    {confirmingCheckItemTitle === item.id ? (
                      <div className={`kim-check-confirm-popover${shouldOpenCheckConfirmAbove ? " is-above" : ""}`} ref={checkConfirmRef} role="dialog" aria-label="해야 할 일 상태 변경 확인" onClick={(event) => event.stopPropagation()}>
                        <p>{isCompleted ? "완료한 일을 다시 진행 중으로 되돌릴까요?" : "해당 할 일을 완료 처리할까요?"}</p>
                        <div>
                          <button type="button" onClick={() => setConfirmingCheckItemTitle(null)}>취소</button>
                          <button className={isCompleted ? "neutral" : "primary"} type="button" onClick={() => toggleCheckItem(item.id)}>{isCompleted ? "되돌림" : "완료"}</button>
                        </div>
                      </div>
                    ) : null}
                    {confirmingCheckItemDeleteId === item.id ? (
                      <div className={`kim-check-confirm-popover delete${shouldOpenCheckDeleteAbove ? " is-above" : ""}`} ref={checkDeleteRef} role="dialog" aria-label="해야 할 일 삭제 확인" onClick={(event) => event.stopPropagation()}>
                        <p>해당 할 일을 삭제하시겠습니까?</p>
                        <div>
                          <button type="button" onClick={() => setConfirmingCheckItemDeleteId(null)}>아니요</button>
                          <button className="danger" type="button" onClick={() => deleteCheckItem(item.id)}>삭제</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {addingCheckItem ? (
              <form className="kim-check-composer" onSubmit={saveCheckItem}>
                <div className="kim-check-composer-pickers">
                  <div className="kim-check-due-stack">
                    <div className="kim-check-composer-controls due" aria-label="해야 할 일 마감">
                      {kimCheckDueOptions.map((option) => (
                        <label key={option}>
                          <input checked={selectedCheckDue === option} name="due" onChange={() => setSelectedCheckDue(option)} type="radio" value={option} />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                    {selectedCheckDue === "지정" ? (
                      <label className="kim-check-date-field">
                        <span>마감 날짜</span>
                        <input name="dueDate" type="date" />
                      </label>
                    ) : null}
                  </div>
                  <div className="kim-check-composer-controls" aria-label="해야 할 일 분류">
                    {kimCheckCategoryOptions.map((option) => (
                      <label key={option}>
                        <input defaultChecked={option === "체크"} name="category" type="radio" value={option} />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="kim-check-composer-main">
                  <textarea aria-label="해야 할 일 내용" autoFocus name="body" rows={2} />
                </div>
                <div className="kim-check-composer-actions">
                  <button type="button" onClick={() => {
                    setAddingCheckItem(false);
                    setSelectedCheckDue("오늘");
                  }}>취소</button>
                  <button className="primary" type="submit">저장</button>
                </div>
              </form>
            ) : null}
          </div>
        </article>

        <article className="detail-section kim-mvp-card kim-schedule-card">
          <div className="kim-mvp-card-head">
            <div className="kim-mvp-title-row">
              <i aria-hidden="true" className="kim-mvp-title-icon"><CalendarClock size={14} strokeWidth={2.2} /></i>
              <h3>예정 일정</h3>
              <span>{schedules.length}개</span>
              <em>다시 움직일 시점</em>
            </div>
            <button
              aria-label="예정 일정 추가"
              className="kim-mvp-add-circle"
              onClick={() => {
                setEditingScheduleId(null);
                setConfirmingScheduleDeleteId(null);
                setAddingScheduleItem((current) => !current);
              }}
              type="button"
            >{addingScheduleItem ? "×" : "+"}</button>
          </div>
          <div className="kim-mvp-card-body" ref={scheduleBodyRef}>
            <div className="kim-schedule-list">
              {schedules.map((schedule, index) => {
                const isCompleted = completedScheduleKeys.includes(scheduleRecordKey(schedule));
                const isEditing = editingScheduleId === schedule.id;
                const shouldOpenScheduleCompleteAbove = !addingScheduleItem && index > 0 && index === schedules.length - 1;
                const shouldOpenScheduleDeleteAbove = !addingScheduleItem && index > 0 && index === schedules.length - 1;
                if (isEditing) return renderScheduleInlineForm(schedule);
                return (
                  <div
                    className={`kim-schedule-row${isCompleted ? " is-completed" : ""}`}
                    key={scheduleRecordKey(schedule)}
                    onClick={() => {
                      setAddingScheduleItem(false);
                      setConfirmingScheduleDeleteId(null);
                      setEditingScheduleId(schedule.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setAddingScheduleItem(false);
                      setConfirmingScheduleDeleteId(null);
                      setEditingScheduleId(schedule.id);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span>{formatScheduleDateLabel(schedule.date)}{schedule.time ? ` ${schedule.time}` : ""}</span>
                    <div>
                      <p><strong>{schedule.type}</strong><em>·</em>{schedule.memo}</p>
                    </div>
                    <div className="kim-schedule-row-actions">
                      <button
                        aria-label={isCompleted ? "일정 완료 취소" : "일정 완료"}
                        aria-pressed={isCompleted}
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingScheduleId(null);
                          setConfirmingScheduleDeleteId(null);
                          setConfirmingScheduleCompleteId((current) => (current === schedule.id ? null : schedule.id));
                        }}
                        type="button"
                      >
                        <Check size={13} strokeWidth={2.6} />
                      </button>
                      <button
                        aria-label="예정 일정 삭제"
                        className="delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingScheduleId(null);
                          setConfirmingScheduleCompleteId(null);
                          setConfirmingScheduleDeleteId((current) => (current === schedule.id ? null : schedule.id));
                        }}
                        type="button"
                      >
                        <Trash2 size={13} strokeWidth={2.3} />
                      </button>
                    </div>
                    {confirmingScheduleCompleteId === schedule.id ? (
                      <div className={`kim-check-confirm-popover${shouldOpenScheduleCompleteAbove ? " is-above" : ""}`} ref={scheduleCompleteRef} role="dialog" aria-label="예정 일정 상태 변경 확인" onClick={(event) => event.stopPropagation()}>
                        <p>{isCompleted ? "완료한 일정을 되돌릴까요?" : "해당 일정을 완료 처리할까요?"}</p>
                        <div>
                          <button type="button" onClick={() => setConfirmingScheduleCompleteId(null)}>취소</button>
                          <button className={isCompleted ? "neutral" : "primary"} type="button" onClick={() => toggleScheduleComplete(schedule)}>{isCompleted ? "되돌림" : "완료"}</button>
                        </div>
                      </div>
                    ) : null}
                    {confirmingScheduleDeleteId === schedule.id ? (
                      <div className={`kim-check-confirm-popover delete${shouldOpenScheduleDeleteAbove ? " is-above" : ""}`} ref={scheduleDeleteRef} role="dialog" aria-label="예정 일정 삭제 확인" onClick={(event) => event.stopPropagation()}>
                        <p>해당 일정을 삭제하시겠습니까?</p>
                        <div>
                          <button type="button" onClick={() => setConfirmingScheduleDeleteId(null)}>아니요</button>
                          <button className="danger" type="button" onClick={() => deleteSchedule(schedule.id)}>삭제</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {addingScheduleItem ? renderScheduleInlineForm() : null}
          </div>
        </article>

        <article className="detail-section kim-mvp-card kim-quote-card compact">
          <div className="kim-mvp-card-head">
            <div className="kim-mvp-title-row">
              <i aria-hidden="true" className="kim-mvp-title-icon"><FileText size={14} strokeWidth={2.2} /></i>
              <h3>견적함</h3>
              <span>{kimMinjunQuoteHistory.length}개</span>
            </div>
            <button aria-label="견적함 추가" className="kim-mvp-add-circle" onClick={() => onToast("견적함 추가 자리입니다.")} type="button">+</button>
          </div>
          <div className="kim-mvp-card-body">
            <div className="kim-quote-list">
              {kimMinjunQuoteHistory.map((quote) => (
                <div className="kim-quote-row" key={quote.title}>
                  <span>{quote.status}</span>
                  <div>
                    <strong>{quote.title}</strong>
                    <p>{quote.meta}</p>
                  </div>
                  <label aria-label={`${quote.title} 원본 첨부`}>
                    <Upload size={12} strokeWidth={2.4} />
                    첨부
                    <input accept="image/*,.pdf" onChange={(event) => attachQuoteFile(event, quote.title)} type="file" />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="detail-section kim-mvp-card kim-doc-card">
          <div className="kim-mvp-card-head">
            <div className="kim-mvp-title-row">
              <i aria-hidden="true" className="kim-mvp-title-icon"><FolderOpen size={14} strokeWidth={2.2} /></i>
              <h3>서류함</h3>
              <span>0개</span>
            </div>
            <button aria-label="서류 추가" className="kim-mvp-add-circle" onClick={() => onToast("서류 추가 자리입니다.")} type="button">+</button>
          </div>
          <div className="kim-mvp-card-body">
            <div className="kim-doc-list">
              {kimMinjunDocumentVault.map((doc) => (
                <button className="kim-doc-row" key={doc.title} onClick={() => onToast(`${doc.title} 업로드 공간입니다.`)} type="button">
                  <span>{doc.status}</span>
                  <strong>{doc.title}</strong>
                </button>
              ))}
            </div>
          </div>
        </article>
        </section>
      </section>
      {renderFloatingPurchaseEditor()}
    </div>
  );
}

export function CustomerDetailPage({
  chanceOverride,
  customer,
  manageStatusOverride,
  onBack,
  onFullScreen,
  onEditorOpenChange,
  onToast,
  onWorkflowChange,
  variant = "page",
}: CustomerDetailPageProps) {
  const chance = chanceLabel(customer);
  const phone = phoneChunks(customer.phone);
  const isContracted = chance === "확정";
  const drawerMode = variant === "drawer";
  const isKimMinjun = customer.customerId === "CU-2605-0020";

  return (
    <div className={`customer-detail-console-page ${drawerMode ? "drawer" : ""} ${isKimMinjun ? "kim-detail-mode" : ""}`}>
      {isKimMinjun ? null : (
        <>
      <section className="customer-detail-summary">
        <div className="customer-detail-identity">
          <div className="customer-detail-avatar" aria-hidden="true">{customer.name.slice(0, 1)}</div>
          <div>
            <div className="customer-detail-name-row">
              <h2>{customer.name}</h2>
              <span className="customer-detail-code num">{customer.customerId}</span>
              <span className="customer-detail-type">{customer.customerType} · {customer.customerTypeDetail}</span>
            </div>
            <div className="customer-detail-contact-row">
              <span><Phone size={13} strokeWidth={2.2} />{phone.join("-")}</span>
              <span><UserRound size={13} strokeWidth={2.2} />{customer.advisor} · {customer.team}</span>
              <span><CalendarClock size={13} strokeWidth={2.2} />{customer.source} · {customer.receivedAt}</span>
            </div>
          </div>
        </div>
        <div className="customer-detail-status-strip" aria-label="고객 현재 운영 상태">
          <button className="detail-stage-pill" type="button">
            <span>{customer.statusGroup}</span>
            <em>›</em>
            <strong>{customer.status}</strong>
          </button>
          <button className={`detail-chance-pill ${isContracted ? "confirmed" : ""}`} type="button">{chance}</button>
          <button className="detail-manage-pill" type="button">{isContracted ? "완료 관리" : "정상"}</button>
        </div>
      </section>

      <section className="customer-detail-action-rail" aria-label="고객 상세 액션">
        <div className="customer-detail-panel-controls">
          <button className="detail-back-button" onClick={onBack} type="button">
            {drawerMode ? <X size={14} /> : <ArrowLeft size={14} />}
            {drawerMode ? "닫기" : "전체 보기"}
          </button>
          {drawerMode && onFullScreen ? (
            <button className="detail-back-button" onClick={onFullScreen} type="button"><Maximize2 size={14} />전체 화면</button>
          ) : null}
        </div>
        <div className="customer-detail-action-group">
          <button onClick={() => onToast(`${customer.name} 담당자 변경 패널 자리입니다.`)} type="button"><RefreshCcw size={13} />담당자 변경</button>
          <button onClick={() => onToast(`${customer.name} 상담 메모를 추가합니다.`)} type="button"><MessageSquareText size={13} />상담 메모</button>
          <button onClick={() => onToast(`${customer.name} 견적 작성 화면으로 이동합니다.`)} type="button"><FileText size={13} />견적 작성</button>
          <button className="primary" onClick={() => onToast(`${customer.name} 고객 앱으로 견적 송출 준비를 시작합니다.`)} type="button"><Send size={13} />앱으로 견적 송출</button>
        </div>
      </section>
        </>
      )}

      {isKimMinjun ? (
        <KimMinjunDetailContent
          chanceOverride={chanceOverride}
          customer={customer}
          manageStatusOverride={manageStatusOverride}
          onEditorOpenChange={onEditorOpenChange}
          onToast={onToast}
          onWorkflowChange={onWorkflowChange}
        />
      ) : (
      <div className="customer-detail-layout">
        <main className="customer-detail-main">
          <section className="detail-section timeline-section">
            <div className="detail-section-head">
              <div>
                <h3>상담 타임라인</h3>
                <p>접수부터 상태 변경, 메모, 견적 액션까지 고객 흐름을 시간순으로 봅니다.</p>
              </div>
              <span className="detail-section-count num">{timelineRows(customer).length}</span>
            </div>
            <div className="detail-timeline">
              {timelineRows(customer).map((item) => (
                <article className="detail-timeline-item" key={`${item.kind}-${item.title}`}>
                  <span className="detail-timeline-kind">{item.kind}</span>
                  <div>
                    <div className="detail-timeline-title">
                      <strong>{item.title}</strong>
                      <span>{item.meta}</span>
                    </div>
                    <p>{item.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="detail-section">
            <div className="detail-section-head">
              <div>
                <h3>상담 메모 · 문의 사항</h3>
                <p>전체 보기의 상담 메모 컬럼을 상세에서 원문 단위로 관리합니다.</p>
              </div>
              <button className="detail-inline-button" onClick={() => onToast("상담 메모 편집 모드는 다음 단계에서 연결합니다.")} type="button">수정</button>
            </div>
            <div className="detail-note-box">{customer.nextAction}</div>
          </section>

          <section className="detail-section">
            <div className="detail-tabs" role="tablist" aria-label="고객 상세 작업 탭">
              {["상담 기록", "고객 정보", "차량/견적", "계약/출고", "문서", "변경 이력"].map((tab, index) => (
                <button aria-selected={index === 0} className={index === 0 ? "active" : ""} key={tab} role="tab" type="button">{tab}</button>
              ))}
            </div>
            <div className="detail-record-grid">
              <div>
                <span>최근 상담 요약</span>
                <strong>{customer.aiSummary}</strong>
              </div>
              <div>
                <span>다음 액션</span>
                <strong>{customer.nextAction}</strong>
              </div>
            </div>
          </section>
        </main>

        <aside className="customer-detail-side">
          <section className="detail-section">
            <div className="detail-section-head compact">
              <h3>고객 스냅샷</h3>
            </div>
            <div className="detail-kv-list">
              {detailRows(customer).map((row) => (
                <div className="detail-kv-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong className={row.label === "연락처" || row.label === "고객번호" ? "num" : ""}>{row.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-section">
            <div className="detail-section-head compact">
              <h3>차량 · 구매방식</h3>
              <span className="detail-mini-badge">{customer.method}</span>
            </div>
            <div className="detail-kv-list">
              {vehicleRows(customer).map((row) => (
                <div className="detail-kv-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong className={row.tone === "accent" ? "accent" : ""}>{row.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-section ai-section">
            <div className="detail-section-head compact">
              <h3><Bot size={15} /> AI 힌트</h3>
            </div>
            <p>{customer.aiSummary}</p>
            <div className="detail-ai-next">
              <History size={14} />
              <span>상담 메모, 진행 상태, 계약 가능성 변경 이력을 기준으로 다음 액션을 추천하는 자리입니다.</span>
            </div>
          </section>
        </aside>
      </div>
      )}
    </div>
  );
}
