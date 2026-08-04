import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { normalizePhoneDigits } from "../../lib/customer-phone";
import { EMBEDDING_DIM } from "../../lib/gemini-embed";
import { withNotifyGuard } from "../../test-utils/notify-gate";
import { anyUnlinkedProfileId } from "../../test-utils/profiles-fixture";
import { getDefaultDb } from "../client";
import { advisorQuotes, consultationRequests, profiles } from "../public-app";
import {
  accountDeletionJobs,
  assistantMessages,
  consultationDismissals,
  customerDeletions,
  customerDeliveries,
  customerDocuments,
  customerMemos,
  customerTasks,
  customers,
  embeddings,
  quotes,
  settlementReferences,
} from "../schema";
import { applyAppUserUnlink } from "./app-user-link";
import {
  executeAccountPurge,
  executeActiveFulfillment,
  executeRetentionConvergence,
  executeSettlementReference,
  listRetentionDueCustomers,
  proposeClassification,
} from "./account-deletion";

// 회원탈퇴 실행 경로(2026-08-01 spec §3c) 실 DB 검증.
// 전 케이스 **트랜잭션 롤백**(잔재 0 — app-user-link.test.ts 패턴). 알림 트리거 테이블
// (advisor_quotes INSERT = FCM · consultations INSERT = 디스코드)을 쓰므로 withNotifyGuard 필수
// — 롤백이 pg_net을 취소하지만(실측) 가드까지 이중으로 건다.

const db = getDefaultDb();
const ROLLBACK = "__rollback__";
const code = () => `CU-ACCDEL-${crypto.randomUUID().slice(0, 8)}`;
const qcode = () => `QT-ACCDEL-${crypto.randomUUID().slice(0, 8)}`;

