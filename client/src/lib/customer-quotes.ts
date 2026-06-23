import { apiFetch } from "./api";
import { invalidateCustomerDetail } from "./customers";
import { getJson, sendJson, sendVoid } from "./http";

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

// PATCH 바디(서버 zod와 동형). 보낸 키만 갱신.
export type QuoteWritePatch = {
  status?: string | null;
  entryMode?: "manual" | "solution" | "original" | null;
  quoteRound?: string | null;
  stockStatus?: "재고있음" | "재고없음" | "재고확인중" | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  appStatus?: "draft" | "queued" | "sent" | "viewed" | null;
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
  // #4c-2 워크벤치 스냅샷(trim_id/color_id는 catalog FK라 실존 id만)
  trimId?: number | null;
  basePrice?: string | null;
  optionTotal?: string | null;
  options?: { id: number; name: string; price: number | null }[] | null;
  finalDiscount?: string | null;
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
};

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
