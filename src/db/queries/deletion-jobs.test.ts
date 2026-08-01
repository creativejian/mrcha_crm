import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { withNotifyGuard } from "../../test-utils/notify-gate";
import { getDefaultDb } from "../client";
import { accountDeletionJobs, customerDeletions, customerDeliveries, customers, settlementReferences } from "../schema";
import {
  autoExecuteJob,
  confirmDeletionJob,
  getDeletionJobState,
  listAutoDueJobs,
  listRemindDueJobs,
  receiveAccountDeletion,
} from "./deletion-jobs";

// 탈퇴 잡 상태기계 실 DB 검증 — 전 케이스 트랜잭션 롤백(잔재 0).
// appUserId는 전부 random uuid(loose id — profiles 실존 불요. materialize 경로만 실 profile이
// 필요하고 그건 account-deletion.test.ts가 커버). 공유 master라 목록 단언은 멤버십으로만
// (다른 세션·라우트 테스트의 커밋 잡이 섞일 수 있다 — 개수 단언 금지).

const db = getDefaultDb();
const ROLLBACK = "__rollback__";
const code = () => `CU-ACCDEL-${crypto.randomUUID().slice(0, 8)}`;

test("receive: 연결 고객 없는 유저 → 즉시 purged + 잡 executed(감사)", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      const state = await receiveAccountDeletion(appUserId, tx);
      expect(state).toEqual({ status: "purged" });
      const [job] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.appUserId, appUserId));
      expect(job.status).toBe("executed");
      expect(job.executedVia).toBe("auto");
      expect(job.customerId).toBeNull();
      // 재호출 멱등 — 같은 상태, 잡 1행 유지.
      expect(await receiveAccountDeletion(appUserId, tx)).toEqual({ status: "purged" });
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("receive: 연결 고객 → 202 review_pending(인지 큐) + 멱등 + 고객 무손상", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴큐테스트", appUserId })
        .returning({ id: customers.id, customerCode: customers.customerCode });

      const state = await receiveAccountDeletion(appUserId, tx);
      expect(state).toEqual({ status: "review_pending" });
      expect(await receiveAccountDeletion(appUserId, tx)).toEqual({ status: "review_pending" });
      expect(await getDeletionJobState(appUserId, tx)).toEqual({ status: "review_pending" });

      const jobs = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.appUserId, appUserId));
      expect(jobs).toHaveLength(1); // 멱등 — 재호출이 잡을 늘리지 않는다
      expect(jobs[0].status).toBe("received");
      expect(jobs[0].proposedClassification).toBe("purge");
      expect(jobs[0].customerCode).toBe(c.customerCode);
      // 인지 큐의 핵심 — 접수만으로는 고객이 삭제되지 않는다(이사님 결정 2026-08-01).
      const [alive] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, c.id));
      expect(alive.id).toBe(c.id);
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("confirm purge: 실행 + 잡 executed(confirm) → 재confirm은 already_executed", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      const staffId = crypto.randomUUID();
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴확인테스트", appUserId })
        .returning({ id: customers.id });
      await receiveAccountDeletion(appUserId, tx);
      const [job] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.appUserId, appUserId));

      const result = await confirmDeletionJob(job.id, { classification: "purge", confirmedBy: staffId }, tx);
      expect(result.outcome).toBe("executed");
      const [gone] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, c.id));
      expect(gone).toBeUndefined();
      const [after] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.id, job.id));
      expect(after.status).toBe("executed");
      expect(after.executedVia).toBe("confirm");
      expect(after.confirmedBy).toBe(staffId);
      // 앱 폴링 최종 상태 — purge 확정이므로 purged.
      expect(await getDeletionJobState(appUserId, tx)).toEqual({ status: "purged" });
      // 감사 익명 + 확인자 기록.
      const [audit] = await tx.select().from(customerDeletions).where(eq(customerDeletions.customerId, c.id));
      expect(audit.name).toBeNull();
      expect(audit.deletedBy).toBe(staffId);

      const again = await confirmDeletionJob(job.id, { classification: "purge", confirmedBy: staffId }, tx);
      expect(again.outcome).toBe("already_executed");
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("confirm settlement + clawbackUntil → 스켈레톤 pending 승격, 미입력이면 review_required(쿼리 검증)", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴정산확정테스트", appUserId })
        .returning({ id: customers.id });
      await tx.insert(customerDeliveries).values({ customerId: c.id, lender: "테스트캐피탈", deliveredDate: "2026-07-10" });
      await receiveAccountDeletion(appUserId, tx);
      const [job] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.appUserId, appUserId));
      expect(job.proposedClassification).toBe("settlement_reference");

      const result = await confirmDeletionJob(
        job.id,
        { classification: "settlement_reference", confirmedBy: crypto.randomUUID(), clawbackUntil: "2027-01-31" },
        tx,
      );
      expect(result.outcome).toBe("executed");
      const [settlement] = await tx.select().from(settlementReferences).where(eq(settlementReferences.deletionJobId, job.id));
      expect(settlement.lender).toBe("테스트캐피탈");
      expect(settlement.clawbackUntil).toBe("2027-01-31");
      expect(settlement.status).toBe("pending"); // 기일 입력 → 승격
      // 앱 폴링 최종 상태 — retained + 분류.
      expect(await getDeletionJobState(appUserId, tx)).toEqual({ status: "retained", classification: "settlement_reference" });
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("autoExecuteJob: B 후보 D+5 폴백 = C-스켈레톤(회신 §4) — confirmedBy는 NULL 유지", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴폴백테스트", appUserId })
        .returning({ id: customers.id });
      await tx.insert(customerDeliveries).values({ customerId: c.id, lender: "테스트캐피탈", contractDate: "2026-07-01" });
      const [job] = await tx
        .insert(accountDeletionJobs)
        .values({ appUserId, customerId: c.id, customerCode: code(), proposedClassification: "active_fulfillment" })
        .returning();

      await autoExecuteJob(job, tx);

      const [gone] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, c.id));
      expect(gone).toBeUndefined();
      const [settlement] = await tx.select().from(settlementReferences).where(eq(settlementReferences.deletionJobId, job.id));
      expect(settlement.status).toBe("review_required"); // 자동 폴백은 기일을 모른다
      const [after] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.id, job.id));
      expect(after.executedVia).toBe("auto");
      expect(after.confirmedBy).toBeNull();
      // 실제 실행 분류가 기록돼 앱이 retained/settlement_reference를 받는다(제안값 B가 아니라).
      expect(await getDeletionJobState(appUserId, tx)).toEqual({ status: "retained", classification: "settlement_reference" });
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("D+3 재촉·D+5 자동 실행 창 판정(멤버십 단언 — 공유 DB라 개수 단언 금지)", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const mk = async (interval: string) => {
        const [j] = await tx
          .insert(accountDeletionJobs)
          .values({
            appUserId: crypto.randomUUID(),
            proposedClassification: "purge",
            requestedAt: sql`now() - ${sql.raw(`interval '${interval}'`)}`,
          })
          .returning({ id: accountDeletionJobs.id });
        return j.id;
      };
      const fresh = await mk("1 day");
      const remindDue = await mk("3 days 12 hours");
      const autoDue = await mk("6 days");

      const remindIds = (await listRemindDueJobs(tx)).map((j) => j.id);
      expect(remindIds).toContain(remindDue);
      expect(remindIds).not.toContain(fresh);
      expect(remindIds).not.toContain(autoDue); // 4일 초과는 재촉 창 밖(자동 실행 몫)

      const autoIds = (await listAutoDueJobs(tx)).map((j) => j.id);
      expect(autoIds).toContain(autoDue);
      expect(autoIds).not.toContain(fresh);
      expect(autoIds).not.toContain(remindDue);
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});
