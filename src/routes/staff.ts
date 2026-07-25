import { Hono } from "hono";
import { asc, eq, inArray, sql } from "drizzle-orm";

import { CRM_ROLES } from "../auth/verify";
import { profiles } from "../db/public-app";
import { customers, staffSettings } from "../db/schema";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { requireRoles } from "../middleware/role-gate";

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

// 조직 구성원 디렉토리(대표 전용) — `/org-members` 화면의 「구성원」 탭 소스.
// ⚠️ **위 `GET /`(배정 후보)와 의도적으로 다른 어휘**다: 여기는 `CRM_ROLES` 전부(**dealer 포함**).
// 조직 화면은 "누가 CRM에 접근하고 무슨 권한을 갖는가"를 보는 곳이라 접근 주체가 빠지면 안 되고,
// 배정 후보에 dealer가 섞이면 안 되는 이유는 위 ADVISOR_ROLES 주석 참조. 두 목적이 갈리므로
// 파라미터로 한 API를 넓히지 않고 **엔드포인트를 나눈다**(배정 API의 기본 동작 불변).
// CRM_ROLES를 직접 import해 드리프트를 원천 차단한다 — 역할이 추가/삭제되면 자동 반영된다.
//
// 게이트 = admin 단독. 화면 메뉴가 `isAdminRole`(=최고관리자)일 때만 노출되므로(Topbar) 서버도 같게
// 맞춘다 — 전 구성원 목록 + 담당 고객 수는 조직 운영 정보라 fail-closed가 맞다.
staff.get("/org", requireRoles(["admin"]), async (c) => {
  const rows = await c.var.db
    .select({
      id: profiles.id,
      name: profiles.fullName,
      role: profiles.role,
      liveReceiving: sql<boolean>`coalesce(${staffSettings.liveReceiving}, true)`,
      // 담당 고객 수 — 조직 화면이 쓰는 유일한 고객 데이터(집계뿐이라 role scope 무관).
      // 상관 서브쿼리를 쓴다: customers를 조인하면 staff_settings 조인과 곱해져 카운트가 부풀고,
      // 담당 0명인 구성원이 사라진다(inner 성격).
      assignedCustomers: sql<number>`(select count(*)::int from ${customers} where ${customers.advisorId} = ${profiles.id})`,
    })
    .from(profiles)
    .leftJoin(staffSettings, eq(staffSettings.staffUserId, profiles.id))
    .where(inArray(profiles.role, [...CRM_ROLES]))
    // 역할 우선순위(대표 → 팀장 → 상담사 → 딜러) 후 이름순. ORDER BY 없는 SELECT는 heap 순서라
    // 세션마다 행 순서가 바뀐다(배정 후보 API와 같은 이유).
    .orderBy(
      sql`case ${profiles.role}::text when 'admin' then 0 when 'manager' then 1 when 'staff' then 2 when 'dealer' then 3 else 4 end`,
      asc(profiles.fullName),
      asc(profiles.id),
    );
  // 이름 없는 계정은 표시 불가 — 배정 후보 API와 같은 규칙.
  return c.json(rows.filter((r) => r.name?.trim()));
});
