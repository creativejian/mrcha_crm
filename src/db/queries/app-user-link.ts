import { and, eq, ne } from "drizzle-orm";

import { ConflictError, LinkConflictError } from "../../lib/errors";
import { getDefaultDb, type Executor } from "../client";
import { customers } from "../schema";

// 앱 계정 ↔ CRM 고객 연결 가드 SSOT — 견적요청·상담신청 link가 공유한다.
// (0713 감사: byte 동일 가드·사용자 노출 문구가 두 쿼리 모듈에 축자 복제돼, 파리티 테스트 없이
// 한쪽만 바뀌면 #225 안내 UX가 경로별로 갈리는 드리프트 축이었다.)
//
// 정방향: 들어오는 userId가 이미 다른 고객에 연결 → LinkConflictError(409 + conflict 동봉 —
//   클라 "그 고객으로 이동" 안내, 이사님 2026-07-13 ②). app_user_id 중복 고객은 요청 청크의
//   고객 귀속(임베딩·staff scope)을 비결정으로 만든다.
// 역방향: 대상 고객이 이미 다른 앱 계정에 연결 → ConflictError. 덮어쓰면 원래 계정의 요청·상담이
//   매칭을 잃는다. 같은 계정 재연결은 멱등이라 통과.
// 경합 주의: 이 가드는 잠금 없는 SELECT라 동시 요청의 TOCTOU 창을 닫지 못한다 — 최후 방어선은
//   customers_app_user_id_unique partial index(23505 → run()이 연결 충돌 문구로 매핑).
// 반환: 대상 고객 행(phone — 상담신청의 빈 연락처 보강용) / 대상 고객 없음 null.
export async function assertAppUserLinkable(
  userId: string,
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ phone: string | null; appUserId: string | null } | null> {
  const [linked] = await ex
    .select({ customerCode: customers.customerCode, name: customers.name })
    .from(customers)
    .where(and(eq(customers.appUserId, userId), ne(customers.id, customerId)));
  if (linked) throw new LinkConflictError(`이 앱 계정은 이미 ${linked.name}(${linked.customerCode}) 고객에 연결돼 있습니다.`, linked);

  const [target] = await ex
    .select({ phone: customers.phone, appUserId: customers.appUserId })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!target) return null;
  if (target.appUserId && target.appUserId !== userId) {
    throw new ConflictError("이 고객은 이미 다른 앱 계정에 연결돼 있습니다.");
  }
  return target;
}
