// 탈퇴 잡 상태기계(2026-08-01 spec §2a·§4) — 접수(멱등)·확인 실행·D+3/D+5 판정.
// 정책 = ref/2026-08-01-app-account-deletion-crm-reply.md · spec = ref/specs/2026-08-01-crm-account-deletion-flow-design.md
import { and, eq, inArray, sql } from "drizzle-orm";

import { getDefaultDb, type Db, type Executor } from "../client";
import { accountDeletionJobs, customers, settlementReferences } from "../schema";
import {
  executeAccountPurge,
  executeActiveFulfillment,
  executeSettlementReference,
  proposeClassification,
  type DeletionClassification,
} from "./account-deletion";

// 앱 폴링 응답 상태(회신 §4 표 + 2026-08-01 오후 앱 추가 계약) — purged/retained = 앱이
// profile/Auth 삭제를 진행해도 된다. retained에는 classification과 함께 **retentionBasis(비어
// 있지 않음)·retentionUntil**을 싣는다(앱이 완료 인정 조건으로 요구 — 누락 시 잠금 재시도).
// retentionUntil이 null인 유일한 경로 = C(정산 보존)의 clawback 미확정(review_required — 원문
// §2-C상 확정 기한이 존재하지 않는 상태). null 수용 여부는 영실 회신 대기(회신 문서 §12).
export type DeletionJobState =
  | { status: "review_pending" }
  | { status: "purged" }
  | {
      status: "retained";
      classification: "active_fulfillment" | "settlement_reference";
      retentionBasis: string;
      retentionUntil: string | null;
      // C(정산 보존) 전용(2026-08-01 오후 영실 회신 — "안전장치 없는 null 금지"): retentionUntil이
      // null이면 reviewStatus="review_required" + 미래 reviewDueAt이 앱 완료 인정 조건이다.
      // legal_hold도 같은 문법 공유(reviewStatus에 settlement status가 그대로 실린다).
      reviewStatus?: string;
      reviewDueAt?: string | null;
    };

// C(정산 보존)의 고정 보존 근거 — 고객 행이 사라져 저장처가 없는 분류라 상수가 SSOT.
const SETTLEMENT_RETENTION_BASIS = "출고 후 정산·환수 참조 보존(개인정보 파기 완료)";

async function stateOfExecuted(
  job: { customerId: string | null; confirmedClassification: string | null; proposedClassification: string; id: string },
  ex: Executor,
): Promise<DeletionJobState> {
  const classification = finalClassification(job);
  if (classification === "purge") return { status: "purged" };
  if (classification === "active_fulfillment") {
    const [row] = job.customerId
      ? await ex
          .select({ retentionBasis: customers.retentionBasis, retentionUntil: customers.retentionUntil })
          .from(customers)
          .where(eq(customers.id, job.customerId))
      : [];
    return {
      status: "retained",
      classification,
      // 실행 경로가 항상 기록하지만(라우트 기본값 "출고 연락·조율"), 이후 수동 정리로 행이
      // 사라졌을 폴백까지 비어 있지 않게 유지한다(앱 계약 — 빈 문자열 금지).
      retentionBasis: row?.retentionBasis ?? "출고 연락·조율(보존 종료)",
      retentionUntil: row?.retentionUntil?.toISOString() ?? null,
    };
  }
  const [settlement] = await ex
    .select({
      clawbackUntil: settlementReferences.clawbackUntil,
      reviewStatus: settlementReferences.status,
      reviewDueAt: settlementReferences.reviewDueAt,
    })
    .from(settlementReferences)
    .where(eq(settlementReferences.deletionJobId, job.id));
  return {
    status: "retained",
    classification,
    retentionBasis: SETTLEMENT_RETENTION_BASIS,
    // date 컬럼(YYYY-MM-DD) → 그날까지 보존(KST 자정 직전). 미확정(review_required)은 null.
    retentionUntil: settlement?.clawbackUntil ? `${settlement.clawbackUntil}T23:59:59+09:00` : null,
    reviewStatus: settlement?.reviewStatus ?? "review_required",
    reviewDueAt: settlement?.reviewDueAt?.toISOString() ?? null,
  };
}

