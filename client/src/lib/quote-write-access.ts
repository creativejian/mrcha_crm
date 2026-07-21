// 견적 쓰기 권한 SSOT(2026-07-21 이사님 결정 D-1①/D-2①/D-3①/D-4② —
// spec ref/specs/2026-07-21-crm-quote-write-access-design.md).
// 서버 게이트(src/routes/customers.ts)와 클라 버튼 숨김이 이 한 벌을 물리 공유한다
// (서버→클라 순수 모듈 import 경계 — AGENTS.md 허용 목록 등재). 부작용 0 유지 필수.
// 판정은 advisor_id(uuid)만 — 이름 비교 금지(#176 정합 규칙이 스테일 id를 차단하는 전제).
// 발송완료(appStatus) 구분 없음(D-1 ①): 위험은 "남의 고객"이지 "자기 고객의 발송본"이 아니다.

export type QuoteWriteUser = { id: string; role: string };

export function canWriteQuote(user: QuoteWriteUser, customerAdvisorId: string | null): boolean {
  if (user.role === "admin" || user.role === "manager") return true; // D-2 ① — 팀장은 admin 동급
  if (user.role !== "staff") return false; // dealer 등 — 전역 dealerWriteGate와 이중 fail-closed
  // D-3 ① — 미배정(null) 고객은 staff 불가(본인 배정부터).
  return customerAdvisorId !== null && customerAdvisorId === user.id;
}

// 서버 403·클라 안내가 공유하는 거절 문구.
export const QUOTE_WRITE_DENIED_MESSAGE = "담당 고객의 견적만 처리할 수 있습니다.";
