import { and, eq, inArray } from "drizzle-orm";

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
  // insert values ↔ conflict set 공통 1벌 — 필드 추가 시 set 누락으로 "재발송이 일부 필드만 교체"되는 무음 드리프트 방지.
  const common = {
    userId: v.userId,
    quoteRequestId: v.quoteRequestId,
    quoteCode: v.quoteCode,
    revision: v.revision,
    vehicleLabel: v.vehicleLabel,
    monthlyPayment: v.monthlyPayment,
    payload: v.payload,
    sentAt: v.sentAt,
    validUntil: v.validUntil,
  };
  await ex
    .insert(advisorQuotes)
    .values({ ...common, crmQuoteId: v.crmQuoteId })
    .onConflictDoUpdate({
      target: advisorQuotes.crmQuoteId,
      set: { ...common, viewedAt: null },
    });
}

// 견적 삭제 시 보낸 카드 회수. 발송된 적 없는 견적이면 행이 없다 — null(멱등).
// RETURNING으로 요청 연결을 함께 반환 — 호출부(deleteQuote)가 pre-select 없이 reopen 분기에 쓴다.
export async function deleteAdvisorQuoteByCrmQuoteId(
  crmQuoteId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ quoteRequestId: string | null } | null> {
  const [row] = await ex
    .delete(advisorQuotes)
    .where(eq(advisorQuotes.crmQuoteId, crmQuoteId))
    .returning({ quoteRequestId: advisorQuotes.quoteRequestId });
  return row ?? null;
}

// 발송 시 원 견적요청 완료 전이. UPDATE가 상수 set이라 재호출해도 같은 결과(멱등),
// 요청 없는 발송(quote_request_id null)은 호출부가 걸러 이 함수까지 오지 않는다.
export async function completeQuoteRequest(requestId: string, ex: Executor = getDefaultDb()): Promise<void> {
  await ex.update(quoteRequests).set({ status: "completed" }).where(eq(quoteRequests.id, requestId));
}

// completed 전이의 역연산(앱 정책 제안 2026-07-05): 마지막 카드 회수로 요청의 advisor 카드가 0이 되면
// "완료인데 견적 없음" 모순이 영구히 남는다 — 잔여 0일 때만 open 복원. completed 가드로 어드민 수동
// closed(마감)는 되살리지 않는다. 삭제와 같은 트랜잭션에서 호출해야 앱 재조회 시점에 한 번에 정합.
export async function reopenQuoteRequestIfUndelivered(requestId: string, ex: Executor = getDefaultDb()): Promise<void> {
  const [remaining] = await ex
    .select({ id: advisorQuotes.id })
    .from(advisorQuotes)
    .where(eq(advisorQuotes.quoteRequestId, requestId))
    .limit(1);
  if (remaining) return;
  await ex
    .update(quoteRequests)
    .set({ status: "open" })
    .where(and(eq(quoteRequests.id, requestId), eq(quoteRequests.status, "completed")));
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
