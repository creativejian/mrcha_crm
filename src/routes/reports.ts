// 경영 리포트 집계 API — spec: ref/specs/2026-08-02-crm-admin-report-live-design.md §3.
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getAdminReport } from "../db/queries/reports";
import { currentMonthKey, isMonthKey } from "../lib/report-month";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { requireRoles } from "../middleware/role-gate";
import { run } from "./shared";

export const reports = new Hono<{ Variables: AuthVariables & DbVariables }>();

// admin 단독 게이트(읽기 포함) — 경영 지표는 조직 전체의 실적·유입이라 fail-closed가 맞다
// (`staff.get("/org")` 선례). 화면도 isAdmin일 때만 /admin-dashboard를 렌더하지만 그건 UX 게이트일 뿐,
// 진짜 게이트는 여기다. 라우트 선언보다 앞이어야 작동한다.
reports.use("*", requireRoles(["admin"]));

const monthQuery = z.object({
  // 생략 = KST 현재 월. 형식 이탈은 400(fail-loud) — 조용히 현재 월로 폴백하면 오타난 월을 보고
  // 이사님이 "그 달 숫자"로 읽는다. 미래 월은 허용한다(빈 결과가 정직한 답).
  month: z
    .string()
    .refine(isMonthKey, "month는 YYYY-MM 형식이어야 합니다.")
    .optional(),
});

reports.get("/admin", zValidator("query", monthQuery), (c) => {
  const { month } = c.req.valid("query");
  return run(c, () => getAdminReport(month ?? currentMonthKey(), c.var.db));
});
