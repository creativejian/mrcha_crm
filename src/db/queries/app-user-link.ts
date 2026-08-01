import { and, eq, ne, sql } from "drizzle-orm";

import { normalizePhoneDigits, resolvePhoneOnLink } from "../../lib/customer-phone";
import { ConflictError, LinkConflictError } from "../../lib/errors";
import { getDefaultDb, type Executor } from "../client";
import { profiles } from "../public-app";
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
// 반환: 대상 고객 행(phone/phoneSecondary — applyAppUserLink의 전화번호 전이 입력) / 대상 고객 없음 null.
async function assertAppUserLinkable(
  userId: string,
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ phone: string | null; phoneSecondary: string | null; appUserId: string | null } | null> {
  const [linked] = await ex
    .select({ customerCode: customers.customerCode, name: customers.name })
    .from(customers)
    .where(and(eq(customers.appUserId, userId), ne(customers.id, customerId)));
  if (linked) throw new LinkConflictError(`이 앱 계정은 이미 ${linked.name}(${linked.customerCode}) 고객에 연결돼 있습니다.`, linked);

  const [target] = await ex
    .select({ phone: customers.phone, phoneSecondary: customers.phoneSecondary, appUserId: customers.appUserId })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!target) return null;
  if (target.appUserId && target.appUserId !== userId) {
    throw new ConflictError("이 고객은 이미 다른 앱 계정에 연결돼 있습니다.");
  }
  return target;
}

// 연결 실행 SSOT — 가드 + 전화번호 전이(2026-07-17 spec §3-4) + UPDATE를 한 곳에.
// 견적요청·상담신청 link가 이걸 공유한다(0713 감사 이후 남아 있던 마지막 비대칭 — 상담 link만
// 빈 연락처를 폼 번호로 보강하던 것 — 이 함수로 소멸. 주 번호 표시는 read-through 합성이 담당).
// droppedPhone: secondary가 다른 값으로 점유돼 옮기지 못한 기존 phone(라우트 응답에 동봉 — 클라 토스트).
export async function applyAppUserLink(
  userId: string,
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; customerCode: string; name: string; appUserId: string; droppedPhone: string | null } | null> {
  const target = await assertAppUserLinkable(userId, customerId, ex);
  if (!target) return null;
  const [profile] = await ex
    .select({ phoneNumber: profiles.phoneNumber })
    .from(profiles)
    .where(eq(profiles.id, userId));
  const transition = resolvePhoneOnLink({
    currentPhone: target.phone,
    currentSecondary: target.phoneSecondary,
    appPhone: profile?.phoneNumber ?? null,
  });
  const [row] = await ex
    .update(customers)
    // phone=NULL은 CHECK 불변식(app_user_id ↔ phone 배타) 성립 조건 — 전이 규칙과 무관하게 항상.
    .set({ appUserId: userId, phone: null, phoneSecondary: transition.phoneSecondary, updatedAt: sql`now()` })
    .where(eq(customers.id, customerId))
    .returning({ id: customers.id, customerCode: customers.customerCode, name: customers.name });
  return row ? { ...row, appUserId: userId, droppedPhone: transition.droppedPhone } : null;
}

// 연결 해제 SSOT(2026-08-01 회원탈퇴 spec §3b) — applyAppUserLink의 역방향. 탈퇴 실행 경로 전용.
// mode 'purge'       = 연결만 끊는다(phone 미전이 — 호출 직후 고객 행 자체가 삭제되는 경로).
// mode 'materialize' = ACTIVE_FULFILLMENT 보존: **단일 UPDATE**로 app_user_id=NULL과
//   phone=profiles.phone_number(digits 정규화)를 동시에 기록한다. CHECK
//   customers_phone_app_exclusive_check는 행 단위 평가라 같은 statement 안에서 통과한다 —
//   두 UPDATE로 쪼개면 첫 번째가 CHECK에 걸리므로 쪼개지 말 것.
//   profiles가 살아 있는 동안 호출해야 번호를 읽을 수 있다(앱이 CRM 성공 응답 전 profile을
//   지우지 않는 계약이 이 순서를 보장 — 회신 §3).
// 멱등: appUserId로 연결된 고객이 없으면 null(no-op) — 탈퇴 재시도·재호출 안전.
export async function applyAppUserUnlink(
  appUserId: string,
  mode: "purge" | "materialize",
  ex: Executor = getDefaultDb(),
): Promise<{ customerId: string; customerCode: string; materializedPhone: string | null } | null> {
  const [target] = await ex
    .select({ id: customers.id, customerCode: customers.customerCode })
    .from(customers)
    .where(eq(customers.appUserId, appUserId));
  if (!target) return null;

  let materializedPhone: string | null = null;
  if (mode === "materialize") {
    const [profile] = await ex
      .select({ phoneNumber: profiles.phoneNumber })
      .from(profiles)
      .where(eq(profiles.id, appUserId));
    materializedPhone = normalizePhoneDigits(profile?.phoneNumber);
  }
  await ex
    .update(customers)
    .set({
      appUserId: null,
      ...(mode === "materialize" ? { phone: materializedPhone } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(customers.id, target.id));
  return { customerId: target.id, customerCode: target.customerCode, materializedPhone };
}
