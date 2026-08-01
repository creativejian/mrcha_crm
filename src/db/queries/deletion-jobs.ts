// 탈퇴 잡 상태기계(2026-08-01 spec §2a·§4) — 접수(멱등)·확인 실행·D+3/D+5 판정.
// 정책 = ref/2026-08-01-app-account-deletion-crm-reply.md · spec = ref/specs/2026-08-01-crm-account-deletion-flow-design.md
import { and, eq, sql } from "drizzle-orm";

import { getDefaultDb, type Db, type Executor } from "../client";
import { accountDeletionJobs, customers, settlementReferences } from "../schema";
import {
  executeAccountPurge,
  executeActiveFulfillment,
  executeSettlementReference,
  proposeClassification,
  type DeletionClassification,
} from "./account-deletion";

// 앱 폴링 응답 상태(회신 §4 표) — purged/retained = 앱이 profile/Auth 삭제를 진행해도 된다.
export type DeletionJobState =
  | { status: "review_pending" }
  | { status: "purged" }
  | { status: "retained"; classification: "active_fulfillment" | "settlement_reference" };

function stateOfExecuted(classification: DeletionClassification): DeletionJobState {
  return classification === "purge" ? { status: "purged" } : { status: "retained", classification };
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
export async function receiveAccountDeletion(
  appUserId: string,
  ex: Executor = getDefaultDb(),
): Promise<DeletionJobState> {
  const [existing] = await ex
    .select()
    .from(accountDeletionJobs)
    .where(eq(accountDeletionJobs.appUserId, appUserId));
  if (existing) {
    if (existing.status === "executed") return stateOfExecuted(finalClassification(existing));
    return { status: "review_pending" };
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
    return { status: "purged" };
  }

  const proposed = await proposeClassification(customer.id, ex);
  await ex.insert(accountDeletionJobs).values({
    appUserId,
    customerId: customer.id,
    customerCode: customer.customerCode,
    proposedClassification: proposed,
  });
  return { status: "review_pending" };
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
  if (job.status === "executed") return stateOfExecuted(finalClassification(job));
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
  /** B 전용 — 라우트가 필수 검증. 기본 문구는 라우트 zod가 채운다. */
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
export async function confirmDeletionJob(
  jobId: string,
  input: ConfirmDeletionInput,
  ex: Executor = getDefaultDb(),
): Promise<ConfirmDeletionResult> {
  const [job] = await ex.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
  if (!job) return { outcome: "not_found" };
  if (job.status !== "received" || !job.appUserId || !job.customerId) return { outcome: "already_executed" };

  const storagePaths = await dispatchExecution(job.customerId, job.appUserId, input.classification, {
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
      confirmedClassification: input.classification,
      confirmedBy: input.confirmedBy,
      confirmedAt: sql`now()`,
      executedAt: sql`now()`,
    })
    .where(eq(accountDeletionJobs.id, jobId));
  return { outcome: "executed", storagePaths };
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
export async function autoExecuteJob(
  job: { id: string; customerId: string | null; appUserId: string | null; proposedClassification: string },
  ex: Executor,
): Promise<{ storagePaths: string[] }> {
  const classification: DeletionClassification =
    job.proposedClassification === "purge" ? "purge" : "settlement_reference";
  const storagePaths =
    job.customerId && job.appUserId
      ? await dispatchExecution(job.customerId, job.appUserId, classification, { deletedBy: null, jobId: job.id }, ex)
      : [];
  await ex
    .update(accountDeletionJobs)
    .set({
      status: "executed",
      executedVia: "auto",
      // 실제 실행된 분류를 기록(위 finalClassification 참조) — confirmedBy는 NULL 유지(사람 아님).
      confirmedClassification: classification,
      executedAt: sql`now()`,
    })
    .where(eq(accountDeletionJobs.id, job.id));
  return { storagePaths };
}

// 분류 → 실행 경로 디스패치. 실행 함수가 null(고객 이미 없음 — psql 수동 삭제 등)이어도
// 잡은 executed로 닫는다(재시도 루프 방지 — 감사는 customer_deletions가 이미 담당).
async function dispatchExecution(
  customerId: string,
  appUserId: string,
  classification: DeletionClassification,
  opts: { deletedBy: string | null; retentionBasis?: string; retentionUntil?: Date; clawbackUntil?: string; jobId: string | null },
  ex: Executor,
): Promise<string[]> {
  if (classification === "purge") {
    const r = await executeAccountPurge(customerId, appUserId, opts.deletedBy, ex);
    return r?.storagePaths ?? [];
  }
  if (classification === "active_fulfillment") {
    const r = await executeActiveFulfillment(
      appUserId,
      { basis: opts.retentionBasis ?? "출고 연락·조율", until: opts.retentionUntil ?? new Date() },
      ex,
    );
    return r?.storagePaths ?? [];
  }
  const r = await executeSettlementReference(customerId, appUserId, opts.jobId, opts.deletedBy, ex);
  if (r && opts.clawbackUntil) {
    // 확인 화면에서 clawback 기일을 받았으면 스켈레톤을 pending으로 승격(모르면 review_required 유지).
    await ex
      .update(settlementReferences)
      .set({ clawbackUntil: opts.clawbackUntil, status: "pending", updatedAt: sql`now()` })
      .where(eq(settlementReferences.id, r.settlementId));
  }
  return r?.storagePaths ?? [];
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
      executed += 1;
      storagePaths.push(...r.storagePaths);
    } catch (e) {
      console.error(`[account-deletion] D+5 자동 실행 실패 job=${job.id}:`, e);
    }
  }
  return { executed, storagePaths };
}