// 실행된 잡의 최종 분류 — 사람 확정(confirmed)이 있으면 그것, 없으면(자동 실행 전 스킴) 제안값.
// D+5 자동 실행도 confirmed에 **실제 실행된 분류**를 기록한다(B 후보의 C 폴백을 앱이
// retained/active_fulfillment로 잘못 받지 않도록) — confirmedBy NULL이 "사람 아님"을 담당.
function finalClassification(job: { confirmedClassification: string | null; proposedClassification: string }): DeletionClassification {
  return (job.confirmedClassification ?? job.proposedClassification) as DeletionClassification;
}

// 탈퇴 접수(앱 POST) — app_user_id 멱등: 기존 잡이 있으면 현재 상태만 반환한다.
// 연결 고객이 없으면 인지할 대상이 없어 큐 없이 즉시 종결(잡은 감사로 남긴다 — spec §1).
// 경합 주의: 동시 첫 POST 2건은 UNIQUE(app_user_id)가 두 번째를 거부한다(23505 → 500) —
// 앱 재시도가 기존 잡을 읽어 수렴하므로 별도 잠금은 두지 않는다.
// queuedCustomerCode = **이번 호출이** 인지 큐 잡을 새로 만들었을 때만 실림(멱등 재호출엔 없음) —
// 라우트의 D+0 Discord 알림(회신 §1 "CRM 화면 + Discord")이 이 신호로 1회만 발화한다.
export type ReceiveDeletionResult = { state: DeletionJobState; queuedCustomerCode?: string | null };

export async function receiveAccountDeletion(
  appUserId: string,
  ex: Executor = getDefaultDb(),
): Promise<ReceiveDeletionResult> {
  const [existing] = await ex
    .select()
    .from(accountDeletionJobs)
    .where(eq(accountDeletionJobs.appUserId, appUserId));
  if (existing) {
    if (existing.status === "executed") return { state: await stateOfExecuted(existing, ex) };
    return { state: { status: "review_pending" } };
  }

  const [customer] = await ex
    .select({ id: customers.id, customerCode: customers.customerCode })
    .from(customers)
    .where(eq(customers.appUserId, appUserId));
  if (!customer) {
    await ex.insert(accountDeletionJobs).values({
      appUserId,
      proposedClassification: "purge",
      status: "executed",
      executedVia: "auto",
      executedAt: sql`now()`,
    });
    return { state: { status: "purged" } };
  }

  const proposed = await proposeClassification(customer.id, ex);
  await ex.insert(accountDeletionJobs).values({
    appUserId,
    customerId: customer.id,
    customerCode: customer.customerCode,
    proposedClassification: proposed,
  });
  return { state: { status: "review_pending" }, queuedCustomerCode: customer.customerCode };
}

// 앱 폴링(GET status) — 잡 이력이 없으면 null(404).
export async function getDeletionJobState(
  appUserId: string,
  ex: Executor = getDefaultDb(),
): Promise<DeletionJobState | null> {
  const [job] = await ex
    .select()
    .from(accountDeletionJobs)
    .where(eq(accountDeletionJobs.appUserId, appUserId));
  if (!job) return null;
  if (job.status === "executed") return stateOfExecuted(job, ex);
  return { status: "review_pending" };
}

// 인지 큐 목록(스태프 화면·PR-3) — 대기 잡 + 표시용 고객 정보(잡 자체는 PII 무보관이라 join).
export async function listReceivedDeletionJobs(ex: Executor = getDefaultDb()) {
  return ex
    .select({
      id: accountDeletionJobs.id,
      customerId: accountDeletionJobs.customerId,
      customerCode: accountDeletionJobs.customerCode,
      proposedClassification: accountDeletionJobs.proposedClassification,
      requestedAt: accountDeletionJobs.requestedAt,
      customerName: customers.name,
      advisorId: customers.advisorId,
      advisorName: customers.advisorName,
    })
    .from(accountDeletionJobs)
    .leftJoin(customers, eq(customers.id, accountDeletionJobs.customerId))
    .where(eq(accountDeletionJobs.status, "received"))
    .orderBy(accountDeletionJobs.requestedAt);
}

