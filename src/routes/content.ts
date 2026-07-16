// 앱 콘텐츠(insights·knowledge_articles) 읽기 전용 라우트 — CRM admin 참조 화면.
// 앱은 staff 이상이 CRUD하지만 CRM은 admin read only(더 좁은 게이트). write·임베딩은 앱 소유.
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getInsight, getKnowledgeArticle, listInsights, listKnowledgeArticles } from "../db/queries/content";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

type Vars = { Variables: AuthVariables & DbVariables };

const idParam = z.object({ id: z.uuid() });

// admin 전용 게이트 — customers.ts 삭제 라우트와 동일 패턴(role은 JWT user_role claim, auth/verify.ts).
export const insightsRoute = new Hono<Vars>();
insightsRoute.use("*", async (c, next) => {
  if (c.var.user.role !== "admin") return c.json({ error: "권한이 없습니다." }, 403);
  await next();
});
insightsRoute.get("/", (c) => run(c, () => listInsights(c.var.db)));
insightsRoute.get("/:id", zValidator("param", idParam), (c) => run(c, () => getInsight(c.req.valid("param").id, c.var.db), "인사이트를 찾을 수 없습니다."));

export const knowledgeRoute = new Hono<Vars>();
knowledgeRoute.use("*", async (c, next) => {
  if (c.var.user.role !== "admin") return c.json({ error: "권한이 없습니다." }, 403);
  await next();
});
knowledgeRoute.get("/", (c) => run(c, () => listKnowledgeArticles(c.var.db)));
knowledgeRoute.get("/:id", zValidator("param", idParam), (c) => run(c, () => getKnowledgeArticle(c.req.valid("param").id, c.var.db), "지식 문서를 찾을 수 없습니다."));
