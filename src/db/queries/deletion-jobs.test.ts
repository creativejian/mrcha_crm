import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { withNotifyGuard } from "../../test-utils/notify-gate";
import { getTestDb } from "../../test-utils/hermetic-db";
import { accountDeletionJobs, customerDeletions, customerDeliveries, customers, settlementReferences } from "../schema";
import {
  autoExecuteJob,
  bumpSettlementReviewDue,
  confirmDeletionJob,
  getDeletionJobState,
  listAutoDueJobs,
  listRemindDueJobs,
  listReviewDueSettlements,
  receiveAccountDeletion,
} from "./deletion-jobs";

// 탈퇴 잡 상태기계 실 DB 검증 — 전 케이스 트랜잭션 롤백(잔재 0).
// appUserId는 전부 random uuid(loose id — profiles 실존 불요. materialize 경로만 실 profile이
// 필요하고 그건 account-deletion.test.ts가 커버). 공유 master라 목록 단언은 멤버십으로만
// (다른 세션·라우트 테스트의 커밋 잡이 섞일 수 있다 — 개수 단언 금지).

// dual-mode(hermetic-db.ts): 로컬 test:server = 실 master(기존 그대로), CI test:pure = PGlite.
const db = await getTestDb();
const ROLLBACK = "__rollback__";
const code = () => `CU-ACCDEL-${crypto.randomUUID().slice(0, 8)}`;

