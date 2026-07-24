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

// 출고 관리(delivery mode) 차량 열의 표시 소스 — 3단 폴백이고 **어느 소스인지가 결과에 남는다**(kind).
// contract = 상담사가 입력한 계약 차량(정본) · quote = 계약 진행 마킹된 견적 · needs = 니즈(관심 차종).
//
// ⚠️ needs를 그냥 보여주면 안 되는 이유: 니즈는 **최초 승격 때 그 요청의 차량으로 한 번 박히고 끝**이다
// (createCustomerFromRequest 시드 — 이후 요청이 아무리 와도 갱신되지 않고, 앱 연결 고객은 CRM에 편집
// UI조차 없다). 계약·출고 실무 화면에서 이게 계약 차량인 양 뜨면 오독된다 — 실제로 계약은 BMW인데
// 목록엔 최초 관심 차종 "기아 레이"가 떠서 혼란이 보고됐다(2026-07-24 유슨생). 그래서 kind를 남겨
// 렌더가 "관심" 라벨로 구분하게 한다(값을 숨기지는 않는다 — 계약 견적이 없는 고객엔 유일한 단서다).
export type DeliveryVehicleDisplay = {
  kind: "contract" | "quote" | "needs";
  label: string | null; // needs이고 니즈도 비면 null → 렌더가 미입력 처리
};

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function deliveryVehicleDisplay(customer: Customer): DeliveryVehicleDisplay {
  const contract = trimmedOrNull(customer.delivery?.contractVehicle);
  if (contract) return { kind: "contract", label: contract };
  const q = customer.contractingQuote;
  // 브랜드·모델·트림 결합(각 null 가능 — 전부 비면 견적이 있어도 표시할 게 없어 니즈로 내려간다).
  const quoteLabel = q ? [q.brandName, q.modelName, q.trimName].map(trimmedOrNull).filter(Boolean).join(" ") : "";
  if (quoteLabel) return { kind: "quote", label: quoteLabel };
  return { kind: "needs", label: trimmedOrNull(customer.vehicle) };
}

// 계약·출고 목록의 구매방식 줄 — 차량과 같은 이유로 계약 진행 견적이 니즈보다 우선한다.
// 실측(2026-07-24): 제임스의 계약 견적은 **운용리스**인데 니즈(need_method)는 장기렌트라, 계약 화면에
// 차량만 고치면 "BMW 3 Series · 장기렌트"라는 실재하지 않는 조합이 남는다.
export function deliveryMethodDisplay(customer: Customer): string {
  return trimmedOrNull(customer.contractingQuote?.purchaseMethod) ?? customer.method;
}

export function customerMeta(customer: Customer) {
  return [customer.customerType, customer.customerTypeDetail].filter(Boolean).join(" · ");
}

export function extraTooltipValue(values: string[]) {
  return values.join(", ");
}

// AI 힌트(ai_summary)는 서버 생성 문장 — 핵심어만 **…**로 감싼 인라인 마크다운 서브셋이 온다
// (src/lib/ai-hint.ts sanitizeAiHint가 보증). 구 DB 값(마커 없음)은 단일 평문 파트로 하위호환.
export function parseAiHintParts(text: string): { text: string; strong?: boolean }[] {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return [];
  const parts: { text: string; strong?: boolean }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(trimmed); m !== null; m = re.exec(trimmed)) {
    if (m.index > last) parts.push({ text: trimmed.slice(last, m.index) });
    parts.push({ text: m[1], strong: true });
    last = m.index + m[0].length;
  }
  if (last < trimmed.length) parts.push({ text: trimmed.slice(last) });
  return parts;
}

// 빈 배열 = 값 없음 — 소비처(CustomerActionsCell)가 버튼째 숨긴다(빈 보라 말풍선 방지).
export function aiHintDisplay(customer: Customer) {
  return { parts: parseAiHintParts(customer.aiSummary) };
}

// 마커 제거 평문 — 목록 검색 문자열·레거시 all 모드 셀용(마커가 검색어 경계를 깨는 것 방지).
export function aiHintPlainText(customer: Customer) {
  return parseAiHintParts(customer.aiSummary).map((part) => part.text).join("");
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

function chanceLabel(customer: Customer): ChanceOption {
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
