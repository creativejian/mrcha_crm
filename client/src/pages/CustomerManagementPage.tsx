import { Check, ChevronsUpDown, Eraser, FileText, MessageSquare, Minus, Pencil, Plus, RefreshCcw, Search, X } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { type Customer, type CustomerChanceOption, type CustomerManageStatus, type CustomerMode, customerStatusGroups, initialCustomers } from "@/data/customers";
import type { RoleTab } from "@/data/roles";

type CustomerManagementPageProps = {
  activeCustomerId?: string | null;
  customers?: Customer[];
  mode: CustomerMode;
  chanceOverrides?: Record<number, CustomerChanceOption>;
  manageStatusOverrides?: Record<number, CustomerManageStatus>;
  onChanceOverridesChange?: (overrides: Record<number, CustomerChanceOption>) => void;
  onCustomersChange?: (customers: Customer[]) => void;
  onOpenCustomer?: (customer: Customer) => void;
  roleTab?: RoleTab;
};

function modeFilter(mode: CustomerMode, customer: Customer) {
  if (mode === "consulting") return ["신규", "상담중", "견적", "차량체크", "심사서류", "관리중"].includes(customer.statusGroup);
  if (mode === "contract") return ["심사서류", "계약완료"].includes(customer.statusGroup);
  if (mode === "delivery") return customer.statusGroup === "계약완료";
  if (mode === "settlement") return customer.status === "출고완료" && customer.settlementStatus;
  if (mode === "hold") return ["관리중", "상담완료", "불발"].includes(customer.statusGroup);
  return true;
}

function badgeClass(value: string, group?: string) {
  if (value === "완료" || group === "계약완료" || value === "출고완료" || value === "배정완료") return "badge green";
  if (value === "긴급" || group === "불발" || value === "계약취소" || value === "지속적부재" || value === "재고없음") return "badge red";
  if (value === "높음" || value === "보류" || group === "견적" || group === "차량체크" || group === "관리중") return "badge yellow";
  return "badge";
}

function statusButtonClass(value: string, group?: string) {
  return badgeClass(value, group).replace("badge", "stage-status-button");
}

const headsByMode: Record<CustomerMode, string[]> = {
  all: ["선택", "고객", "차종 · 구매방식", "진행 상태", "계약 가능성", "상담 메모 · 문의 사항", "접수 · 배정", "관리 상태", "액션"],
  allDraft: ["선택", "고객", "차종 · 구매방식", "진행 상태", "계약 가능성", "상담 메모 · 문의 사항", "접수 · 배정", "관리 상태", "액션"],
  consulting: ["선택", "고객", "차종 · 구매방식", "상담 상태", "AI 요약", "상담 메모", "담당", "관리"],
  contract: ["선택", "고객", "고객유형", "차종 · 구매방식", "계약 / 심사", "계약 조건", "담당", "상담 메모", "관리"],
  delivery: ["선택", "고객", "차량", "출고 상태", "출고 업무", "담당", "관리"],
  settlement: ["선택", "고객", "차종 · 구매방식", "출고일", "수수료", "비용", "마진", "정산 상태", "관리"],
  hold: ["선택", "고객", "차종 · 구매방식", "상태", "이탈 / 보류 요약", "재컨택 액션", "담당", "관리"],
};

const tableColumnsByMode: Record<CustomerMode, string[]> = {
  all: ["select", "customer", "vehicle", "stage", "chance", "action", "operation", "update", "actions"],
  allDraft: ["select", "customer", "vehicle", "stage", "chance", "action", "operation", "update", "actions"],
  consulting: ["select", "customer", "vehicle", "stage", "summary", "action", "advisor", "actions"],
  contract: ["select", "customer", "type", "vehicle", "stage", "summary", "advisor", "action", "actions"],
  delivery: ["select", "customer", "vehicle", "stage", "summary", "advisor", "actions"],
  settlement: ["select", "customer", "vehicle", "date", "money", "money", "money", "stage", "actions"],
  hold: ["select", "customer", "vehicle", "stage", "summary", "action", "advisor", "actions"],
};

const pageSizeOptions = [15, 30, 50, 100] as const;
const chanceOptions = ["높음", "중간", "낮음", "보류", "확정"] as const;
const finalUpdateFilterOptions = ["정상", "확인필요", "재문의", "지연", "장기방치"] as const;
const advisorRotation = ["김지안", "이주선", "이건수"] as const;
type ChanceOption = CustomerChanceOption;
type ManageStatusOption = CustomerManageStatus;
type FinalUpdateFilterOption = typeof finalUpdateFilterOptions[number];
type StagePickerLevel = "primary" | "secondary";
type DraftFilterKey = "statusGroup" | "status" | "advisor" | "chance" | "finalUpdate";
type FinalUpdateInfo = {
  action: string;
  field: string;
  label: string;
  days: number;
  customerRecontacted?: boolean;
};

type FinalUpdateStatus = {
  className: string;
  label: string;
};

const primaryStageOptions = Object.keys(customerStatusGroups);
const secondaryStageOptionsByGroup = customerStatusGroups;

const statusGroupByStatus = Object.fromEntries(
  Object.entries(customerStatusGroups).flatMap(([group, values]) => values.map((value) => [value, group])),
);

const initialFinalUpdateByCustomerId: Record<string, FinalUpdateInfo> = {
  "CU-2605-0020": { action: "상담 메모 업데이트", field: "상담 메모", label: "5월 19일 13:42", days: 0 },
  "CU-2605-0019": { action: "진행 상태 준비중으로 변경", field: "진행 상태", label: "5월 19일 11:18", days: 0 },
  "CU-2605-0018": { action: "계약 가능성 높음으로 변경", field: "계약 가능성", label: "5월 18일 19:10", days: 1 },
  "CU-2605-0017": { action: "진행 상태 출고완료로 변경", field: "진행 상태", label: "5월 14일 16:30", days: 5 },
  "CU-2605-0016": { action: "상담 메모 업데이트", field: "상담 메모", label: "5월 11일 10:02", days: 8 },
  "CU-2605-0015": { action: "고객이 카카오로 먼저 재문의", field: "유입 경로", label: "5월 19일 10:00", days: 0, customerRecontacted: true },
  "CU-2605-0014": { action: "상담 메모 업데이트", field: "상담 메모", label: "5월 13일 15:20", days: 6 },
  "CU-2605-0013": { action: "진행 상태 추후재컨택으로 변경", field: "진행 상태", label: "5월 1일 13:45", days: 18 },
  "CU-2605-0011": { action: "계약 가능성 중간으로 변경", field: "계약 가능성", label: "5월 7일 18:00", days: 12 },
  "CU-2605-0010": { action: "차종 · 구매방식 재고확인중으로 변경", field: "차종 · 구매방식", label: "5월 4일 13:30", days: 15 },
  "CU-2605-0009": { action: "진행 상태 딜러사계약중으로 변경", field: "진행 상태", label: "5월 16일 16:40", days: 3 },
  "CU-2605-0008": { action: "상담 메모 업데이트", field: "상담 메모", label: "4월 18일 11:10", days: 31 },
};

const vehicleDisplayByVehicle: Record<string, { title: string; trim: string; trimShort?: string }> = {
  "Maybach S-Class": { title: "Maybach S-Class", trim: "S 500 4M Long" },
  "Model Y": { title: "Model Y", trim: "Premium RWD" },
  GV80: { title: "GV80", trim: "26년형 가솔린 터보 2.5", trimShort: "2.5T 가솔린" },
  "GV80 Coupe": { title: "GV80 Coupe", trim: "26년형 가솔린 터보 3.5", trimShort: "3.5T 가솔린" },
  싼타페: { title: "싼타페", trim: "26년형 가솔린 터보 1.6 하이브리드 2WD", trimShort: "1.6T 하이브리드 2WD" },
  "Cooper Convertible": { title: "Cooper Convertible", trim: "JCW" },
  Panamera: { title: "Panamera", trim: "Panamera 4 E-Hybrid" },
  팰리세이드: { title: "팰리세이드", trim: "26년형 가솔린 터보 2.5 하이브리드 (9인승)", trimShort: "2.5T 하이브리드 · 9인승" },
  "E-Class": { title: "E-Class", trim: "E 300 4M AMG Line" },
  K8: { title: "K8", trim: "26년형 가솔린 터보 1.6 하이브리", trimShort: "1.6T 하이브리드" },
  GLE: { title: "GLE", trim: "GLE 450 4M AMG Line" },
  쏘렌토: { title: "쏘렌토", trim: "26년형 가솔린 터보 2.5 2WD", trimShort: "2.5T 가솔린 2WD" },
  Cybertruck: { title: "Cybertruck", trim: "Cyberbeast" },
  "5 Series": { title: "5 Series", trim: "520i M Spt" },
  GV70: { title: "GV70", trim: "2.5T 가솔린" },
  카니발: { title: "카니발", trim: "3.5 가솔린 · 7인승" },
  A6: { title: "A6", trim: "A6 45 TFSI qu. S-Line" },
  G80: { title: "G80", trim: "2.5T 가솔린" },
  XC90: { title: "XC90", trim: "T8 AWD Ultra Dark" },
};