// 단건 조회 — 확인 라우트의 담당자 스코프 검증용.
export async function getDeletionJob(jobId: string, ex: Executor = getDefaultDb()) {
  const [job] = await ex.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
  return job ?? null;
}

// 대고객 액션 차단 판정(spec §3e) — 탈퇴 접수(received) 고객이면 true. 발송 라우트 409 게이트가
// 쓴다. 확인 실행과의 경합 창은 수렴한다: 실행이 먼저면 발송 UPDATE가 빈 행(404), 발송이 먼저면
// 실행의 deleteQuote가 카드를 회수한다 — 이 게이트는 UX 차단이지 최후 방벽이 아니다.
export async function hasReceivedDeletionJob(customerId: string, ex: Executor = getDefaultDb()): Promise<boolean> {
  const [job] = await ex
    .select({ id: accountDeletionJobs.id })
    .from(accountDeletionJobs)
    .where(and(eq(accountDeletionJobs.customerId, customerId), eq(accountDeletionJobs.status, "received")));
  return !!job;
}

export type ConfirmDeletionInput = {
  classification: DeletionClassification;
  confirmedBy: string;
  /** B 전용 — 라우트가 필수 검증. 기본 문구는 dispatchExecution의 retentionBasis 폴백이 채운다. */
  retentionBasis?: string;
  retentionUntil?: Date;
  /** C 전용 — 확인 화면 입력(모르면 생략 = review_required 유지). YYYY-MM-DD. */
  clawbackUntil?: string;
};

export type ConfirmDeletionResult =
  | { outcome: "executed"; storagePaths: string[] }
  | { outcome: "not_found" }
  | { outcome: "already_executed" };

// 탈퇴확인(스태프) — 분류 확정 + 그 자리에서 실행. 반드시 트랜잭션 안에서 호출한다.
// 확인 = 인지 + 분류 확정이지 삭제 거부권이 아니다(이사님 결정 2026-08-01) — 취소 경로는 없다.
// FOR UPDATE = D+5 크론·다른 세션 confirm과의 이중 실행 잠금(autoExecuteJob과 한 쌍) — 잠금 없인
// 두 트랜잭션이 같은 received를 읽고 각자 실행해 정산 행 중복·감사 중복이 난다.
export async function confirmDeletionJob(
  jobId: string,
  input: ConfirmDeletionInput,
  ex: Executor = getDefaultDb(),
): Promise<ConfirmDeletionResult> {
  const [job] = await ex.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId)).for("update");
  if (!job) return { outcome: "not_found" };
  if (job.status !== "received" || !job.appUserId || !job.customerId) return { outcome: "already_executed" };

  const executed = await dispatchExecution(job.customerId, job.appUserId, input.classification, {
    deletedBy: input.confirmedBy,
    retentionBasis: input.retentionBasis,
    retentionUntil: input.retentionUntil,
    clawbackUntil: input.clawbackUntil,
    jobId,
  }, ex);

  await ex
    .update(accountDeletionJobs)
    .set({
      status: "executed",
      executedVia: "confirm",
      // 실제 실행된 분류(effective) — 고객이 이미 없어 no-op이면 요청 분류가 아니라 purge를 기록해야
      // 앱 폴링이 "아무것도 보존되지 않은 retained"(null 필드 → 앱 잠금 재시도)를 받지 않는다.
      confirmedClassification: executed.effective,
      confirmedBy: input.confirmedBy,
      confirmedAt: sql`now()`,
      executedAt: sql`now()`,
    })
    .where(eq(accountDeletionJobs.id, jobId));
  return { outcome: "executed", storagePaths: executed.storagePaths };
}

