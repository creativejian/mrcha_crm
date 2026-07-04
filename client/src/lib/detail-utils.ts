// 고객 상세(CustomerDetailPage) 전용 순수 유틸.
// 타입/상수에 의존하지 않는(string·number·Date만 입출력) 함수만 모은다.
// 컴포넌트 상태와 무관해 단위 테스트가 쉽고, 거대 페이지 컴포넌트에서 분리해 가독성을 높인다.

import { type DragEvent as ReactDragEvent } from "react";

export function nowMs() {
  return Date.now();
}

// --- 시간 · 날짜 ---

export function formatKoreanShortTime(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `오늘 ${hours}:${minutes}`;
}

export function formatAssignmentTime(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `오늘 ${hours}:${minutes}`;
}

export function formatDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatShortDateLabel(value: string) {
  const [, month, day] = value.split("-");
  if (!month || !day) return "지정";
  return `${Number(month)}/${Number(day)}`;
}

export function formatScheduleDateLabel(value: string) {
  const [, month, day] = value.split("-");
  if (!month || !day) return value;
  return `${Number(month)}/${Number(day)}`;
}

export const scheduleHourOptions = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
export const scheduleMinuteOptions = ["00", "10", "20", "30", "40", "50"];

export function parseScheduleTimeParts(value?: string) {
  const [rawHour, rawMinute] = (value || "10:00").split(":");
  const hour = scheduleHourOptions.includes(rawHour) ? rawHour : "10";
  const minute = scheduleMinuteOptions.includes(rawMinute) ? rawMinute : "00";
  return { hour, minute };
}

export function scheduleTimeFromFormData(formData: FormData) {
  const hour = String(formData.get("scheduleHour") ?? "10");
  const minute = String(formData.get("scheduleMinute") ?? "00");
  const safeHour = scheduleHourOptions.includes(hour) ? hour : "10";
  const safeMinute = scheduleMinuteOptions.includes(minute) ? minute : "00";
  return `${safeHour}:${safeMinute}`;
}