const extraVehicleDisplayByCustomerId: Record<string, string[]> = {
  "CU-2605-0020": ["GLC"],
};

const extraPurchaseMethodDisplayByCustomerId: Record<string, string[]> = {
  "CU-2605-0020": ["할부"],
  "CU-2605-0014": ["장기렌트"],
  "CU-2605-0012": ["운용리스"],
  "CU-2605-0010": ["운용리스", "할부"],
};

const aiHintDisplayByCustomerId: Record<string, { parts: { text: string; strong?: boolean }[] }> = {
  "CU-2605-0020": { parts: [{ text: "X3 · GLC", strong: true }, { text: "를 비교 중이며 " }, { text: "중도해지, 월 납입액, 총비용", strong: true }, { text: " 차이에 민감" }] },
  "CU-2605-0019": { parts: [{ text: "초기비용 0원", strong: true }, { text: " 선호가 강하고 " }, { text: "보험 포함, 만기 인수", strong: true }, { text: "를 함께 확인 중" }] },
  "CU-2605-0018": { parts: [{ text: "사업자 증빙", strong: true }, { text: "이 약해 " }, { text: "승인 금융사", strong: true }, { text: "를 먼저 좁혀야 함" }] },
  "CU-2605-0017": { parts: [{ text: "계약 완료", strong: true }, { text: " 후 " }, { text: "시공 일정, 첫 출고 경험", strong: true }, { text: " 관리가 중요" }] },
  "CU-2605-0016": { parts: [{ text: "법인 인수자, 보험 담보", strong: true }, { text: "를 출고 전 다시 확인해야 함" }] },
  "CU-2605-0015": { parts: [{ text: "패밀리카", strong: true }, { text: " 목적이 뚜렷하고 " }, { text: "월 70만원 이하", strong: true }, { text: " 조건을 희망" }] },
  "CU-2605-0014": { parts: [{ text: "첫 차 구매", strong: true }, { text: "라 " }, { text: "월 납입, 만기 인수", strong: true }, { text: " 이해가 결정에 중요" }] },
  "CU-2605-0013": { parts: [{ text: "희망 조건", strong: true }, { text: "과 " }, { text: "금융 조건 차이", strong: true }, { text: "가 커 단기 가능성은 낮음" }] },
  "CU-2605-0012": { parts: [{ text: "패밀리 SUV", strong: true }, { text: " 탐색 중이며 " }, { text: "렌트 · 리스", strong: true }, { text: " 차이 이해가 먼저 필요" }] },
  "CU-2605-0011": { parts: [{ text: "수입 세단", strong: true }, { text: " 선호가 강하지만 " }, { text: "초기비용", strong: true }, { text: " 상한 재확인이 필요" }] },
  "CU-2605-0010": { parts: [{ text: "빠른 출고", strong: true }, { text: " 선호가 강해 " }, { text: "재고 색상", strong: true }, { text: " 확인이 우선" }] },
  "CU-2605-0009": { parts: [{ text: "계약 확정", strong: true }, { text: " 건으로 " }, { text: "출고 안내, 법인 서류", strong: true }, { text: "만 남음" }] },
  "CU-2605-0008": { parts: [{ text: "가족 반대", strong: true }, { text: "로 취소되어 " }, { text: "재컨택 명분", strong: true }, { text: " 정리가 필요" }] },
  "CU-2605-0007": { parts: [{ text: "출고 완료", strong: true }, { text: " 후 " }, { text: "정산 입금, 후기 요청", strong: true }, { text: " 타이밍 관리 필요" }] },
  "CU-2605-0006": { parts: [{ text: "사업자 리스", strong: true }, { text: " 출고 완료, " }, { text: "정산 확인", strong: true }, { text: "만 남음" }] },
  "CU-2605-0005": { parts: [{ text: "법인 렌트", strong: true }, { text: " 출고 후 " }, { text: "정산 자료, 증빙 파일", strong: true }, { text: " 확인 필요" }] },
  "CU-2605-0004": { parts: [{ text: "다자녀 패밀리카", strong: true }, { text: " 문의 후 미응답, " }, { text: "마지막 재컨택", strong: true }, { text: " 전까지 보류" }] },
  "CU-2605-0003": { parts: [{ text: "수입 세단", strong: true }, { text: " 선호는 명확하나 " }, { text: "배우자 결정", strong: true }, { text: " 영향이 큼" }] },
  "CU-2605-0002": { parts: [{ text: "구매 의사", strong: true }, { text: "는 있으나 " }, { text: "시점, 예산", strong: true }, { text: "이 미정이라 우선순위 낮음" }] },
  "CU-2605-0001": { parts: [{ text: "안전성, 브랜드 이미지", strong: true }, { text: "를 중시하며 " }, { text: "6월 조건", strong: true }, { text: " 대기 중" }] },
};

function vehicleDisplay(customer: Customer) {
  const display = vehicleDisplayByVehicle[customer.vehicle] ?? { title: customer.vehicle, trim: "트림 미확인" };
  const extraVehicles = extraVehicleDisplayByCustomerId[customer.customerId] ?? [];
  const extraMethods = extraPurchaseMethodDisplayByCustomerId[customer.customerId] ?? [];
  return {
    ...display,
    extraVehicles,
    extraMethods,
    trimLabel: display.trimShort ?? display.trim,
    method: customer.method,
  };
}

function customerMeta(customer: Customer) {
  return [customer.customerType, customer.customerTypeDetail].filter(Boolean).join(" · ");
}

function extraTooltipValue(values: string[]) {
  return values.join(", ");
}

function aiHintDisplay(customer: Customer) {
  return aiHintDisplayByCustomerId[customer.customerId] ?? { parts: [{ text: customer.aiSummary }] };
}

function compactOperationDate(year: string, month: string, day: string, time: string) {
  return `${year.slice(-2)}/${month}/${day} ${time}`;
}

function receivedAtDisplay(value: string) {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/);
  if (!matched) return value;
  const [, year, month, day, time] = matched;
  if (month === "05" && day === "14") return `오늘 ${time}`;
  if (month === "05" && day === "13") return `어제 ${time}`;
  return compactOperationDate(year, month, day, time);
}

function assignedAtDisplay(value: string) {
  const relativeMatched = value.match(/^(오늘|어제) (\d{2}:\d{2})$/);
  if (relativeMatched) return value;

  const shortDateMatched = value.match(/^(\d{1,2})\/(\d{2}) (\d{2}:\d{2})$/);
  if (shortDateMatched) {
    const [, month, day, time] = shortDateMatched;
    return compactOperationDate("2026", month.padStart(2, "0"), day, time);
  }

  return value;
}

function operationDateValue(value: string): number | null {
  const todayMatched = value.match(/^오늘 (\d{2}):(\d{2})$/);
  if (todayMatched) return new Date(2026, 4, 19, Number(todayMatched[1]), Number(todayMatched[2])).getTime();

  const yesterdayMatched = value.match(/^어제 (\d{2}):(\d{2})$/);
  if (yesterdayMatched) return new Date(2026, 4, 18, Number(yesterdayMatched[1]), Number(yesterdayMatched[2])).getTime();

  const shortDateMatched = value.match(/^(\d{1,2})\/(\d{2}) (\d{2}):(\d{2})$/);
  if (shortDateMatched) return new Date(2026, Number(shortDateMatched[1]) - 1, Number(shortDateMatched[2]), Number(shortDateMatched[3]), Number(shortDateMatched[4])).getTime();

  const compactDateMatched = value.match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
  if (compactDateMatched) return new Date(2000 + Number(compactDateMatched[1]), Number(compactDateMatched[2]) - 1, Number(compactDateMatched[3]), Number(compactDateMatched[4]), Number(compactDateMatched[5])).getTime();

  const koreanDateMatched = value.match(/^(\d{1,2})월 (\d{1,2})일 (\d{2}):(\d{2})$/);
  if (koreanDateMatched) return new Date(2026, Number(koreanDateMatched[1]) - 1, Number(koreanDateMatched[2]), Number(koreanDateMatched[3]), Number(koreanDateMatched[4])).getTime();

  return null;
}