// D+5 자동 실행 대상(회신 §4) — received && 접수 후 5일 경과. 크론과 테스트가 공유하는 판정 SSOT.
export async function listAutoDueJobs(ex: Executor = getDefaultDb()) {
  return ex
    .select()
    .from(accountDeletionJobs)
    .where(and(eq(accountDeletionJobs.status, "received"), sql`${accountDeletionJobs.requestedAt} <= now() - interval '5 days'`));
}

// D+3 재촉 대상 — [D+3, D+4) 창. 일 1회 크론이라 창에 한 번만 잡힌다(remindedAt 컬럼 불요 —
// 크론이 하루 죽으면 그 재촉은 유실되지만 D+5 자동 실행이 최종 그물이라 수용).
export async function listRemindDueJobs(ex: Executor = getDefaultDb()) {
  return ex
    .select({ id: accountDeletionJobs.id, customerCode: accountDeletionJobs.customerCode, requestedAt: accountDeletionJobs.requestedAt })
    .from(accountDeletionJobs)
    .where(
      and(
        eq(accountDeletionJobs.status, "received"),
        sql`${accountDeletionJobs.requestedAt} <= now() - interval '3 days'`,
        sql`${accountDeletionJobs.requestedAt} > now() - interval '4 days'`,
      ),
    );
}

// D+5 잡 1건 자동 실행 — 폴백(회신 §4): purge 제안은 purge 그대로, B·C 후보는 C-스켈레톤
// (개인정보 0 보존 + 나머지 파기 — 미결정 시 계속 보유는 원문 정책 위반이라 대안이 아니다).
// 반드시 트랜잭션 안에서 호출한다(크론이 잡별 트랜잭션을 연다 — 1건 실패가 나머지를 막지 않게).
// 인자 job은 트랜잭션 **밖**(listAutoDueJobs)에서 읽은 스냅샷일 수 있다 — 그 사이 스태프가
// 탈퇴확인(B 보존 등)을 커밋했으면 stale 실행이 보존 확정 고객을 재파기한다. 그래서 tx 안에서
// FOR UPDATE 재조회 + status 재확인으로 잠근다(confirmDeletionJob과 한 쌍 — skipped 반환).
export async function autoExecuteJob(
  job: { id: string },
  ex: Executor,
): Promise<{ storagePaths: string[]; skipped?: boolean }> {
  const [fresh] = await ex.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.id, job.id)).for("update");
  if (!fresh || fresh.status !== "received") return { storagePaths: [], skipped: true };

  const classification: DeletionClassification =
    fresh.proposedClassification === "purge" ? "purge" : "settlement_reference";
  const executed =
    fresh.customerId && fresh.appUserId
      ? await dispatchExecution(fresh.customerId, fresh.appUserId, classification, { deletedBy: null, jobId: fresh.id }, ex)
      : { storagePaths: [], effective: "purge" as const };
  await ex
    .update(accountDeletionJobs)
    .set({
      status: "executed",
      executedVia: "auto",
      // 실제 실행된 분류(effective)를 기록 — confirmedBy는 NULL 유지(사람 아님). 고객이 이미 없어
      // no-op이면 purge 기록(confirmDeletionJob의 effective 주석 참조 — 앱 잠금 방지).
      confirmedClassification: executed.effective,
      executedAt: sql`now()`,
    })
    .where(eq(accountDeletionJobs.id, fresh.id));
  return { storagePaths: executed.storagePaths };
}