test("receive: 연결 고객 없는 유저 → 즉시 purged + 잡 executed(감사)", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      const r = await receiveAccountDeletion(appUserId, tx);
      expect(r.state).toEqual({ status: "purged" });
      expect(r.queuedCustomerCode).toBeUndefined(); // 큐 미생성 = D+0 알림 없음
      const [job] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.appUserId, appUserId));
      expect(job.status).toBe("executed");
      expect(job.executedVia).toBe("auto");
      expect(job.customerId).toBeNull();
      // 재호출 멱등 — 같은 상태, 잡 1행 유지.
      expect((await receiveAccountDeletion(appUserId, tx)).state).toEqual({ status: "purged" });
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

      const r = await receiveAccountDeletion(appUserId, tx);
      expect(r.state).toEqual({ status: "review_pending" });
      expect(r.queuedCustomerCode).toBe(c.customerCode); // 신규 큐 = 라우트 D+0 알림 신호
      const again = await receiveAccountDeletion(appUserId, tx);
      expect(again.state).toEqual({ status: "review_pending" });
      expect(again.queuedCustomerCode).toBeUndefined(); // 멱등 재호출은 재알림하지 않는다
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
      // 앱 폴링 최종 상태 — retained + 분류 + 보존 근거·기한 + 재검토 필드(영실 2차 회신).
      // clawback 확정 = pending 승격 + 재검토 주기 해제(reviewDueAt null).
      expect(await getDeletionJobState(appUserId, tx)).toEqual({
        status: "retained",
        classification: "settlement_reference",
        retentionBasis: "출고 후 정산·환수 참조 보존(개인정보 파기 완료)",
        retentionUntil: "2027-01-31T23:59:59+09:00",
        reviewStatus: "pending",
        reviewDueAt: null,
      });
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("confirm B(한시 보존): retained 응답에 retentionBasis + 미래 retentionUntil이 실린다(앱 계약)", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      await tx.insert(customers).values({ customerCode: code(), name: "탈퇴보존응답테스트", appUserId });
      await receiveAccountDeletion(appUserId, tx);
      const [job] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.appUserId, appUserId));

      const until = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const result = await confirmDeletionJob(
        job.id,
        { classification: "active_fulfillment", confirmedBy: crypto.randomUUID(), retentionUntil: until },
        tx,
      );
      expect(result.outcome).toBe("executed");
      const state = await getDeletionJobState(appUserId, tx);
      expect(state).toEqual({
        status: "retained",
        classification: "active_fulfillment",
        retentionBasis: "출고 연락·조율", // 라우트/디스패치 기본값 — 비어 있지 않음 보장
        retentionUntil: until.toISOString(),
      });
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
      // 자동 폴백 = clawback 미확정: retentionUntil null + **안전장치**(영실 2차 회신 계약) —
      // reviewStatus review_required + 미래 reviewDueAt(30일 주기)이 앱 완료 인정 조건.
      const state = await getDeletionJobState(appUserId, tx);
      expect(state).toMatchObject({
        status: "retained",
        classification: "settlement_reference",
        retentionBasis: "출고 후 정산·환수 참조 보존(개인정보 파기 완료)",
        retentionUntil: null,
        reviewStatus: "review_required",
      });
      const reviewDueAt = state?.status === "retained" ? state.reviewDueAt : null;
      expect(reviewDueAt).not.toBeNull();
      expect(new Date(reviewDueAt!).getTime()).toBeGreaterThan(Date.now());
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("autoExecuteJob: purge 제안 잡 자동 실행 — 고객 파기 + effective purge 기록 + 폴링 purged", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴자동퍼지테스트", appUserId })
        .returning({ id: customers.id });
      const [job] = await tx
        .insert(accountDeletionJobs)
        .values({ appUserId, customerId: c.id, customerCode: code(), proposedClassification: "purge" })
        .returning();

      const r = await autoExecuteJob(job, tx);
      expect(r.skipped).toBeUndefined();

      const [gone] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, c.id));
      expect(gone).toBeUndefined();
      const [after] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.id, job.id));
      expect(after.status).toBe("executed");
      expect(after.executedVia).toBe("auto");
      expect(after.confirmedClassification).toBe("purge");
      expect(await getDeletionJobState(appUserId, tx)).toEqual({ status: "purged" });
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("경합 방어: 확인(confirm)이 선점한 잡은 stale 스냅샷 autoExecuteJob이 skip한다(보존 고객 재파기 금지)", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴경합테스트", appUserId })
        .returning({ id: customers.id });
      // 크론이 트랜잭션 밖에서 읽었을 stale 스냅샷 역할 — 이 시점엔 received.
      const [staleJob] = await tx
        .insert(accountDeletionJobs)
        .values({ appUserId, customerId: c.id, customerCode: code(), proposedClassification: "active_fulfillment" })
        .returning();

      // 스태프가 먼저 B(보존)로 확정.
      const until = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const confirmed = await confirmDeletionJob(
        staleJob.id,
        { classification: "active_fulfillment", confirmedBy: crypto.randomUUID(), retentionUntil: until },
        tx,
      );
      expect(confirmed.outcome).toBe("executed");

      // 크론의 stale 실행 — FOR UPDATE 재확인이 잡아 skip해야 한다.
      const r = await autoExecuteJob(staleJob, tx);
      expect(r.skipped).toBe(true);
      expect(r.storagePaths).toEqual([]);

      // 보존 고객 무손상 + 잡은 confirm 기록 그대로(C 폴백으로 덮어쓰지 않음) + 정산 스켈레톤 없음.
      const [alive] = await tx.select({ id: customers.id, retentionBasis: customers.retentionBasis }).from(customers).where(eq(customers.id, c.id));
      expect(alive.id).toBe(c.id);
      const [after] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.id, staleJob.id));
      expect(after.executedVia).toBe("confirm");
      expect(after.confirmedClassification).toBe("active_fulfillment");
      const settlements = await tx.select().from(settlementReferences).where(eq(settlementReferences.deletionJobId, staleJob.id));
      expect(settlements).toHaveLength(0);
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("no-op 실행(고객이 이미 없음): 요청 분류 대신 effective purge를 기록해 앱 잠금을 막는다", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const appUserId = crypto.randomUUID();
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "탈퇴선삭제테스트", appUserId })
        .returning({ id: customers.id });
      const [job] = await tx
        .insert(accountDeletionJobs)
        .values({ appUserId, customerId: c.id, customerCode: code(), proposedClassification: "settlement_reference" })
        .returning();
      // 스태프 수동 삭제(#212 등)로 고객이 잡보다 먼저 사라진 상황.
      await tx.delete(customers).where(eq(customers.id, c.id));

      await autoExecuteJob(job, tx);

      const [after] = await tx.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.id, job.id));
      expect(after.status).toBe("executed");
      // settlement_reference 그대로 박제하면 앱이 "정산행 없는 retained"(retentionUntil null +
      // reviewDueAt null)를 받아 완료 인정 조건 미달로 영구 재시도한다 — purge가 실제 결과다.
      expect(after.confirmedClassification).toBe("purge");
      expect(await getDeletionJobState(appUserId, tx)).toEqual({ status: "purged" });
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

