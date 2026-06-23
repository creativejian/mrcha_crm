import { ArrowLeft, Bot, BriefcaseBusiness, Calculator, CalendarClock, CarFront, Check, ChevronDown, ChevronRight, Download, Eye, File, FilePlus2, FileText, FileUp, FolderOpen, GripVertical, History, Image, ListChecks, MapPin, Maximize2, MessageSquareText, MoreHorizontal, Paperclip, PencilLine, Phone, RefreshCcw, RotateCcw, Route, Send, Smartphone, Sparkles, Star, Trash2, UserRound, X } from "lucide-react";
import { type ChangeEvent, type SyntheticEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { CHANCE_OPTIONS, customerStatusGroups, type Customer, type CustomerChanceOption, type CustomerManageStatus } from "@/data/customers";
import { fetchCustomerDetail, formatActivity, formatPhone, updateCustomer, type CustomerDetailData, type CustomerWritePatch } from "@/lib/customers";
import { toKimQuoteItem, flattenPrimaryScenario, formatMonthly, formatScenarioMoneyMode, type KimQuoteItem } from "@/lib/kim-quote";
import { addMemo, updateMemo, deleteMemo, addTask, updateTask, deleteTask, addSchedule, updateSchedule as apiUpdateSchedule, deleteSchedule as apiDeleteSchedule } from "@/lib/customer-children";
import { updateQuote as apiUpdateQuote, deleteQuote as apiDeleteQuote, createQuote as apiCreateQuote, parseTermMonths, parseMonthlyPayment, uploadQuoteOriginal, deleteQuoteOriginal, getQuoteOriginalUrl, type QuoteWritePatch, type QuoteCreatePayload } from "@/lib/customer-quotes";
import { ColorPicker } from "@/components/ColorPicker";
import { OptionPicker } from "@/components/OptionPicker";
import { VehiclePicker, type VehicleSelection } from "@/components/VehiclePicker";
import { computePricing, formatMoney, parseMoney, type PricingInputs, type PricingResult } from "@/lib/quote-pricing";
import { fetchTrimDetail, type TrimColor, type TrimDetail } from "@/lib/vehicles";
import { deleteDocumentApi, getDocumentUrlApi, reorderDocumentsApi, updateDocumentTypeApi, uploadDocument } from "@/lib/customer-documents";
import type { MergeSource } from "@/lib/document-merge";
import { nowMs, phoneChunks, formatKimRecentUpdateTime, formatKimNumberWithCommas, kimPurchaseValueClass, isKimPurchaseTagField, kimPurchaseTags, kimConsultKindClass, formatLocalPhone, localPhoneFrom, formatKoreanShortTime, formatShortDateLabel, formatScheduleDateLabel, formatDateInputValue, formatKimFileSize, classifyKimDocumentFile, kimDocumentFileKind, kimQuoteValidClass, formatKimAssignmentTime, parseKimCheckDueDate } from "@/lib/kim-detail-utils";
import { type KimScheduleItem, type KimCheckItem, type KimCustomerMemoItem, scheduleRecordKey, sortKimCustomerMemosByCreatedAt, sortKimCheckItemsByWorkRule, sortKimSchedulesByDateTime } from "@/lib/kim-schedule";
import { type KimCustomerType, type KimAdvisorTeam, kimCustomerTypeOptions, kimAutomaticSourceOptions, kimManualSourceOptions, kimAdvisorOptions, kimRegionOptions, parseKimJobValue, formatKimJobValue, parseKimLocationValue, formatKimLocationValue, parseKimSourceValue, parseKimAdvisorValue, formatKimAdvisorValue, isKimAutomaticSource, hasKimAppSourceQueue, hasKimQuoteAttachments } from "@/lib/kim-status-fields";
import { type KimPurchaseFloatingKind, type KimPurchasePopoverFrame, type KimQuoteActionFrame, type KimQuoteStatusTooltip, isKimPurchaseFloatingKind, calculateKimPurchasePopoverFrame, calculateKimQuoteActionFrame, calculateKimQuoteStatusTooltip } from "@/lib/kim-popover-frames";

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
type KimInitialCostKind = "무보증" | "보증금" | "선수금";
type KimInitialCostSelection = KimInitialCostKind | "";
type KimInitialCostUnit = "%" | "금액";
type KimDiscountUnit = "amount" | "percent";
type KimDiscountLine = { id: string; label: string; amount: string; unit: KimDiscountUnit };
type KimManualDepositMode = "none" | "amount" | "percent";
type KimManualResidualMode = "max" | "amount" | "percent";
type KimManualMileageMode = "basic" | "custom";
const kimDiscountLabelOptions = ["재구매 할인", "법인 추가 할인", "기타"] as const;
const kimManualMileageOptions = [
  "10,000km / 년",
  "15,000km / 년",
  "20,000km / 년",
  "25,000km / 년",
  "30,000km / 년",
  "35,000km / 년",
  "40,000km / 년",
] as const;
type KimAcquisitionTaxMode = "normal" | "hybrid" | "electric" | "manual";
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


type KimQuoteComposerMode = "solution" | "manual" | "edit";
type KimQuoteEntryMode = "solution" | "manual" | "original";
type KimQuotePurchaseMethod = "장기렌트" | "운용리스" | "금융리스" | "중고리스" | "할부" | "일시불";
type KimRecognizedQuoteFile = { file: File; fileName: string; fileSize: number; mimeType: string };

type KimDocumentItem = {
  id: string;
  title: string;
  status: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  objectUrl?: string;
  file?: File;
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

const kimMaybachQuotePricingMock: PricingInputs = {
  basePrice: 243000000,
  optionPrice: 0,
  discount: 6500000,
  acquisitionTax: 13531000,
  bond: 0,
  delivery: 0,
  incidental: 0,
};
const kimMaybachQuotePricingResult = computePricing(kimMaybachQuotePricingMock);

const kimManualQuoteConditionCards = [
  {
    id: "manual-condition-1",
    title: "견적 작성",
    round: "1",
    copyLabel: "",
    lender: "우리금융캐피탈",
    monthlyPayment: "2,398,000",
    totalReturn: "167,652,170",
    totalTakeover: "239,505,410",
    dueAtDelivery: "72,900,000",
    interestRate: "5.32",
    depositMode: "percent" as KimManualDepositMode,
    depositValue: "30",
    downPaymentMode: "none" as KimManualDepositMode,
    downPaymentValue: "0",
    residualMode: "max" as KimManualResidualMode,
    residualValue: "-",
  },
  {
    id: "manual-condition-2",
    title: "견적 작성",
    round: "2",
    copyLabel: "1번 복사",
    lender: "미선택",
    monthlyPayment: "0",
    totalReturn: "0",
    totalTakeover: "0",
    dueAtDelivery: "0",
    interestRate: "0",
    depositMode: "none" as KimManualDepositMode,
    depositValue: "0",
    downPaymentMode: "none" as KimManualDepositMode,
    downPaymentValue: "0",
    residualMode: "max" as KimManualResidualMode,
    residualValue: "-",
  },
  {
    id: "manual-condition-3",
    title: "견적 작성",
    round: "3",
    copyLabel: "2번 복사",
    lender: "미선택",
    monthlyPayment: "0",
    totalReturn: "0",
    totalTakeover: "0",
    dueAtDelivery: "0",
    interestRate: "0",
    depositMode: "none" as KimManualDepositMode,
    depositValue: "0",
    downPaymentMode: "none" as KimManualDepositMode,
    downPaymentValue: "0",
    residualMode: "max" as KimManualResidualMode,
    residualValue: "-",
  },
] as const;

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

const kimMinjunStatusFieldMeta = [
  { key: "phone", label: "연락처", icon: Phone },
  { key: "job", label: "직군", icon: BriefcaseBusiness },
  { key: "location", label: "거주지", icon: MapPin },
  { key: "source", label: "상담경로", icon: Route },
  { key: "advisor", label: "담당자", icon: UserRound },
  { key: "assignedAt", label: "배정시간", icon: CalendarClock },
] satisfies { key: KimStatusFieldKey; label: string; icon: typeof Phone }[];

const kimMinjunWorkflowMeta = [
  { key: "stage", label: "진행 상태", tone: "stage" },
  { key: "chance", label: "계약 가능성", tone: "chance" },
  { key: "manage", label: "관리 상태", tone: "normal" },
] satisfies { key: KimWorkflowKey; label: string; tone: string }[];

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
const kimPersonalJobDetailOptions = ["4대보험", "프리랜서", "무직", "주부", "기타"];


const kimCheckCategoryOptions = ["체크", "견적", "안내", "요청", "내부", "심사"];
const kimCheckDueOptions = ["오늘", "내일", "이번 주", "급함", "지정"];
const kimScheduleTypeOptions = ["재연락", "결정확인", "체크", "견적", "안내", "요청", "내부", "심사"];
const kimQuotePurchaseMethodOptions: KimQuotePurchaseMethod[] = ["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"];
const kimDocumentTypeOptions = [
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
const kimScheduleHourOptions = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const kimScheduleMinuteOptions = ["00", "10", "20", "30", "40", "50"];

function KimMinjunDetailHeader({ now, recentUpdate, name, customerCode, receivedLabel }: { now: number; recentUpdate: KimRecentUpdate; name: string; customerCode: string; receivedLabel: string }) {
  return (
    <section className="customer-detail-summary kim-detail-summary">
      <div className="kim-header-main">
        <div className="kim-header-read">
          <div className="kim-header-primary">
            <h2 className="kim-header-breadcrumb">
              <span>고객 관리</span>
              <ChevronRight size={18} strokeWidth={2.2} />
              <span>{name}</span>
              <em className="kim-header-code-text num">{customerCode}</em>
              <em className="kim-header-received-text num">{receivedLabel ? `· ${receivedLabel} 접수` : ""}</em>
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

function kimQuoteAppStatusLabel(status: KimQuoteItem["appStatus"], quote?: KimQuoteItem) {
  if ((quote?.revision ?? 1) > 1 && status === "viewed") return "수정 열람";
  if ((quote?.revision ?? 1) > 1 && status === "sent") return "수정 발송";
  if (status === "viewed") return "고객 열람";
  if (status === "sent") return "발송 완료";
  return "발송 전";
}

function kimQuoteAppSendLabel(status: KimQuoteItem["appStatus"], quote?: KimQuoteItem) {
  if ((quote?.revision ?? 1) > 1 && status === "viewed") return "수정 열람";
  if ((quote?.revision ?? 1) > 1 && status === "sent") return "수정 발송";
  if (status === "viewed") return "고객 열람";
  if (status === "sent") return "발송 완료";
  return "발송 전";
}

function kimQuoteStatusDetailParts(quote: KimQuoteItem) {
  if ((quote.revision ?? 1) > 1 && (quote.appStatus === "sent" || quote.appStatus === "viewed")) {
    return {
      time: `${kimQuoteRevisionLabel(quote) ?? "수정본"} · ${quote.revisedAt ?? quote.sentAt ?? "수정 시각 확인 전"}`,
      body: quote.appStatus === "viewed" ? "수정 견적 열람 완료" : "재발송",
    };
  }
  if (quote.appStatus === "viewed") {
    return {
      time: quote.viewedAt ?? "열람 시각 확인 전",
      body: "고객이 견적 열람 완료",
    };
  }
  if (quote.appStatus === "sent") {
    return {
      time: quote.sentAt ?? "발송 시각 확인 전",
      body: "앱 견적함으로 발송 완료",
    };
  }
  return null;
}

function kimQuoteDeleteConfirmTitle(quote: KimQuoteItem) {
  if (quote.appStatus === "sent" || quote.appStatus === "viewed") {
    return "발송된 견적 삭제";
  }
  return "발송 전 견적 삭제";
}

function kimQuoteDeleteConfirmMessage(quote: KimQuoteItem) {
  if (quote.appStatus === "sent" || quote.appStatus === "viewed") {
    return "고객 앱 견적함에 있는 견적도 함께 삭제됩니다.";
  }
  return "아직 고객 앱에 보내지 않은 견적입니다. 이 견적을 삭제합니다.";
}

function kimQuoteSourceIcon(source: KimQuoteItem["source"]) {
  if (source === "solution") return <Calculator size={12} strokeWidth={2.35} />;
  if (source === "original") return <FileText size={12} strokeWidth={2.35} />;
  return <PencilLine size={12} strokeWidth={2.35} />;
}

function kimQuoteDecisionLabel(status: KimQuoteItem["decisionStatus"]) {
  if (status === "contracting") return "계약 진행";
  if (status === "confirmed") return "고객 확정";
  if (status === "considering") return "최종 고민중";
  return "확정 전";
}

function kimQuoteRevisionLabel(quote: KimQuoteItem) {
  if (!quote.revision || quote.revision <= 1) return null;
  return `수정 v${quote.revision}`;
}

function kimQuoteStockClass(status?: KimQuoteItem["stockStatus"]) {
  if (status === "재고있음") return " in-stock";
  if (status === "재고없음") return " no-stock";
  return " checking";
}

function normalizeKimQuotePurchaseMethod(value?: string): KimQuotePurchaseMethod {
  if (value && kimQuotePurchaseMethodOptions.includes(value as KimQuotePurchaseMethod)) return value as KimQuotePurchaseMethod;
  return "운용리스";
}

function primaryKimQuotePurchaseMethod(fields: { label: string; value: string }[]) {
  return normalizeKimQuotePurchaseMethod(fields.find((field) => field.label === "구매방식")?.value);
}

function kimQuoteManualFieldConfig(method: KimQuotePurchaseMethod) {
  if (method === "장기렌트") {
    return {
      periodLabel: "계약 기간",
      periodDefault: "48개월",
      paymentLabel: "월 렌트료",
      paymentDefault: "월 1,642,190원",
      rateLabel: "보험 포함",
      ratePlaceholder: "포함 · 미포함",
      residualLabel: "약정거리",
      residualPlaceholder: "연 20,000km",
      prepaymentLabel: "선납금",
      depositLabel: "보증금",
      totalLabel: "총 렌트료",
    };
  }
  if (method === "할부") {
    return {
      periodLabel: "할부 기간",
      periodDefault: "60개월",
      paymentLabel: "월 할부금",
      paymentDefault: "월 1,128,000원",
      rateLabel: "금리",
      ratePlaceholder: "5.22%",
      residualLabel: "대출원금",
      residualPlaceholder: "60,000,000원",
      prepaymentLabel: "선수금",
      depositLabel: "총 이자",
      totalLabel: "총 비용",
    };
  }
  if (method === "일시불") {
    return {
      periodLabel: "결제 방식",
      periodDefault: "일시불",
      paymentLabel: "최종 결제금액",
      paymentDefault: "154,480,000원",
      rateLabel: "할인",
      ratePlaceholder: "-11,000,000원",
      residualLabel: "취득세/등록비",
      residualPlaceholder: "포함",
      prepaymentLabel: "차량가",
      depositLabel: "옵션가",
      totalLabel: "최종 비용",
    };
  }
  return {
    periodLabel: "계약 기간",
    periodDefault: method === "중고리스" ? "48개월" : "60개월",
    paymentLabel: "월 납입금",
    paymentDefault: "월 2,473,200원",
    rateLabel: "금리",
    ratePlaceholder: "5.32%",
    residualLabel: "잔존가치",
    residualPlaceholder: "71,853,240원",
    prepaymentLabel: "선수금",
    depositLabel: "보증금",
    totalLabel: "총 비용",
  };
}

function createKimQuoteCode(existingQuotes: KimQuoteItem[]) {
  const yearMonth = "2606";
  const nextSequence = existingQuotes.reduce((max, quote) => {
    const match = quote.quoteCode.match(/^QT-\d{4}-(\d{4})$/);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0) + 1;
  return `QT-${yearMonth}-${String(nextSequence).padStart(4, "0")}`;
}

function kimDocumentFileIcon(kind: string) {
  if (kind === "이미지") return <Image size={13} strokeWidth={2.25} />;
  if (kind === "PDF") return <FileText size={13} strokeWidth={2.25} />;
  return <File size={13} strokeWidth={2.25} />;
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

const kimMockQuoteAttachments = [
  { label: "첨부 견적서 1", fileName: "첨부파일1" },
  { label: "첨부 견적서 2", fileName: "첨부파일2" },
];

function KimPhoneStatusInput({ initialValue }: { initialValue: string }) {
  // 010은 고정 prefix. 입력값은 뒤 8자리(4-4)만 다룬다. 폼 제출 시 name="value"=8자리, 저장 핸들러가 010 prepend.
  const [value, setValue] = useState(() => localPhoneFrom(initialValue));

  return (
    <div className="kim-phone-input">
      <span className="kim-phone-prefix" aria-hidden="true">010</span>
      <input
        aria-label="연락처 수정"
        autoComplete="tel"
        autoFocus
        inputMode="numeric"
        maxLength={9}
        name="value"
        onChange={(event) => setValue(formatLocalPhone(event.currentTarget.value))}
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        placeholder="0000-0000"
        type="tel"
        value={value}
      />
    </div>
  );
}

function KimJobStatusEditor({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
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
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
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
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
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
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
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
  detail,
  manageStatusOverride,
  onEditorOpenChange,
  onToast,
  onWorkflowChange,
}: {
  chanceOverride?: CustomerChanceOption;
  customer: Customer;
  detail: CustomerDetailData;
  manageStatusOverride?: CustomerManageStatus;
  onEditorOpenChange?: CustomerDetailPageProps["onEditorOpenChange"];
  onToast: (message: string) => void;
  onWorkflowChange?: CustomerDetailPageProps["onWorkflowChange"];
}) {
  const [statusValues, setStatusValues] = useState<Record<KimStatusFieldKey, string>>(() => ({
    phone: detail.phone ? formatPhone(detail.phone) : "미입력",
    job: formatKimJobValue((detail.customerType as KimCustomerType) ?? "개인", detail.customerTypeDetail ?? ""),
    location: detail.residence ?? "확인 필요",
    source: detail.source ?? "미입력",
    advisor: "미배정",
    assignedAt: detail.assignedAt ? formatActivity(detail.assignedAt) : "미배정",
  }));
  const [stageGroup, setStageGroup] = useState(customer.statusGroup);
  const [stageStatus, setStageStatus] = useState(customer.status);
  const [chance, setChance] = useState<CustomerChanceOption>(chanceOverride ?? chanceLabel(customer) as CustomerChanceOption);
  const [manage, setManage] = useState<CustomerManageStatus>(manageStatusOverride ?? "정상");
  const [needs, setNeeds] = useState<KimNeedsState>(() => ({
    model: detail.needModel ?? "",
    trim: detail.needTrim ?? "",
    colors: detail.needColors ?? "외장 컬러 미정 · 내장 컬러 미정",
    method: detail.needMethod ?? "",
    memo: detail.needMemo ?? "",
  }));
  const [purchaseFields, setPurchaseFields] = useState(() =>
    kimMinjunPurchaseFields.map((field) =>
      field.label === "구매방식"
        ? { ...field, value: detail.needMethod ?? field.value }
        : field.label === "출고 희망 시기"
          ? { ...field, value: detail.needTiming ?? field.value }
          : field,
    ),
  );
  const [showTimingMonths, setShowTimingMonths] = useState(false);
  const [initialCostKind, setInitialCostKind] = useState<KimInitialCostSelection>("보증금");
  const [initialCostUnit, setInitialCostUnit] = useState<KimInitialCostUnit>("%");
  const [initialCostAmount, setInitialCostAmount] = useState("30");
  const [purchasePopoverFrame, setPurchasePopoverFrame] = useState<KimPurchasePopoverFrame | null>(null);
  const [schedules, setSchedules] = useState<KimScheduleItem[]>(() =>
    detail.schedules.map((s) => ({
      id: s.id,
      date: s.scheduledDate ?? "",
      time: s.scheduledTime ?? "",
      type: s.type ?? "",
      memo: s.memo ?? "",
    })),
  );
  const [completedScheduleKeys, setCompletedScheduleKeys] = useState<string[]>(() =>
    detail.schedules.filter((s) => s.done).map((s) => s.id),
  );
  const [addingScheduleItem, setAddingScheduleItem] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [confirmingScheduleCompleteId, setConfirmingScheduleCompleteId] = useState<string | null>(null);
  const [confirmingScheduleDeleteId, setConfirmingScheduleDeleteId] = useState<string | null>(null);
  const [checkItems, setCheckItems] = useState<KimCheckItem[]>(() =>
    detail.tasks.map((t) => ({
      id: t.id,
      category: t.category ?? "",
      due: t.due ?? "",
      body: t.body ?? "",
    })),
  );
  const [completedCheckItems, setCompletedCheckItems] = useState<string[]>(() =>
    detail.tasks.filter((t) => t.done).map((t) => t.id),
  );
  const [addingCheckItem, setAddingCheckItem] = useState(false);
  const [selectedCheckDue, setSelectedCheckDue] = useState("오늘");
  const [selectedEditingCheckDue, setSelectedEditingCheckDue] = useState("오늘");
  const [editingCheckItemId, setEditingCheckItemId] = useState<string | null>(null);
  const [confirmingCheckItemTitle, setConfirmingCheckItemTitle] = useState<string | null>(null);
  const [confirmingCheckItemDeleteId, setConfirmingCheckItemDeleteId] = useState<string | null>(null);
  const [customerMemos, setCustomerMemos] = useState<KimCustomerMemoItem[]>(() =>
    detail.memos.map((m) => ({
      id: m.id,
      body: m.body ?? "",
      createdAt: formatActivity(m.createdAt),
    })),
  );
  const [addingCustomerMemo, setAddingCustomerMemo] = useState(false);
  const [editingCustomerMemoId, setEditingCustomerMemoId] = useState<string | null>(null);
  const [confirmingCustomerMemoDeleteId, setConfirmingCustomerMemoDeleteId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<KimQuoteItem[]>(() => detail.quotes.map((q) => toKimQuoteItem(q, Date.now())));
  const [quoteComposerMode, setQuoteComposerMode] = useState<KimQuoteComposerMode | null>(null);
  const [isQuoteSolutionWorkbenchOpen, setIsQuoteSolutionWorkbenchOpen] = useState(false);
  const [solutionWorkbenchPurchaseMethod, setSolutionWorkbenchPurchaseMethod] = useState<KimQuotePurchaseMethod>(() => primaryKimQuotePurchaseMethod(kimMinjunPurchaseFields));
  const [solutionWorkbenchEntryMode, setSolutionWorkbenchEntryMode] = useState<KimQuoteEntryMode>("manual");
  const [solutionWorkbenchModeMenu, setSolutionWorkbenchModeMenu] = useState<"purchase" | "entry" | null>(null);
  const [isQuoteAppCardPreviewOpen, setIsQuoteAppCardPreviewOpen] = useState(false);
  const [isQuoteDraftSaved, setIsQuoteDraftSaved] = useState(false);
  const [isQuoteDraftDirty, setIsQuoteDraftDirty] = useState(false);
  const [savedManualQuoteConditionIds, setSavedManualQuoteConditionIds] = useState<string[]>([]);
  const [manualDepositModes, setManualDepositModes] = useState<Record<string, KimManualDepositMode>>({});
  const [manualDownPaymentModes, setManualDownPaymentModes] = useState<Record<string, KimManualDepositMode>>({});
  const [manualResidualModes, setManualResidualModes] = useState<Record<string, KimManualResidualMode>>({});
  const [manualMileageModes, setManualMileageModes] = useState<Record<string, KimManualMileageMode>>({});
  const [manualMileageValues, setManualMileageValues] = useState<Record<string, string>>({});
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [selectedQuotePurchaseMethod, setSelectedQuotePurchaseMethod] = useState<KimQuotePurchaseMethod>("운용리스");
  const [quoteEntryMode, setQuoteEntryMode] = useState<KimQuoteEntryMode>("solution");
  const [recognizedQuoteFile, setRecognizedQuoteFile] = useState<KimRecognizedQuoteFile | null>(null);
  const [isQuoteHeaderDragActive, setIsQuoteHeaderDragActive] = useState(false);
  const [isQuoteModalDragActive, setIsQuoteModalDragActive] = useState(false);
  const [isQuoteWorkbenchOriginalDragActive, setIsQuoteWorkbenchOriginalDragActive] = useState(false);
  const [confirmingQuoteDeleteId, setConfirmingQuoteDeleteId] = useState<string | null>(null);
  const [confirmingQuoteSendId, setConfirmingQuoteSendId] = useState<string | null>(null);
  const [confirmingQuoteContractId, setConfirmingQuoteContractId] = useState<string | null>(null);
  const [confirmingQuoteContractEditId, setConfirmingQuoteContractEditId] = useState<string | null>(null);
  const [confirmingQuoteContractDowngrade, setConfirmingQuoteContractDowngrade] = useState<{ id: string; status: "confirmed" | "considering" } | null>(null);
  const [openQuoteActionId, setOpenQuoteActionId] = useState<string | null>(null);
  const [quoteActionFrame, setQuoteActionFrame] = useState<KimQuoteActionFrame | null>(null);
  const [hoveredQuoteStatus, setHoveredQuoteStatus] = useState<KimQuoteStatusTooltip | null>(null);
  const [pinnedQuoteStatus, setPinnedQuoteStatus] = useState<KimQuoteStatusTooltip | null>(null);
  const [quoteDropTargetId, setQuoteDropTargetId] = useState<string | null>(null);
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null);
  const [previewSentQuoteId, setPreviewSentQuoteId] = useState<string | null>(null);
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [previewQuoteUrl, setPreviewQuoteUrl] = useState<string | null>(null);
  const [pricing, setPricing] = useState<PricingResult>(kimMaybachQuotePricingResult);
  const pricingPanelRef = useRef<HTMLElement>(null);
  const [primaryDiscountUnit, setPrimaryDiscountUnit] = useState<KimDiscountUnit>("amount");
  const [discountLines, setDiscountLines] = useState<KimDiscountLine[]>([]);
  const [acquisitionTaxMode, setAcquisitionTaxMode] = useState<KimAcquisitionTaxMode>("normal");
  const [trimDetail, setTrimDetail] = useState<TrimDetail | null>(null);
  const [exteriorColor, setExteriorColor] = useState<TrimColor | null>(null);
  const [interiorColor, setInteriorColor] = useState<TrimColor | null>(null);
  // #4c-2 워크벤치 저장용: VehiclePicker가 고른 brand/model(applyTrimToPricing이 버리던 값)과 선택 옵션 ids.
  const [workbenchVehicle, setWorkbenchVehicle] = useState<VehicleSelection | null>(null);
  const [selectedWorkbenchOptionIds, setSelectedWorkbenchOptionIds] = useState<number[]>([]);
  const [documents, setDocuments] = useState<KimDocumentItem[]>(() =>
    detail.documents.map((d) => ({
      id: d.id,
      // 분류의 진실원본은 doc_type(분류 변경 PATCH가 갱신하는 컬럼). title 컬럼은 레거시라 폴백만.
      title: d.docType ?? d.title ?? "",
      status: "분류완료",
      fileName: d.fileName ?? undefined,
      fileSize: d.fileSize ?? undefined,
      mimeType: d.fileMime ?? undefined,
    })),
  );
  const [isDocumentDragActive, setIsDocumentDragActive] = useState(false);
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);
  const [documentDropTargetId, setDocumentDropTargetId] = useState<string | null>(null);
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null);
  const [previewDocumentUrl, setPreviewDocumentUrl] = useState<string | null>(null);
  const [previewDownloadUrl, setPreviewDownloadUrl] = useState<string | null>(null);
  // 미리보기 이미지 로딩 완료 여부는 "로드된 URL"로 추적(파생) — URL이 바뀌면 자동으로 false가 되고
  // 무관한 리렌더로 effect가 재실행돼도 영향이 없다(objectUrl 미리보기가 false에 갇히던 버그 방지).
  const [loadedPreviewUrl, setLoadedPreviewUrl] = useState<string | null>(null);
  const [confirmingDocumentDeleteId, setConfirmingDocumentDeleteId] = useState<string | null>(null);
  const [isMergingDocuments, setIsMergingDocuments] = useState(false);
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
  const documentDeleteRef = useRef<HTMLDivElement>(null);
  const consultBodyRef = useRef<HTMLDivElement>(null);
  const customerMemoBodyRef = useRef<HTMLDivElement>(null);
  const checkBodyRef = useRef<HTMLDivElement>(null);
  const scheduleBodyRef = useRef<HTMLDivElement>(null);
  const quoteBodyRef = useRef<HTMLDivElement>(null);
  const documentBodyRef = useRef<HTMLDivElement>(null);
  const quoteWorkbenchOriginalInputRef = useRef<HTMLInputElement>(null);
  const quoteDetailFormRef = useRef<HTMLDivElement>(null);
  const timelineItems = timelineRows(customer);
  const remainingCheckCount = checkItems.filter((item) => !completedCheckItems.includes(item.id)).length;
  const receivedDocumentCount = documents.length;
  const openQuoteAction = quotes.find((quote) => quote.id === openQuoteActionId) ?? null;
  const editingQuote = quotes.find((quote) => quote.id === editingQuoteId) ?? null;
  const activeQuoteStatusTooltip = pinnedQuoteStatus ?? hoveredQuoteStatus;
  const activeQuoteStatus = activeQuoteStatusTooltip ? quotes.find((quote) => quote.id === activeQuoteStatusTooltip.id) ?? null : null;
  const activeQuoteStatusDetail = activeQuoteStatus ? kimQuoteStatusDetailParts(activeQuoteStatus) : null;
  const previewQuote = quotes.find((quote) => quote.id === previewQuoteId) ?? null;
  // 미리보기 URL: 업로드 직후 메모리 objectUrl 우선, 영속본은 signed URL을 비동기 발급.
  const activePreviewQuoteUrl = previewQuote ? previewQuote.objectUrl ?? previewQuoteUrl : null;
  useEffect(() => {
    if (!previewQuoteId || quotes.find((q) => q.id === previewQuoteId)?.objectUrl) return () => setPreviewQuoteUrl(null);
    let cancelled = false;
    getQuoteOriginalUrl(detail.id, previewQuoteId)
      .then((r) => { if (!cancelled) setPreviewQuoteUrl(r.url); })
      .catch(() => onToast("미리보기 URL 발급에 실패했습니다."));
    return () => { cancelled = true; setPreviewQuoteUrl(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewQuoteId 변경 시에만 재실행(quotes는 파생 조회라 dep 제외)
  }, [previewQuoteId, detail.id, onToast]);
  const previewSentQuote = quotes.find((quote) => quote.id === previewSentQuoteId) ?? null;
  const previewDocument = documents.find((documentItem) => documentItem.id === previewDocumentId) ?? null;
  // 미리보기 URL(이미지면 썸네일). 업로드 직후 objectUrl 우선. null이면 아직 발급 중(로딩).
  const activePreviewDocumentUrl = previewDocument ? previewDocument.objectUrl ?? previewDocumentUrl : null;
  // 현재 보여줄 URL이 실제로 로드 완료됐는지(파생). URL이 바뀌면 자동 false.
  const previewImageLoaded = activePreviewDocumentUrl !== null && loadedPreviewUrl === activePreviewDocumentUrl;
  // 다운로드는 항상 원본. objectUrl(업로드 직후 원본) 우선, 없으면 서버 원본 downloadUrl.
  const activeDownloadUrl = previewDocument ? previewDocument.objectUrl ?? previewDownloadUrl ?? previewDocumentUrl : null;
  // 서버 저장 파일은 signed URL을 비동기 발급한다(미리보기=썸네일/원본, 다운로드=원본).
  useEffect(() => {
    if (!previewDocumentId || (previewDocument?.objectUrl)) return () => { setPreviewDocumentUrl(null); setPreviewDownloadUrl(null); };
    let cancelled = false;
    getDocumentUrlApi(detail.id, previewDocumentId)
      .then((r) => {
        if (!cancelled) { setPreviewDocumentUrl(r.url); setPreviewDownloadUrl(r.downloadUrl); }
      })
      .catch(() => onToast("미리보기 URL 발급에 실패했습니다."));
    return () => {
      cancelled = true;
      setPreviewDocumentUrl(null);
      setPreviewDownloadUrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewDocumentId 변경 시에만 재실행, previewDocument는 파생값이라 dep 제외
  }, [previewDocumentId, detail.id, onToast]);


  // 미리보기 모달이 열린 동안 배경(고객 상세 패널·페이지) 스크롤을 잠가 스크롤 전파(chaining)를 막는다.
  useEffect(() => {
    if (!previewDocumentId) return;
    document.body.classList.add("kim-doc-preview-open");
    return () => document.body.classList.remove("kim-doc-preview-open");
  }, [previewDocumentId]);
  const quoteManualFieldConfig = kimQuoteManualFieldConfig(selectedQuotePurchaseMethod);
  const quoteSolutionAvailable = selectedQuotePurchaseMethod === "운용리스" || selectedQuotePurchaseMethod === "장기렌트";
  const solutionWorkbenchCanQuery =solutionWorkbenchPurchaseMethod === "운용리스" || solutionWorkbenchPurchaseMethod === "장기렌트";
  const quoteDraftReady = isQuoteDraftSaved && !isQuoteDraftDirty;
  const sortedCustomerMemos = sortKimCustomerMemosByCreatedAt(customerMemos);
  const sortedCheckItems = sortKimCheckItemsByWorkRule(checkItems, completedCheckItems);
  const sortedSchedules = sortKimSchedulesByDateTime(schedules);

  function jeffMoneyInputFromTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLInputElement) || !target.closest(".kim-jeff-money-input")) return null;
    if (target.readOnly) return null;
    return target;
  }

  function clearJeffMoneyInputPreview(input: HTMLInputElement) {
    delete input.dataset.replaceOnInput;
    input.classList.remove("is-replace-preview");
  }

  function formatJeffMoneyInput(input: HTMLInputElement) {
    if (input.dataset.discountUnit === "percent") return;
    const value = parseMoney(input.value);
    input.value = value ? formatMoney(value) : "0";
  }

  function parsePercent(value: string) {
    const normalized = value.replace(/[^\d.]/g, "");
    const [head = "", ...rest] = normalized.split(".");
    const n = Number(rest.length ? `${head}.${rest.join("")}` : head);
    return Number.isFinite(n) ? n : 0;
  }

  function handleJeffMoneyInputFocus(event: ReactFocusEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target) return;
    target.dataset.replaceOnInput = "true";
    target.classList.add("is-replace-preview");
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function handleJeffMoneyInputMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.closest(".kim-jeff-money-input")) return;
    event.preventDefault();
    target.focus();
    target.dataset.replaceOnInput = "true";
    target.classList.add("is-replace-preview");
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function handleJeffMoneyInputBeforeInput(event: SyntheticEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target || target.dataset.replaceOnInput !== "true") return;
    const nativeEvent = event.nativeEvent as InputEvent;
    if (nativeEvent.inputType !== "insertText" || !nativeEvent.data) return;
    event.preventDefault();
    target.value = nativeEvent.data;
    formatJeffMoneyInput(target);
    clearJeffMoneyInputPreview(target);
    markQuoteDraftChanged();
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function handleJeffMoneyInputBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target) return;
    clearJeffMoneyInputPreview(target);
    formatJeffMoneyInput(target);
    markQuoteDraftChanged();
    recomputePricing();
  }

  function handleJeffMoneyInputChange(event: ChangeEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target) return;
    clearJeffMoneyInputPreview(target);
    if (target.dataset.discountUnit !== "percent") {
      window.requestAnimationFrame(() => formatJeffMoneyInput(target));
    }
  }

  function handleJeffMoneyInputPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target || target.dataset.replaceOnInput !== "true") return;
    event.preventDefault();
    target.value = event.clipboardData.getData("text");
    formatJeffMoneyInput(target);
    clearJeffMoneyInputPreview(target);
    markQuoteDraftChanged();
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function handleJeffMoneyInputKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = jeffMoneyInputFromTarget(event.target);
    if (!target || target.dataset.replaceOnInput !== "true") return;
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      target.value = "";
      clearJeffMoneyInputPreview(target);
      markQuoteDraftChanged();
      window.requestAnimationFrame(handlePricingPanelInput);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
    event.preventDefault();
    target.value = event.key;
    formatJeffMoneyInput(target);
    clearJeffMoneyInputPreview(target);
    markQuoteDraftChanged();
    target.setSelectionRange(target.value.length, target.value.length);
    window.requestAnimationFrame(handlePricingPanelInput);
  }

  function handleJeffMoneyInputMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.closest(".kim-jeff-money-input") || target.dataset.replaceOnInput !== "true") return;
    event.preventDefault();
    target.setSelectionRange(target.value.length, target.value.length);
  }

  function saveManualQuoteCondition(conditionId: string, conditionRound: string) {
    setSavedManualQuoteConditionIds((current) => (
      current.includes(conditionId) ? current : [...current, conditionId]
    ));
    onToast(`${conditionRound}번 조건을 저장했습니다.`);
  }

  function editManualQuoteCondition(conditionId: string, conditionRound: string) {
    setSavedManualQuoteConditionIds((current) => current.filter((id) => id !== conditionId));
    onToast(`${conditionRound}번 조건을 수정할 수 있습니다.`);
  }

  function markQuoteDraftChanged() {
    if (!isQuoteDraftSaved) return;
    setIsQuoteDraftDirty(true);
    setIsQuoteAppCardPreviewOpen(false);
  }

  function readPricingInputs(root: HTMLElement): PricingInputs {
    const read = (key: string) =>
      parseMoney(root.querySelector<HTMLInputElement>(`input[data-pricing="${key}"]`)?.value ?? "");
    return {
      basePrice: read("base"),
      optionPrice: read("option"),
      discount: read("discount"),
      acquisitionTax: read("acquisitionTax"),
      bond: read("bond"),
      delivery: read("delivery"),
      incidental: read("incidental"),
    };
  }

  function recomputePricing() {
    const root = pricingPanelRef.current;
    if (!root) return;
    setPricing(computePricing(readPricingInputs(root)));
  }

  function syncDiscountTotalFromRows(root: HTMLElement) {
    const discountInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-discount-line="true"]'));
    if (!discountInputs.length) return;
    const basePrice = parseMoney(root.querySelector<HTMLInputElement>('input[data-pricing="base"]')?.value ?? "");
    const optionPrice = parseMoney(root.querySelector<HTMLInputElement>('input[data-pricing="option"]')?.value ?? "");
    const discountBasis = basePrice + optionPrice;
    const total = discountInputs.reduce((sum, input) => {
      const value = input.dataset.discountUnit === "percent" ? parsePercent(input.value) : parseMoney(input.value);
      return sum + (input.dataset.discountUnit === "percent" ? Math.round(discountBasis * value / 100) : value);
    }, 0);
    const discountTotal = root.querySelector<HTMLInputElement>('input[data-pricing="discount"]');
    if (discountTotal) discountTotal.value = formatMoney(total);
  }

  function discountBasis(root: HTMLElement) {
    return parseMoney(root.querySelector<HTMLInputElement>('input[data-pricing="base"]')?.value ?? "") +
      parseMoney(root.querySelector<HTMLInputElement>('input[data-pricing="option"]')?.value ?? "");
  }

  function formatPercent(value: number) {
    return value.toFixed(2).replace(/\.?0+$/, "");
  }

  function convertDiscountInputUnit(input: HTMLInputElement, from: KimDiscountUnit, to: KimDiscountUnit, basis: number) {
    if (from === to) return;
    const value = from === "percent" ? parsePercent(input.value) : parseMoney(input.value);
    if (!value || !basis) {
      input.value = "0";
      return;
    }
    input.value = to === "percent" ? formatPercent(value / basis * 100) : formatMoney(Math.round(basis * value / 100));
  }

  function handlePricingPanelInput() {
    const root = pricingPanelRef.current;
    if (!root) return;
    syncDiscountTotalFromRows(root);
    recomputePricing();
  }

  function addDiscountLine() {
    setDiscountLines((prev) => [...prev, { id: `discount-${nowMs()}`, label: "재구매 할인", amount: "0", unit: "amount" }]);
    markQuoteDraftChanged();
  }

  function removeDiscountLine(id: string) {
    setDiscountLines((prev) => prev.filter((line) => line.id !== id));
    window.requestAnimationFrame(() => {
      const root = pricingPanelRef.current;
      if (!root) return;
      syncDiscountTotalFromRows(root);
      recomputePricing();
    });
    markQuoteDraftChanged();
  }

  function setPrimaryDiscountMode(unit: KimDiscountUnit) {
    const root = pricingPanelRef.current;
    const input = root?.querySelector<HTMLInputElement>('input[data-discount-primary="true"]');
    if (root && input) convertDiscountInputUnit(input, primaryDiscountUnit, unit, discountBasis(root));
    setPrimaryDiscountUnit(unit);
    window.requestAnimationFrame(() => {
      const root = pricingPanelRef.current;
      if (!root) return;
      syncDiscountTotalFromRows(root);
      recomputePricing();
    });
    markQuoteDraftChanged();
  }

  function setDiscountLineMode(id: string, unit: KimDiscountUnit) {
    const current = discountLines.find((line) => line.id === id);
    const root = pricingPanelRef.current;
    const input = root?.querySelector<HTMLInputElement>(`input[data-discount-id="${id}"]`);
    if (root && input && current) convertDiscountInputUnit(input, current.unit, unit, discountBasis(root));
    setDiscountLines((prev) => prev.map((line) => line.id === id ? { ...line, unit } : line));
    window.requestAnimationFrame(() => {
      const root = pricingPanelRef.current;
      if (!root) return;
      syncDiscountTotalFromRows(root);
      recomputePricing();
    });
    markQuoteDraftChanged();
  }

  async function applyTrimToPricing(selection: VehicleSelection) {
    const trim = selection.trim;
    if (!trim) return;
    try {
      const detail = await fetchTrimDetail(trim.id);
      setTrimDetail(detail);
      setWorkbenchVehicle(selection);
      setSelectedWorkbenchOptionIds([]);
      setExteriorColor(null);
      setInteriorColor(null);
      const root = pricingPanelRef.current;
      if (!root) return;
      const setInput = (key: string, value: number) => {
        const el = root.querySelector<HTMLInputElement>(`input[data-pricing="${key}"]`);
        if (el) el.value = formatMoney(value);
      };
      setInput("base", detail.price);
      setInput("option", 0);
      setInput("discount", detail.financialDiscountAmount ?? 0);
      setPrimaryDiscountUnit("amount");
      const primaryDiscount = root.querySelector<HTMLInputElement>('input[data-discount-primary="true"]');
      if (primaryDiscount) primaryDiscount.value = formatMoney(detail.financialDiscountAmount ?? 0);
      recomputePricing();
      markQuoteDraftChanged();
    } catch (error) {
      console.warn("트림 상세 로드 실패", error);
    }
  }

  function applyOptionTotal(next: { selectedIds: number[]; total: number }) {
    setSelectedWorkbenchOptionIds(next.selectedIds);
    const root = pricingPanelRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLInputElement>('input[data-pricing="option"]');
    if (el) el.value = formatMoney(next.total);
    recomputePricing();
    markQuoteDraftChanged();
  }

  function setManualDepositMode(conditionId: string, mode: KimManualDepositMode) {
    setManualDepositModes((prev) => ({ ...prev, [conditionId]: mode }));
    markQuoteDraftChanged();
  }

  function setManualDownPaymentMode(conditionId: string, mode: KimManualDepositMode) {
    setManualDownPaymentModes((prev) => ({ ...prev, [conditionId]: mode }));
    markQuoteDraftChanged();
  }

  function setManualResidualMode(conditionId: string, mode: KimManualResidualMode) {
    setManualResidualModes((prev) => ({ ...prev, [conditionId]: mode }));
    markQuoteDraftChanged();
  }

  function setManualMileageMode(conditionId: string, mode: KimManualMileageMode) {
    setManualMileageModes((prev) => ({ ...prev, [conditionId]: mode }));
    if (mode === "basic") setManualMileageValues((prev) => ({ ...prev, [conditionId]: "20,000km / 년" }));
    markQuoteDraftChanged();
  }

  function setManualMileageValue(conditionId: string, value: string) {
    setManualMileageValues((prev) => ({ ...prev, [conditionId]: value }));
    markQuoteDraftChanged();
  }

  function validateQuoteDetailDraft() {
    const form = quoteDetailFormRef.current;
    if (!form) return ["세부 견적 작성 영역을 확인해 주세요."];
    const missing: string[] = [];
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((field) => {
      const label = field.closest("label")?.querySelector("span")?.textContent?.trim() ?? "필수 항목";
      const value = field.value.trim();
      if (!value) {
        missing.push(`${label} 입력이 필요합니다.`);
        return;
      }
      if (field.dataset.rejectValue && value === field.dataset.rejectValue) {
        missing.push(`${label}가 ${field.dataset.rejectValue} 상태입니다.`);
      }
    });
    return missing;
  }

  function saveQuoteDetailDraft() {
    const missing = validateQuoteDetailDraft();
    if (missing.length > 0) {
      onToast(missing.slice(0, 3).join(" "));
      return;
    }
    setIsQuoteDraftSaved(true);
    setIsQuoteDraftDirty(false);
    onToast("작성한 견적이 저장되었습니다. 우측 상단의 견적함에 저장 버튼을 눌러 마무리하세요.");
  }

  function guardQuoteDraftOutput(outputLabel: string) {
    if (quoteDraftReady) return true;
    const missing = validateQuoteDetailDraft();
    if (missing.length > 0) {
      onToast(missing.slice(0, 3).join(" "));
      return false;
    }
    onToast(`${outputLabel} 전에 먼저 세부 견적을 저장해 주세요.`);
    return false;
  }

  function markRecentUpdate(section: string) {
    const updatedAt = nowMs();
    setRecentUpdate({ section, updatedAt });
    setRecentUpdateNow(updatedAt);
  }

  // 낙관 갱신 후 백그라운드 PATCH. 실패 시 rollback + 토스트(쓰기는 재시도 안 함).
  function savePatch(patch: CustomerWritePatch, rollback: () => void) {
    if (!customer.id) return;
    void updateCustomer(customer.id, patch).catch(() => {
      rollback();
      onToast("저장에 실패했습니다");
    });
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- customer prop이 바뀔 때 진행 상태를 외부 값과 동기화하는 의도된 effect
    setStageGroup(customer.statusGroup);
    setStageStatus(customer.status);
  }, [customer.status, customer.statusGroup]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chanceOverride/customer 변경 시 계약 가능성을 동기화하는 의도된 effect
    setChance(chanceOverride ?? chanceLabel(customer) as CustomerChanceOption);
  }, [chanceOverride, customer]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manageStatusOverride 변경 시 관리 상태를 동기화하는 의도된 effect
    setManage(manageStatusOverride ?? "정상");
  }, [manageStatusOverride]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRecentUpdateNow(Date.now());
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    onEditorOpenChange?.(openEditor !== null || addingCustomerMemo || addingCheckItem || addingScheduleItem || quoteComposerMode !== null || isQuoteSolutionWorkbenchOpen || openQuoteActionId !== null || previewQuoteId !== null || previewSentQuoteId !== null || previewDocumentId !== null || editingCheckItemId !== null || editingCustomerMemoId !== null || editingScheduleId !== null || editingQuoteId !== null || confirmingCustomerMemoDeleteId !== null || confirmingScheduleDeleteId !== null || confirmingQuoteDeleteId !== null || confirmingQuoteSendId !== null || confirmingQuoteContractId !== null || confirmingQuoteContractEditId !== null || confirmingQuoteContractDowngrade !== null || confirmingDocumentDeleteId !== null);
    return () => onEditorOpenChange?.(false);
  }, [addingCheckItem, addingCustomerMemo, addingScheduleItem, confirmingCustomerMemoDeleteId, confirmingDocumentDeleteId, confirmingQuoteDeleteId, confirmingQuoteSendId, confirmingQuoteContractId, confirmingQuoteContractEditId, confirmingQuoteContractDowngrade, confirmingScheduleDeleteId, editingCheckItemId, editingCustomerMemoId, editingScheduleId, editingQuoteId, isQuoteSolutionWorkbenchOpen, onEditorOpenChange, openEditor, openQuoteActionId, previewDocumentId, previewQuoteId, previewSentQuoteId, quoteComposerMode]);

  useEffect(() => {
    if (!quoteSolutionAvailable && (quoteEntryMode === "solution" || quoteEntryMode === "original")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 미지원 구매방식에서 작성 방식을 수기로 되돌리는 의도된 가드 effect
      setQuoteEntryMode("manual");
    }
  }, [quoteEntryMode, quoteSolutionAvailable]);

  useEffect(() => {
    if (!solutionWorkbenchCanQuery && solutionWorkbenchEntryMode === "solution") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 솔루션 조회 불가 구매방식에서 작성 방식을 수기로 되돌리는 의도된 가드 effect
      setSolutionWorkbenchEntryMode("manual");
    }
  }, [solutionWorkbenchCanQuery, solutionWorkbenchEntryMode]);

  useEffect(() => {
    if (!isQuoteSolutionWorkbenchOpen) return;

    function closeQuoteSolutionWorkbenchByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (solutionWorkbenchModeMenu) {
        setSolutionWorkbenchModeMenu(null);
        return;
      }
      setIsQuoteSolutionWorkbenchOpen(false);
    }

    function closeQuoteSolutionWorkbenchMenu(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (solutionWorkbenchModeMenu && target.closest(`[data-workbench-mode="${solutionWorkbenchModeMenu}"]`)) return;
      setSolutionWorkbenchModeMenu(null);
    }

    document.addEventListener("keydown", closeQuoteSolutionWorkbenchByKeyboard);
    document.addEventListener("pointerdown", closeQuoteSolutionWorkbenchMenu, true);
    return () => {
      document.removeEventListener("keydown", closeQuoteSolutionWorkbenchByKeyboard);
      document.removeEventListener("pointerdown", closeQuoteSolutionWorkbenchMenu, true);
    };
  }, [isQuoteSolutionWorkbenchOpen, solutionWorkbenchModeMenu]);

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
    const containers = [quoteBodyRef.current];
    const frame = window.requestAnimationFrame(() => {
      containers.forEach((container) => {
        if (!container) return;
        container.scrollTop = container.scrollHeight;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [quotes.length]);

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
    if (!openQuoteActionId) return;

    function closeQuoteAction(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (target.closest(".kim-quote-action-popover") || target.closest(".kim-quote-row-actions")) return;
      setOpenQuoteActionId(null);
      setQuoteActionFrame(null);
      setConfirmingQuoteSendId(null);
      setConfirmingQuoteDeleteId(null);
      setConfirmingQuoteContractId(null);
      setConfirmingQuoteContractEditId(null);
      setConfirmingQuoteContractDowngrade(null);
    }

    function closeQuoteActionByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenQuoteActionId(null);
      setQuoteActionFrame(null);
      setConfirmingQuoteSendId(null);
      setConfirmingQuoteDeleteId(null);
      setConfirmingQuoteContractId(null);
      setConfirmingQuoteContractEditId(null);
      setConfirmingQuoteContractDowngrade(null);
    }

    document.addEventListener("pointerdown", closeQuoteAction, true);
    document.addEventListener("keydown", closeQuoteActionByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeQuoteAction, true);
      document.removeEventListener("keydown", closeQuoteActionByKeyboard);
    };
  }, [openQuoteActionId]);

  useEffect(() => {
    if (!pinnedQuoteStatus) return;

    function closePinnedQuoteStatus(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (target.closest(".kim-quote-status-detail") || target.closest(".kim-quote-status-tooltip")) return;
      setPinnedQuoteStatus(null);
    }

    function closePinnedQuoteStatusByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setPinnedQuoteStatus(null);
    }

    document.addEventListener("pointerdown", closePinnedQuoteStatus, true);
    document.addEventListener("keydown", closePinnedQuoteStatusByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closePinnedQuoteStatus, true);
      document.removeEventListener("keydown", closePinnedQuoteStatusByKeyboard);
    };
  }, [pinnedQuoteStatus]);

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
    if (!confirmingDocumentDeleteId) return;

    function closeDocumentDelete(event: PointerEvent) {
      if (documentDeleteRef.current?.contains(event.target as Node)) return;
      setConfirmingDocumentDeleteId(null);
    }

    function closeDocumentDeleteByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingDocumentDeleteId(null);
    }

    document.addEventListener("pointerdown", closeDocumentDelete, true);
    document.addEventListener("keydown", closeDocumentDeleteByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeDocumentDelete, true);
      document.removeEventListener("keydown", closeDocumentDeleteByKeyboard);
    };
  }, [confirmingDocumentDeleteId]);

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

  function saveStatusField(event: SyntheticEvent<HTMLFormElement>, key: KimStatusFieldKey) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = String(formData.get("value") ?? "").trim();
    if (!value) return;
    const prev = statusValues[key];
    if (key === "phone") {
      const digits = `010${value.replace(/\D/g, "")}`; // 입력 8자리 + 010 고정 prefix = 11자리
      const display = formatPhone(digits);
      setStatusValues((current) => ({ ...current, phone: display }));
      setOpenEditor(null);
      markRecentUpdate("고객 정보");
      onToast("연락처 수정 완료");
      savePatch({ phone: digits }, () => setStatusValues((current) => ({ ...current, phone: prev })));
      return;
    }
    setStatusValues((current) => ({ ...current, [key]: value }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast(`${fieldLabel(key)} 수정 완료`);
  }

  function saveJobField(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const customerType = String(formData.get("customerType") ?? "개인") as KimCustomerType;
    const customerTypeDetail = String(formData.get("customerTypeDetail") ?? "").trim();
    const nextJobValue = formatKimJobValue(customerType, customerTypeDetail);
    const prevJob = statusValues.job;
    setStatusValues((current) => ({ ...current, job: nextJobValue }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("직군 수정 완료");
    savePatch({ customerType, customerTypeDetail }, () => setStatusValues((current) => ({ ...current, job: prevJob })));
  }

  function saveLocationField(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const province = String(formData.get("province") ?? "확인 필요");
    const detail = String(formData.get("detail") ?? "확인 필요");
    const nextLocation = formatKimLocationValue(province, detail);
    const prevLocation = statusValues.location;
    setStatusValues((current) => ({ ...current, location: nextLocation }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("거주지 수정 완료");
    savePatch({ residence: nextLocation }, () => setStatusValues((current) => ({ ...current, location: prevLocation })));
  }

  function saveSourceField(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const source = String(formData.get("source") ?? "").trim();
    const customSource = String(formData.get("customSource") ?? "").trim();
    const nextSource = source === "기타" ? customSource || "기타" : source;
    if (!nextSource) return;
    const prevSource = statusValues.source;
    setStatusValues((current) => ({ ...current, source: nextSource }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("상담경로 수정 완료");
    savePatch({ source: nextSource }, () => setStatusValues((current) => ({ ...current, source: prevSource })));
  }

  function saveAdvisorField(event: SyntheticEvent<HTMLFormElement>) {
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

  function saveNeeds(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const prevNeeds = needs;
    const nextNeeds = {
      model: String(formData.get("model") ?? "").trim() || needs.model,
      trim: String(formData.get("trim") ?? "").trim() || needs.trim,
      colors: String(formData.get("colors") ?? "").trim() || needs.colors,
      method: String(formData.get("method") ?? "").trim() || needs.method,
      memo: String(formData.get("memo") ?? "").trim() || needs.memo,
    };
    setNeeds(nextNeeds);
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("고객 니즈 수정 완료");
    savePatch(
      { needModel: nextNeeds.model, needTrim: nextNeeds.trim, needColors: nextNeeds.colors, needMethod: nextNeeds.method, needMemo: nextNeeds.memo },
      () => setNeeds(prevNeeds),
    );
  }

  function savePurchaseConditions(event: SyntheticEvent<HTMLFormElement>) {
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
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "구매방식" ? { ...field, value: nextValue } : field
    )));
    markRecentUpdate("상세 구매조건");
    onToast("구매방식 수정 완료");
    savePatch({ needMethod: nextValue }, () => setPurchaseFields(prevPurchaseFields));
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
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
    savePatch({ needTiming: nextValue }, () => setPurchaseFields(prevPurchaseFields));
  }

  function selectPurchaseTimingMonth(month: string) {
    const currentTimingField = purchaseFields.find((field) => field.label === "출고 희망 시기");
    const monthValue = `${month} 출고 희망`;
    const nextValue = currentTimingField?.value === monthValue ? "확인 필요" : monthValue;
    const prevPurchaseFields = purchaseFields;
    setPurchaseFields((current) => current.map((field) => (
      field.label === "출고 희망 시기" ? { ...field, value: nextValue } : field
    )));
    setShowTimingMonths(false);
    setOpenEditor(null);
    setPurchasePopoverFrame(null);
    markRecentUpdate("상세 구매조건");
    onToast("출고 희망 시기 수정 완료");
    savePatch({ needTiming: nextValue }, () => setPurchaseFields(prevPurchaseFields));
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

  function saveQuote(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const status = String(formData.get("status") ?? "대기");
    const sourceLabel = String(formData.get("source") ?? (quoteEntryMode === "solution" ? "견적 조회" : quoteEntryMode === "original" ? "원본 인식" : "수기 작성"));
    const source: KimQuoteItem["source"] = sourceLabel === "견적 조회" ? "solution" : sourceLabel === "원본 인식" ? "original" : "manual";
    const brand = String(formData.get("brand") ?? "").trim();
    const model = String(formData.get("model") ?? "").trim();
    const trim = String(formData.get("trim") ?? "").trim();
    const quoteRound = String(formData.get("quoteRound") ?? "").trim();
    const vehicleName = String(formData.get("vehicleName") ?? "").trim();
    const financeType = normalizeKimQuotePurchaseMethod(String(formData.get("financeType") ?? selectedQuotePurchaseMethod).trim());
    const term = String(formData.get("term") ?? "").trim();
    const monthlyPayment = String(formData.get("monthlyPayment") ?? "").trim();
    const lender = String(formData.get("financeCompany") ?? "").trim();
    const stockStatus = String(formData.get("stockStatus") ?? "").trim() as KimQuoteItem["stockStatus"] | "";
    const validLabel = String(formData.get("validLabel") ?? "").trim();
    const meta = String(formData.get("meta") ?? "").trim();
    const nextTitle = title || [model || vehicleName, financeType, quoteRound ? `${quoteRound} 견적` : "견적"].filter(Boolean).join(" ");
    if (!nextTitle) return;
    if (quoteComposerMode === "edit" && editingQuoteId) {
      const sentAt = formatKoreanShortTime();
      const prevQuotes = quotes;
      const prev = quotes.find((quote) => quote.id === editingQuoteId);
      setQuotes((current) => current.map((quote) => (
        quote.id === editingQuoteId ? {
          ...quote,
          title: nextTitle,
          status: "고객 확인 전",
          source,
          appStatus: "sent",
          vehicleName,
          brand: brand || quote.brand,
          model: model || quote.model,
          trim: trim || vehicleName || quote.trim,
          financeType,
          term,
          monthlyPayment,
          lender: lender || quote.lender,
          quoteRound: quoteRound || quote.quoteRound,
          stockStatus: stockStatus || quote.stockStatus,
          validLabel: validLabel || quote.validLabel,
          note: meta || quote.note,
          sentAt,
          viewedAt: undefined,
          revisedAt: sentAt,
          revision: (quote.revision ?? 1) + 1,
          decisionStatus: quote.decisionStatus === "contracting" ? quote.decisionStatus : "none",
          originalNeedsReplacement: Boolean(quote.fileName),
          meta: meta || `${sentAt} · 수정 후 앱 재발송`,
          ...(recognizedQuoteFile ? {
            fileName: recognizedQuoteFile.fileName,
            fileSize: recognizedQuoteFile.fileSize,
            mimeType: recognizedQuoteFile.mimeType,
            file: recognizedQuoteFile.file,
            originalNeedsReplacement: false,
          } : {}),
        } : quote
      )));
      if (customer.id && !editingQuoteId.startsWith("kim-")) {
        const patch: QuoteWritePatch = {
          status: "고객 확인 전",
          entryMode: source,
          appStatus: "sent",
          bumpRevision: true,
          quoteRound: quoteRound || prev?.quoteRound || null,
          stockStatus: (stockStatus || prev?.stockStatus) ?? null,
          brandName: (brand || prev?.brand) ?? null,
          modelName: (model || prev?.model) ?? null,
          trimName: (trim || vehicleName || prev?.trim) ?? null,
          note: meta || prev?.note || null,
          decisionStatus: prev?.decisionStatus === "contracting" ? "contracting" : "none",
          scenario: {
            purchaseMethod: financeType || null,
            termMonths: parseTermMonths(term),
            monthlyPayment: parseMonthlyPayment(monthlyPayment),
            lender: lender || prev?.lender || null,
          },
        };
        void apiUpdateQuote(customer.id, editingQuoteId, patch).catch(() => { setQuotes(prevQuotes); onToast("견적 저장에 실패했습니다."); });
      }
      setQuoteComposerMode(null);
      setEditingQuoteId(null);
      setRecognizedQuoteFile(null);
      setConfirmingQuoteDeleteId(null);
      setConfirmingQuoteContractId(null);
      setOpenQuoteActionId(null);
      setQuoteActionFrame(null);
      markRecentUpdate("견적함");
      onToast("수정 견적을 앱 견적함으로 재발송하고 푸시알림을 보냈습니다.");
      return;
    }
    const tempId = `kim-quote-${Date.now()}`;
    const tempQuoteCode = createKimQuoteCode(quotes);
    setQuotes((current) => [...current, {
      id: tempId,
      quoteCode: tempQuoteCode,
      title: nextTitle,
      status,
      source,
      appStatus: "draft",
      brand,
      model: model || vehicleName,
      trim: trim || vehicleName,
      quoteRound: quoteRound || "1차",
      vehicleName,
      financeType,
      term,
      monthlyPayment,
      lender,
      stockStatus: stockStatus || "재고확인중",
      validLabel,
      note: meta,
      meta: meta || `${formatKoreanShortTime()} · ${source === "original" ? "원본 인식" : "내부 작성"}`,
      ...(recognizedQuoteFile ? {
        fileName: recognizedQuoteFile.fileName,
        fileSize: recognizedQuoteFile.fileSize,
        mimeType: recognizedQuoteFile.mimeType,
        file: recognizedQuoteFile.file,
      } : {}),
    }]);
    if (customer.id) {
      const payload: QuoteCreatePayload = {
        entryMode: source,
        status,
        quoteRound: quoteRound || "1차",
        stockStatus: stockStatus || "재고확인중",
        brandName: brand || null,
        modelName: (model || vehicleName) || null,
        trimName: (trim || vehicleName) || null,
        note: meta || null,
        scenario: {
          purchaseMethod: financeType || null,
          termMonths: parseTermMonths(term),
          monthlyPayment: parseMonthlyPayment(monthlyPayment),
          lender: lender || null,
        },
      };
      void apiCreateQuote(customer.id, payload)
        .then(({ id, quoteCode }) => setQuotes((current) => current.map((q) => (q.id === tempId ? { ...q, id, quoteCode } : q))))
        .catch(() => { setQuotes((current) => current.filter((q) => q.id !== tempId)); onToast("견적 저장에 실패했습니다."); });
    }
    setQuoteComposerMode(null);
    setEditingQuoteId(null);
    setRecognizedQuoteFile(null);
    setConfirmingQuoteDeleteId(null);
    setConfirmingQuoteContractId(null);
    markRecentUpdate("견적함");
    onToast("견적 항목이 추가되었습니다.");
  }

  function saveQuoteFromWorkbench() {
    if (!guardQuoteDraftOutput("견적함 저장")) return;
    const source: KimQuoteItem["source"] = solutionWorkbenchEntryMode === "solution" ? "solution" : solutionWorkbenchEntryMode === "original" ? "original" : "manual";
    const sourceLabel = source === "solution" ? "솔루션 조회 조건" : source === "original" ? "원본 인식 후 보정" : "수기 입력 조건";
    const savedAt = formatKoreanShortTime();

    // 워크벤치 입력 추출(#4c-2). 가격은 DOM(readPricingInputs)+pricing state, 차량/색상/옵션은 기존 state.
    const root = pricingPanelRef.current;
    const inputs = root ? readPricingInputs(root) : null;
    const brandName = workbenchVehicle?.brand?.name ?? null;
    const modelName = workbenchVehicle?.model?.name ?? null;
    const trimName = trimDetail?.trimName ?? trimDetail?.name ?? null;
    const selectedOptions = trimDetail
      ? trimDetail.options.filter((o) => selectedWorkbenchOptionIds.includes(o.id)).map((o) => ({ id: o.id, name: o.name, price: o.price }))
      : [];
    const vehicleName = [brandName, modelName, trimName].filter(Boolean).join(" ") || "차량 미선택";
    const num = (n: number | undefined | null) => (n == null ? null : String(n));

    const tempId = `kim-quote-workbench-${nowMs()}`;
    const tempQuoteCode = createKimQuoteCode(quotes);

    setQuotes((current) => [...current, {
      id: tempId,
      quoteCode: tempQuoteCode,
      title: vehicleName,
      meta: `${savedAt} · ${sourceLabel}`,
      status: "작성중",
      source,
      appStatus: "draft",
      brand: brandName ?? undefined,
      model: modelName ?? undefined,
      trim: trimName ?? undefined,
      quoteRound: "1차",
      vehicleName,
      financeType: solutionWorkbenchPurchaseMethod,
      term: "조건 미정",
      lender: "금융사 미정",
      stockStatus: "재고확인중",
      note: sourceLabel,
      decisionStatus: "none",
      finalVehiclePrice: pricing.finalVehiclePrice,
      exteriorColorName: exteriorColor?.name,
      exteriorColorHex: exteriorColor?.hexValue ?? undefined,
      interiorColorName: interiorColor?.name,
      interiorColorHex: interiorColor?.hexValue ?? undefined,
      ...(recognizedQuoteFile ? {
        fileName: recognizedQuoteFile.fileName,
        fileSize: recognizedQuoteFile.fileSize,
        mimeType: recognizedQuoteFile.mimeType,
        file: recognizedQuoteFile.file,
      } : {}),
    }]);

    if (customer.id) {
      // #4c-3a: 저장된 비교카드 → scenarios. 없으면 단일(구매방식만, #4c-2 폴백).
      const compareForm = quoteDetailFormRef.current;
      const builtScenarios = savedManualQuoteConditionIds.map((condId) => {
        const card = compareForm?.querySelector<HTMLElement>(`[data-scenario-card="${condId}"]`);
        const fieldVal = (f: string) => card?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-sc-field="${f}"]`)?.value ?? null;
        const constCard = kimManualQuoteConditionCards.find((c) => c.id === condId);
        const depositMode = manualDepositModes[condId] ?? constCard?.depositMode ?? null;
        const downPaymentMode = manualDownPaymentModes[condId] ?? constCard?.downPaymentMode ?? null;
        const residualMode = manualResidualModes[condId] ?? constCard?.residualMode ?? null;
        const mileageMode = manualMileageModes[condId] ?? "basic";
        const mileageValue = mileageMode === "basic" ? "20,000km / 년" : (manualMileageValues[condId] ?? "20,000km / 년");
        const lenderRaw = fieldVal("lender");
        return {
          scenarioNo: Number(constCard?.round ?? 1),
          isSaved: true,
          purchaseMethod: solutionWorkbenchPurchaseMethod,
          lender: lenderRaw && lenderRaw !== "미선택" ? lenderRaw : null,
          monthlyPayment: parseMonthlyPayment(fieldVal("monthly") ?? ""),
          depositMode,
          depositValue: depositMode === "none" ? null : parseMonthlyPayment(fieldVal("deposit") ?? ""),
          downPaymentMode,
          downPaymentValue: downPaymentMode === "none" ? null : parseMonthlyPayment(fieldVal("downPayment") ?? ""),
          residualMode,
          residualValue: residualMode === "max" ? null : parseMonthlyPayment(fieldVal("residual") ?? ""),
          mileageMode,
          mileageValue,
        };
      });
      const payload: QuoteCreatePayload = {
        entryMode: source,
        status: "작성중",
        quoteRound: "1차",
        stockStatus: "재고확인중",
        brandName,
        modelName,
        trimName,
        note: sourceLabel,
        trimId: trimDetail?.id ?? null,
        basePrice: inputs ? num(inputs.basePrice) : null,
        optionTotal: inputs ? num(inputs.optionPrice) : null,
        options: selectedOptions.length ? selectedOptions : null,
        finalDiscount: inputs ? num(inputs.discount) : null,
        acquisitionTax: inputs ? num(inputs.acquisitionTax) : null,
        acquisitionTaxMode,
        bond: inputs ? num(inputs.bond) : null,
        delivery: inputs ? num(inputs.delivery) : null,
        incidental: inputs ? num(inputs.incidental) : null,
        finalVehiclePrice: num(pricing.finalVehiclePrice),
        acquisitionCost: num(pricing.acquisitionCost),
        exteriorColorId: exteriorColor?.id ?? null,
        exteriorColorName: exteriorColor?.name ?? null,
        exteriorColorHex: exteriorColor?.hexValue ?? null,
        interiorColorId: interiorColor?.id ?? null,
        interiorColorName: interiorColor?.name ?? null,
        interiorColorHex: interiorColor?.hexValue ?? null,
        ...(builtScenarios.length
          ? { scenarios: builtScenarios }
          : { scenario: { purchaseMethod: solutionWorkbenchPurchaseMethod } }),
      };
      void apiCreateQuote(customer.id, payload)
        .then(({ id, quoteCode }) => setQuotes((current) => current.map((q) => (q.id === tempId ? { ...q, id, quoteCode } : q))))
        .catch(() => { setQuotes((current) => current.filter((q) => q.id !== tempId)); onToast("견적 저장에 실패했습니다."); });
    }

    setIsQuoteSolutionWorkbenchOpen(false);
    setSolutionWorkbenchModeMenu(null);
    setRecognizedQuoteFile(null);
    markRecentUpdate("견적함");
    onToast("워크벤치 견적을 견적함에 저장했습니다.");
  }

  function resetQuoteWorkbench() {
    setSolutionWorkbenchPurchaseMethod(primaryKimQuotePurchaseMethod(purchaseFields));
    setSolutionWorkbenchEntryMode("manual");
    setSolutionWorkbenchModeMenu(null);
    setRecognizedQuoteFile(null);
    setIsQuoteWorkbenchOriginalDragActive(false);
    setIsQuoteDraftSaved(false);
    setIsQuoteDraftDirty(false);
    setSavedManualQuoteConditionIds([]);
    setIsQuoteAppCardPreviewOpen(false);
    onToast("워크벤치 입력값을 초기화했습니다.");
  }

  function attachQuoteFileToQuote(quoteId: string, file: File) {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onToast("이미지 또는 PDF 파일만 첨부할 수 있습니다.");
      return;
    }
    const quoteTitle = quotes.find((quote) => quote.id === quoteId)?.title ?? "견적";
    const prevQuotes = quotes;
    const objectUrl = URL.createObjectURL(file);
    const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    setQuotes((current) => current.map((quote) => (
      quote.id === quoteId ? {
        ...quote,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        objectUrl,
        file,
        status: quote.status === "작성중" ? "발송대기" : quote.status,
        appStatus: quote.appStatus === "draft" ? "queued" : quote.appStatus,
        originalNeedsReplacement: false,
      } : quote
    )));
    markRecentUpdate("견적함");
    if (customer.id && !quoteId.startsWith("kim-")) {
      void uploadQuoteOriginal(customer.id, quoteId, file).catch(() => {
        URL.revokeObjectURL(objectUrl);
        setQuotes(prevQuotes);
        onToast("원본 업로드에 실패했습니다.");
      });
    }
    onToast(`${quoteTitle} 원본 첨부: ${file.name}`);
  }

  function removeQuoteOriginal(quoteId: string) {
    const prevQuotes = quotes;
    const target = quotes.find((quote) => quote.id === quoteId);
    if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
    setQuotes((current) => current.map((quote) => (
      quote.id === quoteId ? { ...quote, fileName: undefined, fileSize: undefined, mimeType: undefined, objectUrl: undefined, file: undefined } : quote
    )));
    setPreviewQuoteId((current) => (current === quoteId ? null : current));
    if (customer.id && !quoteId.startsWith("kim-")) {
      void deleteQuoteOriginal(customer.id, quoteId).catch(() => { setQuotes(prevQuotes); onToast("원본 삭제에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast("견적 원본을 삭제했습니다.");
  }

  function attachQuoteFile(event: ChangeEvent<HTMLInputElement>, quoteId: string) {
    const file = event.target.files?.[0];
    if (!file) return;
    attachQuoteFileToQuote(quoteId, file);
    event.target.value = "";
  }

  function dropQuoteFile(event: ReactDragEvent<HTMLElement>, quoteId: string) {
    event.preventDefault();
    event.stopPropagation();
    setQuoteDropTargetId(null);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    attachQuoteFileToQuote(quoteId, file);
  }

  function startQuoteFromOriginalFile(file: File) {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onToast("견적 원본은 이미지 또는 PDF 파일만 인식할 수 있습니다.");
      return;
    }
    setRecognizedQuoteFile({
      file,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
    });
    setConfirmingQuoteDeleteId(null);
    setEditingQuoteId(null);
    setSelectedQuotePurchaseMethod("운용리스");
    setQuoteEntryMode("original");
    setQuoteComposerMode("manual");
    onToast("견적 원본을 인식해 작성창을 열었습니다.");
  }

  function recognizeQuoteOriginalForWorkbench(file: File) {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onToast("견적 원본은 이미지 또는 PDF 파일만 인식할 수 있습니다.");
      return;
    }
    setRecognizedQuoteFile({
      file,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
    });
    setSolutionWorkbenchEntryMode("original");
    setSolutionWorkbenchModeMenu(null);
    onToast("견적 원본을 인식해 워크벤치에 반영했습니다.");
  }

  function dropQuoteOriginalToComposer(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsQuoteHeaderDragActive(false);
    setIsQuoteModalDragActive(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    startQuoteFromOriginalFile(file);
  }

  function selectQuoteOriginalFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    startQuoteFromOriginalFile(file);
    event.target.value = "";
  }

  function selectQuoteWorkbenchOriginalFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    recognizeQuoteOriginalForWorkbench(file);
    event.target.value = "";
  }

  function dropQuoteOriginalToWorkbench(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsQuoteWorkbenchOriginalDragActive(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    recognizeQuoteOriginalForWorkbench(file);
  }

  function deleteQuote(id: string) {
    const targetQuote = quotes.find((quote) => quote.id === id);
    if (targetQuote?.objectUrl) URL.revokeObjectURL(targetQuote.objectUrl);
    const prevQuotes = quotes;
    setQuotes((current) => current.filter((quote) => quote.id !== id));
    setPreviewQuoteId((current) => (current === id ? null : current));
    setConfirmingQuoteDeleteId(null);
    setConfirmingQuoteContractId(null);
    if (customer.id && !id.startsWith("kim-")) {
      void apiDeleteQuote(customer.id, id).catch(() => { setQuotes(prevQuotes); onToast("삭제에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast("견적 항목을 삭제했습니다.");
  }

  function sendQuoteToApp(id: string) {
    const sentAt = formatKoreanShortTime();
    const prevQuotes = quotes;
    setQuotes((current) => current.map((quote) => (
      quote.id === id ? {
        ...quote,
        status: "고객 확인 전",
        appStatus: "sent",
        sentAt,
        meta: `${sentAt} · 앱 발송완료`,
      } : quote
    )));
    if (customer.id && !id.startsWith("kim-")) {
      void apiUpdateQuote(customer.id, id, { status: "고객 확인 전", appStatus: "sent" }).catch(() => { setQuotes(prevQuotes); onToast("발송 저장에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast(`김민준 고객 앱 견적함으로 발송했습니다. 대상: CU-2605-0020`);
  }

  function updateQuoteDecisionStatus(id: string, decisionStatus: KimQuoteItem["decisionStatus"]) {
    const prevQuotes = quotes;
    setQuotes((current) => current.map((quote) => (
      quote.id === id ? { ...quote, decisionStatus } : quote
    )));
    if (customer.id && !id.startsWith("kim-") && decisionStatus) {
      void apiUpdateQuote(customer.id, id, { decisionStatus }).catch(() => { setQuotes(prevQuotes); onToast("저장에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast(decisionStatus === "contracting" ? "계약 진행 견적으로 표시했습니다." : decisionStatus === "confirmed" ? "고객 확정 견적으로 표시했습니다." : decisionStatus === "considering" ? "최종 고민중 견적으로 표시했습니다." : "견적 확정 상태를 해제했습니다.");
  }

  function setPrimaryScenario(quoteId: string, scenarioId: string) {
    const prevQuotes = quotes;
    setQuotes((current) => current.map((quote) => {
      if (quote.id !== quoteId) return quote;
      const next = quote.scenarios?.find((s) => s.id === scenarioId) ?? null;
      return { ...quote, primaryScenarioId: scenarioId, ...flattenPrimaryScenario(next) };
    }));
    if (customer.id && !quoteId.startsWith("kim-")) {
      void apiUpdateQuote(customer.id, quoteId, { primaryScenarioId: scenarioId }).catch(() => { setQuotes(prevQuotes); onToast("대표 시나리오 저장에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast("대표 시나리오를 변경했습니다.");
  }

  async function addDocumentFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => {
      const lower = file.name.toLowerCase();
      return file.type.startsWith("image/") || file.type === "application/pdf" || lower.endsWith(".pdf");
    });
    if (files.length === 0) {
      onToast("이미지·PDF만 등록할 수 있습니다.");
      return;
    }
    setConfirmingDocumentDeleteId(null);
    markRecentUpdate("서류함");
    for (const file of files) {
      const tempId = `kim-document-${nowMs()}-${Math.round(file.size)}`;
      const docType = classifyKimDocumentFile(file.name);
      const objectUrl = URL.createObjectURL(file);
      const optimistic: KimDocumentItem = {
        id: tempId,
        title: docType,
        status: "자동인식",
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
        objectUrl,
        file,
      };
      setDocuments((current) => [...current, optimistic]);
      try {
        const saved = await uploadDocument(detail.id, file, docType);
        setDocuments((current) => current.map((d) => (d.id === tempId ? { ...d, id: saved.id, file: undefined } : d)));
      } catch {
        setDocuments((current) => current.filter((d) => d.id !== tempId));
        URL.revokeObjectURL(objectUrl);
        onToast(`${file.name} 업로드에 실패했습니다.`);
      }
    }
  }

  function addDocumentFilesFromInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addDocumentFiles(event.target.files);
    event.target.value = "";
  }

  function addDocumentFilesFromDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDocumentDragActive(false);
    addDocumentFiles(event.dataTransfer.files);
  }

  function updateDocumentType(id: string, title: string) {
    setDocuments((current) => current.map((documentItem) => (documentItem.id === id ? { ...documentItem, title, status: "수동분류" } : documentItem)));
    markRecentUpdate("서류함");
    if (!id.startsWith("kim-")) void updateDocumentTypeApi(detail.id, id, title).catch(() => onToast("분류 저장에 실패했습니다."));
  }

  function isDocumentFileDrag(event: ReactDragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function clearDocumentRowDrag() {
    setDraggedDocumentId(null);
    setDocumentDropTargetId(null);
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.classList.contains("kim-doc-drag-handle")) {
      activeElement.blur();
    }
  }

  function startDocumentRowDrag(event: ReactDragEvent<HTMLElement>, id: string) {
    setDraggedDocumentId(id);
    setDocumentDropTargetId(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-kim-document-id", id);
  }

  function moveDocumentToTarget(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const sourceIndex = documents.findIndex((documentItem) => documentItem.id === sourceId);
    const targetIndex = documents.findIndex((documentItem) => documentItem.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const nextDocuments = [...documents];
    const [target] = nextDocuments.splice(sourceIndex, 1);
    nextDocuments.splice(targetIndex, 0, target);
    setDocuments(nextDocuments);
    markRecentUpdate("서류함");
    // 서버 저장 항목만 추린 뒤 연속 index로 재채번(업로드 중 임시 항목을 제외한 자리로 sortOrder를 맞춘다).
    const order = nextDocuments.filter((documentItem) => !documentItem.id.startsWith("kim-")).map((documentItem, index) => ({ id: documentItem.id, sortOrder: index }));
    if (order.length > 0) void reorderDocumentsApi(detail.id, order).catch(() => onToast("순서 저장에 실패했습니다."));
  }

  function dragDocumentRowOver(event: ReactDragEvent<HTMLElement>, targetId: string) {
    if (!draggedDocumentId || draggedDocumentId === targetId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDocumentDropTargetId(targetId);
  }

  function dropDocumentRow(event: ReactDragEvent<HTMLElement>, targetId: string) {
    const sourceId = event.dataTransfer.getData("application/x-kim-document-id") || draggedDocumentId;
    if (!sourceId) return;
    event.preventDefault();
    event.stopPropagation();
    moveDocumentToTarget(sourceId, targetId);
    clearDocumentRowDrag();
  }

  function deleteDocument(id: string) {
    const targetDocument = documents.find((documentItem) => documentItem.id === id);
    if (targetDocument?.objectUrl) URL.revokeObjectURL(targetDocument.objectUrl);
    setDocuments((current) => current.filter((documentItem) => documentItem.id !== id));
    setPreviewDocumentId((current) => (current === id ? null : current));
    setConfirmingDocumentDeleteId(null);
    markRecentUpdate("서류함");
    onToast("서류 항목을 삭제했습니다.");
    if (!id.startsWith("kim-")) void deleteDocumentApi(detail.id, id).catch(() => onToast("삭제 저장에 실패했습니다."));
  }

  // 다운로드는 signed URL(또는 업로드 직후 objectUrl)을 blob으로 받아 같은 출처에서 내려받는다.
  // signed URL의 Content-Disposition은 supabase가 한글 파일명을 이중 인코딩해 깨지므로,
  // blob + a.download로 원본 파일명(한글 포함)을 그대로 보존한다.
  async function downloadKimDocument(url: string, fileName: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      onToast("다운로드에 실패했습니다.");
    }
  }

  // 서류함의 이미지/PDF를 표시 순서대로 하나의 PDF로 병합해 내려받는다(금융사에 한 번에 제출).
  // 소스 바이트: 업로드 직후(메모리 File) 우선, 없으면 저장본의 원본 signed URL(downloadUrl)을 fetch.
  async function downloadDocumentsMergedPdf() {
    if (isMergingDocuments) return;
    if (documents.length === 0) {
      onToast("내보낼 서류가 없습니다.");
      return;
    }
    setIsMergingDocuments(true);
    try {
      const sources: MergeSource[] = [];
      for (const documentItem of documents) {
        const kind = kimDocumentFileKind(documentItem.mimeType, documentItem.fileName);
        if (kind !== "이미지" && kind !== "PDF") continue;
        let blob: Blob | null = null;
        if (documentItem.file) {
          blob = documentItem.file;
        } else if (!documentItem.id.startsWith("kim-")) {
          try {
            const { downloadUrl } = await getDocumentUrlApi(detail.id, documentItem.id);
            const res = await fetch(downloadUrl);
            if (res.ok) blob = await res.blob();
          } catch {
            blob = null;
          }
        }
        if (blob) sources.push({ kind: kind === "PDF" ? "pdf" : "image", blob });
      }
      if (sources.length === 0) {
        onToast("병합할 수 있는 이미지·PDF 서류가 없습니다.");
        return;
      }
      // pdf-lib는 무겁다 — 병합 시점에만 동적 로드(초기 번들에서 분리).
      const { mergeDocumentsToPdf } = await import("@/lib/document-merge");
      const { bytes, merged, skipped } = await mergeDocumentsToPdf(sources);
      if (merged === 0) {
        onToast("서류 병합에 실패했습니다.");
        return;
      }
      const pdfBlob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(pdfBlob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "김민준-서류.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      markRecentUpdate("서류함");
      onToast(skipped > 0 ? `서류 ${merged}건을 PDF로 병합했습니다(${skipped}건 제외).` : `서류 ${merged}건을 하나의 PDF로 병합했습니다.`);
    } catch {
      onToast("서류 병합에 실패했습니다.");
    } finally {
      setIsMergingDocuments(false);
    }
  }

  function saveSchedule(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextSchedule = {
      id: `kim-schedule-${nowMs()}`,
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
    if (!customer.id) return;
    void addSchedule(customer.id, { scheduledDate: nextSchedule.date, scheduledTime: nextSchedule.time, type: nextSchedule.type, memo: nextSchedule.memo })
      .then((res) => setSchedules((current) => current.map((s) => (s.id === nextSchedule.id ? { ...s, id: res.id } : s))))
      .catch(() => { setSchedules((current) => current.filter((s) => s.id !== nextSchedule.id)); onToast("저장에 실패했습니다"); });
  }

  function updateSchedule(event: SyntheticEvent<HTMLFormElement>, id: string) {
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
    const prevSchedules = schedules;
    setSchedules((current) => current.map((item) => (
      item.id === id ? { ...item, date, time, type, memo } : item
    )));
    setEditingScheduleId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 수정했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void apiUpdateSchedule(customer.id, id, { scheduledDate: date, scheduledTime: time, type, memo }).catch(() => { setSchedules(prevSchedules); onToast("저장에 실패했습니다"); });
    }
  }

  function deleteSchedule(id: string) {
    const prevSchedules = schedules;
    const prevCompleted = completedScheduleKeys;
    setSchedules((current) => current.filter((item) => item.id !== id));
    setCompletedScheduleKeys((current) => current.filter((key) => key !== id));
    setEditingScheduleId((current) => (current === id ? null : current));
    setConfirmingScheduleDeleteId(null);
    markRecentUpdate("예정 일정");
    onToast("예정 일정을 삭제했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void apiDeleteSchedule(customer.id, id).catch(() => { setSchedules(prevSchedules); setCompletedScheduleKeys(prevCompleted); onToast("삭제에 실패했습니다"); });
    }
  }

  function saveCheckItem(event: SyntheticEvent<HTMLFormElement>) {
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
    const tempId = `kim-check-${Date.now()}`;
    setCheckItems((current) => [...current, { id: tempId, category, due, body }]);
    setAddingCheckItem(false);
    setSelectedCheckDue("오늘");
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일이 추가되었습니다.");
    if (!customer.id) return;
    void addTask(customer.id, { category, due, body })
      .then((res) => setCheckItems((current) => current.map((t) => (t.id === tempId ? { ...t, id: res.id } : t))))
      .catch(() => { setCheckItems((current) => current.filter((t) => t.id !== tempId)); onToast("저장에 실패했습니다"); });
  }

  function updateCheckItem(event: SyntheticEvent<HTMLFormElement>, id: string, currentDue: string) {
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
    const prevCheckItems = checkItems;
    setCheckItems((current) => current.map((item) => (
      item.id === id ? { ...item, category, due, body } : item
    )));
    cancelCheckItemEdit();
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 수정했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void updateTask(customer.id, id, { category, due, body }).catch(() => { setCheckItems(prevCheckItems); onToast("저장에 실패했습니다"); });
    }
  }

  function saveCustomerMemo(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    const tempId = `kim-customer-memo-${Date.now()}`;
    setCustomerMemos((current) => [...current, { id: tempId, body, createdAt: formatKoreanShortTime() }]);
    setAddingCustomerMemo(false);
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모가 추가되었습니다.");
    if (!customer.id) return;
    void addMemo(customer.id, { body })
      .then((res) => setCustomerMemos((current) => current.map((m) => (m.id === tempId ? { ...m, id: res.id, createdAt: formatActivity(res.createdAt) } : m))))
      .catch(() => { setCustomerMemos((current) => current.filter((m) => m.id !== tempId)); onToast("저장에 실패했습니다"); });
  }

  function updateCustomerMemo(event: SyntheticEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    const prevMemos = customerMemos;
    setCustomerMemos((current) => current.map((item) => (
      item.id === id ? { ...item, body } : item
    )));
    setEditingCustomerMemoId(null);
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 수정했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void updateMemo(customer.id, id, { body }).catch(() => { setCustomerMemos(prevMemos); onToast("저장에 실패했습니다"); });
    }
  }

  function deleteCustomerMemo(id: string) {
    const prevMemos = customerMemos;
    setCustomerMemos((current) => current.filter((item) => item.id !== id));
    setEditingCustomerMemoId((current) => (current === id ? null : current));
    setConfirmingCustomerMemoDeleteId(null);
    markRecentUpdate("고객 메모");
    onToast("고객 메모를 삭제했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void deleteMemo(customer.id, id).catch(() => { setCustomerMemos(prevMemos); onToast("삭제에 실패했습니다"); });
    }
  }

  function toggleScheduleComplete(item: KimScheduleItem) {
    const key = scheduleRecordKey(item);
    const nextDone = !completedScheduleKeys.includes(key);
    const prevCompleted = completedScheduleKeys;
    setCompletedScheduleKeys((current) => (
      current.includes(key) ? current.filter((completedKey) => completedKey !== key) : [...current, key]
    ));
    setConfirmingScheduleCompleteId(null);
    markRecentUpdate("예정 일정");
    if (customer.id && !item.id.startsWith("kim-")) {
      void apiUpdateSchedule(customer.id, item.id, { done: nextDone }).catch(() => { setCompletedScheduleKeys(prevCompleted); onToast("저장에 실패했습니다"); });
    }
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
    const nextDone = !completedCheckItems.includes(id);
    const prevCompleted = completedCheckItems;
    setCompletedCheckItems((current) => (
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]
    ));
    setConfirmingCheckItemTitle(null);
    markRecentUpdate("해야 할 일");
    if (customer.id && !id.startsWith("kim-")) {
      void updateTask(customer.id, id, { done: nextDone }).catch(() => { setCompletedCheckItems(prevCompleted); onToast("저장에 실패했습니다"); });
    }
  }

  function deleteCheckItem(id: string) {
    const prevCheckItems = checkItems;
    const prevCompleted = completedCheckItems;
    setCheckItems((current) => current.filter((item) => item.id !== id));
    setCompletedCheckItems((current) => current.filter((itemId) => itemId !== id));
    setEditingCheckItemId((current) => (current === id ? null : current));
    setConfirmingCheckItemTitle(null);
    setConfirmingCheckItemDeleteId(null);
    markRecentUpdate("해야 할 일");
    onToast("해야 할 일을 삭제했습니다.");
    if (customer.id && !id.startsWith("kim-")) {
      void deleteTask(customer.id, id).catch(() => { setCheckItems(prevCheckItems); setCompletedCheckItems(prevCompleted); onToast("삭제에 실패했습니다"); });
    }
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
          {CHANCE_OPTIONS.map((option) => {
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

  return (
    <div className="kim-customer-dashboard">
      <div className="kim-left-dashboard">
        <KimMinjunDetailHeader now={recentUpdateNow} recentUpdate={recentUpdate} name={detail.name} customerCode={detail.customerCode} receivedLabel={formatActivity(detail.receivedAt)} />
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
                {sortedCustomerMemos.map((item, index) => {
                  const shouldOpenDeletePopoverAbove = !addingCustomerMemo && index === sortedCustomerMemos.length - 1;

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
              {sortedCheckItems.map((item, index) => {
                const isCompleted = completedCheckItems.includes(item.id);
                const shouldOpenCheckConfirmAbove = !addingCheckItem && index === sortedCheckItems.length - 1;
                const shouldOpenCheckDeleteAbove = !addingCheckItem && index === sortedCheckItems.length - 1;
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
              {sortedSchedules.map((schedule, index) => {
                const isCompleted = completedScheduleKeys.includes(scheduleRecordKey(schedule));
                const isEditing = editingScheduleId === schedule.id;
                const shouldOpenScheduleCompleteAbove = !addingScheduleItem && index > 0 && index === sortedSchedules.length - 1;
                const shouldOpenScheduleDeleteAbove = !addingScheduleItem && index > 0 && index === sortedSchedules.length - 1;
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
          <div
            className={`kim-mvp-card-head kim-quote-drop-head${isQuoteHeaderDragActive ? " is-drop-active" : ""}`}
            onDragEnter={(event) => {
              if (!isDocumentFileDrag(event)) return;
              event.preventDefault();
              setIsQuoteHeaderDragActive(true);
            }}
            onDragLeave={(event) => {
              const nextTarget = event.relatedTarget;
              if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
              setIsQuoteHeaderDragActive(false);
            }}
            onDragOver={(event) => {
              if (!isDocumentFileDrag(event)) return;
              event.preventDefault();
            }}
            onDrop={dropQuoteOriginalToComposer}
          >
            <div className="kim-mvp-title-row">
              <i aria-hidden="true" className="kim-mvp-title-icon"><FileText size={14} strokeWidth={2.2} /></i>
              <h3>견적함</h3>
              <span>{quotes.length}개</span>
              <em>고객에게 나간 조건</em>
            </div>
            <div className="kim-quote-head-actions">
              <button
                aria-label="견적 작성"
                className="kim-mvp-add-circle kim-quote-head-action kim-quote-solution-entry"
                onClick={() => {
                  setConfirmingQuoteDeleteId(null);
                  setEditingQuoteId(null);
                  setRecognizedQuoteFile(null);
                  setQuoteComposerMode(null);
                  setSolutionWorkbenchPurchaseMethod(primaryKimQuotePurchaseMethod(purchaseFields));
                  setSolutionWorkbenchEntryMode("manual");
                  setSolutionWorkbenchModeMenu(null);
                  setIsQuoteSolutionWorkbenchOpen(true);
                }}
                type="button"
              ><FilePlus2 size={13} strokeWidth={2.35} /></button>
            </div>
            <div className="kim-file-drop-overlay kim-quote-head-drop-overlay" aria-hidden="true">
              <FileUp size={22} strokeWidth={1.9} />
              <strong>견적 원본의 값으로 새 견적을 작성합니다</strong>
              <span>이미지와 PDF를 인식해 작성창을 엽니다</span>
            </div>
          </div>
          <div className="kim-mvp-card-body" ref={quoteBodyRef}>
            <div className="kim-quote-list">
              {quotes.map((quote) => {
                return (
                <div
                  className={`kim-quote-row app-status-${quote.appStatus}${quoteDropTargetId === quote.id ? " is-file-drop-target" : ""}${openQuoteActionId === quote.id ? " is-action-open" : ""}`}
                  key={quote.id}
                  onDragEnter={(event) => {
                    if (!isDocumentFileDrag(event)) return;
                    event.preventDefault();
                    setQuoteDropTargetId(quote.id);
                  }}
                  onDragLeave={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                    if (quoteDropTargetId === quote.id) setQuoteDropTargetId(null);
                  }}
                  onDragOver={(event) => {
                    if (!isDocumentFileDrag(event)) return;
                    event.preventDefault();
                  }}
                  onDrop={(event) => dropQuoteFile(event, quote.id)}
                >
                  <span className="kim-quote-status-stack">
                    {quote.appStatus === "sent" || quote.appStatus === "viewed" ? (
                      <button
                        className={`kim-quote-status-detail ${quote.appStatus === "viewed" ? "send-viewed" : "send-sent"}${pinnedQuoteStatus?.id === quote.id ? " is-pinned" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          const nextFrame = calculateKimQuoteStatusTooltip(event.currentTarget, quote.id);
                          setPinnedQuoteStatus((current) => (current?.id === quote.id ? null : nextFrame));
                          setHoveredQuoteStatus(null);
                        }}
                        onMouseEnter={(event) => setHoveredQuoteStatus(calculateKimQuoteStatusTooltip(event.currentTarget, quote.id))}
                        onMouseLeave={() => setHoveredQuoteStatus(null)}
                        type="button"
                      >
                        {kimQuoteSourceIcon(quote.source)}
                        <i aria-hidden="true" />
                        <span>{kimQuoteAppStatusLabel(quote.appStatus, quote)}</span>
                      </button>
                    ) : (
                      <b className="send-draft">
                        {kimQuoteSourceIcon(quote.source)}
                        <i aria-hidden="true" />
                        <span>{kimQuoteAppStatusLabel(quote.appStatus, quote)}</span>
                      </b>
                    )}
                  </span>
                  <div className="kim-quote-row-main">
                    <div className="kim-quote-meta-primary">
                      {quote.brand ? <span>{quote.brand}</span> : null}
                      <strong>{quote.model || quote.vehicleName || quote.title}</strong>
                      {quote.trim ? <span>{quote.trim}</span> : null}
                      {quote.quoteRound ? <b>{quote.quoteRound}</b> : null}
                    </div>
                    <div className="kim-quote-meta-secondary">
                      {quote.financeType ? <span>{quote.financeType}</span> : null}
                      {quote.term ? <span>{quote.term}</span> : null}
                      {quote.monthlyPayment ? <strong>{quote.monthlyPayment}</strong> : <span>월 납입금 확인 전</span>}
                      {quote.lender ? <span>{quote.lender}</span> : null}
                      {quote.stockStatus ? <span className={`stock${kimQuoteStockClass(quote.stockStatus)}`}>{quote.stockStatus}</span> : null}
                      {quote.validLabel ? <span className={`valid${kimQuoteValidClass(quote.validLabel)}`}>{quote.validLabel}</span> : null}
                    </div>
                    {(quote.finalVehiclePrice != null || quote.exteriorColorName || quote.interiorColorName || quote.fileName) ? (
                      <div className="kim-quote-meta-pricing">
                        {quote.finalVehiclePrice != null ? <span className="kim-quote-final-price">최종 차량가 {formatMoney(quote.finalVehiclePrice)}</span> : null}
                        {quote.exteriorColorName ? (
                          <span className="kim-quote-color-chip">
                            {quote.exteriorColorHex ? <i aria-hidden="true" style={{ background: quote.exteriorColorHex }} /> : null}
                            외장 {quote.exteriorColorName}
                          </span>
                        ) : null}
                        {quote.interiorColorName ? (
                          <span className="kim-quote-color-chip">
                            {quote.interiorColorHex ? <i aria-hidden="true" style={{ background: quote.interiorColorHex }} /> : null}
                            내장 {quote.interiorColorName}
                          </span>
                        ) : null}
                        {quote.fileName ? (
                          <button type="button" className="kim-quote-attach-chip" onClick={() => setPreviewQuoteId(quote.id)} title={`견적 원본 보기 · ${quote.fileName}`}>
                            <Paperclip size={11} strokeWidth={2.5} />
                            <span>{quote.fileName}</span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {quote.note ? <p className="kim-quote-row-note">{quote.note}</p> : null}
                    {quote.scenarios && quote.scenarios.length >= 2 ? (
                      <div className="kim-quote-compare">
                        <button
                          type="button"
                          className={`kim-quote-compare-toggle${expandedQuoteId === quote.id ? " is-open" : ""}`}
                          aria-expanded={expandedQuoteId === quote.id}
                          onClick={() => setExpandedQuoteId((current) => (current === quote.id ? null : quote.id))}
                        >
                          비교 {quote.scenarios.length}
                          <ChevronDown size={12} strokeWidth={2.6} />
                        </button>
                        {expandedQuoteId === quote.id ? (
                          <ul className="kim-quote-scenario-cards">
                            {[...quote.scenarios]
                              .sort((a, b) => (a.scenarioNo ?? 0) - (b.scenarioNo ?? 0))
                              .map((scenario) => {
                                const isPrimary = (quote.primaryScenarioId ?? null) === scenario.id;
                                const monthly = formatMonthly(scenario.monthlyPayment);
                                const deposit = formatScenarioMoneyMode(scenario.depositMode, scenario.depositValue);
                                const downPayment = formatScenarioMoneyMode(scenario.downPaymentMode, scenario.downPaymentValue);
                                const residual = formatScenarioMoneyMode(scenario.residualMode, scenario.residualValue);
                                return (
                                  <li key={scenario.id} className={`kim-quote-scenario-card${isPrimary ? " is-primary" : ""}`}>
                                    <div className="kim-quote-scenario-head">
                                      <span className="kim-quote-scenario-no">{scenario.scenarioNo ?? "-"}</span>
                                      {scenario.lender ? <span className="kim-quote-scenario-lender">{scenario.lender}</span> : null}
                                      {isPrimary ? (
                                        <span className="kim-quote-scenario-star"><Star size={11} strokeWidth={2.6} />대표</span>
                                      ) : (
                                        <button type="button" className="kim-quote-scenario-pick" onClick={() => setPrimaryScenario(quote.id, scenario.id)}>대표로</button>
                                      )}
                                    </div>
                                    <div className="kim-quote-scenario-figures">
                                      {monthly ? <strong>{monthly}</strong> : <span>월 납입금 미정</span>}
                                      {deposit ? <span>보증금 {deposit}</span> : null}
                                      {downPayment ? <span>선수금 {downPayment}</span> : null}
                                      {residual ? <span>잔존 {residual}</span> : null}
                                      {scenario.mileageValue ? <span>약정 {scenario.mileageValue}</span> : null}
                                    </div>
                                  </li>
                                );
                              })}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="kim-quote-row-actions">
                    <div className="kim-quote-row-action-line">
                      {quote.originalNeedsReplacement ? (
                        <span className="kim-quote-replace-pill">수정견적으로 교체 필요</span>
                      ) : null}
                      {quote.decisionStatus && quote.decisionStatus !== "none" ? (
                        <span className={`kim-quote-decision-pill decision-${quote.decisionStatus}`}>{kimQuoteDecisionLabel(quote.decisionStatus)}</span>
                      ) : null}
                      <button
                        aria-label={`${quote.title} 견적 작업 열기`}
                        className={openQuoteActionId === quote.id ? "is-active" : undefined}
                        onClick={(event) => {
                          const nextFrame = calculateKimQuoteActionFrame(event.currentTarget);
                          setConfirmingQuoteDeleteId(null);
                          setConfirmingQuoteSendId(null);
                          setConfirmingQuoteContractId(null);
                          setConfirmingQuoteContractEditId(null);
                          setOpenQuoteActionId((current) => {
                            if (current === quote.id) {
                              setQuoteActionFrame(null);
                              return null;
                            }
                            setQuoteActionFrame(nextFrame);
                            return quote.id;
                          });
                        }}
                        type="button"
                      >
                        <MoreHorizontal size={14} strokeWidth={2.4} />
                      </button>
                    </div>
                  </div>
                  <div className="kim-file-drop-overlay" aria-hidden="true">
                    <FileUp size={28} strokeWidth={1.9} />
                    <strong>견적 원본 첨부</strong>
                    <span>해당 견적의 금융사 견적 원본을 첨부합니다</span>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </article>

        {activeQuoteStatusDetail && activeQuoteStatusTooltip ? (
          <div
            className="kim-quote-status-tooltip"
            style={{ left: activeQuoteStatusTooltip.left, top: activeQuoteStatusTooltip.top }}
          >
            <strong>{activeQuoteStatusDetail.time}</strong>
            <span>{activeQuoteStatusDetail.body}</span>
          </div>
        ) : null}

        {openQuoteAction && quoteActionFrame ? (
          <div
            className="kim-quote-action-popover"
            role="dialog"
            aria-label="견적 작업"
            style={{ left: quoteActionFrame.left, top: quoteActionFrame.top }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kim-quote-action-popover-head">
              <span>{openQuoteAction.quoteCode}</span>
              <b className={openQuoteAction.appStatus === "viewed" ? "is-viewed" : openQuoteAction.appStatus === "sent" ? "is-sent" : "is-draft"}>{kimQuoteAppSendLabel(openQuoteAction.appStatus, openQuoteAction)}</b>
            </div>
            <button type="button" onClick={() => {
              setConfirmingQuoteContractId(null);
              setConfirmingQuoteDeleteId(null);
              setConfirmingQuoteContractEditId(null);
              if (openQuoteAction.appStatus === "sent" || openQuoteAction.appStatus === "viewed") {
                setPreviewSentQuoteId(openQuoteAction.id);
                setOpenQuoteActionId(null);
                setQuoteActionFrame(null);
                setConfirmingQuoteSendId(null);
              } else {
                setConfirmingQuoteSendId((current) => (current === openQuoteAction.id ? null : openQuoteAction.id));
              }
            }}>
              {openQuoteAction.appStatus === "sent" || openQuoteAction.appStatus === "viewed" ? <Eye size={13} strokeWidth={2.3} /> : <Send size={13} strokeWidth={2.3} />}
              {openQuoteAction.appStatus === "sent" || openQuoteAction.appStatus === "viewed" ? "발송 견적 보기" : "앱 발송"}
            </button>
            {confirmingQuoteSendId === openQuoteAction.id ? (
              <div className="kim-quote-send-confirm" role="dialog" aria-label="견적 앱 발송 확인">
                <strong>앱 견적함으로 발송</strong>
                <p>김민준(CU-2605-0020) 고객에게 견적을 보내고 푸시알림을 발송합니다.</p>
                <div>
                  <button type="button" onClick={() => setConfirmingQuoteSendId(null)}>취소</button>
                  <button className="primary" type="button" onClick={() => {
                    sendQuoteToApp(openQuoteAction.id);
                    setOpenQuoteActionId(null);
                    setQuoteActionFrame(null);
                    setConfirmingQuoteSendId(null);
                  }}>발송</button>
                </div>
              </div>
            ) : null}
            <button type="button" onClick={() => {
              if (openQuoteAction.decisionStatus === "contracting") {
                setConfirmingQuoteSendId(null);
                setConfirmingQuoteDeleteId(null);
                setConfirmingQuoteContractId(null);
                setConfirmingQuoteContractEditId((current) => (current === openQuoteAction.id ? null : openQuoteAction.id));
                return;
              }
              setEditingQuoteId(openQuoteAction.id);
              setSelectedQuotePurchaseMethod(normalizeKimQuotePurchaseMethod(openQuoteAction.financeType));
              setQuoteEntryMode(openQuoteAction.source === "solution" ? "solution" : "manual");
              setQuoteComposerMode("edit");
              setOpenQuoteActionId(null);
              setQuoteActionFrame(null);
              setConfirmingQuoteSendId(null);
              setConfirmingQuoteDeleteId(null);
              setConfirmingQuoteContractId(null);
            }}>
              <PencilLine size={13} strokeWidth={2.3} />
              견적 수정
            </button>
            {confirmingQuoteContractEditId === openQuoteAction.id ? (
              <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="계약 진행 견적 수정 안내">
                <strong>계약 관리에서 수정</strong>
                <p>계약 진행 중인 견적은 계약 관리 창에서 수정할 수 있습니다.</p>
                <div>
                  <button type="button" onClick={() => setConfirmingQuoteContractEditId(null)}>확인</button>
                  <button className="primary" type="button" onClick={() => onToast("계약 관리 화면 연결 후 이동됩니다.")}>계약 관리로 이동</button>
                </div>
              </div>
            ) : null}
            {openQuoteAction.fileName ? (
              <button type="button" onClick={() => {
                setPreviewQuoteId(openQuoteAction.id);
                setOpenQuoteActionId(null);
                setQuoteActionFrame(null);
              }}>
                <Eye size={13} strokeWidth={2.3} />
                견적 원본 보기
              </button>
            ) : (
              <label>
                <Paperclip size={13} strokeWidth={2.4} />
                견적 원본 첨부
                <input accept="image/*,.pdf" onChange={(event) => {
                  attachQuoteFile(event, openQuoteAction.id);
                  setOpenQuoteActionId(null);
                  setQuoteActionFrame(null);
                }} type="file" />
              </label>
            )}
            <button className="is-group-start" type="button" onClick={() => {
              setConfirmingQuoteSendId(null);
              setConfirmingQuoteDeleteId(null);
              setConfirmingQuoteContractId(null);
              setConfirmingQuoteContractEditId(null);
              if (openQuoteAction.decisionStatus === "contracting") {
                setConfirmingQuoteContractDowngrade((current) => (current?.id === openQuoteAction.id && current.status === "considering" ? null : { id: openQuoteAction.id, status: "considering" }));
                return;
              }
              setConfirmingQuoteContractDowngrade(null);
              updateQuoteDecisionStatus(openQuoteAction.id, openQuoteAction.decisionStatus === "considering" ? "none" : "considering");
            }}>
              <MessageSquareText size={13} strokeWidth={2.2} />
              최종 고민중
              {openQuoteAction.decisionStatus === "considering" ? <Check className="kim-quote-action-state-check" size={13} strokeWidth={2.6} /> : null}
            </button>
            {confirmingQuoteContractDowngrade?.id === openQuoteAction.id && confirmingQuoteContractDowngrade.status === "considering" ? (
              <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="계약 진행 해제 확인">
                <strong>계약 진행 해제</strong>
                <p>고객 앱의 진행 중인 계약을 다시 견적함으로 이동하고, CRM 계약 관리 창 연결을 해제합니다. 푸시알림도 발송합니다.</p>
                <div>
                  <button type="button" onClick={() => setConfirmingQuoteContractDowngrade(null)}>취소</button>
                  <button className="primary" type="button" onClick={() => {
                    updateQuoteDecisionStatus(openQuoteAction.id, "considering");
                    setConfirmingQuoteContractDowngrade(null);
                  }}>확정</button>
                </div>
              </div>
            ) : null}
            <button type="button" onClick={() => {
              setConfirmingQuoteSendId(null);
              setConfirmingQuoteDeleteId(null);
              setConfirmingQuoteContractId(null);
              setConfirmingQuoteContractEditId(null);
              if (openQuoteAction.decisionStatus === "contracting") {
                setConfirmingQuoteContractDowngrade((current) => (current?.id === openQuoteAction.id && current.status === "confirmed" ? null : { id: openQuoteAction.id, status: "confirmed" }));
                return;
              }
              setConfirmingQuoteContractDowngrade(null);
              updateQuoteDecisionStatus(openQuoteAction.id, openQuoteAction.decisionStatus === "confirmed" ? "none" : "confirmed");
            }}>
              <UserRound size={13} strokeWidth={2.25} />
              고객 확정
              {openQuoteAction.decisionStatus === "confirmed" ? <Check className="kim-quote-action-state-check" size={13} strokeWidth={2.6} /> : null}
            </button>
            {confirmingQuoteContractDowngrade?.id === openQuoteAction.id && confirmingQuoteContractDowngrade.status === "confirmed" ? (
              <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="계약 진행 해제 확인">
                <strong>계약 진행 해제</strong>
                <p>고객 앱의 진행 중인 계약을 다시 견적함으로 이동하고, CRM 계약 관리 창 연결을 해제합니다. 푸시알림도 발송합니다.</p>
                <div>
                  <button type="button" onClick={() => setConfirmingQuoteContractDowngrade(null)}>취소</button>
                  <button className="primary" type="button" onClick={() => {
                    updateQuoteDecisionStatus(openQuoteAction.id, "confirmed");
                    setConfirmingQuoteContractDowngrade(null);
                  }}>확정</button>
                </div>
              </div>
            ) : null}
            <button type="button" onClick={() => {
              setConfirmingQuoteSendId(null);
              setConfirmingQuoteDeleteId(null);
              setConfirmingQuoteContractEditId(null);
              setConfirmingQuoteContractDowngrade(null);
              setConfirmingQuoteContractId((current) => (current === openQuoteAction.id ? null : openQuoteAction.id));
            }}>
              <BriefcaseBusiness size={13} strokeWidth={2.25} />
              계약 진행
              {openQuoteAction.decisionStatus === "contracting" ? <Check className="kim-quote-action-state-check" size={13} strokeWidth={2.6} /> : null}
            </button>
            {confirmingQuoteContractId === openQuoteAction.id ? (
              <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="최종 계약 진행 확인">
                <strong>{openQuoteAction.decisionStatus === "contracting" ? "계약 진행 해제" : "최종 계약 진행"}</strong>
                <p>{openQuoteAction.decisionStatus === "contracting" ? "고객 앱의 진행 중인 계약을 다시 견적함으로 이동하고, CRM 계약 관리 창 연결을 해제합니다. 푸시알림도 발송합니다." : "고객 앱의 해당 견적을 진행 중인 계약으로 이동하고, CRM에는 별도 계약 관리 창이 생성됩니다. 푸시알림도 발송합니다."}</p>
                <div>
                  <button type="button" onClick={() => setConfirmingQuoteContractId(null)}>취소</button>
                  <button className="primary" type="button" onClick={() => {
                    updateQuoteDecisionStatus(openQuoteAction.id, openQuoteAction.decisionStatus === "contracting" ? "none" : "contracting");
                    setConfirmingQuoteContractId(null);
                  }}>확정</button>
                </div>
              </div>
            ) : null}
            <button className="delete is-group-start" type="button" onClick={() => {
              setConfirmingQuoteSendId(null);
              setConfirmingQuoteContractId(null);
              setConfirmingQuoteContractEditId(null);
              setConfirmingQuoteContractDowngrade(null);
              setConfirmingQuoteDeleteId((current) => (current === openQuoteAction.id ? null : openQuoteAction.id));
            }}>
              <Trash2 size={13} strokeWidth={2.3} />
              삭제
            </button>
            {confirmingQuoteDeleteId === openQuoteAction.id ? (
              openQuoteAction.decisionStatus === "contracting" ? (
                <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="계약 진행 견적 삭제 안내">
                  <strong>계약 진행 견적 삭제 불가</strong>
                  <p>계약 진행 중인 견적은 삭제할 수 없습니다. 계약 관리 메뉴에서 견적 수정 또는 계약 취소를 진행해주세요.</p>
                  <div>
                    <button type="button" onClick={() => setConfirmingQuoteDeleteId(null)}>확인</button>
                    <button className="primary" type="button" onClick={() => onToast("계약 관리 화면 연결 후 이동됩니다.")}>계약 관리로 이동</button>
                  </div>
                </div>
              ) : (
                <div className="kim-quote-send-confirm kim-quote-delete-inline-confirm" role="dialog" aria-label="견적 항목 삭제 확인">
                  <strong>{kimQuoteDeleteConfirmTitle(openQuoteAction)}</strong>
                  <p>{kimQuoteDeleteConfirmMessage(openQuoteAction)}</p>
                  <div>
                    <button type="button" onClick={() => setConfirmingQuoteDeleteId(null)}>취소</button>
                    <button className="danger" type="button" onClick={() => {
                      deleteQuote(openQuoteAction.id);
                      setOpenQuoteActionId(null);
                      setQuoteActionFrame(null);
                    }}>삭제</button>
                  </div>
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {quoteComposerMode ? (
          <div className="kim-quote-modal-backdrop" role="presentation">
            <form className="kim-quote-modal kim-quote-builder-modal" key={`${quoteComposerMode === "edit" ? editingQuote?.id ?? "edit" : "builder"}-${recognizedQuoteFile?.fileName ?? "no-original"}-${selectedQuotePurchaseMethod}`} onSubmit={saveQuote} role="dialog" aria-modal="true" aria-label={quoteComposerMode === "edit" ? "견적 수정" : "견적 작성"}>
              <div className="kim-quote-modal-head">
                <div>
                  <span>{quoteComposerMode === "edit" ? `${editingQuote?.quoteCode ?? "QT"} · 수정 후 고객 앱 재발송` : "차량 DB · 솔루션 조회 · 수기 작성"}</span>
                  <strong>{quoteComposerMode === "edit" ? "견적 수정" : "견적 작성"}</strong>
                  <p>{quoteComposerMode === "edit" ? "기존 조건을 수정하고 고객 앱 견적함으로 다시 발송합니다." : "차량을 고르고, 솔루션 조회 또는 수기 작성으로 견적 조건을 완성합니다."}</p>
                </div>
                <button aria-label={quoteComposerMode === "edit" ? "견적 수정 닫기" : "견적 작성 닫기"} type="button" onClick={() => {
                  setQuoteComposerMode(null);
                  setEditingQuoteId(null);
                  setRecognizedQuoteFile(null);
                }}><X size={18} strokeWidth={2.4} /></button>
              </div>
              <input name="source" type="hidden" value={quoteEntryMode === "original" ? "원본 인식" : quoteEntryMode === "solution" && quoteSolutionAvailable ? "견적 조회" : "수기 작성"} />
              <input name="status" type="hidden" value={quoteComposerMode === "edit" ? "고객 확인 전" : "작성중"} />
              <input name="financeType" type="hidden" value={selectedQuotePurchaseMethod} />

              <div className="kim-quote-builder-shell">
                <section className="kim-quote-builder-vehicle">
                  <div className="kim-quote-builder-section-head">
                    <span><CarFront size={13} strokeWidth={2.3} /> 차량 선택</span>
                    <button type="button" onClick={() => onToast("차량 DB 선택 모달 연결 예정입니다.")}>DB에서 선택</button>
                  </div>
                  <div className="kim-quote-vehicle-picks">
                    <label><span>브랜드</span><input autoFocus defaultValue={quoteComposerMode === "edit" ? editingQuote?.brand ?? "" : recognizedQuoteFile ? "BMW" : "벤츠"} name="brand" placeholder="벤츠" /></label>
                    <label><span>모델</span><input defaultValue={quoteComposerMode === "edit" ? editingQuote?.model ?? "" : recognizedQuoteFile ? "X7" : "Maybach S-Class"} name="model" placeholder="Maybach S-Class" /></label>
                    <label><span>트림</span><input defaultValue={quoteComposerMode === "edit" ? editingQuote?.trim ?? editingQuote?.vehicleName ?? "" : recognizedQuoteFile ? "X7 xDrive 40i M Spt LCI (7인승)" : "S 500 4M Long"} name="trim" placeholder="S 500 4M Long" /></label>
                    <label><span>차수</span><select defaultValue={quoteComposerMode === "edit" ? editingQuote?.quoteRound ?? "1차" : "1차"} name="quoteRound"><option>1차</option><option>2차</option><option>3차</option><option>비교</option><option>최종</option></select></label>
                  </div>
                  <div className="kim-quote-db-preview" aria-label="차량 DB 선택 예시">
                    <button type="button"><b>{recognizedQuoteFile ? "BMW" : "벤츠"}</b><span>수입차</span></button>
                    <button type="button"><b>{recognizedQuoteFile ? "X7" : "Maybach S-Class"}</b><span>{recognizedQuoteFile ? "대형 SUV · 1억대" : "대형 세단 · 2억대"}</span></button>
                    <button type="button"><b>{recognizedQuoteFile ? "X7 xDrive 40i M Spt LCI" : "S 500 4M Long"}</b><span>2026 · 가솔린 · 4WD</span></button>
                  </div>
                </section>

                <section className="kim-quote-builder-method">
                  <div className="kim-quote-builder-section-head">
                    <span><Route size={13} strokeWidth={2.3} /> 구매방식</span>
                    <em>{quoteSolutionAvailable ? "솔루션 조회 가능" : "수기 작성 방식"}</em>
                  </div>
                  <div className="kim-quote-method-tabs" aria-label="구매 방식">
                    {kimQuotePurchaseMethodOptions.map((option) => (
                      <button
                        aria-pressed={selectedQuotePurchaseMethod === option}
                        key={option}
                        onClick={() => {
                          setSelectedQuotePurchaseMethod(option);
                          if (option === "운용리스" || option === "장기렌트") setQuoteEntryMode("solution");
                          else setQuoteEntryMode("manual");
                        }}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <div className="kim-quote-entry-switch" aria-label="견적 작성 방식">
                    <button aria-pressed={quoteEntryMode === "solution"} disabled={!quoteSolutionAvailable} onClick={() => setQuoteEntryMode("solution")} type="button"><Calculator size={13} strokeWidth={2.3} /> 솔루션 조회</button>
                    <button aria-pressed={quoteEntryMode === "original"} disabled={!quoteSolutionAvailable} onClick={() => setQuoteEntryMode("original")} type="button"><FileText size={13} strokeWidth={2.3} /> 원본 인식</button>
                    <button aria-pressed={quoteEntryMode === "manual" || !quoteSolutionAvailable} onClick={() => setQuoteEntryMode("manual")} type="button"><PencilLine size={13} strokeWidth={2.3} /> 수기 작성</button>
                  </div>
                </section>

                <section
                  className={`kim-quote-original-dropzone${isQuoteModalDragActive ? " is-drop-active" : ""}${recognizedQuoteFile ? " has-file" : ""}`}
                  onDragEnter={(event) => {
                    if (!isDocumentFileDrag(event)) return;
                    event.preventDefault();
                    setIsQuoteModalDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                    setIsQuoteModalDragActive(false);
                  }}
                  onDragOver={(event) => {
                    if (!isDocumentFileDrag(event)) return;
                    event.preventDefault();
                  }}
                  onDrop={dropQuoteOriginalToComposer}
                >
                  <div>
                    <FileUp size={16} strokeWidth={2.35} />
                    <strong>{recognizedQuoteFile ? "원본 견적서 인식 완료" : "원본 견적서 인식"}</strong>
                    <p>{recognizedQuoteFile ? `${recognizedQuoteFile.fileName} · 금융사/월납입/잔존가치/총비용을 임시 인식했습니다.` : "이미지 또는 PDF를 드롭하면 운용리스/장기렌트 견적 작성값을 자동으로 채웁니다."}</p>
                  </div>
                  <label>
                    파일 선택
                    <input accept="image/*,.pdf" onChange={selectQuoteOriginalFile} type="file" />
                  </label>
                </section>

                {quoteSolutionAvailable && quoteEntryMode !== "original" ? (
                  <section className={`kim-quote-solution-workbench${quoteEntryMode === "solution" ? " is-active" : ""}`}>
                    <div className="kim-quote-builder-section-head">
                      <span><Sparkles size={13} strokeWidth={2.4} /> 솔루션 결과</span>
                      <button type="button" onClick={() => onToast("제프 견적 솔루션 API 연결 후 실제 조건 조회가 실행됩니다.")}>조건 조회</button>
                    </div>
                    <div className="kim-quote-solution-results">
                      <button className="is-selected" type="button">
                        <span>추천</span>
                        <strong>iM캐피탈</strong>
                        <b>{selectedQuotePurchaseMethod === "장기렌트" ? "월 1,642,190원" : "월 2,473,200원"}</b>
                        <em>{selectedQuotePurchaseMethod} · 60개월 · 재고있음 · D-6</em>
                      </button>
                      <button type="button">
                        <span>최저 월납</span>
                        <strong>우리금융캐피탈</strong>
                        <b>{selectedQuotePurchaseMethod === "장기렌트" ? "월 1,598,000원" : "월 2,398,000원"}</b>
                        <em>보증금 30% · 심사 조건 확인</em>
                      </button>
                      <button type="button">
                        <span>빠른 출고</span>
                        <strong>하나캐피탈</strong>
                        <b>{selectedQuotePurchaseMethod === "장기렌트" ? "월 1,688,400원" : "월 2,512,000원"}</b>
                        <em>즉시 출고 가능 · 할인 재확인</em>
                      </button>
                    </div>
                  </section>
                ) : null}

                <section className="kim-quote-builder-fields">
                  <div className="kim-quote-builder-section-head">
                    <span>{quoteEntryMode === "original" ? "원본 인식값 보정" : quoteEntryMode === "solution" && quoteSolutionAvailable ? "선택 결과 보정" : "수기 작성"}</span>
                    <em>{quoteEntryMode === "original" ? "OCR 인식값을 상담사가 확인합니다" : quoteEntryMode === "solution" && quoteSolutionAvailable ? "조회값을 상담사가 수정할 수 있습니다" : "외부 견적/전화 조건을 정리합니다"}</em>
                  </div>
                  <div className="kim-quote-manual-grid">
                    <label className="wide"><span>견적 제목</span><input defaultValue={quoteComposerMode === "edit" ? editingQuote?.title ?? "" : ""} name="title" placeholder="비워두면 차량/방식/차수 기준으로 자동 생성" /></label>
                    <label><span>금융사</span><input defaultValue={quoteComposerMode === "edit" ? editingQuote?.lender ?? "" : recognizedQuoteFile ? "산은캐피탈" : quoteEntryMode === "solution" && quoteSolutionAvailable ? "iM캐피탈" : "iM캐피탈"} name="financeCompany" placeholder="iM캐피탈" /></label>
                    <label key={`${selectedQuotePurchaseMethod}-term`}><span>{quoteManualFieldConfig.periodLabel}</span><select defaultValue={quoteComposerMode === "edit" ? editingQuote?.term ?? quoteManualFieldConfig.periodDefault : quoteManualFieldConfig.periodDefault} name="term"><option>36개월</option><option>48개월</option><option>60개월</option><option>일시불</option><option>조건 미정</option></select></label>
                    <label key={`${selectedQuotePurchaseMethod}-payment`}><span>{quoteManualFieldConfig.paymentLabel}</span><input defaultValue={quoteComposerMode === "edit" ? editingQuote?.monthlyPayment ?? "" : recognizedQuoteFile ? "월 2,398,000원" : quoteManualFieldConfig.paymentDefault} name="monthlyPayment" placeholder={quoteManualFieldConfig.paymentDefault} /></label>
                    <label><span>재고 상태</span><select defaultValue={quoteComposerMode === "edit" ? editingQuote?.stockStatus ?? "재고확인중" : "재고있음"} name="stockStatus"><option>재고있음</option><option>재고확인중</option><option>재고없음</option></select></label>
                    <label><span>유효기간</span><input defaultValue={quoteComposerMode === "edit" ? editingQuote?.validLabel ?? "" : "D-6"} name="validLabel" placeholder="D-6 · D-1 · 만료됨" /></label>
                    <label key={`${selectedQuotePurchaseMethod}-rate`}><span>{quoteManualFieldConfig.rateLabel}</span><input defaultValue={recognizedQuoteFile ? "5.22%" : ""} name="interestRate" placeholder={quoteManualFieldConfig.ratePlaceholder} /></label>
                    <label key={`${selectedQuotePurchaseMethod}-residual`}><span>{quoteManualFieldConfig.residualLabel}</span><input defaultValue={recognizedQuoteFile ? "71,853,240원" : ""} name="residualValue" placeholder={quoteManualFieldConfig.residualPlaceholder} /></label>
                    <label key={`${selectedQuotePurchaseMethod}-prepayment`}><span>{quoteManualFieldConfig.prepaymentLabel}</span><input name="prepayment" placeholder="0원" /></label>
                    <label key={`${selectedQuotePurchaseMethod}-deposit`}><span>{quoteManualFieldConfig.depositLabel}</span><input name="deposit" placeholder={selectedQuotePurchaseMethod === "할부" ? "총 이자" : selectedQuotePurchaseMethod === "일시불" ? "옵션가" : "30%"} /></label>
                    <label key={`${selectedQuotePurchaseMethod}-total`}><span>{quoteManualFieldConfig.totalLabel}</span><input defaultValue={recognizedQuoteFile ? "167,652,170원" : ""} name="totalCost" placeholder={selectedQuotePurchaseMethod === "일시불" ? "154,480,000원" : "167,652,170원"} /></label>
                    <label className="wide"><span>짧은 메모</span><input defaultValue={quoteComposerMode === "edit" ? editingQuote?.note ?? "수정 견적 재발송" : recognizedQuoteFile ? "원본 견적서 OCR 인식값, 상담사 확인 필요" : quoteEntryMode === "solution" && quoteSolutionAvailable ? "솔루션 추천 조건, 상담 후 보정 가능" : "보증금 30% 기준, 할인 조건 재확인 필요"} name="meta" maxLength={42} placeholder="견적 row에 표시할 짧은 메모" /></label>
                  </div>
                </section>
              </div>

              <div className="kim-quote-modal-actions">
                <button type="button" onClick={() => {
                  setQuoteComposerMode(null);
                  setEditingQuoteId(null);
                  setRecognizedQuoteFile(null);
                }}>취소</button>
                {quoteSolutionAvailable ? <button type="button" onClick={() => onToast("제프 견적 솔루션 API 연결 후 실제 조건 조회가 실행됩니다.")}>솔루션 조회</button> : null}
                <button className="primary" type="submit">{quoteComposerMode === "edit" ? "수정 후 발송" : "견적함에 저장"}</button>
              </div>
            </form>
          </div>
        ) : null}
        {isQuoteSolutionWorkbenchOpen ? (
          <div className="kim-quote-modal-backdrop kim-quote-workbench-backdrop" onClick={() => setIsQuoteSolutionWorkbenchOpen(false)} role="presentation">
            <div
              className="kim-quote-modal kim-quote-solution-modal"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                if (solutionWorkbenchModeMenu && target.closest(`[data-workbench-mode="${solutionWorkbenchModeMenu}"]`)) return;
                setSolutionWorkbenchModeMenu(null);
              }}
              role="dialog"
              aria-modal="true"
              aria-label="솔루션 견적 워크벤치"
            >
              <div
                className={`kim-quote-modal-head kim-quote-workbench-head${solutionWorkbenchEntryMode === "original" ? " is-original-input" : ""}${isQuoteWorkbenchOriginalDragActive ? " is-original-drop-active" : ""}${recognizedQuoteFile ? " has-original-file" : ""}`}
                onDragEnter={(event) => {
                  if (!isDocumentFileDrag(event)) return;
                  event.preventDefault();
                  setIsQuoteWorkbenchOriginalDragActive(true);
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                  setIsQuoteWorkbenchOriginalDragActive(false);
                }}
                onDragOver={(event) => {
                  if (!isDocumentFileDrag(event)) return;
                  event.preventDefault();
                  setIsQuoteWorkbenchOriginalDragActive(true);
                }}
                onDrop={dropQuoteOriginalToWorkbench}
              >
                <input
                  accept="image/*,application/pdf"
                  aria-label="원본 견적서 첨부"
                  className="kim-quote-workbench-original-input"
                  onChange={selectQuoteWorkbenchOriginalFile}
                  ref={quoteWorkbenchOriginalInputRef}
                  type="file"
                />
                <div className="kim-quote-workbench-head-copy">
                  <h2>
                    <span>고객 관리</span>
                    <ChevronRight size={18} strokeWidth={2.4} />
                    <span>김민준</span>
                    <em className="num">CU-2605-0020</em>
                    <ChevronRight size={18} strokeWidth={2.4} />
                    <strong>새 견적 작성</strong>
                  </h2>
                  <p><span>최근 견적 {quotes.length}개</span><i aria-hidden="true" /><mark>Maybach S 500 · {solutionWorkbenchPurchaseMethod} 60개월</mark><span>견적 작성 필요</span></p>
                </div>
                <div className="kim-quote-workbench-head-tools" aria-label="견적 작성 모드">
                  <div className="kim-quote-workbench-mode-select" data-workbench-mode="purchase">
                    <span>구매방식</span>
                    <div className="kim-quote-workbench-mode-control">
                      <button
                        aria-expanded={solutionWorkbenchModeMenu === "purchase"}
                        aria-haspopup="menu"
                        onClick={() => setSolutionWorkbenchModeMenu((current) => (current === "purchase" ? null : "purchase"))}
                        type="button"
                      >
                        {solutionWorkbenchPurchaseMethod}
                        <ChevronDown size={14} strokeWidth={2.3} />
                      </button>
                      {solutionWorkbenchModeMenu === "purchase" ? (
                        <div className="kim-quote-workbench-mode-menu" role="menu">
                          {kimQuotePurchaseMethodOptions.filter((option) => option !== solutionWorkbenchPurchaseMethod).map((option) => (
                            <button
                              key={option}
                              onClick={() => {
                                setSolutionWorkbenchPurchaseMethod(option);
                                markQuoteDraftChanged();
                                if (option !== "운용리스" && option !== "장기렌트" && solutionWorkbenchEntryMode === "solution") {
                                  setSolutionWorkbenchEntryMode("manual");
                                }
                                setSolutionWorkbenchModeMenu(null);
                              }}
                              role="menuitem"
                              type="button"
                            >
                              <span>{option}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="kim-quote-workbench-mode-select" data-workbench-mode="entry">
                    <span>작성방식</span>
                    <div className="kim-quote-workbench-mode-control">
                      <button
                        aria-expanded={solutionWorkbenchModeMenu === "entry"}
                        aria-haspopup="menu"
                        onClick={() => setSolutionWorkbenchModeMenu((current) => (current === "entry" ? null : "entry"))}
                        type="button"
                      >
                        {solutionWorkbenchEntryMode === "solution" ? "솔루션 조회" : solutionWorkbenchEntryMode === "original" ? "원본 인식" : "수기 작성"}
                        <ChevronDown size={14} strokeWidth={2.3} />
                      </button>
                      {solutionWorkbenchModeMenu === "entry" ? (
                        <div className="kim-quote-workbench-mode-menu narrow" role="menu">
                          {[
                            { key: "manual" as const, label: "수기 작성", disabled: false },
                            { key: "solution" as const, label: "솔루션 조회", disabled: !solutionWorkbenchCanQuery },
                            { key: "original" as const, label: "원본 인식", disabled: false },
                          ].filter((option) => option.key !== solutionWorkbenchEntryMode).map((option) => (
                            <button
                              disabled={option.disabled}
                              key={option.key}
                              onClick={() => {
                                if (option.disabled) return;
                                setSolutionWorkbenchEntryMode(option.key);
                                markQuoteDraftChanged();
                                if (option.key === "original") {
                                  window.requestAnimationFrame(() => quoteWorkbenchOriginalInputRef.current?.click());
                                }
                                setSolutionWorkbenchModeMenu(null);
                              }}
                              role="menuitem"
                              type="button"
                            >
                              <span>{option.label}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="kim-quote-workbench-actions" aria-label="견적 실행">
                    <div className="kim-quote-workbench-action-group">
                      <button
                        className="kim-quote-workbench-action ghost"
                        onClick={resetQuoteWorkbench}
                        type="button"
                      >
                        <RotateCcw size={13} strokeWidth={2.2} />
                        초기화
                      </button>
                      <button
                        className={`kim-quote-workbench-action complete${isQuoteDraftSaved && !isQuoteDraftDirty ? " is-saved" : ""}`}
                        onClick={saveQuoteDetailDraft}
                        type="button"
                      >
                        <Check size={13} strokeWidth={2.35} />
                        작성완료
                      </button>
                    </div>
                    <div className="kim-quote-workbench-action-group output">
                      <button
                        className="kim-quote-workbench-action muted"
                        onClick={() => onToast("financial-dolim-solution 연결 전 임시 워크벤치입니다.")}
                        type="button"
                      >
                        <Calculator size={13} strokeWidth={2.2} />
                        솔루션조회
                      </button>
                      <button
                        className={`kim-quote-workbench-action muted quote-doc${quoteDraftReady ? " is-ready-blue" : " is-disabled"}`}
                        onClick={() => {
                          if (!guardQuoteDraftOutput("견적서 보기")) return;
                          onToast("견적서 보기 화면은 다음 단계에서 연결합니다.");
                        }}
                        type="button"
                      >
                        <FileText size={13} strokeWidth={2.2} />
                        견적서보기
                      </button>
                      <button
                        className={`kim-quote-workbench-action muted app-card${quoteDraftReady ? " is-ready-green" : " is-disabled"}`}
                        onClick={() => {
                          if (!guardQuoteDraftOutput("앱카드 보기")) return;
                          setIsQuoteAppCardPreviewOpen(true);
                        }}
                        type="button"
                      >
                        <Smartphone size={13} strokeWidth={2.2} />
                        앱카드보기
                      </button>
                      <button
                        className={`kim-quote-workbench-action primary${quoteDraftReady ? "" : " is-disabled"}`}
                        onClick={saveQuoteFromWorkbench}
                        type="button"
                      >
                        <FilePlus2 size={13} strokeWidth={2.2} />
                        견적함에 저장
                      </button>
                    </div>
                  </div>
                </div>
                <div className="kim-file-drop-overlay kim-quote-workbench-drop-overlay" aria-hidden="true">
                  <FileUp size={22} strokeWidth={1.9} />
                  <strong>원본 견적서 인식</strong>
                  <span>첨부한 견적서의 값으로 자동 입력합니다</span>
                </div>
              </div>
              <div
                className="kim-quote-solution-shell kim-jeff-quote-body"
                onBeforeInput={handleJeffMoneyInputBeforeInput}
                onBlur={handleJeffMoneyInputBlur}
                onChange={handleJeffMoneyInputChange}
                onFocus={handleJeffMoneyInputFocus}
                onKeyDown={handleJeffMoneyInputKeyDown}
                onMouseDown={handleJeffMoneyInputMouseDown}
                onMouseUp={handleJeffMoneyInputMouseUp}
                onPaste={handleJeffMoneyInputPaste}
              >
                <section className="kim-jeff-top-panel" ref={pricingPanelRef} onInput={handlePricingPanelInput}>
                  <div className="kim-jeff-top-grid">
                    <div className="kim-jeff-section">
                      <h4>🚘 차량 선택</h4>
                      <VehiclePicker onChange={(selection) => { void applyTrimToPricing(selection); }} />
                    </div>
                    <div className="kim-jeff-section">
                      <h4>🎨 옵션 / 컬러</h4>
                      <OptionPicker key={trimDetail?.id ?? "none"} options={trimDetail?.options ?? []} relations={trimDetail?.optionRelations ?? []} onChange={applyOptionTotal} />
                      <ColorPicker colorType="exterior" colors={trimDetail?.colors ?? []} value={exteriorColor} onChange={(c) => { setExteriorColor(c); markQuoteDraftChanged(); }} />
                      <ColorPicker colorType="interior" colors={trimDetail?.colors ?? []} value={interiorColor} onChange={(c) => { setInteriorColor(c); markQuoteDraftChanged(); }} />
                    </div>
                    <div className="kim-jeff-section">
                      <h4>💰 할인</h4>
                      <div className="kim-jeff-form-row kim-jeff-discount-row">
                        <span>기본 할인</span>
                        <span className="kim-jeff-discount-label-placeholder" aria-hidden="true" />
                        <div className="kim-jeff-segment">
                          <button className={primaryDiscountUnit === "amount" ? "active" : ""} onClick={() => setPrimaryDiscountMode("amount")} type="button">금액</button>
                          <button className={primaryDiscountUnit === "percent" ? "active" : ""} onClick={() => setPrimaryDiscountMode("percent")} type="button">%</button>
                        </div>
                        <div className="kim-jeff-money-input"><input data-discount-line="true" data-discount-primary="true" data-discount-unit={primaryDiscountUnit} defaultValue={formatMoney(kimMaybachQuotePricingMock.discount)} /><em>{primaryDiscountUnit === "percent" ? "%" : "원"}</em></div>
                        <button className="kim-jeff-discount-add" aria-label="할인 항목 추가" onClick={addDiscountLine} type="button">+</button>
                      </div>
                      {discountLines.map((line) => (
                        <div className="kim-jeff-form-row kim-jeff-discount-row" key={line.id}>
                          <span>추가 할인</span>
                          <select className="kim-jeff-discount-label" aria-label="할인 항목명" defaultValue={line.label}>
                            {kimDiscountLabelOptions.map((option) => <option key={option}>{option}</option>)}
                          </select>
                          <div className="kim-jeff-segment">
                            <button className={line.unit === "amount" ? "active" : ""} onClick={() => setDiscountLineMode(line.id, "amount")} type="button">금액</button>
                            <button className={line.unit === "percent" ? "active" : ""} onClick={() => setDiscountLineMode(line.id, "percent")} type="button">%</button>
                          </div>
                          <div className="kim-jeff-money-input"><input data-discount-id={line.id} data-discount-line="true" data-discount-unit={line.unit} defaultValue={line.amount} /><em>{line.unit === "percent" ? "%" : "원"}</em></div>
                          <button className="kim-jeff-discount-remove" aria-label="할인 항목 삭제" onClick={() => removeDiscountLine(line.id)} type="button"><Trash2 size={13} strokeWidth={2.1} /></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="kim-jeff-price-grid">
                    <div className="kim-jeff-price-cell"><strong>기본 가격</strong><div className="kim-jeff-money-input"><input data-pricing="base" defaultValue={formatMoney(kimMaybachQuotePricingMock.basePrice)} /><em>원</em></div></div>
                    <div className="kim-jeff-price-cell"><strong>(+) 옵션 금액</strong><div className="kim-jeff-money-input"><input data-pricing="option" defaultValue={formatMoney(kimMaybachQuotePricingMock.optionPrice)} /><em>원</em></div></div>
                    <div className="kim-jeff-price-cell"><strong>(-) 최종 할인</strong><div className="kim-jeff-money-input"><input data-pricing="discount" defaultValue={formatMoney(kimMaybachQuotePricingMock.discount)} /><em>원</em></div></div>
                  </div>

                  <div className="kim-jeff-cost-grid">
                    <div className="kim-jeff-section kim-jeff-cost-section">
                      <h4>⚙️ 취득원가 설정</h4>
                      <div className="kim-jeff-form-row kim-jeff-acquisition-tax-row">
                        <span>취득세</span>
                        <div className="kim-jeff-segment">
                          <button className={acquisitionTaxMode === "normal" ? "active" : ""} onClick={() => setAcquisitionTaxMode("normal")} type="button">일반</button>
                          <button className={acquisitionTaxMode === "hybrid" ? "active" : ""} onClick={() => setAcquisitionTaxMode("hybrid")} type="button">하이브리드 감면</button>
                          <button className={acquisitionTaxMode === "electric" ? "active" : ""} onClick={() => setAcquisitionTaxMode("electric")} type="button">전기차 감면</button>
                          <button className={acquisitionTaxMode === "manual" ? "active" : ""} onClick={() => setAcquisitionTaxMode("manual")} type="button">직접 입력</button>
                        </div>
                        <div className="kim-jeff-money-input"><input data-pricing="acquisitionTax" defaultValue={formatMoney(kimMaybachQuotePricingMock.acquisitionTax)} readOnly={acquisitionTaxMode !== "manual"} /><em>원</em></div>
                      </div>
                      <div className="kim-jeff-form-row kim-jeff-cost-toggle-row"><span>공채</span><div className="kim-jeff-segment"><button className="active" type="button">포함</button><button type="button">불포함</button></div><div className="kim-jeff-money-input"><input data-pricing="bond" defaultValue={formatMoney(kimMaybachQuotePricingMock.bond)} /><em>원</em></div></div>
                      <div className="kim-jeff-form-row kim-jeff-cost-toggle-row"><span>탁송료</span><div className="kim-jeff-segment"><button type="button">포함</button><button className="active" type="button">불포함</button></div><div className="kim-jeff-money-input"><input data-pricing="delivery" defaultValue={formatMoney(kimMaybachQuotePricingMock.delivery)} /><em>원</em></div></div>
                      <div className="kim-jeff-form-row kim-jeff-cost-toggle-row"><span>부대비용</span><div className="kim-jeff-segment"><button type="button">포함</button><button className="active" type="button">불포함</button></div><div className="kim-jeff-money-input"><input data-pricing="incidental" defaultValue={formatMoney(kimMaybachQuotePricingMock.incidental)} /><em>원</em></div></div>
                    </div>
                    <div className="kim-jeff-section kim-jeff-summary-section">
                      <h4>📋 최종 가격</h4>
                      <div className="kim-jeff-summary-row"><span>최종 차량가(계산서 발행금액)</span><b><span>{formatMoney(pricing.finalVehiclePrice)}</span><em>원</em></b></div>
                      <div className="kim-jeff-summary-row"><span>등록비용(취득원가 포함)</span><b><span>{formatMoney(pricing.registrationCost)}</span><em>원</em></b></div>
                      <div className="kim-jeff-summary-row no-divider"><span>기타비용(취득원가 불포함, 고객 부담)</span><b><span>{formatMoney(pricing.otherCost)}</span><em>원</em></b></div>
                      <div className="kim-jeff-summary-row emphasized"><span>취득원가</span><b><span>{formatMoney(pricing.acquisitionCost)}</span><em>원</em></b></div>
                    </div>
                  </div>
                </section>

                <section className="kim-app-quote-builder" aria-label="앱 견적카드 수기 작성">
                  <div
                    className="kim-app-quote-form"
                    key="quote-detail-manual-v2"
                    onChange={markQuoteDraftChanged}
                    onInput={markQuoteDraftChanged}
                    ref={quoteDetailFormRef}
                  >
                    <section className="kim-app-form-section kim-manual-compare-section">
                      <div className="kim-manual-compare-grid">
                        {kimManualQuoteConditionCards.map((condition) => {
                          const isConditionSaved = savedManualQuoteConditionIds.includes(condition.id);
                          const depositMode = manualDepositModes[condition.id] ?? condition.depositMode;
                          const downPaymentMode = manualDownPaymentModes[condition.id] ?? condition.downPaymentMode;
                          const residualMode = manualResidualModes[condition.id] ?? condition.residualMode;
                          const mileageMode = manualMileageModes[condition.id] ?? "basic";
                          const mileageValue = mileageMode === "basic" ? "20,000km / 년" : manualMileageValues[condition.id] ?? "20,000km / 년";

                          return (
                            <section className={`kim-manual-compare-card${isConditionSaved ? " is-saved" : ""}`} data-scenario-card={condition.id} key={condition.id}>
                              <header>
                                <strong>{condition.title} <span>{condition.round}</span></strong>
                                <div>
                                  {condition.copyLabel ? <button className="copy" type="button">{condition.copyLabel}</button> : null}
                                  {isConditionSaved ? (
                                    <button className="edit" onClick={() => editManualQuoteCondition(condition.id, condition.round)} type="button">수정</button>
                                  ) : null}
                                  <button type="button">재입력</button>
                                </div>
                              </header>
                              <div className="kim-manual-compare-body">
                                <label className="select-value"><span>금융사</span><select data-sc-field="lender" defaultValue={condition.lender} disabled={isConditionSaved}><option>미선택</option><option>우리금융캐피탈</option><option>iM캐피탈</option><option>하나캐피탈</option></select></label>
                                <label><span>기간</span><div className="kim-jeff-segment wide"><button disabled={isConditionSaved} type="button">12개월</button><button disabled={isConditionSaved} type="button">24개월</button><button disabled={isConditionSaved} type="button">36개월</button><button disabled={isConditionSaved} type="button">48개월</button><button className="active" disabled={isConditionSaved} type="button">60개월</button></div></label>
                                <label><span>보증금</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={depositMode === "none" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDepositMode(condition.id, "none")} type="button">없음</button><button className={depositMode === "amount" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDepositMode(condition.id, "amount")} type="button">금액</button><button className={depositMode === "percent" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDepositMode(condition.id, "percent")} type="button">%</button></div><div className={`kim-jeff-money-input${depositMode === "none" ? " is-fixed" : ""}`}><input data-sc-field="deposit" data-discount-unit={depositMode === "percent" ? "percent" : "amount"} defaultValue={condition.depositValue} disabled={isConditionSaved} readOnly={depositMode === "none"} /><em>{depositMode === "percent" ? "%" : "원"}</em></div></div></label>
                                <label><span>선수금</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={downPaymentMode === "none" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDownPaymentMode(condition.id, "none")} type="button">없음</button><button className={downPaymentMode === "amount" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDownPaymentMode(condition.id, "amount")} type="button">금액</button><button className={downPaymentMode === "percent" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualDownPaymentMode(condition.id, "percent")} type="button">%</button></div><div className={`kim-jeff-money-input${downPaymentMode === "none" ? " is-fixed" : ""}`}><input data-sc-field="downPayment" data-discount-unit={downPaymentMode === "percent" ? "percent" : "amount"} defaultValue={condition.downPaymentValue} disabled={isConditionSaved} readOnly={downPaymentMode === "none"} /><em>{downPaymentMode === "percent" ? "%" : "원"}</em></div></div></label>
                                <label><span>잔존가치</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={residualMode === "max" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualResidualMode(condition.id, "max")} type="button">최대</button><button className={residualMode === "amount" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualResidualMode(condition.id, "amount")} type="button">금액</button><button className={residualMode === "percent" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualResidualMode(condition.id, "percent")} type="button">%</button></div><div className={`kim-jeff-money-input${residualMode === "max" ? " is-fixed" : ""}`}><input data-sc-field="residual" data-discount-unit={residualMode === "percent" ? "percent" : "amount"} defaultValue={condition.residualValue} disabled={isConditionSaved} readOnly={residualMode === "max"} /><em>{residualMode === "percent" ? "%" : "원"}</em></div></div></label>
                                <label><span>약정거리</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className={mileageMode === "basic" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualMileageMode(condition.id, "basic")} type="button">기본</button><button className={mileageMode === "custom" ? "active" : ""} disabled={isConditionSaved} onClick={() => setManualMileageMode(condition.id, "custom")} type="button">변경</button></div><select className={`kim-manual-value-select${mileageMode === "basic" ? " is-fixed" : ""}`} value={mileageValue} disabled={isConditionSaved || mileageMode === "basic"} onChange={(event) => setManualMileageValue(condition.id, event.currentTarget.value)}>{kimManualMileageOptions.map((option) => <option key={option}>{option}</option>)}</select></div></label>
                                <label><span>자동차세</span><div className="kim-jeff-segment"><button className="active" disabled={isConditionSaved} type="button">불포함</button><button disabled={isConditionSaved} type="button">포함</button></div></label>
                                <label className="before-emphasis"><span>보조금</span><div className="kim-manual-combo"><div className="kim-jeff-segment"><button className="active" disabled={isConditionSaved} type="button">비해당</button><button disabled={isConditionSaved} type="button">해당</button></div><div className="kim-jeff-money-input"><input defaultValue="0" disabled={isConditionSaved} readOnly /><em>원</em></div></div></label>
                                <div className="kim-manual-compare-row amount emphasis"><span>월 납입금</span><div className="kim-manual-monthly-control"><button aria-label="솔루션 조회" className="kim-manual-solution-query" disabled={isConditionSaved || !solutionWorkbenchCanQuery} onClick={() => onToast("financial-dolim-solution 연결 전 임시 조회 버튼입니다.")} title="솔루션 조회" type="button"><Calculator size={14} strokeWidth={2.15} /></button><div className="kim-jeff-money-input"><input aria-label="월 납입금" data-sc-field="monthly" defaultValue={condition.monthlyPayment} disabled={isConditionSaved} /><em>원</em></div></div></div>
                                <div className="kim-manual-result-grid">
                                  <label><span>반납 총비용</span><div className="kim-jeff-money-input"><input disabled={isConditionSaved} readOnly value={condition.totalReturn} /><em>원</em></div></label>
                                  <label><span>인수 총비용</span><div className="kim-jeff-money-input"><input disabled={isConditionSaved} readOnly value={condition.totalTakeover} /><em>원</em></div></label>
                                  <label><span>출고 전 납입</span><div className="kim-jeff-money-input"><input disabled={isConditionSaved} readOnly value={condition.dueAtDelivery} /><em>원</em></div></label>
                                  <label><span>금리</span><div className="kim-jeff-money-input"><input disabled={isConditionSaved} readOnly value={condition.interestRate} /><em>%</em></div></label>
                                </div>
                                <button
                                  className="kim-manual-condition-save"
                                  disabled={isConditionSaved}
                                  onClick={() => saveManualQuoteCondition(condition.id, condition.round)}
                                  type="button"
                                >
                                  {isConditionSaved ? (
                                    <>
                                      <Check size={14} strokeWidth={2.4} />
                                      {condition.round}번 조건 저장됨
                                    </>
                                  ) : `${condition.round}번 조건 저장`}
                                </button>
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    </section>

                    <div className="kim-app-form-split kim-app-legacy-form-split">
                      <div className="kim-app-form-section kim-app-core-section">
                        <header>
                          <strong>🧾 기존 세부 견적 수기 입력</strong>
                        </header>
                        <div className="kim-app-form-section-body">
                          <div className="kim-app-condition-grid">
                            <label><span>구매방식</span><div className="kim-jeff-segment"><button className="active" type="button">운용리스</button></div></label>
                            <label><span>자동차세</span><div className="kim-jeff-segment"><button className="active" type="button">불포함</button><button type="button">포함</button></div></label>
                            <label><span>금융사</span><select defaultValue="우리금융캐피탈"><option>우리금융캐피탈</option><option>iM캐피탈</option><option>하나캐피탈</option></select></label>
                            <label><span>전기차 보조금</span><div className="kim-app-combo-control"><div className="kim-jeff-segment"><button className="active" type="button">비해당</button><button type="button">해당</button></div><input disabled defaultValue="0" /></div></label>
                            <label><span>리스기간</span><div className="kim-jeff-segment wide"><button type="button">12개월</button><button type="button">24개월</button><button type="button">36개월</button><button type="button">48개월</button><button className="active" type="button">60개월</button></div></label>
                            <label><span>금리</span><input readOnly value="5.32%" /></label>
                            <label><span>보증금</span><div className="kim-app-combo-control"><div className="kim-jeff-segment"><button type="button">없음</button><button type="button">금액</button><button className="active" type="button">%</button></div><input defaultValue="30" /></div></label>
                            <label><span>반납까지 총 비용</span><input readOnly value="167,652,170원" /></label>
                            <label><span>선수금</span><div className="kim-app-combo-control"><div className="kim-jeff-segment"><button className="active" type="button">없음</button><button type="button">금액</button><button type="button">%</button></div><input defaultValue="0" /></div></label>
                            <label><span>인수까지 총 비용</span><input readOnly value="239,505,410원" /></label>
                            <label><span>잔존가치</span><div className="kim-app-combo-control"><div className="kim-jeff-segment"><button className="active" type="button">최대</button><button type="button">금액</button><button type="button">%</button></div><input defaultValue="71,853,240" /></div></label>
                            <label><span>출고 전 납입 금액</span><input readOnly value="72,900,000원" /></label>
                            <label><span>약정주행거리</span><div className="kim-app-combo-control"><div className="kim-jeff-segment"><button className="active" type="button">기본</button><button type="button">변경</button></div><select defaultValue="20,000km / 년"><option>20,000km / 년</option><option>30,000km / 년</option></select></div></label>
                            <label><span>월 납입금</span><input defaultValue="2,398,000원" /></label>
                          </div>
                        </div>
                      </div>

                      <div className="kim-app-form-section kim-app-delivery-section">
                        <header>
                          <strong>📋 추가 안내 사항</strong>
                        </header>
                        <div className="kim-app-form-section-body">
                          <div className="kim-app-guidance-grid">
                            <label>
                              <span>출고시기 코멘트</span>
                              <select defaultValue="이 차량은 1주일 내 출고 가능해요">
                                <option>이 차량은 1주일 내 출고 가능해요</option>
                                <option>배정 확인 후 출고 일정을 안내드릴게요</option>
                                <option>주문 후 생산 일정 확인이 필요해요</option>
                                <option>색상 확정 후 출고 가능 시점을 안내드릴게요</option>
                              </select>
                            </label>
                            <label><span>서비스 1</span><input defaultValue="썬팅: 후퍼옵틱 KBR 전면 + 측후면 제공" /></label>
                            <label>
                              <span>재고여부</span>
                              <select defaultValue="재고 확인 필요">
                                <option>재고 확인 필요</option>
                                <option>즉시 출고 가능</option>
                                <option>배정 대기</option>
                                <option>주문 필요</option>
                              </select>
                            </label>
                            <label><span>서비스 2</span><input defaultValue="블랙박스: 기본 제공" /></label>
                            <label>
                              <span>예상 출고 기간</span>
                              <select defaultValue="확인 후 안내">
                                <option>확인 후 안내</option>
                                <option>1주일 이내</option>
                                <option>2주 이내</option>
                                <option>1개월 이내</option>
                                <option>1개월 이상</option>
                              </select>
                            </label>
                            <label><span>서비스 3</span><input defaultValue="출고 기념품: 키케이스, 주차번호판, 머그컵" /></label>
                            <label>
                              <span>고객 지역</span>
                              <select defaultValue="인천">
                                <option>서울</option>
                                <option>인천</option>
                                <option>경기</option>
                                <option>부산</option>
                                <option>대구</option>
                                <option>광주</option>
                                <option>대전</option>
                                <option>기타</option>
                              </select>
                            </label>
                            <label><span>서비스 4</span><input defaultValue="담당 카매니저 출고 일정 개별 안내" /></label>
                            <label className="wide">
                              <span>핵심포인트</span>
                              <select defaultValue="잔존가치 최대 조건으로 월 납입금을 낮춘 조건입니다.">
                                <option>잔존가치 최대 조건으로 월 납입금을 낮춘 조건입니다.</option>
                                <option>초기 부담을 낮추는 조건입니다.</option>
                                <option>월 납입금과 초기 비용 균형을 맞춘 조건입니다.</option>
                                <option>인수 선택까지 고려한 안정적인 조건입니다.</option>
                              </select>
                            </label>
                            <label className="wide"><span>추천이유</span><textarea defaultValue={"현재 조건에서는 월 납입금과 취득원가 균형이 가장 안정적인 운용리스 조건입니다.\n금리와 잔존가치 조건은 상담 중 추가 협상 여지가 있습니다."} rows={1} /></label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <aside className="kim-app-card-preview" aria-label="앱 견적카드 미리보기">
                    <div className="kim-app-card">
                      <div className="kim-app-card-status">
                        <strong>🔔 미확인 견적</strong>
                        <span>● D-6</span>
                      </div>
                      <div className="kim-app-card-body">
                        <div className="kim-app-card-hero">
                          <div>
                            <span>벤츠</span>
                            <strong>Maybach S-Class<br />S 500 4M Long</strong>
                            <p>2026년식 ㅣ {formatMoney(kimMaybachQuotePricingMock.basePrice)}원 ㅣ 기본 제공 옵션</p>
                          </div>
                          <div>
                            <b>운용리스</b>
                            <b>60개월</b>
                          </div>
                        </div>

                        <div className="kim-app-pay-box">
                          <span>월 납입금</span>
                          <strong>2,398,000원</strong>
                          <em>금리 5.32%</em>
                          <p>잔존가치 71,853,240원 · 총 비용 167,652,170원</p>
                        </div>

                        <div className="kim-app-discount-box">
                          <span>최대 할인 적용</span>
                          <strong>-{formatMoney(kimMaybachQuotePricingMock.discount)}원</strong>
                        </div>

                        <div className="kim-app-mini-grid">
                          <div><span>보증금</span><strong>30% · 72,900,000원</strong></div>
                          <div><span>주행거리</span><strong>연 20,000km</strong></div>
                        </div>

                        <div className="kim-app-detail-block">
                          <header>🚗 출고 시기 정보</header>
                          <dl>
                            <dt>외장 컬러</dt><dd>{exteriorColor?.name ?? "미선택"}</dd>
                            <dt>내장 컬러</dt><dd>{interiorColor?.name ?? "미선택"}</dd>
                            <dt>재고 여부</dt><dd className="green">확인 필요</dd>
                            <dt>예상 출고</dt><dd>확인 후 안내</dd>
                            <dt>고객 지역</dt><dd>인천</dd>
                          </dl>
                        </div>

                        <div className="kim-app-detail-block">
                          <header>📌 취득원가 구성</header>
                          <dl>
                            <dt>최종 차량가</dt><dd className="green">{formatMoney(kimMaybachQuotePricingResult.finalVehiclePrice)}원</dd>
                            <dt>등록비용 합계</dt><dd className="green">{formatMoney(kimMaybachQuotePricingResult.registrationCost)}원</dd>
                            <dt>취득원가</dt><dd className="blue">{formatMoney(kimMaybachQuotePricingResult.acquisitionCost)}원</dd>
                          </dl>
                        </div>

                        <div className="kim-app-detail-block">
                          <header>🧾 추천 견적 조건</header>
                          <dl>
                            <dt>금융사</dt><dd>우리금융캐피탈</dd>
                            <dt>보증금</dt><dd>30%</dd>
                            <dt>선수금</dt><dd>0원</dd>
                            <dt>최종 월 납입금</dt><dd className="blue">2,398,000원</dd>
                          </dl>
                        </div>
                      </div>
                    </div>
                  </aside>
                </section>
              </div>
              {isQuoteAppCardPreviewOpen ? (
                <div
                  className="kim-app-card-preview-modal"
                  onClick={() => setIsQuoteAppCardPreviewOpen(false)}
                  role="presentation"
                >
                  <div
                    className="kim-app-card-preview-dialog"
                    onClick={(event) => event.stopPropagation()}
                    role="dialog"
                    aria-label="앱카드 미리보기"
                    aria-modal="true"
                  >
                    <header>
                      <div>
                        <span>고객 견적함 화면</span>
                        <strong>앱카드 미리보기</strong>
                      </div>
                      <button aria-label="앱카드 미리보기 닫기" onClick={() => setIsQuoteAppCardPreviewOpen(false)} type="button">
                        <X size={18} strokeWidth={2.2} />
                      </button>
                    </header>
                    <aside className="kim-app-card-preview in-modal" aria-label="앱 견적카드 미리보기">
                      <div className="kim-app-card">
                        <div className="kim-app-card-status">
                          <strong>🔔 미확인 견적</strong>
                          <span>● D-6</span>
                        </div>
                        <div className="kim-app-card-body">
                          <div className="kim-app-card-hero">
                            <div>
                              <span>벤츠</span>
                              <strong>Maybach S-Class<br />S 500 4M Long</strong>
                              <p>2026년식 ㅣ {formatMoney(kimMaybachQuotePricingMock.basePrice)}원 ㅣ 기본 제공 옵션</p>
                            </div>
                            <div>
                              <b>운용리스</b>
                              <b>60개월</b>
                            </div>
                          </div>

                          <div className="kim-app-pay-box">
                            <span>월 납입금</span>
                            <strong>2,398,000원</strong>
                            <em>금리 5.32%</em>
                            <p>잔존가치 71,853,240원 · 총 비용 167,652,170원</p>
                          </div>

                          <div className="kim-app-discount-box">
                            <span>최대 할인 적용</span>
                            <strong>-{formatMoney(kimMaybachQuotePricingMock.discount)}원</strong>
                          </div>

                          <div className="kim-app-mini-grid">
                            <div><span>보증금</span><strong>30% · 72,900,000원</strong></div>
                            <div><span>주행거리</span><strong>연 20,000km</strong></div>
                          </div>

                          <div className="kim-app-detail-block">
                            <header>🚗 출고 시기 정보</header>
                            <dl>
                              <dt>외장 컬러</dt><dd>{exteriorColor?.name ?? "미선택"}</dd>
                              <dt>내장 컬러</dt><dd>{interiorColor?.name ?? "미선택"}</dd>
                              <dt>재고 여부</dt><dd className="green">확인 필요</dd>
                              <dt>예상 출고</dt><dd>확인 후 안내</dd>
                              <dt>고객 지역</dt><dd>인천</dd>
                            </dl>
                          </div>

                          <div className="kim-app-detail-block">
                            <header>📌 취득원가 구성</header>
                            <dl>
                              <dt>최종 차량가</dt><dd className="green">{formatMoney(kimMaybachQuotePricingResult.finalVehiclePrice)}원</dd>
                              <dt>등록비용 합계</dt><dd className="green">{formatMoney(kimMaybachQuotePricingResult.registrationCost)}원</dd>
                              <dt>취득원가</dt><dd className="blue">{formatMoney(kimMaybachQuotePricingResult.acquisitionCost)}원</dd>
                            </dl>
                          </div>

                          <div className="kim-app-detail-block">
                            <header>🧾 추천 견적 조건</header>
                            <dl>
                              <dt>금융사</dt><dd>우리금융캐피탈</dd>
                              <dt>보증금</dt><dd>30%</dd>
                              <dt>선수금</dt><dd>0원</dd>
                              <dt>최종 월 납입금</dt><dd className="blue">2,398,000원</dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </aside>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <article
          className={`detail-section kim-mvp-card kim-doc-card${isDocumentDragActive ? " is-drop-active" : ""}`}
          onDragEnter={(event) => {
            if (!isDocumentFileDrag(event)) return;
            event.preventDefault();
            setIsDocumentDragActive(true);
          }}
          onDragLeave={(event) => {
            if (!isDocumentFileDrag(event)) return;
            event.preventDefault();
            const nextTarget = event.relatedTarget;
            if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
            setIsDocumentDragActive(false);
          }}
          onDragOver={(event) => {
            if (!isDocumentFileDrag(event)) return;
            event.preventDefault();
          }}
          onDrop={(event) => {
            if (!isDocumentFileDrag(event)) return;
            addDocumentFilesFromDrop(event);
          }}
        >
          <div className="kim-mvp-card-head">
            <div className="kim-mvp-title-row">
              <i aria-hidden="true" className="kim-mvp-title-icon"><FolderOpen size={14} strokeWidth={2.2} /></i>
              <h3>서류함</h3>
              <span>{receivedDocumentCount}개</span>
              <em>자동 분류 파일 캐비닛</em>
            </div>
            <div className="kim-doc-head-actions">
              <label aria-label="서류 파일 첨부" className="kim-mvp-add-circle kim-doc-upload-trigger">
                <Paperclip size={13} strokeWidth={2.4} />
                <input accept="image/*,.pdf,application/pdf" multiple onChange={addDocumentFilesFromInput} type="file" />
              </label>
              <button
                aria-label="서류 PDF 병합 다운로드"
                className="kim-mvp-add-circle"
                disabled={isMergingDocuments || documents.length === 0}
                onClick={downloadDocumentsMergedPdf}
                title="이미지·PDF 서류를 하나의 PDF로 병합해 다운로드"
                type="button"
              ><Download size={13} strokeWidth={2.4} /></button>
            </div>
          </div>
          <div className="kim-mvp-card-body" ref={documentBodyRef}>
            <div className="kim-doc-list">
              {documents.length === 0 ? (
                <div className="kim-doc-empty">
                  <strong>등록된 서류가 없습니다.</strong>
                  <p>면허증, 등본, 소득서류, 계약서류, 등록서류 등 이미지, PDF 파일을 올리면 자동으로 인식됩니다.</p>
                </div>
              ) : documents.map((doc, index) => {
                const shouldOpenDocumentDeleteAbove = index > 0 && index === documents.length - 1;
                const fileKind = kimDocumentFileKind(doc.mimeType, doc.fileName);
                return (
                <div
                  className={`kim-doc-row${draggedDocumentId === doc.id ? " is-dragging" : ""}${documentDropTargetId === doc.id ? " is-drop-target" : ""}`}
                  key={doc.id}
                  onDragEnd={clearDocumentRowDrag}
                  onDragLeave={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                    if (documentDropTargetId === doc.id) setDocumentDropTargetId(null);
                  }}
                  onDragOver={(event) => dragDocumentRowOver(event, doc.id)}
                  onDrop={(event) => dropDocumentRow(event, doc.id)}
                >
                  <span aria-label={`${fileKind} 파일`} className={`kim-doc-kind-badge kind-${fileKind === "이미지" ? "image" : fileKind === "PDF" ? "pdf" : "file"}`} title={`${fileKind} 파일`}>
                    {kimDocumentFileIcon(fileKind)}
                  </span>
                  <div>
                    <select className="kim-doc-type-native-select" aria-label={`${doc.fileName} 문서 종류 변경`} value={doc.title} onChange={(event) => updateDocumentType(doc.id, event.target.value)}>
                      {kimDocumentTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <p>{doc.status} · {doc.fileName} · {formatKimFileSize(doc.fileSize)}</p>
                  </div>
                  <div className="kim-doc-row-actions">
                    <span
                      aria-label={`${doc.title} 순서 이동`}
                      className="kim-doc-drag-handle"
                      draggable
                      onDragStart={(event) => startDocumentRowDrag(event, doc.id)}
                      role="button"
                      tabIndex={0}
                    >
                      <GripVertical size={13} strokeWidth={2.2} />
                    </span>
                    <button aria-label={`${doc.title} 미리보기`} onClick={() => setPreviewDocumentId(doc.id)} type="button">
                      <Eye size={13} strokeWidth={2.3} />
                    </button>
                    <button
                      aria-label="서류 항목 삭제"
                      className="delete"
                      onClick={() => setConfirmingDocumentDeleteId((current) => (current === doc.id ? null : doc.id))}
                      type="button"
                    >
                      <Trash2 size={13} strokeWidth={2.3} />
                    </button>
                  </div>
                  {confirmingDocumentDeleteId === doc.id ? (
                    <div className={`kim-check-confirm-popover delete${shouldOpenDocumentDeleteAbove ? " is-above" : ""}`} ref={documentDeleteRef} role="dialog" aria-label="서류 항목 삭제 확인">
                      <p>해당 서류를 삭제하시겠습니까?</p>
                      <div>
                        <button type="button" onClick={() => setConfirmingDocumentDeleteId(null)}>아니요</button>
                        <button className="danger" type="button" onClick={() => deleteDocument(doc.id)}>삭제</button>
                      </div>
                    </div>
                  ) : null}
                </div>
                );
              })}
            </div>
          </div>
          <div className="kim-file-drop-overlay kim-doc-drop-overlay" aria-hidden="true">
            <FileUp size={30} strokeWidth={1.9} />
            <strong>고객 서류 첨부</strong>
            <span>이미지와 PDF를 인식해 자동 분류합니다</span>
          </div>
        </article>
        </section>
      </section>
      {previewSentQuote ? (
        <div className="kim-document-preview-backdrop" role="dialog" aria-label={`${previewSentQuote.title} 발송본`} onClick={() => setPreviewSentQuoteId(null)}>
          <div className="kim-sent-quote-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="kim-document-preview-head">
              <div>
                <strong>{previewSentQuote.title}</strong>
                <span>{previewSentQuote.quoteCode} · {previewSentQuote.sentAt ?? "발송 시각 확인 전"} · 고객 앱 발송본</span>
              </div>
              <button aria-label="발송본 보기 닫기" onClick={() => setPreviewSentQuoteId(null)} type="button"><X size={15} strokeWidth={2.4} /></button>
            </div>
            <div className="kim-sent-quote-preview-body">
              <section>
                <span>고객 앱 표시</span>
                <h4>{previewSentQuote.vehicleName || previewSentQuote.title}</h4>
                <p>{previewSentQuote.financeType || "조건 미정"} · {previewSentQuote.term || "기간 미정"} · {previewSentQuote.quoteCode}</p>
              </section>
              <div>
                <strong>{previewSentQuote.monthlyPayment || "월 납입금 확인 중"}</strong>
                <small>월 납입금</small>
              </div>
              <ul>
                <li>고객 앱 `내 견적` 추천 견적 탭에 노출되는 구조화 견적입니다.</li>
                <li>원본 파일과 별도로 차량/금융/기간/월납입 조건을 보관합니다.</li>
                <li>{previewSentQuote.decisionStatus === "contracting" ? "최종 계약 진행 견적으로 표시됩니다." : previewSentQuote.decisionStatus === "confirmed" ? "고객 최종 확정 견적으로 표시됩니다." : previewSentQuote.decisionStatus === "considering" ? "고객이 최종 고민중인 견적으로 표시됩니다." : "고객 확정 전 추천 견적입니다."}</li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}
      {previewQuote ? (
        <div className="kim-document-preview-backdrop" role="dialog" aria-label={`${previewQuote.title} 원본 미리보기`} onClick={() => setPreviewQuoteId(null)}>
          <div className="kim-document-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="kim-document-preview-head">
              <div>
                <strong>{previewQuote.title}</strong>
                <span>{previewQuote.quoteCode} · {previewQuote.fileName} · {formatKimFileSize(previewQuote.fileSize)}</span>
              </div>
              <div className="kim-document-preview-head-actions">
                <button aria-label="견적 원본 다운로드" disabled={!activePreviewQuoteUrl} onClick={() => { if (activePreviewQuoteUrl) downloadKimDocument(activePreviewQuoteUrl, previewQuote.fileName ?? "quote"); }} type="button"><Download size={15} strokeWidth={2.3} /></button>
                <button aria-label="견적 원본 삭제" onClick={() => removeQuoteOriginal(previewQuote.id)} type="button"><Trash2 size={15} strokeWidth={2.3} /></button>
                <button aria-label="견적 원본 미리보기 닫기" onClick={() => setPreviewQuoteId(null)} type="button"><X size={15} strokeWidth={2.4} /></button>
              </div>
            </div>
            <div className="kim-document-preview-body">
              {!activePreviewQuoteUrl ? (
                <p>불러오는 중…</p>
              ) : previewQuote.mimeType?.startsWith("image/") ? (
                <img alt={previewQuote.title} src={activePreviewQuoteUrl} />
              ) : kimDocumentFileKind(previewQuote.mimeType, previewQuote.fileName) === "PDF" ? (
                <iframe src={activePreviewQuoteUrl} title={previewQuote.title} />
              ) : (
                <p>미리보기를 지원하지 않는 파일입니다.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {previewDocument ? (
        <div className="kim-document-preview-backdrop" role="dialog" aria-label={`${previewDocument.title} 미리보기`} onClick={() => setPreviewDocumentId(null)}>
          <div className="kim-document-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="kim-document-preview-head">
              <div>
                <strong>{previewDocument.title}</strong>
                <span>{previewDocument.fileName} · {formatKimFileSize(previewDocument.fileSize)}</span>
              </div>
              <div className="kim-document-preview-head-actions">
                {/* 닫기처럼 항상 렌더 — URL 발급 전엔 disabled로(이전엔 URL 준비 후에야 버튼이 떠 뒤늦게 나타났다). */}
                <button aria-label="원본 다운로드" disabled={!activeDownloadUrl} onClick={() => { if (activeDownloadUrl) downloadKimDocument(activeDownloadUrl, previewDocument.fileName ?? "document"); }} type="button"><Download size={15} strokeWidth={2.3} /></button>
                <button aria-label="서류 미리보기 닫기" onClick={() => setPreviewDocumentId(null)} type="button"><X size={15} strokeWidth={2.4} /></button>
              </div>
            </div>
            <div className="kim-document-preview-body">
              {!activePreviewDocumentUrl ? (
                <div className="kim-document-preview-loading" role="status">불러오는 중…</div>
              ) : previewDocument.mimeType?.startsWith("image/") ? (
                <>
                  {!previewImageLoaded ? <div className="kim-document-preview-loading" role="status">불러오는 중…</div> : null}
                  <img alt={previewDocument.title} src={activePreviewDocumentUrl} onLoad={() => setLoadedPreviewUrl(activePreviewDocumentUrl)} style={previewImageLoaded ? undefined : { display: "none" }} />
                </>
              ) : kimDocumentFileKind(previewDocument.mimeType, previewDocument.fileName) === "PDF" ? (
                <iframe src={activePreviewDocumentUrl} title={previewDocument.title} />
              ) : (
                <div className="kim-document-preview-fallback">
                  <p>이 형식은 미리보기를 지원하지 않습니다.</p>
                  <button className="kim-doc-preview-download-link" onClick={() => downloadKimDocument(activeDownloadUrl ?? activePreviewDocumentUrl, previewDocument.fileName ?? "document")} type="button">원본 다운로드</button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
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
  const [detail, setDetail] = useState<CustomerDetailData | null>(null);
  const [detailError, setDetailError] = useState(false);
  useEffect(() => {
    if (!isKimMinjun || !customer.id) return;
    let cancelled = false;
    fetchCustomerDetail(customer.id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetailError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isKimMinjun, customer.id]);

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
          <button className="primary" onClick={() => onToast(`${customer.name} 고객 앱으로 견적 발송 준비를 시작합니다.`)} type="button"><Send size={13} />앱으로 견적 발송</button>
        </div>
      </section>
        </>
      )}

      {isKimMinjun ? (
        detailError ? (
          <div className="kim-detail-loading">고객 정보를 불러오지 못했습니다.</div>
        ) : detail ? (
          <KimMinjunDetailContent
            key={customer.id}
            detail={detail}
            chanceOverride={chanceOverride}
            customer={customer}
            manageStatusOverride={manageStatusOverride}
            onEditorOpenChange={onEditorOpenChange}
            onToast={onToast}
            onWorkflowChange={onWorkflowChange}
          />
        ) : (
          <div className="kim-detail-skeleton" aria-hidden="true" />
        )
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
