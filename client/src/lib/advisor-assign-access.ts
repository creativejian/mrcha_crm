// 담당자 배정 권한 SSOT — 서버(진짜 게이트)와 클라(UI 보조)가 물리 공유하는 순수 모듈
// (quote-write-access.ts 선례 · AGENTS.md 서버→클라 순수 import 경계 등재).
//
// 왜 staff를 막는가(2026-07-21 유슨생 결정, staff 실기 감사에서 발견):
// staff는 #301 스코프로 "본인 담당 고객"만 본다. 그 상태에서 담당자를 남으로 바꾸면 그 고객이
// 즉시 본인 목록에서 사라지고, 상세도 404가 되어 **스스로는 되돌릴 수 없다**(admin 개입 필요).
// 되돌릴 수 없는 조작이라는 점에서 고객 하드 삭제(#212 admin 전용)와 같은 성격인데 게이트만
// 없었다(실측: staff 토큰 PATCH advisorId → 200 → 본인 목록 0건).
// 실무 흐름도 "상담사가 임의로 넘기는" 게 아니라 **관리자·팀장에게 요청**하는 쪽이 맞다.
export type AdvisorAssignUser = { role: string };

// 팀장(manager)은 admin 동급 — 배정은 팀 운영 행위다(canWriteQuote D-2① 미러).
// dealer 등 그 외 role은 fail-closed(전역 dealerWriteGate와 이중).
export function canAssignAdvisor(user: AdvisorAssignUser): boolean {
  return user.role === "admin" || user.role === "manager";
}

// 서버 403 · 클라 안내가 공유하는 거절 문구.
export const ADVISOR_ASSIGN_DENIED_MESSAGE = "담당자 배정은 관리자·팀장에게 요청해 주세요.";
