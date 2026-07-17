// 앱 상담신청(public.consultations) → CRM 고객 통합. 견적요청(quote-requests.ts) 패턴 재사용 —
// 차이점: userId nullable(비로그인 상담신청 경로가 스키마상 존재). status는 read-only로 시작(전이는 미구현).
// 폼 phone_number는 표시(ConsultationRow)용으로만 읽는다 — CRM 고객 phone에 저장하지 않는다
// (2026-07-17 spec §3-5: 앱 연결 고객 주 번호 = profiles read-through 합성).
import { and, desc, eq, notInArray } from "drizzle-orm";

import { APP_CONSULTATION_SOURCE } from "../../../client/src/data/customers";
import { applyAppUserLink } from "./app-user-link";
import { nextCustomerCode } from "./quote-requests";
import { getDefaultDb, type Executor } from "../client";
import { consultationRequests, profiles } from "../public-app";
import { consultationDismissals, customers } from "../schema";

export type ConsultationRow = {
  id: string;
  userId: string | null;
  customerName: string;
  phoneNumber: string;
  carModel: string | null;
  notes: string | null;
  status: string | null;
  createdAt: string;
};

// rows 조회 공통 select 컬럼. where만 호출부에서 더한다(quote-requests.ts 패턴).
const consultationBaseSelect = {
  id: consultationRequests.id,
  userId: consultationRequests.userId,
  customerName: consultationRequests.customerName,
  phoneNumber: consultationRequests.phoneNumber,
  carModel: consultationRequests.carModel,
  notes: consultationRequests.notes,
  status: consultationRequests.status,
  createdAt: consultationRequests.createdAt,
} as const;

// CRM 전용 숨김(dismissConsultation) 처리된 상담신청 id 서브쿼리 — public.consultations는 절대
// 건드리지 않고 CRM 조회 결과에서만 제외한다.
function notDismissed(ex: Executor) {
  return notInArray(
    consultationRequests.id,
    ex.select({ id: consultationDismissals.consultationId }).from(consultationDismissals),
  );
}

// 인박스: 미처리(pending) 상담신청 전체(최신순). CRM에서 숨김 처리한 건은 제외.
export async function listConsultations(ex: Executor = getDefaultDb()): Promise<ConsultationRow[]> {
  return ex
    .select(consultationBaseSelect)
    .from(consultationRequests)
    .where(and(eq(consultationRequests.status, "pending"), notDismissed(ex)))
    .orderBy(desc(consultationRequests.createdAt));
}

// 고객 상세 카드: 그 앱 유저의 상담신청 전부(상태 무관, 최신순). 읽기전용 문의 카드 목록용.
// CRM에서 숨김 처리한 건은 제외.
export async function listConsultationsByUser(
  appUserId: string,
  ex: Executor = getDefaultDb(),
): Promise<ConsultationRow[]> {
  return ex
    .select(consultationBaseSelect)
    .from(consultationRequests)
    .where(and(eq(consultationRequests.userId, appUserId), notDismissed(ex)))
    .orderBy(desc(consultationRequests.createdAt));
}

// profiles + 상담신청 데이터로 신규 customers INSERT(app_user_id 연결). 같은 user로 이미 고객 있으면
// 기존 반환(중복 방지, source 안 덮음 — 최초 유입 source 유지). userId 없는(비로그인) 상담신청은 통합 불가(null).
// 라우트가 transaction으로 감싸 호출(ex=tx) — 채번+insert 원자성.
export async function createCustomerFromConsultation(
  consultationId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; customerCode: string; name: string; appUserId: string } | null> {
  const [req] = await ex
    .select({
      userId: consultationRequests.userId,
      customerName: consultationRequests.customerName,
      phoneNumber: consultationRequests.phoneNumber,
      carModel: consultationRequests.carModel,
      createdAt: consultationRequests.createdAt,
    })
    .from(consultationRequests)
    .where(eq(consultationRequests.id, consultationId));
  if (!req || !req.userId) return null;

  const [existing] = await ex
    .select({ id: customers.id, customerCode: customers.customerCode, name: customers.name })
    .from(customers)
    .where(eq(customers.appUserId, req.userId));
  if (existing) return { ...existing, appUserId: req.userId };

  const [profile] = await ex
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, req.userId));

  const customerCode = await nextCustomerCode(ex);
  const [row] = await ex
    .insert(customers)
    .values({
      customerCode,
      // 이름은 폼 우선(OpenQ1 확정) — book_consultation Edge가 폼값을 저장한다.
      name: req.customerName.trim() || profile?.fullName || "이름미상",
      // phone은 저장하지 않는다(2026-07-17 spec §3-5): 앱 연결 고객의 주 번호는 profiles read-through
      // 합성이 담당(구 "폼 우선 phone" 규칙 폐기 — 실측상 과거 폼 번호는 테스트 노이즈였고, 앱이
      // 등록 번호 강제로 전환하면 폼 번호=앱 번호라 규칙 자체가 무의미). CHECK 불변식도 이걸 강제.
      phone: null,
      appUserId: req.userId,
      needModel: req.carModel ?? null,
      source: APP_CONSULTATION_SOURCE,
      statusGroup: "신규",
      status: "상담접수",
      receivedAt: new Date(req.createdAt),
    })
    .returning({ id: customers.id, customerCode: customers.customerCode, name: customers.name });
  return row ? { ...row, appUserId: req.userId } : null;
}

// 상담신청의 user_id를 대상 고객 app_user_id에 set. 요청/고객 없으면 null.
// 가드+전화번호 전이+UPDATE는 applyAppUserLink SSOT(견적요청 link와 완전 공유 — 구 "빈 연락처를
// 폼 번호로 보강"은 2026-07-17 spec §3-5로 폐기: 주 번호 표시는 profiles read-through 합성이 담당).
export async function linkConsultationToCustomer(
  consultationId: string,
  customerId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; customerCode: string; name: string; appUserId: string; droppedPhone: string | null } | null> {
  const [req] = await ex
    .select({ userId: consultationRequests.userId })
    .from(consultationRequests)
    .where(eq(consultationRequests.id, consultationId));
  if (!req || !req.userId) return null;
  return applyAppUserLink(req.userId, customerId, ex);
}

// CRM 전용 숨김 — public.consultations는 절대 건드리지 않고 dismissal만 기록(idempotent).
export async function dismissConsultation(
  consultationId: string,
  dismissedBy: string | null,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string }> {
  await ex.insert(consultationDismissals).values({ consultationId, dismissedBy }).onConflictDoNothing();
  return { id: consultationId };
}

// dismiss 훅용: 그 상담신청 유저(user_id)에 연결된 CRM 고객 id. 미승격(연결 고객 없음)·비로그인
// (userId null — NULL은 join 불성립) 상담신청은 null.
export async function linkedCustomerIdForConsultation(
  consultationId: string,
  ex: Executor = getDefaultDb(),
): Promise<string | null> {
  const [row] = await ex
    .select({ customerId: customers.id })
    .from(consultationRequests)
    .innerJoin(customers, eq(customers.appUserId, consultationRequests.userId))
    .where(eq(consultationRequests.id, consultationId));
  return row?.customerId ?? null;
}