export function formatRecentUpdateTime(updatedAt: number, now: number) {
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

export function timeLabelMinutes(value: string) {
  const [, time = ""] = value.split(" ");
  const [rawHour, rawMinute] = time.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Number.MAX_SAFE_INTEGER;
  return hour * 60 + minute;
}

// --- 전화번호 (010 prefix 고정, 입력은 뒤 8자리만) ---

export function phoneChunks(phone: string) {
  const chunks = phone.split("-");
  return chunks.length === 3 ? chunks : [phone.slice(0, 3), phone.slice(3, 7), phone.slice(7)];
}

export function formatLocalPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

export function localPhoneFrom(fullValue: string) {
  const digits = fullValue.replace(/\D/g, "");
  return formatLocalPhone(digits.startsWith("010") ? digits.slice(3) : digits);
}

// --- 숫자 · 파일 크기 ---

export function formatNumberWithCommas(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("ko-KR");
}

export function formatFileSize(size?: number) {
  if (!size) return "크기 확인 전";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

// --- 문서 분류 (파일명 기반) ---

export function classifyDocumentFile(fileName: string) {
  const normalized = fileName.normalize("NFC").toLowerCase().replace(/\s|_|-/g, "");
  if (/운전면허|면허|driver.?license|license/.test(normalized)) return "면허증";
  if (/주민등록등본|등본|초본|resident|register/.test(normalized)) return "주민등록등본";
  if (/원천징수|withholding/.test(normalized)) return "원천징수영수증";
  if (/부가세|부가가치|과세|vat/.test(normalized)) return "부가세과세증명원";
  if (/소득금액|소득증명|income/.test(normalized)) return "소득금액증명원";
  if (/사업자등록|사업자|businessregistration/.test(normalized)) return "사업자등록증";
  if (/자동이체|통장사본|계좌|bankbook|account/.test(normalized)) return "자동이체통장사본";
  if (/매매계약|purchasecontract|salescontract/.test(normalized)) return "매매계약서";
  if (/리스승인|leaseapproval/.test(normalized)) return "리스승인서";
  if (/계약사실|contractconfirmation/.test(normalized)) return "계약사실확인서";
  if (/주주명부|shareholder/.test(normalized)) return "법인(점)주주명부";
  if (/등기부등본|법인등기|registry/.test(normalized)) return "법인(점)등기부등본";
  if (/법인인감/.test(normalized)) return "법인(점)법인인감증명서";
  if (/개인인감|인감/.test(normalized)) return "법인(점)개인인감증명서";
  if (/전기|전년도|전해|previous/.test(normalized) && /재무제표|표준재무|financialstatement|financial/.test(normalized)) return "법인(점)재무제표(전기)";
  if (/재무제표|표준재무|당해|financialstatement|financial/.test(normalized)) return "법인(점)재무제표(당해)";
  if (/자동차등록증|차량등록증|vehicle.?registration/.test(normalized)) return "등록(점)자동차등록증";
  if (/세금계산서|taxinvoice/.test(normalized)) return "등록(점)세금계산서";
  if (/취득세|acquisitiontax/.test(normalized)) return "등록(점)취득세납부영수증";
  if (/등록비|registrationfee/.test(normalized)) return "등록(점)등록비영수증";
  if (/보험가입|보험증명|insurance/.test(normalized)) return "등록(점)보험가입증명서";
  return "기타서류";
}

export function documentFileKind(mimeType?: string, fileName = "") {
  if (mimeType?.startsWith("image/")) return "이미지";
  if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) return "PDF";
  return "파일";
}

// 드래그 데이터에 파일이 포함됐는지(=OS 파일 드롭) 판정. 서류함·견적 원본 드롭 영역이 공유.
export function isDocumentFileDrag(event: ReactDragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

// --- 구매 조건 표시/태그 ---

export function purchaseValueClass(value: string) {
  if (value === "미정") return "is-empty";
  if (value === "확인 필요") return "needs-confirmation";
  return "";
}

export function isPurchaseTagField(label: string) {
  return label === "계약 포커스" || label === "고객 특이사항" || label === "심사 특이사항";
}

export function purchaseTags(value: string) {
  return value.split("#").map((tag) => tag.trim()).filter(Boolean).map((tag) => `#${tag}`);
}

// --- 상담/견적 표시 클래스 ---

export function consultKindClass(kind: string) {
  if (kind === "통화") return " call";
  if (kind === "카톡" || kind === "앱상담") return " chat";
  if (kind === "상태변경" || kind === "상태") return " status";
  if (kind === "메모") return " memo";
  return "";
}

export function quoteValidClass(label?: string) {
  if (!label) return "";
  if (label.includes("만료")) return " expired";
  if (/D-[01]$/.test(label)) return " urgent";
  return " active";
}

// --- 해야 할 일(체크) 마감 랭크 ---

export function checkDueRank(value: string) {
  if (value === "급함") return 0;
  if (value === "오늘") return 1;
  if (value === "내일") return 2;
  if (value === "이번 주") return 3;
  return 4;
}

export function checkDueDateRank(value: string) {
  const [month, day] = value.split("/").map(Number);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return Number.MAX_SAFE_INTEGER;
  return month * 100 + day;
}

export function parseCheckDueDate(value: string, date = new Date()) {
  const [month, day] = value.split("/");
  if (!month || !day) return "";
  return `${date.getFullYear()}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

// 해야 할 일 마감 선택지. 마지막 "지정"은 임의 날짜 입력 분기.
export const checkDueOptions = ["오늘", "내일", "이번 주", "급함", "지정"];

// 저장된 due 값이 표준 선택지에 없으면 "지정"(임의 날짜)으로 본다.
export function checkDueSelection(value: string) {
  return checkDueOptions.includes(value) ? value : "지정";
}