function firstResponseDisplay(assignedAt: string, updateInfo: FinalUpdateInfo | null) {
  if (!updateInfo) return "대기 중";

  const assignedTime = operationDateValue(assignedAt);
  const firstActionTime = operationDateValue(updateInfo.label);
  if (!assignedTime || !firstActionTime || firstActionTime < assignedTime) return "기록 확인";

  const minutes = Math.round((firstActionTime - assignedTime) / 60_000);
  if (minutes <= 0) return "즉시";
  if (minutes < 60) return `배정 후 ${minutes}분`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `배정 후 ${hours}시간 ${remainingMinutes}분` : `배정 후 ${hours}시간`;

  const days = Math.floor(hours / 24);
  return `배정 후 ${days}일`;
}

function chanceLabel(customer: Customer): ChanceOption {
  if (customer.statusGroup === "계약완료" || customer.status === "출고완료") return "확정";
  if (customer.statusGroup === "불발" || customer.status === "계약취소") return "낮음";
  if (customer.priority === "긴급" || customer.priority === "높음") return "높음";
  if (customer.priority === "보류") return "보류";
  if (customer.priority === "낮음") return "낮음";
  return "중간";
}

function chanceButtonClass(value: ChanceOption) {
  const toneByChance: Record<ChanceOption, string> = {
    높음: "purple",
    중간: "",
    낮음: "red",
    보류: "yellow",
    확정: "green",
  };

  return ["chance-status-button", toneByChance[value]].filter(Boolean).join(" ");
}

function chanceOptionClass(value: ChanceOption, active: boolean) {
  const toneByChance: Record<ChanceOption, string> = {
    높음: "purple",
    중간: "neutral",
    낮음: "red",
    보류: "yellow",
    확정: "green",
  };

  return ["chance-status-option", toneByChance[value], active ? "active" : ""].filter(Boolean).join(" ");
}

function stageSignal(customer: Customer) {
  const signalsByStatus: Record<string, string> = {
    신규: "상담 배정",
    상담중: "방식 확정",
    관리중: "조건 재확인",
    상담완료: "조건 대기",
    견적준비중: "견적 작성",
    차량체크중: "재고 확인",
    견적발송: "응답 대기",
    심사서류안내: "서류 대기",
    계약완료: "출고 준비",
    계약취소: "재컨택 후보",
    출고예정: "출고 확인",
    출고완료: customer.settlementStatus ? "정산 확인" : "완료 관리",
    "부재(1차 부재중)": "2차 예정",
    "부재(카톡인사)": "2차 예정",
    "부재(미응답)": "마지막 재컨택",
    재컨택완료: "조건 재확인",
    미정: "시점 보류",
    불발: "이탈 기록",
  };

  return signalsByStatus[customer.status] ?? (customer.priority === "긴급" ? "우선 처리" : "후속 확인");
}

function finalUpdateStatus(info: FinalUpdateInfo): FinalUpdateStatus {
  if (info.customerRecontacted) return { className: "recontact", label: "재문의" };
  if (info.days >= 30) return { className: "stale", label: "장기방치" };
  if (info.days >= 15) return { className: "delay", label: "지연" };
  if (info.days >= 7) return { className: "check", label: "확인필요" };
  return { className: "normal", label: "정상" };
}

function finalUpdateStatusFromManage(value: ManageStatusOption): FinalUpdateStatus {
  const classByStatus: Record<ManageStatusOption, string> = {
    정상: "normal",
    확인필요: "check",
    재문의: "recontact",
    지연: "delay",
    장기방치: "stale",
  };

  return { className: classByStatus[value], label: value };
}

function shouldShowAdvisorColumn(roleTab: RoleTab) {
  return roleTab === "최고관리자" || roleTab === "팀장";
}

function visibleTableItems(items: string[], showAdvisorColumn: boolean) {
  return showAdvisorColumn ? items : items.filter((item) => item !== "담당" && item !== "advisor");
}

function filterSelectClass(active: boolean, extraClassName?: string) {
  return ["select", extraClassName, active ? "filter-active" : ""].filter(Boolean).join(" ");
}

