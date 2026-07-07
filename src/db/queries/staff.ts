import { eq } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { profiles } from "../public-app";

// 현재 로그인 사용자 표시명(profiles.full_name) — /ask 시스템 프롬프트의 사용자 컨텍스트용. 없으면 null.
// (current_user 도구 리포트는 역할·담당 수까지 필요해 실행기가 직접 조회 — 여긴 이름 1컬럼 최소 조회.)
export async function getStaffName(userId: string, ex: Executor = getDefaultDb()): Promise<string | null> {
  const [row] = await ex.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, userId));
  return row?.name?.trim() || null;
}
