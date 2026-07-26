// 같은 번호 "연결 고객" 판정 SSOT(2026-07-26 유슨생 승인) — 부작용 0 순수 모듈.
// 서버(견적요청 인박스 listQuoteRequests)와 클라(상담 인박스 buildConsultationInboxGroups)가
// 물리 공유한다(서버→클라 순수 import 경계 — AGENTS.md 등재).
//
// 왜 별도 축인가: 기존 phone 매칭 후보는 **미연결 고객만**이다(2026-07-17 spec §3-6 — 연결 고객은
// customers.phone이 CHECK로 NULL). 그래서 "연결 고객(계정 A)과 같은 번호를 인증한 **다른** 계정
// (B)의 유입"은 계정 매칭도 번호 매칭도 못 잡아 완전 신규로 보였고, 상담사가 모르고 고객을 만들어
// 같은 사람이 N분화됐다(실사례: 김지안 번호 계정 3개 = 고객 3개, 김지운 CU-2607-0002가 그 산물).
// 이 판정은 그 케이스만 잡는다 — 연결 고객은 1고객 1계정이라 "연결" 액션이 불가능하므로,
// 결과는 액션 버튼이 아니라 **경고 표시 + 생성 재확인**에만 쓴다(차단 아님 — 가족 공용 번호 등
// 정당한 동번호 사례가 있어 fail-open).

export type SameNumberLinkedCustomer = { id: string; name: string; code: string };

// 후보 = 앱 연결 고객 + 그 계정의 인증 번호(digits). 인덱스 구성은 호출부 몫이다:
// 서버는 customers ⋈ profiles(phone_number), 클라는 목록 고객의 합성 phone(digits 정규화)을 쓴다.
export type LinkedPhoneCandidate = SameNumberLinkedCustomer & {
  appUserId: string;
  phoneDigits: string | null;
};

// 유입 계정(requesterUserId)의 번호(requesterDigits)와 같은 번호를 가진 **다른 계정**의 연결 고객.
// 본인 계정의 고객은 제외한다 — 그건 이미 "연결됨"으로 확정 매칭되는 케이스라 경고가 아니다.
// code 오름차순 정렬(결정적 표시 — nameMatches의 정렬 관례 미러).
export function findSameNumberLinked(
  requesterDigits: string | null,
  requesterUserId: string | null,
  candidates: readonly LinkedPhoneCandidate[],
): SameNumberLinkedCustomer[] {
  if (!requesterDigits) return [];
  return candidates
    .filter((c) => c.phoneDigits === requesterDigits && c.appUserId !== requesterUserId)
    .map(({ id, name, code }) => ({ id, name, code }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