function AiHintIcon() {
  return (
    <svg aria-hidden="true" className="ai-hint-icon" viewBox="0 0 512 512">
      <path
        d="m320 192l-85.333-32L320 127.968l32-85.301l32.03 85.301L469.333 160l-85.303 32L352 277.333zM149.333 362.667L42.667 320l106.666-42.667L192 170.667l42.667 106.666L341.333 320l-106.666 42.667L192 469.333z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CustomerManagementPage({
  activeCustomerId = null,
  customers: controlledCustomers,
  mode,
  chanceOverrides: controlledChanceOverrides,
  manageStatusOverrides = {},
  onChanceOverridesChange,
  onCustomersChange,
  onOpenCustomer,
  roleTab = "최고관리자",
}: CustomerManagementPageProps) {
  const [internalCustomers, setInternalCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [statusGroup, setStatusGroup] = useState("");
  const [status, setStatus] = useState("");
  const [advisor, setAdvisor] = useState("");
  const [chanceFilter, setChanceFilter] = useState<"" | ChanceOption>("");
  const [finalUpdateFilter, setFinalUpdateFilter] = useState<"" | FinalUpdateFilterOption>("");
  const [selected, setSelected] = useState<number[]>([]);
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(15);
  const [currentPage, setCurrentPage] = useState(1);
  const [openStageFor, setOpenStageFor] = useState<number | null>(null);
  const [openStagePicker, setOpenStagePicker] = useState<{ customerNo: number; level: StagePickerLevel } | null>(null);
  const [openChanceFor, setOpenChanceFor] = useState<number | null>(null);
  const [openExtraFor, setOpenExtraFor] = useState<string | null>(null);
  const [openFinalUpdateFor, setOpenFinalUpdateFor] = useState<number | null>(null);
  const [internalChanceOverrides, setInternalChanceOverrides] = useState<Record<number, ChanceOption>>({});
  const [finalUpdateOverrides, setFinalUpdateOverrides] = useState<Record<number, FinalUpdateInfo>>({});
  const [editingNextAction, setEditingNextAction] = useState<{ customerNo: number; draft: string } | null>(null);
  const [chanceNoticeFor, setChanceNoticeFor] = useState<number | null>(null);
  const nextActionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const nextActionEditorRef = useRef<HTMLDivElement>(null);
  const stagePopoverRef = useRef<HTMLDivElement>(null);
  const stagePickerRef = useRef<HTMLDivElement>(null);
  const chancePopoverRef = useRef<HTMLDivElement>(null);
  const extraPopoverRef = useRef<HTMLButtonElement>(null);
  const finalUpdatePopoverRef = useRef<HTMLDivElement>(null);
  const draftFilterRailRef = useRef<HTMLDivElement>(null);
  const pageSizeControlRef = useRef<HTMLDivElement>(null);
  const chanceNoticeTimerRef = useRef<number | null>(null);
  const suppressOutsideClickRef = useRef(false);
  const showAdvisorColumn = shouldShowAdvisorColumn(roleTab);
  const tableHeads = visibleTableItems(headsByMode[mode], showAdvisorColumn);
  const tableColumns = visibleTableItems(tableColumnsByMode[mode], showAdvisorColumn);
  const [openDraftFilter, setOpenDraftFilter] = useState<DraftFilterKey | null>(null);
  const [openPageSize, setOpenPageSize] = useState(false);
  const customers = controlledCustomers ?? internalCustomers;
  const chanceOverrides = controlledChanceOverrides ?? internalChanceOverrides;

  function updateCustomers(next: Customer[] | ((current: Customer[]) => Customer[])) {
    const nextCustomers = typeof next === "function" ? next(customers) : next;
    if (onCustomersChange) onCustomersChange(nextCustomers);
    else setInternalCustomers(nextCustomers);
  }

  function updateChanceOverrides(next: Record<number, ChanceOption> | ((current: Record<number, ChanceOption>) => Record<number, ChanceOption>)) {
    const nextOverrides = typeof next === "function" ? next(chanceOverrides) : next;
    if (onChanceOverridesChange) onChanceOverridesChange(nextOverrides);
    else setInternalChanceOverrides(nextOverrides);
  }

  const statuses = statusGroup ? customerStatusGroups[statusGroup] : Object.values(customerStatusGroups).flat();
  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const searchable = `${customer.name} ${customer.phone} ${customer.vehicle} ${customer.customerType} ${customer.customerTypeDetail} ${customer.status} ${customer.source} ${customer.advisor} ${customer.aiSummary}`.toLowerCase();
      const chance = customer.statusGroup === "계약완료" ? "확정" : chanceOverrides[customer.no] ?? chanceLabel(customer);
      const updateInfo = finalUpdateOverrides[customer.no] ?? initialFinalUpdateByCustomerId[customer.customerId] ?? null;
      const updateStatus = manageStatusOverrides[customer.no] ?? (updateInfo ? finalUpdateStatus(updateInfo).label : "");
      return modeFilter(mode, customer) &&
        (!keyword || searchable.includes(keyword)) &&
        (!statusGroup || customer.statusGroup === statusGroup) &&
        (!status || customer.status === status) &&
        (!advisor || customer.advisor === advisor) &&
        (!chanceFilter || chance === chanceFilter) &&
        (!finalUpdateFilter || updateStatus === finalUpdateFilter);
    });
  }, [advisor, chanceFilter, chanceOverrides, customers, finalUpdateFilter, finalUpdateOverrides, mode, search, status, statusGroup]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const pageStart = (effectivePage - 1) * pageSize;
  const paginatedRows = rows.slice(pageStart, pageStart + pageSize);
  const pageEnd = rows.length === 0 ? 0 : pageStart + paginatedRows.length;
  const allSelected = paginatedRows.length > 0 && paginatedRows.every((customer) => selected.includes(customer.no));
  const visiblePages = useMemo(() => {
    const maxVisiblePages = 5;
    const start = Math.max(1, Math.min(effectivePage - 2, totalPages - maxVisiblePages + 1));
    const end = Math.min(totalPages, start + maxVisiblePages - 1);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [effectivePage, totalPages]);

  useEffect(() => {
    if (openDraftFilter === null) return;

    function closeDraftFilter(event: PointerEvent) {
      if (draftFilterRailRef.current?.contains(event.target as Node)) return;
      setOpenDraftFilter(null);
    }

    function closeDraftFilterByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenDraftFilter(null);
    }

    document.addEventListener("pointerdown", closeDraftFilter, true);
    document.addEventListener("keydown", closeDraftFilterByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeDraftFilter, true);
      document.removeEventListener("keydown", closeDraftFilterByKeyboard);
    };
  }, [openDraftFilter]);

  useEffect(() => {
    if (!openPageSize) return;

    function closePageSize(event: PointerEvent) {
      if (pageSizeControlRef.current?.contains(event.target as Node)) return;
      setOpenPageSize(false);
    }

    function closePageSizeByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenPageSize(false);
    }

    document.addEventListener("pointerdown", closePageSize, true);
    document.addEventListener("keydown", closePageSizeByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closePageSize, true);
      document.removeEventListener("keydown", closePageSizeByKeyboard);
    };
  }, [openPageSize]);

  function isTableControlTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(".stage-control, .chance-control, .extra-count-pill, .final-update-control, .advisor-change-pill"));
  }

  useEffect(() => {
    if (openStageFor === null) return;

    function closeStagePopover(event: PointerEvent) {
      if (stagePopoverRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenStageFor(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeStagePopoverByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenStageFor(null);
    }

    document.addEventListener("pointerdown", closeStagePopover, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeStagePopoverByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeStagePopover, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeStagePopoverByKeyboard);
    };
  }, [openStageFor]);

  useEffect(() => {
    if (openStagePicker === null) return;

    function closeStagePicker(event: PointerEvent) {
      if (stagePickerRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenStagePicker(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeStagePickerByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenStagePicker(null);
    }

    document.addEventListener("pointerdown", closeStagePicker, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeStagePickerByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeStagePicker, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeStagePickerByKeyboard);
    };
  }, [openStagePicker]);

  useEffect(() => {
    if (openChanceFor === null) return;

    function closeChancePopover(event: PointerEvent) {
      if (chancePopoverRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenChanceFor(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeChancePopoverByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenChanceFor(null);
    }

    document.addEventListener("pointerdown", closeChancePopover, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeChancePopoverByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeChancePopover, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeChancePopoverByKeyboard);
    };
  }, [openChanceFor]);

  useEffect(() => {
    if (openExtraFor === null) return;

    function closeExtraPopover(event: PointerEvent) {
      if (extraPopoverRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenExtraFor(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeExtraPopoverByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenExtraFor(null);
    }

    document.addEventListener("pointerdown", closeExtraPopover, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeExtraPopoverByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeExtraPopover, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeExtraPopoverByKeyboard);
    };
  }, [openExtraFor]);

  useEffect(() => {
    if (openFinalUpdateFor === null) return;

    function closeFinalUpdatePopoverFromAiHint(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(".ai-hint-wrap")) {
        setOpenFinalUpdateFor(null);
      }
    }

    function closeFinalUpdatePopover(event: PointerEvent) {
      if (finalUpdatePopoverRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenFinalUpdateFor(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeFinalUpdatePopoverByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenFinalUpdateFor(null);
    }

    document.addEventListener("pointerover", closeFinalUpdatePopoverFromAiHint, true);
    document.addEventListener("pointerdown", closeFinalUpdatePopover, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeFinalUpdatePopoverByKeyboard);
    return () => {
      document.removeEventListener("pointerover", closeFinalUpdatePopoverFromAiHint, true);
      document.removeEventListener("pointerdown", closeFinalUpdatePopover, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeFinalUpdatePopoverByKeyboard);
    };
  }, [openFinalUpdateFor]);

  useEffect(() => {
    const textarea = nextActionTextareaRef.current;
    if (!editingNextAction || !textarea) return;
    const cursorPosition = textarea.value.length;
    textarea.focus();
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  }, [editingNextAction?.customerNo]);

  useEffect(() => {
    if (!editingNextAction) return;
    const editingCustomerNo = editingNextAction.customerNo;

    function saveNextActionFromOutsideClick(event: PointerEvent) {
      if (nextActionEditorRef.current?.contains(event.target as Node)) return;
      saveNextAction(editingCustomerNo);
    }

    document.addEventListener("pointerdown", saveNextActionFromOutsideClick, true);
    return () => {
      document.removeEventListener("pointerdown", saveNextActionFromOutsideClick, true);
    };
  }, [editingNextAction]);

  useEffect(() => {
    return () => {
      if (chanceNoticeTimerRef.current !== null) window.clearTimeout(chanceNoticeTimerRef.current);
    };
  }, []);

  function showChanceNotice(customerNo: number) {
    if (chanceNoticeTimerRef.current !== null) window.clearTimeout(chanceNoticeTimerRef.current);
    setChanceNoticeFor(customerNo);
    chanceNoticeTimerRef.current = window.setTimeout(() => {
      setChanceNoticeFor(null);
      chanceNoticeTimerRef.current = null;
    }, 2200);
  }

  function syncChanceWithStageGroup(customerNo: number, nextGroup: string) {
    updateChanceOverrides((current) => {
      if (nextGroup === "계약완료") return { ...current, [customerNo]: "확정" };
      if (current[customerNo] !== "확정") return current;
      const next = { ...current };
      delete next[customerNo];
      return next;
    });
  }

  function markFinalUpdate(customerNo: number, field: string, action = `${field} 업데이트`) {
    setFinalUpdateOverrides((current) => ({
      ...current,
      [customerNo]: { action, field, label: "방금 전", days: 0 },
    }));
  }

  function changeCustomerAdvisor(customerNo: number) {
    updateCustomers((current) => current.map((customer) => {
      if (customer.no !== customerNo) return customer;
      const currentIndex = advisorRotation.findIndex((name) => name === customer.advisor);
      const nextAdvisor = advisorRotation[(currentIndex + 1 + advisorRotation.length) % advisorRotation.length];
      return { ...customer, advisor: nextAdvisor, assignedAt: "방금 전" };
    }));
    markFinalUpdate(customerNo, "담당", "담당자 변경");
    setOpenStageFor(null);
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor(null);
  }

  function toggleFinalUpdatePopover(event: MouseEvent<HTMLButtonElement>, customerNo: number) {
    event.stopPropagation();
    setOpenStageFor(null);
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor((current) => current === customerNo ? null : customerNo);
  }

  function toggleAll(checked: boolean) {
    const pageIds = paginatedRows.map((customer) => customer.no);
    setSelected((current) => checked
      ? Array.from(new Set([...current, ...pageIds]))
      : current.filter((id) => !pageIds.includes(id)));
  }

  function deleteSelected() {
    updateCustomers((current) => current.filter((customer) => !selected.includes(customer.no)));
    setSelected([]);
  }

  function changeCustomerStatus(customerNo: number, nextStatus: string) {
    const nextGroup = statusGroupByStatus[nextStatus] ?? "";
    updateCustomers((current) => current.map((customer) => customer.no === customerNo
      ? { ...customer, status: nextStatus, statusGroup: nextGroup }
      : customer));
    syncChanceWithStageGroup(customerNo, nextGroup);
    markFinalUpdate(customerNo, "진행 상태");
    setOpenStageFor(null);
    setOpenStagePicker(null);
    setOpenExtraFor(null);
  }

  function openTwoStepStagePicker(customerNo: number, level: StagePickerLevel) {
    setOpenStageFor(null);
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor(null);
    setOpenStagePicker((current) => current?.customerNo === customerNo && current.level === level ? null : { customerNo, level });
  }

  function changeTwoStepPrimaryStage(customerNo: number, nextGroup: string) {
    const nextStatus = secondaryStageOptionsByGroup[nextGroup]?.[0] ?? customerStatusGroups[nextGroup]?.[0] ?? nextGroup;
    updateCustomers((current) => current.map((customer) => customer.no === customerNo
      ? { ...customer, statusGroup: nextGroup, status: nextStatus }
      : customer));
    syncChanceWithStageGroup(customerNo, nextGroup);
    markFinalUpdate(customerNo, "진행 상태");
    setOpenStagePicker({ customerNo, level: "secondary" });
    setOpenStageFor(null);
    setOpenExtraFor(null);
  }

  function changeTwoStepSecondaryStage(customerNo: number, nextStatus: string) {
    updateCustomers((current) => current.map((customer) => customer.no === customerNo
      ? { ...customer, status: nextStatus }
      : customer));
    markFinalUpdate(customerNo, "진행 상태");
    setOpenStagePicker(null);
    setOpenStageFor(null);
    setOpenExtraFor(null);
  }

  function changeCustomerChance(customerNo: number, nextChance: ChanceOption) {
    const customer = customers.find((item) => item.no === customerNo);
    if (nextChance === "확정" && customer?.statusGroup !== "계약완료") {
      showChanceNotice(customerNo);
      return;
    }
    updateChanceOverrides((current) => ({ ...current, [customerNo]: nextChance }));
    markFinalUpdate(customerNo, "계약 가능성");
    setOpenChanceFor(null);
    setOpenExtraFor(null);
  }

  function startEditingNextAction(customer: Customer) {
    setOpenStageFor(null);
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor(null);
    setEditingNextAction({ customerNo: customer.no, draft: customer.nextAction });
  }

  function changeNextActionDraft(customerNo: number, draft: string) {
    setEditingNextAction((current) => current?.customerNo === customerNo ? { ...current, draft } : current);
  }

  function saveNextAction(customerNo: number) {
    if (editingNextAction?.customerNo !== customerNo) return;
    const nextAction = editingNextAction.draft.trim();
    updateCustomers((current) => current.map((customer) => customer.no === customerNo ? { ...customer, nextAction } : customer));
    markFinalUpdate(customerNo, "상담 메모");
    setEditingNextAction(null);
  }

  function cancelNextActionEdit() {
    setEditingNextAction(null);
  }

  function clearNextActionDraft(customerNo: number) {
    setEditingNextAction((current) => current?.customerNo === customerNo ? { ...current, draft: "" } : current);
    window.setTimeout(() => {
      const textarea = nextActionTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(0, 0);
    }, 0);
  }

  function handleNextActionEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, customerNo: number) {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      saveNextAction(customerNo);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelNextActionEdit();
    }
  }

  function openCustomer(customer: Customer) {
    if (suppressOutsideClickRef.current) return;
    onOpenCustomer?.(customer);
  }

  function openCustomerByKeyboard(event: KeyboardEvent<HTMLTableRowElement>, customer: Customer) {
    if (event.key === "Enter") openCustomer(customer);
  }

  function stopTableControlPointer(event: ReactPointerEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function toggleExtraPopover(event: MouseEvent<HTMLButtonElement>, extraId: string) {
    event.stopPropagation();
    setOpenStageFor(null);
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenFinalUpdateFor(null);
    setOpenExtraFor((current) => current === extraId ? null : extraId);
  }

  function renderRow(customer: Customer) {
    const check = (
      <td className="select-cell">
        <input
          checked={selected.includes(customer.no)}
          onChange={(event) => {
            setSelected((current) => event.target.checked ? [...current, customer.no] : current.filter((id) => id !== customer.no));
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={stopTableControlPointer}
          type="checkbox"
        />
      </td>
    );
    const customerCell = (
      <td>
        <strong className="customer-name">{customer.name}<span className="customer-code num">{customer.customerId}</span></strong>
        <span className="customer-meta">{customerMeta(customer)}</span>
        <span className="customer-phone num">{customer.phone}</span>
      </td>
    );
    const hint = aiHintDisplay(customer);
    const actions = (
      <td className="actions-cell">
        <span className="row-actions" onClick={(event) => event.stopPropagation()} onPointerDown={stopTableControlPointer}>
          <span
            className="ai-hint-wrap"
            onFocus={() => setOpenFinalUpdateFor(null)}
            onMouseEnter={() => setOpenFinalUpdateFor(null)}
            onPointerEnter={() => setOpenFinalUpdateFor(null)}
          >
            <button
              aria-label="AI 힌트"
              className="tiny-btn ai-hint-btn"
              title="AI 힌트"
              type="button"
            >
              <AiHintIcon />
            </button>
            <span className="ai-hint-tooltip">
              {hint.parts.map((part, index) => (
                part.strong ? <strong key={`${part.text}-${index}`}>{part.text}</strong> : <span key={`${part.text}-${index}`}>{part.text}</span>
              ))}
            </span>
          </span>
          <button className="tiny-btn" title="상담 열기" type="button"><MessageSquare size={15} /></button>
          <button className="tiny-btn" title="상세 문서" type="button"><FileText size={15} /></button>
        </span>
      </td>
    );
    const rowProps = {
      className: [onOpenCustomer ? "customer-row" : "", activeCustomerId === customer.customerId ? "detail-open" : ""].filter(Boolean).join(" ") || undefined,
      onClick: () => openCustomer(customer),
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => openCustomerByKeyboard(event, customer),
      tabIndex: onOpenCustomer ? 0 : undefined,
    };
    const vehicle = vehicleDisplay(customer);
    const vehicleExtraId = `${customer.no}:vehicle`;
    const methodExtraId = `${customer.no}:method`;
    const vehicleCell = (
      <td>
        <strong className="vehicle-title">
          <span className="vehicle-line-text">{vehicle.title}</span>
          {vehicle.extraVehicles.length > 0 && (
            <button
              aria-expanded={openExtraFor === vehicleExtraId}
              aria-label={`${vehicle.title} 추가 차종 보기`}
              className={openExtraFor === vehicleExtraId ? "extra-count-pill active" : "extra-count-pill"}
              onClick={(event) => toggleExtraPopover(event, vehicleExtraId)}
              ref={openExtraFor === vehicleExtraId ? extraPopoverRef : undefined}
              type="button"
            >
              +{vehicle.extraVehicles.length}
              <span className="extra-tooltip">
                <strong>{extraTooltipValue(vehicle.extraVehicles)}</strong>
                <span>도 고민 · 비교 중..</span>
              </span>
            </button>
          )}
        </strong>
        <span className="vehicle-trim" title={vehicle.trim}>{vehicle.trimLabel}</span>
        <span className="vehicle-method">
          <span className="vehicle-line-text">{vehicle.method}</span>
          {vehicle.extraMethods.length > 0 && (
            <button
              aria-expanded={openExtraFor === methodExtraId}
              aria-label={`${vehicle.method} 추가 구매방식 보기`}
              className={openExtraFor === methodExtraId ? "extra-count-pill active" : "extra-count-pill"}
              onClick={(event) => toggleExtraPopover(event, methodExtraId)}
              ref={openExtraFor === methodExtraId ? extraPopoverRef : undefined}
              type="button"
            >
              +{vehicle.extraMethods.length}
              <span className="extra-tooltip">
                <strong>{extraTooltipValue(vehicle.extraMethods)}</strong>
                <span>도 고민 · 비교 중..</span>
              </span>
            </button>
          )}
        </span>
      </td>
    );
    const previewTwoStepStage = true;
    const twoStepPickerOpen = openStagePicker?.customerNo === customer.no ? openStagePicker.level : null;
    const secondaryStageOptions = secondaryStageOptionsByGroup[customer.statusGroup] ?? customerStatusGroups[customer.statusGroup] ?? [customer.status];
    const showNewLeadBadge = customer.statusGroup === "신규" && customer.status === "상담접수";
    const stageControl = (
      <div className="stage-control" ref={openStageFor === customer.no ? stagePopoverRef : undefined}>
        <button
          aria-expanded={openStageFor === customer.no}
          aria-haspopup="listbox"
          aria-label={`진행 상태 변경: ${customer.status}`}
          className={statusButtonClass(customer.status, customer.statusGroup)}
          onClick={(event) => {
            event.stopPropagation();
            setOpenChanceFor(null);
            setOpenStagePicker(null);
            setOpenFinalUpdateFor(null);
            setOpenStageFor((current) => current === customer.no ? null : customer.no);
          }}
          onPointerDown={stopTableControlPointer}
          type="button"
        >
          <span>{customer.status}</span>
        </button>
        {openStageFor === customer.no && (
          <div aria-label="진행 상태 선택" className="stage-status-popover" role="listbox">
            {Object.entries(customerStatusGroups).map(([group, values]) => (
              <div className="stage-status-group" key={group}>
                <div className="stage-status-group-label">{group}</div>
                <div className="stage-status-options">
                  {values.map((value) => {
                    const selectedStatus = value === customer.status;
                    return (
                      <button
                        aria-selected={selectedStatus}
                        className={selectedStatus ? "stage-status-option active" : "stage-status-option"}
                        key={value}
                        onClick={(event) => {
                          event.stopPropagation();
                          changeCustomerStatus(customer.no, value);
                        }}
                        role="option"
                        type="button"
                      >
                        <span>{value}</span>
                        {selectedStatus && <Check aria-hidden="true" size={13} strokeWidth={2.6} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
    const stageCell = (
      <td className={previewTwoStepStage ? "stage-cell stage-cell-two-step-preview" : "stage-cell"}>
        {previewTwoStepStage ? (
          <div className="stage-two-step-stack" ref={twoStepPickerOpen ? stagePickerRef : undefined}>
            <div className="stage-control">
              <button
                aria-expanded={twoStepPickerOpen === "primary"}
                aria-haspopup="listbox"
                aria-label={`진행 1단계 변경: ${customer.statusGroup}`}
                className="stage-step-button"
                onClick={(event) => {
                  event.stopPropagation();
                  openTwoStepStagePicker(customer.no, "primary");
                }}
                onPointerDown={stopTableControlPointer}
                type="button"
              >
                <span>{customer.statusGroup}</span>
              </button>
              {twoStepPickerOpen === "primary" && (
                <div aria-label="진행 1단계 선택" className="stage-two-step-popover level-primary" role="listbox">
                  <div className="stage-two-step-options">
                    {primaryStageOptions.map((value) => {
                      const selected = value === customer.statusGroup;
                      return (
                        <button
                          aria-selected={selected}
                          className={selected ? "stage-two-step-option level-primary active" : "stage-two-step-option level-primary"}
                          key={value}
                          onClick={(event) => {
                            event.stopPropagation();
                            changeTwoStepPrimaryStage(customer.no, value);
                          }}
                          role="option"
                          type="button"
                        >
                          <span>{value}</span>
                          {selected && <Check aria-hidden="true" size={13} strokeWidth={2.6} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <span aria-hidden="true" className="stage-step-connector">›</span>
            <div className="stage-control">
              <button
                aria-expanded={twoStepPickerOpen === "secondary"}
                aria-haspopup="listbox"
                aria-label={`진행 2단계 변경: ${customer.status}`}
                className={statusButtonClass(customer.status, customer.statusGroup)}
                onClick={(event) => {
                  event.stopPropagation();
                  openTwoStepStagePicker(customer.no, "secondary");
                }}
                onPointerDown={stopTableControlPointer}
                type="button"
              >
                <span>{customer.status}</span>
                {showNewLeadBadge && <span className="stage-new-badge">NEW</span>}
              </button>
              {twoStepPickerOpen === "secondary" && (
                <div aria-label="진행 2단계 선택" className="stage-two-step-popover level-secondary" role="listbox">
                  <div className="stage-two-step-options">
                    {secondaryStageOptions.map((value) => {
                      const selected = value === customer.status;
                      return (
                        <button
                          aria-selected={selected}
                          className={[statusButtonClass(value, customer.statusGroup), "stage-two-step-option level-secondary", selected ? "active" : ""].filter(Boolean).join(" ")}
                          key={value}
                          onClick={(event) => {
                            event.stopPropagation();
                            changeTwoStepSecondaryStage(customer.no, value);
                          }}
                          role="option"
                          type="button"
                        >
                          <span>{value}</span>
                          {selected && <Check aria-hidden="true" size={13} strokeWidth={2.6} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {stageControl}
            <span className="stage-meta">{customer.statusGroup} · {customer.date}</span>
            <span className="stage-signal">{stageSignal(customer)}</span>
          </>
        )}
      </td>
    );
    const nextActionEditing = editingNextAction?.customerNo === customer.no;
    const nextActionCell = (
      <td className="text-block-cell">
        {nextActionEditing ? (
          <div className="next-action-editor" onClick={(event) => event.stopPropagation()} onPointerDown={stopTableControlPointer} ref={nextActionEditorRef}>
            <textarea
              aria-label={`${customer.name} 상담 메모 수정`}
              autoFocus
              onChange={(event) => changeNextActionDraft(customer.no, event.target.value)}
              onKeyDown={(event) => handleNextActionEditKeyDown(event, customer.no)}
              ref={nextActionTextareaRef}
              rows={3}
              value={editingNextAction.draft}
            />
            <span className="next-action-editor-actions">
              <button aria-label="상담 메모 저장" className="inline-edit-control save" onClick={() => saveNextAction(customer.no)} type="button">
                <Check size={12} strokeWidth={2.8} />
              </button>
              <button aria-label="상담 메모 수정 취소" className="inline-edit-control cancel" onClick={cancelNextActionEdit} type="button">
                <X size={12} strokeWidth={2.8} />
              </button>
              <button aria-label="상담 메모 비우기" className="inline-edit-control reset" onClick={() => clearNextActionDraft(customer.no)} type="button">
                <Eraser size={11} strokeWidth={2.6} />
              </button>
            </span>
          </div>
        ) : (
          <div className="next-action-display">
            <div className="next-action-cell">{customer.nextAction}</div>
            <button
              aria-label={`${customer.name} 상담 메모 수정`}
              className="next-action-edit-pill"
              onClick={(event) => {
                event.stopPropagation();
                startEditingNextAction(customer);
              }}
              onPointerDown={stopTableControlPointer}
              title="상담 메모 수정"
              type="button"
            >
              <Pencil size={10} strokeWidth={2.6} />
            </button>
          </div>
        )}
      </td>
    );
    const chance = customer.statusGroup === "계약완료" ? "확정" : chanceOverrides[customer.no] ?? chanceLabel(customer);
    const chanceCell = (
      <td className="chance-cell">
        <div className="chance-control" ref={openChanceFor === customer.no ? chancePopoverRef : undefined}>
          <button
            aria-expanded={openChanceFor === customer.no}
            aria-haspopup="listbox"
            aria-label={`가능성 변경: ${chance}`}
            className={chanceButtonClass(chance)}
            onClick={(event) => {
              event.stopPropagation();
              setOpenStageFor(null);
              setOpenStagePicker(null);
              setOpenFinalUpdateFor(null);
              setOpenChanceFor((current) => current === customer.no ? null : customer.no);
            }}
            onPointerDown={stopTableControlPointer}
            type="button"
          >
            <span>{chance}</span>
          </button>
          {chanceNoticeFor === customer.no && (
            <div className="chance-inline-notice" role="status">
              <span className="chance-inline-notice-mark" aria-hidden="true">!</span>
              <span><strong>계약완료 시</strong> 자동 확정됩니다</span>
            </div>
          )}
          {openChanceFor === customer.no && (
            <div aria-label="가능성 선택" className="chance-status-popover" role="listbox">
              {chanceOptions.map((value) => {
                const selectedChance = value === chance;
                return (
                  <button
                    aria-selected={selectedChance}
                    className={chanceOptionClass(value, selectedChance)}
                    key={value}
                    onClick={(event) => {
                      event.stopPropagation();
                      changeCustomerChance(customer.no, value);
                    }}
                    role="option"
                    type="button"
                  >
                    <span>{value}</span>
                    {selectedChance && <Check aria-hidden="true" size={13} strokeWidth={2.6} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </td>
    );
    const updateInfo = finalUpdateOverrides[customer.no] ?? initialFinalUpdateByCustomerId[customer.customerId] ?? null;
    const updateStatus = manageStatusOverrides[customer.no]
      ? finalUpdateStatusFromManage(manageStatusOverrides[customer.no])
      : updateInfo ? finalUpdateStatus(updateInfo) : null;
    const operationResponseValue = showAdvisorColumn ? firstResponseDisplay(customer.assignedAt, updateInfo) : "담당 배정 후 표시";
    const finalUpdateCell = (
      <td className="final-update-cell">
        {updateInfo && updateStatus ? (
          <div
            className={openFinalUpdateFor === customer.no ? "final-update-control pinned" : "final-update-control"}
            ref={openFinalUpdateFor === customer.no ? finalUpdatePopoverRef : undefined}
          >
            <button
              aria-expanded={openFinalUpdateFor === customer.no}
              aria-label={`최종 업데이트: ${updateStatus.label}`}
              className={`final-update-status ${updateStatus.className}`}
              onClick={(event) => toggleFinalUpdatePopover(event, customer.no)}
              onPointerDown={stopTableControlPointer}
              type="button"
            >
              <span>{updateStatus.label}</span>
            </button>
            <div
              aria-hidden={openFinalUpdateFor === customer.no ? undefined : true}
              className="final-update-popover"
              role={openFinalUpdateFor === customer.no ? "status" : undefined}
            >
              <span className="final-update-popover-date">{updateInfo.label}</span>
              <span className="final-update-popover-action">{updateInfo.action}</span>
            </div>
          </div>
        ) : (
          <span className="final-update-empty" aria-label="최종 업데이트 없음" />
        )}
      </td>
    );
    const operationCell = (
      <td className="operation-cell">
        <div className={showAdvisorColumn ? "operation-stack" : "operation-stack source-only"}>
          <div className="operation-lines">
            <div className="operation-line">
              <span className="operation-label">접수</span>
              <strong className="operation-main">
                <span className="operation-main-text">{customer.source}</span>
                <span className="operation-line-time">{receivedAtDisplay(customer.receivedAt)}</span>
              </strong>
            </div>
            {showAdvisorColumn ? (
              <div className="operation-line">
                <span className="operation-label">배정</span>
                <strong className="operation-main">
                  <span className="operation-main-text">{customer.advisor}</span>
                  <span className="operation-line-time">{assignedAtDisplay(customer.assignedAt)}</span>
                </strong>
              </div>
            ) : null}
            <div className="operation-line operation-response-line">
              <span className="operation-label">응답</span>
              <span className="operation-response-main">{operationResponseValue}</span>
            </div>
          </div>
          {showAdvisorColumn ? (
            <button
              aria-label={roleTab === "최고관리자" ? `${customer.name} 접수·담당 변경` : `${customer.name} 담당자 변경`}
              className="next-action-edit-pill operation-change-pill"
              onClick={(event) => {
                event.stopPropagation();
                changeCustomerAdvisor(customer.no);
              }}
              onPointerDown={stopTableControlPointer}
              title={roleTab === "최고관리자" ? "접수·담당 변경" : "담당자 변경"}
              type="button"
            >
              <RefreshCcw size={10} strokeWidth={2.6} />
            </button>
          ) : null}
        </div>
      </td>
    );

    if (mode === "all" || mode === "allDraft") {
      return (
        <tr key={customer.no} {...rowProps}>
          {check}
          {customerCell}
          {vehicleCell}
          {stageCell}
          {chanceCell}
          {nextActionCell}
          {operationCell}
          {finalUpdateCell}
          {actions}
        </tr>
      );
    }

    if (mode === "settlement") {
      return (
        <tr key={customer.no} {...rowProps}>
          {check}
          {customerCell}
          {vehicleCell}
          <td>{customer.date}</td>
          <td className="num">{customer.fee}</td>
          <td className="num">{customer.cost}</td>
          <td><strong className="num">{customer.margin}</strong></td>
          <td><span className="badge green">{customer.settlementStatus}</span></td>
          {actions}
        </tr>
      );
    }

    return (
      <tr key={customer.no} {...rowProps}>
        {check}
        {customerCell}
        {mode === "contract" && <td><strong>{customer.customerType}</strong><span className="table-note">{customer.customerTypeDetail}</span></td>}
        {vehicleCell}
        <td><span className={badgeClass(customer.status, customer.statusGroup)}>{customer.status}</span><span className="table-note">{customer.date}</span></td>
        <td><div className="ai-summary-cell">{customer.aiSummary}</div></td>
        <td><span className={badgeClass(customer.priority)}>{customer.priority}</span><span className="table-note">{customer.nextAction}</span></td>
        {showAdvisorColumn && <td><strong>{customer.advisor}</strong><span className="table-note">{customer.team}</span></td>}
        {actions}
      </tr>
    );
  }

  const isLineDraft = mode === "allDraft";
  const draftFilterOptions = {
    statusGroup: Object.keys(customerStatusGroups).map((group) => ({ value: group, label: group })),
    status: statuses.map((item) => ({ value: item, label: item })),
    advisor: ["김지안", "이주선", "이건수"].map((name) => ({ value: name, label: name })),
    chance: chanceOptions.map((option) => ({ value: option, label: option })),
    finalUpdate: finalUpdateFilterOptions.map((option) => ({ value: option, label: option })),
  };

  function renderDraftFilter(options: {
    id: DraftFilterKey;
    label: string;
    value: string;
    items: { value: string; label: string }[];
    onChange: (value: string) => void;
    extraClassName?: string;
  }) {
    const active = Boolean(options.value);
    const open = openDraftFilter === options.id;
    const selectedLabel = options.items.find((item) => item.value === options.value)?.label ?? options.label;
    const allItems = [{ value: "", label: options.label }, ...options.items];

    return (
      <div className="draft-filter">
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          className={filterSelectClass(active, ["draft-filter-button", options.extraClassName].filter(Boolean).join(" "))}
          onClick={() => setOpenDraftFilter((current) => current === options.id ? null : options.id)}
          type="button"
        >
          <span>{selectedLabel}</span>
          <ChevronsUpDown aria-hidden="true" className="draft-filter-chevron" size={14} strokeWidth={2.1} />
        </button>
        {open && (
          <div aria-label={`${options.label} 선택`} className="draft-filter-popover" role="listbox">
            {allItems.map((item) => {
              const selected = item.value === options.value;
              const isDefaultOption = item.value === "";
              return (
                <button
                  aria-selected={selected}
                  className={[
                    "draft-filter-option",
                    selected ? "active" : "",
                    isDefaultOption ? "default-option" : "",
                  ].filter(Boolean).join(" ")}
                  key={`${options.id}-${item.value || "default"}`}
                  onClick={() => {
                    options.onChange(item.value);
                    setCurrentPage(1);
                    setOpenDraftFilter(null);
                  }}
                  role="option"
                  type="button"
                >
                  <span>{item.label}</span>
                  {selected && <Check aria-hidden="true" className="draft-filter-check" size={14} strokeWidth={2.6} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className={isLineDraft ? "customer-console-page" : undefined}>
      <section className={isLineDraft ? "card customer-console-card" : "card"}>
        <div className={isLineDraft ? "customer-console-control-rail" : undefined} ref={isLineDraft ? draftFilterRailRef : undefined}>
          <div className={isLineDraft ? "toolbar customer-console-toolbar" : "toolbar"}>
            {isLineDraft && <div className="total-count">전체 <strong className="num">{rows.length}</strong><span>명</span></div>}
            {isLineDraft ? (
              <label className="customer-console-search">
                <Search aria-hidden="true" size={15} strokeWidth={2.4} />
                <input onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="고객명, 연락처, 차종 검색" value={search} />
              </label>
            ) : (
              <input className="input" onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="고객명, 연락처, 차종 검색" value={search} />
            )}
            {isLineDraft ? (
              <>
                {renderDraftFilter({
                  id: "advisor",
                  label: "담당자",
                  value: advisor,
                  items: draftFilterOptions.advisor,
                  onChange: setAdvisor,
                  extraClassName: "filter-advisor",
                })}
                {renderDraftFilter({
                  id: "statusGroup",
                  label: "진행 상태 · 1차",
                  value: statusGroup,
                  items: draftFilterOptions.statusGroup,
                  onChange: (value) => {
                    setStatusGroup(value);
                    setStatus("");
                  },
                  extraClassName: "filter-stage",
                })}
                {renderDraftFilter({
                  id: "status",
                  label: "진행 상태 · 2차",
                  value: status,
                  items: draftFilterOptions.status,
                  onChange: setStatus,
                  extraClassName: "filter-stage",
                })}
              </>
            ) : (
              <>
                <select className="select" onChange={(event) => { setStatusGroup(event.target.value); setStatus(""); setCurrentPage(1); }} value={statusGroup}>
                  <option value="">진행 상태 · 1차</option>
                  {Object.keys(customerStatusGroups).map((group) => <option key={group}>{group}</option>)}
                </select>
                <select className="select" onChange={(event) => { setStatus(event.target.value); setCurrentPage(1); }} value={status}>
                  <option value="">진행 상태 · 2차</option>
                  {statuses.map((item, index) => <option key={`${item}-${index}`}>{item}</option>)}
                </select>
                <select className="select" onChange={(event) => { setAdvisor(event.target.value); setCurrentPage(1); }} value={advisor}>
                  <option value="">담당자</option>
                  <option>김지안</option>
                  <option>이주선</option>
                  <option>이건수</option>
                </select>
              </>
            )}
            {isLineDraft && (
              <div className="list-view-controls">
                {renderDraftFilter({
                  id: "chance",
                  label: "계약 가능성",
                  value: chanceFilter,
                  items: draftFilterOptions.chance,
                  onChange: (value) => setChanceFilter(value as "" | ChanceOption),
                  extraClassName: "view-select filter-compact",
                })}
                {renderDraftFilter({
                  id: "finalUpdate",
                  label: "관리 상태",
                  value: finalUpdateFilter,
                  items: draftFilterOptions.finalUpdate,
                  onChange: (value) => setFinalUpdateFilter(value as "" | FinalUpdateFilterOption),
                  extraClassName: "view-select filter-compact",
                })}
              </div>
            )}
          </div>
          <div className={isLineDraft ? "list-headbar customer-console-headbar" : "list-headbar"}>
            <div className="list-head-left">
              {!isLineDraft && (
                <>
                  <div className="total-count">TOTAL <strong className="num">{rows.length}</strong></div>
                  <div className="vertical-separator" />
                  <div className="list-view-controls">
                    <select className="select view-select"><option>담당자별 보기</option></select>
                    <select className="select view-select"><option>상담상태별 보기</option></select>
                    <select className="select view-select"><option>긴급순으로 보기</option></select>
                  </div>
                </>
              )}
            </div>
            <div className="top-actions">
              <button aria-label="선택 고객 배정 변경" className="btn advisor-change-btn" disabled={selected.length === 0} type="button">
                <RefreshCcw aria-hidden="true" size={12} strokeWidth={2.25} />
                <span>담당자 변경</span>
              </button>
              <button className="btn bulk-delete-btn" disabled={selected.length === 0} onClick={deleteSelected} type="button">
                <Minus aria-hidden="true" size={14} strokeWidth={2.6} />
                <span>{selected.length ? `${selected.length}명 고객 삭제` : "고객 삭제"}</span>
              </button>
              <button className="btn primary-register-btn" type="button">
                <Plus aria-hidden="true" size={14} strokeWidth={2.4} />
                <span>고객 등록</span>
              </button>
            </div>
          </div>
        </div>
        <div className={isLineDraft ? "table-scroll customer-console-table-scroll" : "table-scroll"}>
          <table className={`customer-table mode-${mode}`}>
            <colgroup>
              {tableColumns.map((column, index) => <col className={`col-${column}`} key={`${column}-${index}`} />)}
            </colgroup>
            <thead>
              <tr>
                {tableHeads.map((head, index) => (
                  <th className={`head-${tableColumns[index]}`} key={head}>
                    {index === 0 ? (
                      <input checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} type="checkbox" />
                    ) : tableColumns[index] === "actions" ? (
                      <span className="head-actions-label">{head}</span>
                    ) : (
                      head
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{paginatedRows.map(renderRow)}</tbody>
          </table>
        </div>
        <div className={isLineDraft ? "pagination-bar customer-console-pagination" : "pagination-bar"}>
          <div className="pagination-summary">
            <span className="num">{rows.length === 0 ? 0 : pageStart + 1}-{pageEnd}</span>
            <span> / </span>
            <span className="num">{rows.length}</span>
            <span>명</span>
          </div>
          <div className="pagination-controls" aria-label="고객 목록 페이지 이동">
            <button
              className="page-btn"
              disabled={effectivePage === 1}
              onClick={() => setCurrentPage(1)}
              type="button"
            >
              처음
            </button>
            <button
              className="page-btn compact"
              disabled={effectivePage === 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              type="button"
            >
              이전
            </button>
            {visiblePages.map((page) => (
              <button
                aria-current={effectivePage === page ? "page" : undefined}
                className="page-btn num"
                key={page}
                onClick={() => setCurrentPage(page)}
                type="button"
              >
                {page}
              </button>
            ))}
            <button
              className="page-btn compact"
              disabled={effectivePage === totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              type="button"
            >
              다음
            </button>
            <button
              className="page-btn"
              disabled={effectivePage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
              type="button"
            >
              마지막
            </button>
          </div>
          {isLineDraft ? (
            <div className="page-size-control" ref={pageSizeControlRef}>
              <span>페이지당</span>
              <div className="draft-filter page-size-filter">
                <button
                  aria-expanded={openPageSize}
                  aria-haspopup="listbox"
                  className={filterSelectClass(pageSize !== 15, "draft-filter-button page-size-select page-size-button")}
                  onClick={() => setOpenPageSize((current) => !current)}
                  type="button"
                >
                  <span>{pageSize}</span>
                  <ChevronsUpDown aria-hidden="true" className="draft-filter-chevron" size={14} strokeWidth={2.1} />
                </button>
                {openPageSize && (
                  <div aria-label="페이지당 개수 선택" className="draft-filter-popover page-size-popover" role="listbox">
                    {pageSizeOptions.map((option) => {
                      const selected = option === pageSize;
                      return (
                        <button
                          aria-selected={selected}
                          className={[
                            "draft-filter-option",
                            selected ? "active" : "",
                            option === 15 ? "default-option" : "",
                          ].filter(Boolean).join(" ")}
                          key={option}
                          onClick={() => {
                            setPageSize(option);
                            setCurrentPage(1);
                            setOpenPageSize(false);
                          }}
                          role="option"
                          type="button"
                        >
                          <span>{option}</span>
                          {selected && <Check aria-hidden="true" className="draft-filter-check" size={14} strokeWidth={2.6} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <span>명</span>
            </div>
          ) : (
            <label className="page-size-control">
              <span>페이지당</span>
              <select
                className="select page-size-select"
                onChange={(event) => {
                  setPageSize(Number(event.target.value) as (typeof pageSizeOptions)[number]);
                  setCurrentPage(1);
                }}
                value={pageSize}
              >
                {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <span>개</span>
            </label>
          )}
        </div>
      </section>
    </section>
  );
}