// 분류 → 실행 경로 디스패치. 실행 함수가 null(고객 이미 없음 — psql 수동 삭제·#212 등)이어도
// 잡은 executed로 닫는다(재시도 루프 방지 — 감사는 customer_deletions가 이미 담당). 단 그 경우
// **effective = purge** — 아무것도 보존되지 않았는데 retained 분류를 박제하면 앱 폴링이
// retentionUntil null·reviewDueAt null인 retained를 받아 완료 인정 조건 미달로 영구 잠금 재시도한다.
async function dispatchExecution(
  customerId: string,
  appUserId: string,
  classification: DeletionClassification,
  opts: { deletedBy: string | null; retentionBasis?: string; retentionUntil?: Date; clawbackUntil?: string; jobId: string | null },
  ex: Executor,
): Promise<{ storagePaths: string[]; effective: DeletionClassification }> {
  if (classification === "purge") {
    const r = await executeAccountPurge(customerId, appUserId, opts.deletedBy, ex);
    return { storagePaths: r?.storagePaths ?? [], effective: "purge" };
  }
  if (classification === "active_fulfillment") {
    // 라우트 zod가 필수 검증하는 값 — 여기 도달했는데 없으면 호출 경로 버그다. 조용한 방어 기본값
    // (구 `?? new Date()`)은 "즉시 과거가 되는 보존 기한"이라 앱 계약(미래 retentionUntil) 위반값이
    // 된다 — 시끄럽게 죽는 쪽이 안전(트랜잭션 롤백 → 5xx → 앱 재시도).
    if (!opts.retentionUntil) throw new Error("active_fulfillment 실행에는 retentionUntil이 필수입니다");
    const r = await executeActiveFulfillment(
      appUserId,
      { basis: opts.retentionBasis ?? "출고 연락·조율", until: opts.retentionUntil },
      ex,
    );
    return { storagePaths: r?.storagePaths ?? [], effective: r ? "active_fulfillment" : "purge" };
  }
  const r = await executeSettlementReference(customerId, appUserId, opts.jobId, opts.deletedBy, ex);
  if (r && opts.clawbackUntil) {
    // 확인 화면에서 clawback 기일을 받았으면 스켈레톤을 pending으로 승격(모르면 review_required 유지).
    // 기한이 확정됐으므로 30일 재검토 주기(review_due_at)는 끈다.
    await ex
      .update(settlementReferences)
      .set({ clawbackUntil: opts.clawbackUntil, status: "pending", reviewDueAt: null, updatedAt: sql`now()` })
      .where(eq(settlementReferences.id, r.settlementId));
  }
  return { storagePaths: r?.storagePaths ?? [], effective: r ? "settlement_reference" : "purge" };
}

// 정산 재검토 도래 건(영실 회신 — 30일 주기 안전장치): review_required && 재검토일 경과.
// 크론이 Discord 재알림 후 bumpSettlementReviewDue로 +30일 갱신한다(다음 주기).
export async function listReviewDueSettlements(ex: Executor = getDefaultDb()) {
  return ex
    .select({ id: settlementReferences.id, lender: settlementReferences.lender, createdAt: settlementReferences.createdAt })
    .from(settlementReferences)
    .where(
      and(
        eq(settlementReferences.status, "review_required"),
        sql`${settlementReferences.reviewDueAt} <= now()`,
      ),
    );
}

export async function bumpSettlementReviewDue(ids: string[], ex: Executor = getDefaultDb()): Promise<void> {
  if (ids.length === 0) return;
  await ex
    .update(settlementReferences)
    .set({ reviewDueAt: sql`now() + interval '30 days'`, updatedAt: sql`now()` })
    .where(inArray(settlementReferences.id, ids));
}

// 크론 오케스트레이터 — 잡별 독립 트랜잭션(1건 실패가 나머지를 막지 않는다). Db가 필요해
// Executor가 아니라 Db를 받는다(트랜잭션을 여는 쪽). 실패는 로그만 — 다음 크론이 재시도한다.
export async function autoExecuteDueJobs(db: Db = getDefaultDb()): Promise<{ executed: number; storagePaths: string[] }> {
  const due = await listAutoDueJobs(db);
  let executed = 0;
  const storagePaths: string[] = [];
  for (const job of due) {
    try {
      const r = await db.transaction((tx) => autoExecuteJob(job, tx));
      // skipped = 조회~실행 사이 스태프 확인이 선점(autoExecuteJob의 FOR UPDATE 재확인) — 실행 아님.
      if (!r.skipped) executed += 1;
      storagePaths.push(...r.storagePaths);
    } catch (e) {
      console.error(`[account-deletion] D+5 자동 실행 실패 job=${job.id}:`, e);
    }
  }
  return { executed, storagePaths };
}
