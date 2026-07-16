import { apiFetch } from "./api";
import { invalidateCustomerDetail } from "./customers";
import { getJson, sendJson, sendVoid } from "./http";
import type { QuoteGuidance } from "@/data/quote-guidance";
import type { QuoteDiscountLine } from "./quote-items";
import type { SolutionQuoteInput } from "./solution-quote";

// 견적함 표시 문자열 → 시나리오 컬럼값. 숫자만 남겨 파싱한다.

// "60개월"/"60" → 60, 숫자 없으면 null(smallint term_months).
export function parseTermMonths(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isNaN(n) ? null : n;
}

// "월 2,473,200원"/"2473200" → "2473200", 숫자 없으면 null(numeric monthly_payment은 문자열로 전송).
export function parseMonthlyPayment(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? digits : null;
}

// "5.32%"/"5.32" → "5.32"(소수점 보존, numeric interest_rate은 문자열 전송). 빈값/숫자 아님/0/100 초과는 null(100 초과 = 콤마 오입력 "5,32"→532 같은 비현실 금리 차단).
export function parseInterestRate(raw: string): string | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 && n <= 100 ? String(n) : null;
}

// PATCH 바디(서버 zod와 동형). 보낸 키만 갱신.
export type QuoteWritePatch = {
  status?: string | null;
  entryMode?: "manual" | "solution" | "original" | null;
  quoteRound?: string | null;
  stockStatus?: "재고있음" | "재고없음" | "재고확인중" | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  appStatus?: "draft" | "queued" | "sent" | null; // "viewed" 축소(배치 E) — 열람은 viewedAt(read-through) SSOT
  decisionStatus?: "none" | "considering" | "confirmed" | "contracting" | null;
  note?: string | null;
  primaryScenarioId?: string | null;
  bumpRevision?: boolean;
  scenario?: {
    purchaseMethod?: string | null;
    termMonths?: number | null;
    monthlyPayment?: string | null;
    lender?: string | null;
  };
  // PR2a: 워크벤치 수정용 스냅샷 + 다중 시나리오 교체
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
  // 할인 구성 내역(기본 할인 제외 추가 행 — 전체 교체, null=클리어). 서버 zod와 동형.
  discountLines?: QuoteDiscountLine[] | null;
  acquisitionTax?: string | null;
  acquisitionTaxMode?: "normal" | "hybrid" | "electric" | "manual" | null;
  bond?: string | null;
  delivery?: string | null;
  incidental?: string | null;
  finalVehiclePrice?: string | null;
  acquisitionCost?: string | null;
  exteriorColorId?: number | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  interiorColorId?: number | null;
  interiorColorName?: string | null;
  interiorColorHex?: string | null;
  guidance?: QuoteGuidance | null;
  scenarios?: ScenarioInput[];
};

// 기존 견적 부분 수정. 성공 시 상세 캐시 무효화(재진입 stale 방지).
export async function updateQuote(customerId: string, quoteId: string, patch: QuoteWritePatch): Promise<void> {
  await sendVoid(`/api/customers/${customerId}/quotes/${quoteId}`, "PATCH", patch);
  invalidateCustomerDetail(customerId);
}

// 견적 삭제. 성공 시 상세 캐시 무효화.
export async function deleteQuote(customerId: string, quoteId: string): Promise<void> {
  await sendVoid(`/api/customers/${customerId}/quotes/${quoteId}`, "DELETE");
  invalidateCustomerDetail(customerId);
}

// POST 바디(서버 zod와 동형). 헤더 + 대표 시나리오 + #4c-2 가격/색상/옵션 스냅샷.
export type QuoteCreatePayload = {
  entryMode?: "manual" | "solution" | "original" | null;
  status?: string | null;
  quoteRound?: string | null;
  stockStatus?: "재고있음" | "재고없음" | "재고확인중" | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  note?: string | null;
  sourceQuoteRequestId?: string | null;
  // #4c-2 워크벤치 스냅샷(trim_id/color_id는 catalog FK라 실존 id만)
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
  // 할인 구성 내역(기본 할인 제외 추가 행 — 전체 교체, null=클리어). 서버 zod와 동형.
  discountLines?: QuoteDiscountLine[] | null;
  acquisitionTax?: string | null;
  acquisitionTaxMode?: "normal" | "hybrid" | "electric" | "manual" | null;
  bond?: string | null;
  delivery?: string | null;
  incidental?: string | null;
  finalVehiclePrice?: string | null;
  acquisitionCost?: string | null;
  exteriorColorId?: number | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  interiorColorId?: number | null;
  interiorColorName?: string | null;
  interiorColorHex?: string | null;
  guidance?: QuoteGuidance | null;
  scenario?: ScenarioInput;
  scenarios?: ScenarioInput[];
};

