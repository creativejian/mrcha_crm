import { Hono } from "hono";
import { z } from "zod";

import { getLiveReceiving, setLiveReceiving } from "../db/queries/staff-settings";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";

// 로그인 상담사 본인 개인 설정(/api/me/*). self만 접근하므로 역할 scope 무관 — auth 미들웨어만 통과하면 된다.
export const me = new Hono<{ Variables: AuthVariables & DbVariables }>();

me.get("/live-consulting", async (c) => {
  const receiving = await getLiveReceiving(c.var.user.id, c.var.db);
  return c.json({ receiving });
});

const patchSchema = z.object({ receiving: z.boolean() });

// zValidator("json") 대신 수동 파싱 — app.onError가 HTTPException을 500으로 삼켜서(기존 zValidator 라우트는
// malformed JSON에 500 반환), 깨진 body에도 400을 보장하려는 의도적 우회. 일관성 명목으로 zValidator 전환 금지.
me.patch("/live-consulting", async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "잘못된 요청입니다." }, 400);
  const receiving = await setLiveReceiving(c.var.user.id, parsed.data.receiving, c.var.db);
  return c.json({ receiving });
});
