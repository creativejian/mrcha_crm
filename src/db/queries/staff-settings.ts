import { eq, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { staffSettings } from "../schema";

// 상담사 실시간 상담 수신 상태 — 행 없으면 기본 On(true).
export async function getLiveReceiving(userId: string, ex: Executor = getDefaultDb()): Promise<boolean> {
  const [row] = await ex
    .select({ receiving: staffSettings.liveReceiving })
    .from(staffSettings)
    .where(eq(staffSettings.staffUserId, userId));
  return row?.receiving ?? true;
}

// upsert(상담사당 1행). updated_at 갱신.
export async function setLiveReceiving(userId: string, receiving: boolean, ex: Executor = getDefaultDb()): Promise<boolean> {
  await ex
    .insert(staffSettings)
    .values({ staffUserId: userId, liveReceiving: receiving, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: staffSettings.staffUserId,
      set: { liveReceiving: receiving, updatedAt: sql`now()` },
    });
  return receiving;
}
