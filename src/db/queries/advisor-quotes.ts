import { eq, inArray } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { advisorQuotes, quoteRequests } from "../public-app";

// 발송 시점의 앱카드 스냅샷 1건. payload는 라벨 완성본 jsonb(구조는 조립기 소유 — 여기선 통과만).
export type AdvisorQuoteUpsert = {
  userId: string;
  quoteRequestId: string | null;
  crmQuoteId: string;
  quoteCode: string;
  revision: number;
  vehicleLabel: string;
  monthlyPayment: number | null;
  payload: unknown;
  sentAt: string;
  validUntil: string | null;
};

// 발송/재발송: crm_quote_id UNIQUE conflict 시 전체 교체 + viewed_at NULL 리셋.
// 재발송본은 내용이 바뀐 새 카드라 앱 사용자 입장에서 "다시 미확인"이 맞다(spec 결정).
export async function upsertAdvisorQuote(v: AdvisorQuoteUpsert, ex: Executor = getDefaultDb()): Promise<void> {
  await ex
    .insert(advisorQuotes)
    .values({
      userId: v.userId,
      quoteRequestId: v.quoteRequestId,
      crmQuoteId: v.crmQuoteId,
      quoteCode: v.quoteCode,
      revision: v.revision,
      vehicleLabel: v.vehicleLabel,
      monthlyPayment: v.monthlyPayment,
      payload: v.payload,
      sentAt: v.sentAt,
      validUntil: v.validUntil,
    })
    .onConflictDoUpdate({
      target: advisorQuotes.crmQuoteId,
      set: {
        userId: v.userId,
        quoteRequestId: v.quoteRequestId,
        quoteCode: v.quoteCode,
        revision: v.revision,
        vehicleLabel: v.vehicleLabel,
        monthlyPayment: v.monthlyPayment,
        payload: v.payload,
        sentAt: v.sentAt,
        validUntil: v.validUntil,
        viewedAt: null,
      },
    });
}

// 견적 삭제 시 보낸 카드 회수. 발송된 적 없는 견적이면 행이 없다 — no-op(멱등).
export async function deleteAdvisorQuoteByCrmQuoteId(crmQuoteId: string, ex: Executor = getDefaultDb()): Promise<void> {
  await ex.delete(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, crmQuoteId));
}

// 발송 시 원 견적요청 완료 전이. UPDATE가 상수 set이라 재호출해도 같은 결과(멱등),
// 요청 없는 발송(quote_request_id null)은 호출부가 걸러 이 함수까지 오지 않는다.
export async function completeQuoteRequest(requestId: string, ex: Executor = getDefaultDb()): Promise<void> {
  await ex.update(quoteRequests).set({ status: "completed" }).where(eq(quoteRequests.id, requestId));
}

// CRM 견적함 read-through용: crmQuoteId → viewed_at. 발송 안 된(행 없는) id는 Map에 미포함 —
// 호출부가 "미발송"과 "발송·미열람(null)"을 구분할 수 있게 한다.
export async function listAdvisorViewedAt(
  crmQuoteIds: string[],
  ex: Executor = getDefaultDb(),
): Promise<Map<string, string | null>> {
  if (crmQuoteIds.length === 0) return new Map();
  const rows = await ex
    .select({ crmQuoteId: advisorQuotes.crmQuoteId, viewedAt: advisorQuotes.viewedAt })
    .from(advisorQuotes)
    .where(inArray(advisorQuotes.crmQuoteId, crmQuoteIds));
  return new Map(rows.map((r) => [r.crmQuoteId, r.viewedAt]));
}
