import { invalidateCustomerDetail } from "./customers";
import { sendJson, sendVoid } from "./http";

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

// POST 바디(서버 zod와 동형). 헤더 + 대표 시나리오.
export type QuoteCreatePayload = {
  entryMode?: "manual" | "solution" | "original" | null;
  status?: string | null;
  quoteRound?: string | null;
  stockStatus?: "재고있음" | "재고없음" | "재고확인중" | null;
  brandName?: string | null;
  modelName?: string | null;
  trimName?: string | null;
  note?: string | null;
  scenario?: {
    purchaseMethod?: string | null;
    termMonths?: number | null;
    monthlyPayment?: string | null;
    lender?: string | null;
  };
};

// 새 견적 생성. 서버가 quote_code·id 부여 → 반환값으로 낙관 임시 항목을 교체한다. 성공 시 상세 캐시 무효화.
export async function createQuote(customerId: string, payload: QuoteCreatePayload): Promise<{ id: string; quoteCode: string; createdAt: string }> {
  const row = await sendJson<{ id: string; quoteCode: string; createdAt: string }>(`/api/customers/${customerId}/quotes`, "POST", payload);
  invalidateCustomerDetail(customerId);
  return row;
}
