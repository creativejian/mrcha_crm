import { getDefaultDb } from "../db/client";
import { profiles } from "../db/public-app";
import { customers } from "../db/schema";

// 아직 어떤 CRM 고객에도 연결되지 않은 실 profile id — customers.appUserId를 세팅하는 픽스처 전용.
// `limit(1)` "아무 profile"은 이미 연결된 profile(실측 2/16)을 뽑을 수 있고, 그러면 실 고객과의
// 일시 중복이 customers_app_user_id_unique(partial unique index, 0030)에 걸려 간헐 실패한다(0713 감사).
// (consultations 테스트 2파일의 동명 로컬 헬퍼가 원본 — 공유화. 그쪽 이관은 별도 PR과의 충돌 회피로 보류.)
export async function anyUnlinkedProfileId(): Promise<string> {
  const db = getDefaultDb();
  const allProfiles = await db.select({ id: profiles.id }).from(profiles);
  const linkedRows = await db.select({ appUserId: customers.appUserId }).from(customers);
  const linked = new Set(linkedRows.map((r) => r.appUserId).filter((v): v is string => v != null));
  const free = allProfiles.find((p) => !linked.has(p.id));
  if (!free) throw new Error("연결되지 않은 profile이 없어 테스트 불가(실 master DB 전제)");
  return free.id;
}
