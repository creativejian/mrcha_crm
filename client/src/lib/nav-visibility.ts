import type { RoleTab } from "@/data/roles";

// 메뉴 가시성 판정 SSOT(2026-08-08) — 사이드바와 키보드 단축키 레지스트리가 공유한다.
// 종전엔 Sidebar 안에서 로컬로 계산했는데, 단축키가 같은 판정을 독자적으로 다시 하면 메뉴 권한이
// 바뀔 때 한쪽만 고쳐져 **화면엔 없는데 키로는 열리는 뒷문**이 생긴다. 서버 403은 데이터 방어지
// UI 정합이 아니다. 설계 = ref/specs/2026-08-08-crm-keyboard-shortcuts-design.md §3.2.

export function canViewAdminMenu(role: RoleTab): boolean {
  return role === "최고관리자";
}

export function canViewTeamMenu(role: RoleTab): boolean {
  return role === "최고관리자" || role === "팀장";
}

// 딜러 = 외부 사용자. 내부 업무 도구 5종(검색·업무 AI·계산기·상담 대기·알림)이 상단바에서
// 미표시고(2026-08-02 유슨생), 사이드바도 전용 메뉴 세트를 쓴다.
export function isDealer(role: RoleTab): boolean {
  return role === "딜러";
}
