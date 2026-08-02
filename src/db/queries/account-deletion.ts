// 회원탈퇴 실행 경로(2026-08-01) — 자동 분류 제안 + 3분류 실행.
// 정책 = ref/2026-08-01-app-account-deletion-crm-reply.md · 구현 spec = ref/specs/2026-08-01-crm-account-deletion-flow-design.md
//
// 모든 실행 함수는 **트랜잭션 안에서, profiles가 살아 있는 동안** 호출된다(앱이 CRM 성공 응답
// 전 profile을 지우지 않는 계약 — materialize의 번호 읽기와 dismissals의 원본 id 읽기가 여기 의존).
// Storage 삭제는 커밋 후 호출자 몫(반환 storagePaths — customer-delete.ts와 동일 관례).
import { eq, inArray, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { consultationRequests } from "../public-app";
import {
  accountDeletionJobs,
  consultationDismissals,
  customerDeletions,
  customerDeliveries,
  customerDocuments,
  customerMemos,
  customerTasks,
  consultations,
  customers,
  embeddings,
  quotes,
  settlementReferences,
} from "../schema";
import { applyAppUserUnlink } from "./app-user-link";
import { deleteQuote } from "./customer-quotes";
import { purgeCustomerCore } from "./customer-delete";

export type DeletionClassification = "purge" | "active_fulfillment" | "settlement_reference";

// 자동 분류 제안(회신 §1) — 원문 §2 "계약 전 = PURGE"의 기계적 번역. 순수 판정(단위테스트 대상).
// 계약·출고 흔적이 하나라도 있으면 purge를 제안하지 않는다(오삭제 방지 — 확정은 사람/D+5 폴백).
export function classifyDeliverySignals(
  signals: { contractDate: string | null; deliveredDate: string | null } | null,
): DeletionClassification {
  if (!signals) return "purge";
  if (signals.deliveredDate) return "settlement_reference";
  if (signals.contractDate) return "active_fulfillment";
  return "purge";
}

// 분류 제안 실측 — 잡 생성 시 1회 호출해 저장한다(화면·D+5 자동 실행이 같은 저장값을 본다).
export async function proposeClassification(
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<DeletionClassification> {
  const [row] = await ex
    .select({ contractDate: customerDeliveries.contractDate, deliveredDate: customerDeliveries.deliveredDate })
    .from(customerDeliveries)
    .where(eq(customerDeliveries.customerId, customerId));
  return classifyDeliverySignals(row ?? null);
}

// 탈퇴 유저의 앱 상담신청 dismissal 정리(원문 §3) — public.consultations는 앱 소유라 **read만**,
// 지우는 건 crm.consultation_dismissals(우리 행)뿐. 앱이 원본을 지우면 dismissal이 영구 고아가
// 되므로 profile 삭제 전(= 이 트랜잭션)에 원본 id를 읽어 치운다.
async function cleanupConsultationDismissals(appUserId: string, ex: Executor): Promise<void> {
  const rows = await ex
    .select({ id: consultationRequests.id })
    .from(consultationRequests)
    .where(eq(consultationRequests.userId, appUserId));
  if (rows.length === 0) return;
  await ex.delete(consultationDismissals).where(
    inArray(consultationDismissals.consultationId, rows.map((r) => r.id)),
  );
}

// 탈퇴발 감사 행 — name·app_user_id 미기록(회신 §6). deletedBy NULL = D+5 자동 실행.
async function insertAnonymousDeletionAudit(
  purged: { id: string; customerCode: string; quoteCount: number },
  deletedBy: string | null,
  ex: Executor,
): Promise<void> {
  await ex.insert(customerDeletions).values({
    customerId: purged.id,
    customerCode: purged.customerCode,
    quoteCount: purged.quoteCount,
    deletedBy,
  });
}

// ── PURGE(회신 §2-A) — 스태프 삭제(#212)와 코어 공유, 차이 3가지 ─────────────────
// ①발송 카드 409 가드 없음(카드 회수가 탈퇴의 의도 그 자체 — deleteQuote가 회수 SSOT)
// ②감사 익명 ③dismissals 정리. 반환 null = 고객 없음(이미 실행됨 — 멱등 재시도 안전).
export async function executeAccountPurge(
  customerId: string,
  appUserId: string,
  deletedBy: string | null,
  ex: Executor = getDefaultDb(),
): Promise<{ storagePaths: string[] } | null> {
  await cleanupConsultationDismissals(appUserId, ex);
  const purged = await purgeCustomerCore(customerId, ex);
  if (!purged) return null;
  await insertAnonymousDeletionAudit(purged, deletedBy, ex);
  return { storagePaths: purged.storagePaths };
}

// ── ACTIVE_FULFILLMENT(회신 §2-B) — 고객 행 유지 + 화이트리스트 스크럽 ─────────────
// 유지: name·phone(materialize)·advisor/team·운영 상태값·deliveries·schedules.
// 삭제: 서류(Storage 포함)·메모·할일·CRM 상담·견적(카드 회수 포함)·임베딩 전량.
// NULL 스크럽: 니즈 전 필드·ai_summary/hash·phone_secondary·residence(주소=개인정보)·
//   customer_type_detail·source_consultation_id·featured_request_id.
//   (featured_request_id NULL → 니즈 파생 read-only가 수기 입력 가능으로 풀린다 — 설계 D2 정합.)
// retention_basis/until 필수 기록 — 도래 시 잡이 PURGE로 수렴시킨다(원문 §2-B).
export async function executeActiveFulfillment(
  appUserId: string,
  retention: { basis: string; until: Date },
  ex: Executor = getDefaultDb(),
): Promise<{ customerId: string; materializedPhone: string | null; storagePaths: string[] } | null> {
  // unlink 선행 — profiles 번호를 phone으로 materialize(단일 UPDATE, CHECK 통과).
  const unlinked = await applyAppUserUnlink(appUserId, "materialize", ex);
  if (!unlinked) return null;
  const customerId = unlinked.customerId;

  // Storage 경로 수집(삭제 전) — 서류 + 견적 원본.
  const docs = await ex
    .select({ filePath: customerDocuments.filePath, thumbPath: customerDocuments.thumbPath })
    .from(customerDocuments)
    .where(eq(customerDocuments.customerId, customerId));
  const quoteRows = await ex
    .select({ id: quotes.id, filePath: quotes.filePath })
    .from(quotes)
    .where(eq(quotes.customerId, customerId));
  const storagePaths = [
    ...docs.flatMap((d) => [d.filePath, d.thumbPath]),
    ...quoteRows.map((q) => q.filePath),
  ].filter((p): p is string => !!p);

  for (const q of quoteRows) await deleteQuote(customerId, q.id, ex);
  await ex.delete(customerDocuments).where(eq(customerDocuments.customerId, customerId));
  await ex.delete(customerMemos).where(eq(customerMemos.customerId, customerId));
  // 할일도 삭제 — 회신 §2-B 유지 화이트리스트(name·phone·advisor·deliveries·schedules)에 없고,
  // body가 자유 텍스트라 연락처류 개인정보를 담을 수 있다(화이트리스트 스크럽 원칙).
  await ex.delete(customerTasks).where(eq(customerTasks.customerId, customerId));
  await ex.delete(consultations).where(eq(consultations.customerId, customerId));
  // 임베딩은 소스별이 아니라 고객 전량 — 남는 소스(deliveries·schedules)도 개인정보 최소화 원칙상
  // 코퍼스에서 뺀다(보존 고객은 업무 AI 검색 대상이 아니다 — 회신 §7 legal hold 제외와 같은 방향).
  await ex.delete(embeddings).where(eq(embeddings.customerId, customerId));
  await cleanupConsultationDismissals(appUserId, ex);

  await ex
    .update(customers)
    .set({
      needModel: null, needTrim: null, needTrimId: null, needMethod: null, needTiming: null,
      needColors: null, needCompare: null, needMemo: null, needContractTerm: null,
      needInitialCost: null, needAnnualMileage: null, needDeliveryMethod: null,
      needContractFocus: null, needCustomerNote: null, needReviewNote: null,
      aiSummary: null, aiSummarySourceHash: null,
      phoneSecondary: null, residence: null, customerTypeDetail: null,
      sourceConsultationId: null, featuredRequestId: null,
      retentionBasis: retention.basis,
      retentionUntil: retention.until,
      updatedAt: sql`now()`,
    })
    .where(eq(customers.id, customerId));

  return { customerId, materializedPhone: unlinked.materializedPhone, storagePaths };
}

// ── 보존 기한 도래 수렴(회신 §2-B "도래 시 §4의 잡이 담당 — PURGE로 수렴") ──────────
// B(한시 보존) 고객의 retention_until 경과 건 선별 — 이 컬럼은 B 실행만 기록하므로 값이
// 있다 = 보존 고객이다(앱 연결은 이미 해제 상태).
export async function listRetentionDueCustomers(ex: Executor = getDefaultDb()) {
  return ex
    .select({ id: customers.id, customerCode: customers.customerCode })
    .from(customers)
    .where(sql`${customers.retentionUntil} <= now()`);
}

// 도래 고객 1건 수렴 — 개인정보 전량 파기. 출고 완료 흔적(deliveredDate)이 있으면 정산
// 스켈레톤으로 축소(원문 §4-2 "출고가 끝나면 연락처를 삭제하고 정산 참조로 축소" — 스켈레톤은
// 개인정보 0이라 회신의 "PURGE로 수렴" 문구와 양립), 없으면 전체 파기로 끝낸다.
// dismissals 정리는 불요 — 원 탈퇴 실행(B) 시점에 이미 치웠고 profile도 그때 이후 소멸했다.
// 반환 null = 고객 이미 없음(수동 삭제 등 — 멱등 재시도 안전). 반드시 트랜잭션 안에서 호출.
export async function executeRetentionConvergence(
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ storagePaths: string[]; settlementId: string | null } | null> {
  const [delivery] = await ex
    .select({ lender: customerDeliveries.lender, deliveredDate: customerDeliveries.deliveredDate })
    .from(customerDeliveries)
    .where(eq(customerDeliveries.customerId, customerId));

  const purged = await purgeCustomerCore(customerId, ex);
  if (!purged) return null;
  await insertAnonymousDeletionAudit(purged, null, ex);

  if (!delivery?.deliveredDate) return { storagePaths: purged.storagePaths, settlementId: null };
  // 감사 역추적 — 원 탈퇴 잡이 남아 있으면 잇는다(loose id — 없으면 NULL로 생성).
  const [job] = await ex
    .select({ id: accountDeletionJobs.id })
    .from(accountDeletionJobs)
    .where(eq(accountDeletionJobs.customerId, customerId));
  const [settlement] = await ex
    .insert(settlementReferences)
    .values({ lender: delivery.lender ?? null, deletionJobId: job?.id ?? null })
    .returning({ id: settlementReferences.id });
  return { storagePaths: purged.storagePaths, settlementId: settlement.id };
}

// ── SETTLEMENT_REFERENCE(회신 §2-C) — 정산 스켈레톤 분리 후 PURGE와 동일 삭제 ──────
// CRM이 아는 건 deliveries.lender뿐 — 나머지(정산번호·금액·기일)는 스태프가 확인 화면/후속
// 입력으로 채운다. status 기본 review_required(무기한 보존 방지). 개인정보 0.
export async function executeSettlementReference(
  customerId: string,
  appUserId: string,
  deletionJobId: string | null,
  deletedBy: string | null,
  ex: Executor = getDefaultDb(),
): Promise<{ storagePaths: string[]; settlementId: string } | null> {
  const [delivery] = await ex
    .select({ lender: customerDeliveries.lender })
    .from(customerDeliveries)
    .where(eq(customerDeliveries.customerId, customerId));

  const purged = await executeAccountPurge(customerId, appUserId, deletedBy, ex);
  if (!purged) return null;

  const [settlement] = await ex
    .insert(settlementReferences)
    .values({ lender: delivery?.lender ?? null, deletionJobId })
    .returning({ id: settlementReferences.id });
  return { storagePaths: purged.storagePaths, settlementId: settlement.id };
}
