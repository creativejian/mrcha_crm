import { Hono } from "hono";
import { inArray } from "drizzle-orm";

import { CRM_ROLES } from "../auth/verify";
import { profiles } from "../db/public-app";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";

// 직원 디렉토리(read-only) — 담당자 배정 select의 후보 목록(profiles CRM 역할만).
// 배정이 advisor_id(uuid)를 기록해야 역할 scope(staff=본인 담당)가 성립한다 —
// 클라 ADVISOR_NAMES 목업을 이 디렉토리로 교체하는 후속 PR의 데이터 소스.
export const staff = new Hono<{ Variables: AuthVariables & DbVariables }>();

staff.get("/", async (c) => {
  const rows = await c.var.db
    .select({ id: profiles.id, name: profiles.fullName, role: profiles.role })
    .from(profiles)
    .where(inArray(profiles.role, [...CRM_ROLES]));
  // 이름 없는 계정은 배정 후보로 부적합(표시 불가) — 제외.
  return c.json(rows.filter((r) => r.name?.trim()));
});