test("PURGE: 발송 카드 있어도 실행(회수) + 자식·dismissal 정리 + 익명 감사", async () => {
  const userId = await anyUnlinkedProfileId();
  await expect(
    withNotifyGuard(db, async (tx) => {
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴테스트", appUserId: userId })
        .returning({ id: customers.id });
      const quoteCode = qcode();
      const [q] = await tx
        .insert(quotes)
        .values({ quoteCode, customerId: c.id })
        .returning({ id: quotes.id });
      // 발송 카드 — 스태프 삭제(#212)라면 409로 막히는 상태. 탈퇴는 회수가 의도라 뚫려야 한다.
      await tx.insert(advisorQuotes).values({
        userId,
        crmQuoteId: q.id,
        quoteCode,
        revision: 0,
        vehicleLabel: "탈퇴테스트차",
        payload: {},
        sentAt: new Date().toISOString(),
      });
      // 앱 상담신청 + CRM dismissal — 탈퇴 시 dismissal(우리 행)만 치우고 원본은 앱 소유라 불가침.
      const consultationId = crypto.randomUUID();
      await tx.insert(consultationRequests).values({
        id: consultationId,
        userId,
        customerName: "상담테스트-탈퇴",
        phoneNumber: "01000000000",
        createdAt: new Date().toISOString(),
      });
      await tx.insert(consultationDismissals).values({ consultationId });
      // 업무 AI 대화(provenance, 2026-08-04) — 고객 자식이 아니라 직원 소유라 CASCADE가 닿지
      // 않는다. 파기 코어가 이 삭제를 빠뜨리면 임베딩만 사라지고 지난 답변에 이름·연락처가
      // 남는다(단위 테스트는 그 누락을 못 잡는다 — 통합 경로에서 잠근다).
      const [aiMsg] = await tx
        .insert(assistantMessages)
        .values({
          staffUserId: crypto.randomUUID(),
          role: "assistant",
          content: "탈퇴테스트 고객 요약",
          turnId: crypto.randomUUID(),
          subjectCustomerIds: [c.id],
        })
        .returning({ id: assistantMessages.id });

      const result = await executeAccountPurge(c.id, userId, null, tx);
      expect(result).not.toBeNull();
      expect(
        (await tx.select({ id: assistantMessages.id }).from(assistantMessages).where(eq(assistantMessages.id, aiMsg.id))).length,
      ).toBe(0);

      const count = async (t: typeof quotes | typeof customers | typeof consultationDismissals | typeof advisorQuotes) => {
        if (t === quotes) return (await tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.customerId, c.id))).length;
        if (t === customers) return (await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, c.id))).length;
        if (t === consultationDismissals)
          return (await tx.select({ id: consultationDismissals.consultationId }).from(consultationDismissals).where(eq(consultationDismissals.consultationId, consultationId))).length;
        return (await tx.select({ id: advisorQuotes.id }).from(advisorQuotes).where(eq(advisorQuotes.crmQuoteId, q.id))).length;
      };
      expect(await count(customers)).toBe(0);
      expect(await count(quotes)).toBe(0);
      expect(await count(advisorQuotes)).toBe(0); // 카드 회수됨
      expect(await count(consultationDismissals)).toBe(0);
      // 원본 상담신청(앱 소유)은 그대로 — CRM은 read만 했다.
      const [orig] = await tx.select({ id: consultationRequests.id }).from(consultationRequests).where(eq(consultationRequests.id, consultationId));
      expect(orig?.id).toBe(consultationId);

      // 감사 익명(회신 §6) — name·app_user_id 미기록, deletedBy NULL = 자동 실행.
      const [audit] = await tx.select().from(customerDeletions).where(eq(customerDeletions.customerId, c.id));
      expect(audit.name).toBeNull();
      expect(audit.appUserId).toBeNull();
      expect(audit.deletedBy).toBeNull();
      expect(audit.quoteCount).toBe(1);
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("ACTIVE_FULFILLMENT: phone materialize + 스크럽 + 부분 삭제(deliveries 유지) + retention 기록", async () => {
  const userId = await anyUnlinkedProfileId();
  const [profile] = await db.select({ phoneNumber: profiles.phoneNumber }).from(profiles).where(eq(profiles.id, userId));
  await expect(
    withNotifyGuard(db, async (tx) => {
      const [c] = await tx
        .insert(customers)
        .values({
          customerCode: code(),
          name: "탈퇴보존테스트",
          appUserId: userId,
          needModel: "BMW 5",
          aiSummary: "요약",
          aiSummarySourceHash: "hash",
          phoneSecondary: "01099998888",
          residence: "서울",
        })
        .returning({ id: customers.id });
      const [memo] = await tx.insert(customerMemos).values({ customerId: c.id, body: "메모" }).returning({ id: customerMemos.id });
      // 할일 body는 자유 텍스트라 연락처류 PII 가능 — 화이트리스트 밖이므로 스크럽 대상.
      await tx.insert(customerTasks).values({ customerId: c.id, body: "배우자 010-1234-5678로 출고 연락" });
      // 서류 Storage 경로 수집 검증용 — filePath·thumbPath 둘 다 수집돼야 파기 후 잔존이 없다.
      await tx.insert(customerDocuments).values({
        customerId: c.id,
        fileName: "탈퇴보존서류.pdf",
        filePath: "accdel-test/doc.pdf",
        thumbPath: "accdel-test/doc-thumb.jpg",
      });
      await tx.insert(customerDeliveries).values({
        customerId: c.id,
        contractVehicle: "BMW 테스트",
        lender: "테스트캐피탈",
        contractDate: "2026-07-01",
      });
      await tx.insert(embeddings).values({
        sourceType: "memo",
        sourceId: memo.id,
        customerId: c.id,
        content: "메모",
        contentHash: `accdel-${crypto.randomUUID()}`,
        embedding: new Array(EMBEDDING_DIM).fill(0),
      });

      expect(await proposeClassification(c.id, tx)).toBe("active_fulfillment");

      const until = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const result = await executeActiveFulfillment(userId, { basis: "출고 연락·조율", until }, tx);
      expect(result?.customerId).toBe(c.id);
      expect(result?.materializedPhone).toBe(normalizePhoneDigits(profile?.phoneNumber));
      // Storage 경로 수집 — 회귀 시 파기 후 탈퇴 고객 서류가 Storage에 조용히 잔존한다(DB 행은
      // 지워져 화면 증상 없음 — thumb_path 누락이 대표 사례).
      expect(result?.storagePaths).toContain("accdel-test/doc.pdf");
      expect(result?.storagePaths).toContain("accdel-test/doc-thumb.jpg");

      const [row] = await tx.select().from(customers).where(eq(customers.id, c.id));
      expect(row.appUserId).toBeNull();
      expect(row.phone).toBe(normalizePhoneDigits(profile?.phoneNumber)); // CHECK 통과 = 단일 UPDATE 증명
      expect(row.needModel).toBeNull();
      expect(row.aiSummary).toBeNull();
      expect(row.aiSummarySourceHash).toBeNull();
      expect(row.phoneSecondary).toBeNull();
      expect(row.residence).toBeNull();
      expect(row.retentionBasis).toBe("출고 연락·조율");
      expect(row.retentionUntil).not.toBeNull();

      expect((await tx.select({ id: customerMemos.id }).from(customerMemos).where(eq(customerMemos.customerId, c.id))).length).toBe(0);
      expect((await tx.select({ id: customerTasks.id }).from(customerTasks).where(eq(customerTasks.customerId, c.id))).length).toBe(0);
      expect((await tx.select({ id: customerDocuments.id }).from(customerDocuments).where(eq(customerDocuments.customerId, c.id))).length).toBe(0);
      expect((await tx.select({ id: embeddings.id }).from(embeddings).where(eq(embeddings.customerId, c.id))).length).toBe(0);
      // 출고 정보는 보존 목적 그 자체 — 남는다.
      expect((await tx.select({ id: customerDeliveries.id }).from(customerDeliveries).where(eq(customerDeliveries.customerId, c.id))).length).toBe(1);
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("SETTLEMENT_REFERENCE: 정산 스켈레톤 분리(lender 계승·review_required) 후 고객 삭제", async () => {
  const userId = await anyUnlinkedProfileId();
  await expect(
    withNotifyGuard(db, async (tx) => {
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴정산테스트", appUserId: userId })
        .returning({ id: customers.id });
      await tx.insert(customerDeliveries).values({
        customerId: c.id,
        lender: "테스트캐피탈",
        contractDate: "2026-06-01",
        deliveredDate: "2026-07-15",
      });

      expect(await proposeClassification(c.id, tx)).toBe("settlement_reference");

      const result = await executeSettlementReference(c.id, userId, null, null, tx);
      expect(result).not.toBeNull();

      const [gone] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, c.id));
      expect(gone).toBeUndefined();
      const [settlement] = await tx.select().from(settlementReferences).where(eq(settlementReferences.id, result!.settlementId));
      expect(settlement.lender).toBe("테스트캐피탈");
      expect(settlement.status).toBe("review_required"); // clawback 미확정 = 무기한 보존이 아니라 재검토
      const [audit] = await tx.select().from(customerDeletions).where(eq(customerDeletions.customerId, c.id));
      expect(audit.name).toBeNull();
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("proposeClassification: 출고 정보 없는 고객 → purge", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴분류테스트" })
        .returning({ id: customers.id });
      expect(await proposeClassification(c.id, tx)).toBe("purge");
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("applyAppUserUnlink: 연결 고객 없는 유저 → null(멱등 no-op, 재시도 안전)", async () => {
  const result = await applyAppUserUnlink(crypto.randomUUID(), "materialize");
  expect(result).toBeNull();
});

test("보존 기한 도래 수렴: 선별 창 + 출고 완료 흔적 → 정산 스켈레톤 축소 + 익명 감사", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      // 도래 건(어제 만료) vs 미도래 건(30일 뒤) — 선별 창 검증.
      const [due] = await tx
        .insert(customers)
        .values({
          customerCode: code(),
          name: "보존만료테스트",
          retentionBasis: "출고 연락·조율",
          retentionUntil: sql`now() - interval '1 day'`,
        })
        .returning({ id: customers.id });
      const [notDue] = await tx
        .insert(customers)
        .values({
          customerCode: code(),
          name: "보존진행테스트",
          retentionBasis: "출고 연락·조율",
          retentionUntil: sql`now() + interval '30 days'`,
        })
        .returning({ id: customers.id });
      const dueIds = (await listRetentionDueCustomers(tx)).map((c) => c.id);
      expect(dueIds).toContain(due.id);
      expect(dueIds).not.toContain(notDue.id);

      // 출고 완료 흔적 + 원 탈퇴 잡(역추적 대상) 픽스처.
      await tx.insert(customerDeliveries).values({ customerId: due.id, lender: "테스트캐피탈", deliveredDate: "2026-07-20" });
      const [job] = await tx
        .insert(accountDeletionJobs)
        .values({ appUserId: crypto.randomUUID(), customerId: due.id, customerCode: code(), proposedClassification: "active_fulfillment", status: "executed" })
        .returning({ id: accountDeletionJobs.id });

      const result = await executeRetentionConvergence(due.id, tx);
      expect(result?.settlementId).not.toBeNull();

      // 고객 파기 + 스켈레톤(lender 계승·review_required·잡 역추적) + 익명 감사(deletedBy NULL = 기계).
      const [gone] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, due.id));
      expect(gone).toBeUndefined();
      const [settlement] = await tx.select().from(settlementReferences).where(eq(settlementReferences.deletionJobId, job.id));
      expect(settlement.lender).toBe("테스트캐피탈");
      expect(settlement.status).toBe("review_required");
      const [audit] = await tx.select().from(customerDeletions).where(eq(customerDeletions.customerId, due.id));
      expect(audit.name).toBeNull();
      expect(audit.deletedBy).toBeNull();
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("보존 기한 도래 수렴: 출고 흔적 없으면 전체 파기(스켈레톤 없음) + 고객 소멸 시 null 멱등", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const [c] = await tx
        .insert(customers)
        .values({
          customerCode: code(),
          name: "보존만료퍼지테스트",
          retentionBasis: "출고 연락·조율",
          retentionUntil: sql`now() - interval '1 day'`,
        })
        .returning({ id: customers.id });

      const result = await executeRetentionConvergence(c.id, tx);
      expect(result).not.toBeNull();
      expect(result?.settlementId).toBeNull(); // 출고 흔적 없음 = 전체 파기로 종결

      const [gone] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, c.id));
      expect(gone).toBeUndefined();
      // 재실행(고객 이미 없음) — null 멱등(크론 재시도 안전).
      expect(await executeRetentionConvergence(c.id, tx)).toBeNull();
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});
