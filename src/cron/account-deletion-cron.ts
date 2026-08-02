// 탈퇴 잡 일일 크론(2026-08-01 spec §3d) — D+3 Discord 재촉 · D+5 자동 실행 · 보존 기한 도래 수렴 · 정산 재검토.
// Workers scheduled 핸들러에서 호출된다(웹 요청 밖 — Hono c.env가 없어 env를 직접 받는다).
// 스케줄 = wrangler.jsonc triggers.crons "0 1 * * *"(01:00 UTC = 10:00 KST — 재촉이 업무 시간에 닿게).
import { createDbClient, getDefaultDb } from "../db/client";
import { executeRetentionConvergence, listRetentionDueCustomers } from "../db/queries/account-deletion";
import { autoExecuteDueJobs, bumpSettlementReviewDue, listRemindDueJobs, listReviewDueSettlements } from "../db/queries/deletion-jobs";
import { removeObjects } from "../lib/storage";

export type DeletionCronEnv = {
  HYPERDRIVE?: { connectionString: string };
  /** 미설정이면 재촉은 로그만 남기고 스킵(화면 인박스가 1차 알림 — spec §3d). */
  DELETION_DISCORD_WEBHOOK?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};

export async function runAccountDeletionCron(env: DeletionCronEnv): Promise<void> {
  // prod = Hyperdrive 요청별 클라이언트(웹 요청과 동일 관례 — Workers는 소켓 재사용 불가).
  // 로컬·테스트 = 싱글톤 폴백.
  const made = env.HYPERDRIVE?.connectionString ? createDbClient(env.HYPERDRIVE.connectionString) : null;
  const db = made?.db ?? getDefaultDb();
  try {
    const remindDue = await listRemindDueJobs(db);
    if (remindDue.length > 0) await notifyDiscordReminder(env, remindDue);

    const result = await autoExecuteDueJobs(db);
    if (result.executed > 0) {
      console.log(`[account-deletion] D+5 자동 실행 ${result.executed}건`);
      await removeObjects(
        { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY },
        result.storagePaths,
      ).catch((e: unknown) => console.error("[account-deletion] Storage 정리 실패:", e));
    }

    // 보존 기한 도래 수렴(회신 §2-B "§4의 잡이 담당") — retention_until이 지난 B 보존 고객의
    // 개인정보를 파기한다. 출고 완료 흔적이 있으면 정산 스켈레톤으로 축소, 없으면 전체 파기.
    // 고객별 독립 트랜잭션(D+5 자동 실행과 같은 격리 관례 — 1건 실패가 나머지를 막지 않는다).
    const retentionDue = await listRetentionDueCustomers(db);
    if (retentionDue.length > 0) {
      console.log(`[account-deletion] 보존 기한 도래 ${retentionDue.length}건`);
      const retentionPaths: string[] = [];
      const converged: { customerCode: string; settlement: boolean }[] = [];
      for (const c of retentionDue) {
        try {
          const r = await db.transaction((tx) => executeRetentionConvergence(c.id, tx));
          if (r) {
            retentionPaths.push(...r.storagePaths);
            converged.push({ customerCode: c.customerCode, settlement: r.settlementId !== null });
          }
        } catch (e) {
          console.error(`[account-deletion] 보존 기한 수렴 실패 customer=${c.customerCode}:`, e);
        }
      }
      if (retentionPaths.length > 0) {
        await removeObjects(
          { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY },
          retentionPaths,
        ).catch((e: unknown) => console.error("[account-deletion] Storage 정리 실패:", e));
      }
      if (converged.length > 0) await notifyDiscordRetentionConverged(env, converged);
    }

    // 정산 재검토 30일 주기(영실 회신 안전장치) — review_required && 재검토일 도래 건을 재알림하고
    // +30일 굴린다. 웹훅이 없어도 로그는 남고 주기는 굴러간다(알림 채널은 best-effort — 정산
    // 목록 화면은 후속 UI 몫이고, 이 주기의 목적은 "무기한 방치 방지" 흔적을 기계로 남기는 것).
    const reviewDue = await listReviewDueSettlements(db);
    if (reviewDue.length > 0) {
      console.log(`[account-deletion] 정산 재검토 도래 ${reviewDue.length}건`);
      await notifyDiscordSettlementReview(env, reviewDue);
      await bumpSettlementReviewDue(reviewDue.map((s) => s.id), db);
    }
  } finally {
    if (made) await made.client.end();
  }
}

async function notifyDiscordSettlementReview(
  env: DeletionCronEnv,
  rows: { id: string; lender: string | null; createdAt: Date }[],
): Promise<void> {
  const url = env.DELETION_DISCORD_WEBHOOK;
  if (!url) return;
  const lines = rows
    .map((s) => `· ${s.lender ?? "금융사 미상"} (${s.createdAt.toISOString().slice(0, 10)} 생성, id ${s.id.slice(0, 8)}…)`)
    .join("\n");
  const content = `📋 탈퇴 정산 참조 재검토 도래 ${rows.length}건 — 환수 기한(clawback) 확정 또는 정산 종결 여부를 확인해 주세요. 다음 재검토는 30일 후입니다.\n${lines}`;
  // ⚠️ Workers에서 fetch는 전역 직접 호출(plain call)만 — 객체 메서드 경유 시 Illegal invocation(AGENTS.md).
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch((e: unknown) => console.error("[account-deletion] 정산 재검토 알림 실패:", e));
}

async function notifyDiscordRetentionConverged(
  env: DeletionCronEnv,
  rows: { customerCode: string; settlement: boolean }[],
): Promise<void> {
  const url = env.DELETION_DISCORD_WEBHOOK;
  if (!url) return;
  const lines = rows.map((r) => `· ${r.customerCode} (${r.settlement ? "정산 참조로 축소" : "전체 파기"})`).join("\n");
  const content = `⏳ 탈퇴 보존 기한 도래 — ${rows.length}건의 개인정보를 파기했습니다.\n${lines}`;
  // ⚠️ Workers에서 fetch는 전역 직접 호출(plain call)만 — 객체 메서드 경유 시 Illegal invocation(AGENTS.md).
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch((e: unknown) => console.error("[account-deletion] 보존 기한 파기 알림 실패:", e));
}

async function notifyDiscordReminder(
  env: DeletionCronEnv,
  jobs: { customerCode: string | null }[],
): Promise<void> {
  const url = env.DELETION_DISCORD_WEBHOOK;
  if (!url) {
    console.log(`[account-deletion] D+3 재촉 대상 ${jobs.length}건 — Discord 웹훅 미설정으로 스킵(화면 인박스만)`);
    return;
  }
  const codes = jobs.map((j) => j.customerCode ?? "(미연결)").join(", ");
  const content = `🔔 회원탈퇴 확인 대기 D+3 — ${codes}. 이틀 뒤(D+5) 자동 실행됩니다. CRM 고객 목록에서 확인해 주세요.`;
  // ⚠️ Workers에서 fetch는 전역 직접 호출(plain call)만 — 객체 메서드 경유 시 Illegal invocation(AGENTS.md).
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch((e: unknown) => console.error("[account-deletion] Discord 재촉 실패:", e));
}
