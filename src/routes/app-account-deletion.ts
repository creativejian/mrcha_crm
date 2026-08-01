// 앱 탈퇴 오케스트레이터 전용 엔드포인트(2026-08-01 spec §3a) — JWT가 아니라 **공유 시크릿**
// (X-Push-Secret 선례의 역방향 — 호출자가 앱 Edge Function이라 사용자 세션이 없다).
// 계약(회신 §4): POST 멱등(app_user_id 키) — 202 review_pending(인지 큐 대기) /
// 200 purged·retained(앱이 profile/Auth 삭제 진행 가능) / 5xx = 재시도 안전.
// 앱은 CRM의 200 수신 전 profiles·auth.users를 지우지 않는다(materialize의 번호 읽기가 의존).
import { Hono } from "hono";
import { z } from "zod";

import { getDeletionJobState, receiveAccountDeletion } from "../db/queries/deletion-jobs";
import type { DbVariables } from "../middleware/db";

function resolveSecret(env: unknown): string | null {
  return (env as { APP_DELETION_SECRET?: string } | undefined)?.APP_DELETION_SECRET
    ?? process.env.APP_DELETION_SECRET
    ?? null;
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
  const state = await c.var.db.transaction((tx) => receiveAccountDeletion(parsed.data.appUserId, tx));
  return c.json(state, state.status === "review_pending" ? 202 : 200);
});

appAccountDeletion.get("/status", async (c) => {
  const parsed = z.uuid().safeParse(c.req.query("appUserId"));
  if (!parsed.success) return c.json({ error: "잘못된 요청입니다." }, 400);
  const state = await getDeletionJobState(parsed.data, c.var.db);
  if (!state) return c.json({ error: "탈퇴 요청 이력이 없습니다." }, 404);
  return c.json(state, state.status === "review_pending" ? 202 : 200);
});