test("정산 재검토 30일 주기: 도래 건 선별 → bump 후 창에서 빠진다", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const [due] = await tx
        .insert(settlementReferences)
        .values({ lender: "재검토테스트캐피탈", reviewDueAt: sql`now() - interval '1 day'` })
        .returning({ id: settlementReferences.id });
      const [notDue] = await tx
        .insert(settlementReferences)
        .values({ lender: "재검토테스트캐피탈" }) // DB 기본값 = +30일(미래)
        .returning({ id: settlementReferences.id });

      const dueIds = (await listReviewDueSettlements(tx)).map((s) => s.id);
      expect(dueIds).toContain(due.id);
      expect(dueIds).not.toContain(notDue.id);

      await bumpSettlementReviewDue([due.id], tx);
      expect((await listReviewDueSettlements(tx)).map((s) => s.id)).not.toContain(due.id);
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
      // ⚠️ 픽스처는 **경계 ±1시간**이어야 한다(2026-08-06 배치 16 변이 실측).
      // 구 픽스처(1일 · 3일12시간 · 6일)는 멤버십 3단언이 성립하는 임계값 범위가 넓었다 —
      // D+5는 **(3.5일, 6일] 어디에 있어도 초록**이고 D+3 하한은 (1일, 3.5일]이었다.
      // 즉 `interval '5 days'`를 `'4 days'`로 바꿔도 이 테스트가 통과했다(실제로 주입해 확인).
      // D+5는 **앱 팀에 통보한 유예**이고 지나면 되돌릴 수 없는 파기가 자동 실행되므로, 하루가
      // 조용히 밀리면 그 자체로 계약 위반이다. 게다가 보존 30일과 달리 **상수 tripwire가 없어**
      // (인라인 SQL 리터럴) 이 픽스처가 유일한 그물이다 — `#442`가 보존 기한에서 한 처방과 같다.
      const beforeRemind = await mk("2 days 23 hours"); // D+3 직전 — 재촉 아직
      const afterRemind = await mk("3 days 1 hour"); // D+3 직후 — 재촉 창 진입
      const beforeRemindEnd = await mk("3 days 23 hours"); // D+4 직전 — 아직 재촉 창
      const afterRemindEnd = await mk("4 days 1 hour"); // D+4 직후 — 재촉 창 이탈
      const beforeAuto = await mk("4 days 23 hours"); // D+5 직전 — 자동 실행 아직
      const afterAuto = await mk("5 days 1 hour"); // D+5 직후 — 자동 실행 대상

      const remindIds = (await listRemindDueJobs(tx)).map((j) => j.id);
      expect(remindIds).not.toContain(beforeRemind);
      expect(remindIds).toContain(afterRemind);
      expect(remindIds).toContain(beforeRemindEnd);
      expect(remindIds).not.toContain(afterRemindEnd); // 4일 초과는 재촉 창 밖(자동 실행 몫)

      const autoIds = (await listAutoDueJobs(tx)).map((j) => j.id);
      expect(autoIds).not.toContain(beforeAuto);
      expect(autoIds).toContain(afterAuto);

      // D+4~D+5는 **어느 쪽에도 안 잡히는 게 의도**다(재촉은 이미 했고 자동 실행 대기).
      // 두 창이 겹치거나 벌어지면 여기서 드러난다.
      expect(remindIds).not.toContain(beforeAuto);
      expect(autoIds).not.toContain(afterRemind);
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});
