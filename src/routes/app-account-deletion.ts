// 앱 탈퇴 오케스트레이터 전용 엔드포인트(2026-08-01 spec §3a) — JWT가 아니라 **공유 시크릿**
// (X-Push-Secret 선례의 역방향 — 호출자가 앱 Edge Function이라 사용자 세션이 없다).
// 계약(회신 §4): POST 멱등(app_user_id 키) — 202 review_pending(인지 큐 대기) /
// 200 purged·retained(앱이 profile/Auth 삭제 진행 가능) / 5xx = 재시도 안전.
// 앱은 CRM의 200 수신 전 profiles·auth.users를 지우지 않는다(materialize의 번호 읽기가 의존).
import { Hono } from "hono";
import { z } from "zod";

import { getDeletionJobState, receiveAccountDeletion } from "../db/queries/deletion-jobs";
import { tryWaitUntil, type DbVariables } from "../middleware/db";

function resolveSecret(env: unknown): string | null {
  return (env as { APP_DELETION_SECRET?: string } | undefined)?.APP_DELETION_SECRET
    ?? process.env.APP_DELETION_SECRET
    ?? null;
}

// D+0 접수 Discord 알림(회신 §1 "담당자·관리자 알림(CRM 화면 + Discord)") — best-effort.
// 크론 D+3 재촉과 같은 웹훅·같은 PII 규칙(고객코드만 — 이름·전화번호 금지, Discord PII 정리 정책).
// 커밋 후에만 호출된다(트랜잭션 밖) — tx 안에서 쏘면 롤백돼도 알림이 나간 뒤라 오보가 된다.
function notifyDeletionReceived(env: unknown, customerCode: string | null): Promise<unknown> {
  const url = (env as { DELETION_DISCORD_WEBHOOK?: string } | undefined)?.DELETION_DISCORD_WEBHOOK
    ?? process.env.DELETION_DISCORD_WEBHOOK;
  if (!url) {
    console.log("[account-deletion] D+0 접수 — Discord 웹훅 미설정으로 화면 알림만");
    return Promise.resolve();
  }
  const content = `🔔 회원탈퇴 접수 D+0 — ${customerCode ?? "(코드 미상)"}. CRM 고객 목록에서 확인해 주세요. 미확인 시 D+3 재촉 후 D+5 자동 실행됩니다.`;
  // ⚠️ Workers에서 fetch는 전역 직접 호출(plain call)만 — 객체 메서드 경유 시 Illegal invocation(AGENTS.md).
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch((e: unknown) => console.error("[account-deletion] D+0 Discord 알림 실패:", e));
}

export const appAccountDeletion = new Hono<{ Variables: DbVariables }>();

// 시크릿 미설정 = 기능 비활성(503 fail-closed) — 배선 전에 엔드포인트가 열리는 사고 방지.
// 값 등록: CF `bunx wrangler secret put APP_DELETION_SECRET` + 앱 Edge secret(양쪽 동일 값).
// 헤더명은 앱 병합 계약에 통일(2026-08-01 오후 영실 회신 — 구 x-deletion-secret에서 개명.
// 앱 유무가 아니라 `app` 세그먼트 유무가 달랐다). HTTP 헤더 조회는 대소문자 무관.
appAccountDeletion.use("*", async (c, next) => {
  const secret = resolveSecret(c.env);
  if (!secret) return c.json({ error: "탈퇴 연동이 아직 설정되지 않았습니다." }, 503);
  if (c.req.header("x-app-deletion-secret") !== secret) return c.json({ error: "인증 실패" }, 401);
  await next();
});

const bodySchema = z.object({ appUserId: z.uuid() });

// 수동 파싱(me.ts 관례) — zValidator는 malformed JSON에 onError 경유 500이 나가 400을 보장 못 한다.
appAccountDeletion.post("/", async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "잘못된 요청입니다." }, 400);
  const result = await c.var.db.transaction((tx) => receiveAccountDeletion(parsed.data.appUserId, tx));
  // 이번 호출이 인지 큐를 새로 만든 경우에만(멱등 재호출 제외) — 응답을 막지 않게 waitUntil.
  // NODE_ENV 게이트: 라우트 테스트가 공유 master에 실제 큐를 만들므로, 게이트가 없으면 로컬
  // test:server 1회마다 운영 Discord에 실알림이 나간다(알림 트리거 가드와 같은 계열의 함정).
  if (result.queuedCustomerCode !== undefined && process.env.NODE_ENV !== "test") {
    const notify = notifyDeletionReceived(c.env, result.queuedCustomerCode);
    if (!tryWaitUntil(c, notify)) void notify; // 로컬(executionCtx 없음)은 fire-and-forget
  }
  return c.json(result.state, result.state.status === "review_pending" ? 202 : 200);
});

appAccountDeletion.get("/status", async (c) => {
  const parsed = z.uuid().safeParse(c.req.query("appUserId"));
  if (!parsed.success) return c.json({ error: "잘못된 요청입니다." }, 400);
  const state = await getDeletionJobState(parsed.data, c.var.db);
  if (!state) return c.json({ error: "탈퇴 요청 이력이 없습니다." }, 404);
  return c.json(state, state.status === "review_pending" ? 202 : 200);
});
