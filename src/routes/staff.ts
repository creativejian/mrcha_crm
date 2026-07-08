import { Hono } from "hono";
import { asc, eq, inArray, sql } from "drizzle-orm";

import { profiles } from "../db/public-app";
import { staffSettings } from "../db/schema";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";

// 배정 후보 역할 — CRM_ROLES(로그인 게이트 어휘, dealer 포함)보다 좁다. dealer는 담당 고객 개념이 없어
// scope가 fail-closed(assistant-scope)인데, 배정 후보로 노출되면 배정되는 순간 그 고객의 AI 조회가 열려
// 전제가 깨진다. verify.ts에 두지 않는다 — CRM_ROLES는 Edge 복제본 패리티 테스트 잠금 대상(접점 회피).
export const ADVISOR_ROLES = ["admin", "manager", "staff"] as const;

// 직원 디렉토리(read-only) — 담당자 배정 select의 후보 목록(profiles 배정 후보 역할만).
// 배정이 advisor_id(uuid)를 기록해야 역할 scope(staff=본인 담당)가 성립한다 —
// 클라 배정 편집기·목록 필터(#177)의 데이터 소스.
export const staff = new Hono<{ Variables: AuthVariables & DbVariables }>();

staff.get("/", async (c) => {
  const rows = await c.var.db
    .select({
      id: profiles.id,
      name: profiles.fullName,
      role: profiles.role,
      // 실시간 상담 수신 상태 — 설정 없는 계정은 기본 On(true). 실시간 상담 배정 select만 소비(고객 담당자 배정은 무시).
      liveReceiving: sql<boolean>`coalesce(${staffSettings.liveReceiving}, true)`,
    })
    .from(profiles)
    .leftJoin(staffSettings, eq(staffSettings.staffUserId, profiles.id))
    .where(inArray(profiles.role, [...ADVISOR_ROLES]))
    // 이름순 고정(id 타이브레이커) — ORDER BY 없는 SELECT는 heap 순서라 배정 편집기의 staff[0]
    // 기본 선택과 필터 옵션 순서가 세션 간 비결정이 된다.
    .orderBy(asc(profiles.fullName), asc(profiles.id));
  // 이름 없는 계정은 배정 후보로 부적합(표시 불가) — 제외.
  return c.json(rows.filter((r) => r.name?.trim()));
});