// #4c-3a 생성용 시나리오(서버 ScenarioInput 동형). 비교카드 입력 가능 컬럼 + 메타.
export type ScenarioInput = {
  scenarioNo?: number | null;
  isSaved?: boolean;
  purchaseMethod?: string | null;
  termMonths?: number | null;
  monthlyPayment?: string | null;
  lender?: string | null;
  depositMode?: string | null;
  depositValue?: string | null;
  downPaymentMode?: string | null;
  downPaymentValue?: string | null;
  residualMode?: string | null;
  residualValue?: string | null;
  mileageMode?: string | null;
  mileageValue?: string | null;
  // 앱카드 4섹션(2026-07-04): 계산엔진 연결 전 수기 입력 결과 필드 + 자동차세/보조금
  carTaxIncluded?: boolean | null;
  subsidyApplicable?: boolean | null;
  subsidyAmount?: string | null;
  totalReturnCost?: string | null;
  totalTakeoverCost?: string | null;
  dueAtDelivery?: string | null;
  interestRate?: string | null;
  // CM/AG 수수료 %(마이그 0032, 계산기 패리티) — 파트너 계산 입력의 % 원문. 서버 zod와 동형.
  cmFeePercent?: string | null;
  agFeePercent?: string | null;
  // 솔루션 조회 재현성 스냅샷(마이그 0031) — 수기 시나리오는 미전송. 서버 zod와 동형.
  solutionLenderCode?: string | null;
  solutionWorkbookVersion?: string | null;
  solutionCalculatedAt?: string | null;
  solutionRaw?: unknown;
};

// 솔루션 계산 릴레이 호출(POST /api/solution/calculate) — 응답 raw는 파트너 원문 그대로
// (해석은 parseSolutionQuoteResult, 스냅샷은 raw 통째 저장). 실패 시 서버가 파트너 error 문구를
// {error}로 매핑하므로 sendJson의 HttpError(message=한글 문구) 관례를 그대로 따른다.
export async function requestSolutionQuote(input: SolutionQuoteInput): Promise<unknown> {
  return sendJson<unknown>("/api/solution/calculate", "POST", input);
}

// 새 견적 생성. 서버가 quote_code·id 부여 → 반환값으로 낙관 임시 항목을 교체한다. 성공 시 상세 캐시 무효화.
export async function createQuote(customerId: string, payload: QuoteCreatePayload): Promise<{ id: string; quoteCode: string; createdAt: string }> {
  const row = await sendJson<{ id: string; quoteCode: string; createdAt: string }>(`/api/customers/${customerId}/quotes`, "POST", payload);
  invalidateCustomerDetail(customerId);
  return row;
}

// ── 견적 원본 파일(#4d) — 서류 업로드와 동형. 성공 시 상세 캐시 무효화. ──────
// multipart라 lib/http(JSON 전용) 대신 apiFetch 직접 사용(브라우저가 boundary 포함).
export async function uploadQuoteOriginal(cid: string, quoteId: string, file: File): Promise<{ fileName: string; fileSize: number; fileMime: string | null }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await apiFetch(`/api/customers/${cid}/quotes/${quoteId}/original`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`견적 원본 업로드 실패: ${res.status}`);
  const data = (await res.json()) as { fileName: string; fileSize: number; fileMime: string | null };
  invalidateCustomerDetail(cid);
  return data;
}

export async function deleteQuoteOriginal(cid: string, quoteId: string): Promise<void> {
  await sendVoid(`/api/customers/${cid}/quotes/${quoteId}/original`, "DELETE");
  invalidateCustomerDetail(cid);
}

// url=미리보기, downloadUrl=원본(견적은 썸네일 없어 동일).
export async function getQuoteOriginalUrl(cid: string, quoteId: string): Promise<{ url: string; downloadUrl: string; fileMime: string | null }> {
  return getJson(`/api/customers/${cid}/quotes/${quoteId}/original/url`);
}
