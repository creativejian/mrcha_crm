// 고객 관리 테이블 행 렌더링용 순수 헬퍼/상수/타입.
// CustomerManagementPage(필터·핸들러)와 CustomerManagementRow(셀 컴포넌트)가 공유한다.
// JSX를 다루지 않는 순수 자산만 이 파일에 둔다(AiHintIcon은 CustomerManagementRow에 있음).
import { type Customer, type CustomerChanceOption, type CustomerManageStatus, customerStatusGroups } from "@/data/customers";

export type ChanceOption = CustomerChanceOption;
export type ManageStatusOption = CustomerManageStatus;
export type StagePickerLevel = "primary" | "secondary";

export type FinalUpdateInfo = {
  action: string;
  label: string;
  // 원본 시각 ISO — label 재파싱의 연도 하드코딩 우회. 파생 데이터만 채움, mock 맵은 없음.
  atIso?: string;
  days: number;
  customerRecontacted?: boolean;
};

export type FinalUpdateStatus = {
  className: string;
  label: string;
};

export const primaryStageOptions = Object.keys(customerStatusGroups);
export const secondaryStageOptionsByGroup = customerStatusGroups;

export const statusGroupByStatus = Object.fromEntries(
  Object.entries(customerStatusGroups).flatMap(([group, values]) => values.map((value) => [value, group])),
);

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

export function badgeClass(value: string, group?: string) {
  if (value === "완료" || group === "계약완료" || value === "출고완료" || value === "배정완료") return "badge green";
  if (value === "긴급" || group === "불발" || value === "계약취소" || value === "지속적부재" || value === "재고없음") return "badge red";
  if (value === "높음" || value === "보류" || group === "견적" || group === "차량체크" || group === "관리중") return "badge yellow";
  return "badge";
}

export function statusButtonClass(value: string, group?: string) {
  return badgeClass(value, group).replace("badge", "stage-status-button");
}

export function vehicleDisplay(customer: Customer) {
  const display = vehicleDisplayByVehicle[customer.vehicle] ?? { title: customer.vehicle, trim: "트림 미확인" };
  const extraVehicles = extraVehicleDisplayByCustomerId[customer.customerId] ?? [];
  const extraMethods = extraPurchaseMethodDisplayByCustomerId[customer.customerId] ?? [];
  // DB의 need_trim(vehicleTrim)이 있으면 우선(앱 유입 고객은 mock 룩업 테이블에 없어 "트림 미확인"이 떴음).
  // 없을 때만 mock 축약(trimShort)/원문(trim)으로 폴백.
  return {
    ...display,
    extraVehicles,
    extraMethods,
    trimLabel: customer.vehicleTrim || display.trimShort || display.trim,
    method: customer.method,
  };
}

export function customerMeta(customer: Customer) {
  return [customer.customerType, customer.customerTypeDetail].filter(Boolean).join(" · ");
}

export function extraTooltipValue(values: string[]) {
  return values.join(", ");
}

export function aiHintDisplay(customer: Customer) {
  return aiHintDisplayByCustomerId[customer.customerId] ?? { parts: [{ text: customer.aiSummary }] };
}

function compactOperationDate(year: string, month: string, day: string, time: string) {
  return `${year.slice(-2)}/${month}/${day} ${time}`;
}

export function receivedAtDisplay(value: string) {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/);
  if (!matched) return value;
  const [, year, month, day, time] = matched;
  if (month === "05" && day === "14") return `오늘 ${time}`;
  if (month === "05" && day === "13") return `어제 ${time}`;
  return compactOperationDate(year, month, day, time);
}

export function assignedAtDisplay(value: string) {
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

export function firstResponseDisplay(assignedAt: string, updateInfo: FinalUpdateInfo | null) {
  if (!updateInfo) return "대기 중";

  const assignedTime = operationDateValue(assignedAt);
  const firstActionTime = updateInfo.atIso ? new Date(updateInfo.atIso).getTime() : operationDateValue(updateInfo.label);
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

export function chanceLabel(customer: Customer): ChanceOption {
  if (customer.statusGroup === "계약완료" || customer.status === "출고완료") return "확정";
  if (customer.statusGroup === "불발" || customer.status === "계약취소") return "낮음";
  if (customer.priority === "긴급" || customer.priority === "높음") return "높음";
  if (customer.priority === "보류") return "보류";
  if (customer.priority === "낮음") return "낮음";
  return "중간";
}

// 목록·상세가 공유하는 계약 가능성 단일 판정(Option A).
// 계약완료/출고완료면 override를 무시하고 무조건 "확정"으로 통일,
// 그 외엔 사용자 override가 있으면 그것, 없으면 chanceLabel(진행상태·priority 기반).
// 목록은 chanceOverrides[customer.no], 상세는 chanceOverride를 resolved override로 넘긴다.
export function resolveChance(customer: Customer, override?: ChanceOption): ChanceOption {
  if (customer.statusGroup === "계약완료" || customer.status === "출고완료") return "확정";
  return override ?? chanceLabel(customer);
}

export function chanceButtonClass(value: ChanceOption) {
  const toneByChance: Record<ChanceOption, string> = {
    높음: "purple",
    중간: "",
    낮음: "red",
    보류: "yellow",
    확정: "green",
  };

  return ["chance-status-button", toneByChance[value]].filter(Boolean).join(" ");
}

export function chanceOptionClass(value: ChanceOption, active: boolean) {
  const toneByChance: Record<ChanceOption, string> = {
    높음: "purple",
    중간: "neutral",
    낮음: "red",
    보류: "yellow",
    확정: "green",
  };

  return ["chance-status-option", toneByChance[value], active ? "active" : ""].filter(Boolean).join(" ");
}

export function stageSignal(customer: Customer) {
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

export function finalUpdateStatus(info: FinalUpdateInfo): FinalUpdateStatus {
  if (info.customerRecontacted) return { className: "recontact", label: "재문의" };
  if (info.days >= 30) return { className: "stale", label: "장기방치" };
  if (info.days >= 15) return { className: "delay", label: "지연" };
  if (info.days >= 7) return { className: "check", label: "확인필요" };
  return { className: "normal", label: "정상" };
}

export function finalUpdateStatusFromManage(value: ManageStatusOption): FinalUpdateStatus {
  const classByStatus: Record<ManageStatusOption, string> = {
    정상: "normal",
    확인필요: "check",
    재문의: "recontact",
    지연: "delay",
    장기방치: "stale",
  };

  return { className: classByStatus[value], label: value };
}
