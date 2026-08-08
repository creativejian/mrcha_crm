import { customerListPath } from "@/lib/customer-route";
import { canViewAdminMenu, canViewTeamMenu, isDealer } from "@/lib/nav-visibility";
import type { RoleTab } from "@/data/roles";

// 키보드 단축키 SSOT(2026-08-08). 배정 근거·기각안 = ref/specs/2026-08-08-crm-keyboard-shortcuts-design.md.
// 판정은 전부 순수 — 리스너(useKeyboardShortcuts)는 이벤트를 여기 넘기는 껍데기다.

// 전역 액션 식별자 — Topbar가 자기 상태 토글로 해석한다(네비게이션은 path로 간다).
// export하지 않는다: 소비처는 `shortcut.action` 접근으로 타입이 추론되고, 밖에서 쓰지 않는 export는
// knip 기준선 0을 깬다(#333 선례).
type GlobalActionId = "shortcuts-panel" | "global-search" | "work-ai" | "calculator" | "notifications" | "toggle-sidebar";

export type Shortcut = {
  id: string;
  /** KeyboardEvent.code 시퀀스. 길이 1 = 단발(수식키 포함), 2 = "X then Y". */
  keys: string[];
  group: "global" | "navigation";
  /** 단발 조합의 수식키 요구. 시퀀스에는 쓰지 않는다. */
  mod?: "meta" | "shift";
  /** 네비게이션 목적지(순수 데이터). */
  path?: string;
  action?: GlobalActionId;
  /** role별 표시 이름 — G M만 분기한다(딜러 포털은 같은 화면을 "할인 업데이트"로 부른다). */
  label: (role: RoleTab) => string;
  /** 노출 조건. 생략 = 전원(딜러 포함). */
  visibleFor?: (role: RoleTab) => boolean;
};

const notDealer = (role: RoleTab) => !isDealer(role);
const constant = (text: string) => () => text;

// ── 전역 액션 ────────────────────────────────────────────────────────────────
// 딜러가 보는 것은 패널·사이드바 토글 2종뿐 — 상단바 내부 도구 5종이 딜러에게 미표시라
// (2026-08-02 유슨생) 화면에 없는 것을 키로 여는 것은 그 결정을 되돌리는 셈이다.
const GLOBAL_SHORTCUTS: Shortcut[] = [
  { id: "shortcuts-panel", keys: ["Slash"], mod: "shift", group: "global", action: "shortcuts-panel", label: constant("단축키 목록") },
  { id: "global-search", keys: ["KeyK"], mod: "meta", group: "global", action: "global-search", label: constant("고객 통합 검색"), visibleFor: notDealer },
  { id: "work-ai", keys: ["KeyI"], mod: "meta", group: "global", action: "work-ai", label: constant("업무 AI"), visibleFor: notDealer },
  { id: "calculator", keys: ["KeyE"], mod: "meta", group: "global", action: "calculator", label: constant("계산기"), visibleFor: notDealer },
  { id: "toggle-sidebar", keys: ["KeyB"], mod: "meta", group: "global", action: "toggle-sidebar", label: constant("사이드바 접기/펴기") },
  { id: "notifications", keys: ["KeyO", "KeyN"], group: "global", action: "notifications", label: constant("알림"), visibleFor: notDealer },
];

// ── 네비게이션 ───────────────────────────────────────────────────────────────
// ⚠️ KeyH는 대시보드다(Supabase가 G then H를 Project Overview에 주는 관례). 보류/이탈(Hold)이
// 아니라 B(보류)로 간 이유 — 초안에서 실제로 충돌했다.
const NAV_SHORTCUTS: Shortcut[] = [
  { id: "nav-dashboard", keys: ["KeyG", "KeyH"], group: "navigation", path: "/", label: constant("대시보드"), visibleFor: notDealer },
  { id: "nav-chat", keys: ["KeyG", "KeyT"], group: "navigation", path: "/chat", label: constant("실시간 상담"), visibleFor: notDealer },
  { id: "nav-customers-all", keys: ["KeyG", "KeyC"], group: "navigation", path: customerListPath("all"), label: constant("고객 관리 · 전체 보기"), visibleFor: notDealer },
  { id: "nav-customers-consulting", keys: ["KeyG", "KeyN"], group: "navigation", path: customerListPath("consulting"), label: constant("고객 관리 · 상담 필요"), visibleFor: notDealer },
  { id: "nav-customers-contract", keys: ["KeyG", "KeyK"], group: "navigation", path: customerListPath("contract"), label: constant("고객 관리 · 계약 관리"), visibleFor: notDealer },
  { id: "nav-customers-delivery", keys: ["KeyG", "KeyD"], group: "navigation", path: customerListPath("delivery"), label: constant("고객 관리 · 출고 관리"), visibleFor: notDealer },
  { id: "nav-customers-settlement", keys: ["KeyG", "KeyE"], group: "navigation", path: customerListPath("settlement"), label: constant("고객 관리 · 출고 정산"), visibleFor: notDealer },
  { id: "nav-customers-hold", keys: ["KeyG", "KeyB"], group: "navigation", path: customerListPath("hold"), label: constant("고객 관리 · 보류 / 이탈"), visibleFor: notDealer },
  { id: "nav-pipeline", keys: ["KeyG", "KeyP"], group: "navigation", path: "/pipeline", label: constant("상담 파이프라인"), visibleFor: notDealer },

  { id: "nav-app-requests", keys: ["KeyG", "KeyQ"], group: "navigation", path: "/app-requests", label: constant("앱 견적요청"), visibleFor: canViewTeamMenu },
  { id: "nav-advisor-assignment", keys: ["KeyG", "KeyA"], group: "navigation", path: "/consultation-requests", label: constant("상담사 배정"), visibleFor: canViewTeamMenu },
  { id: "nav-consultation-requests", keys: ["KeyG", "KeyI"], group: "navigation", path: "/consultation-requests", label: constant("상담 신청 DB"), visibleFor: canViewTeamMenu },
  { id: "nav-org-members", keys: ["KeyG", "KeyO"], group: "navigation", path: "/org-members", label: constant("팀원 관리"), visibleFor: canViewTeamMenu },

  // 딜러도 갖는 유일한 네비게이션 — dealerMenuItems에서 목적지가 있는 항목이 이것뿐이다.
  {
    id: "nav-mc-master",
    keys: ["KeyG", "KeyM"],
    group: "navigation",
    path: "/mc-master",
    label: (role) => (isDealer(role) ? "할인 업데이트" : "MC 마스터"),
    visibleFor: (role) => canViewTeamMenu(role) || isDealer(role),
  },

  { id: "nav-admin-dashboard", keys: ["KeyG", "KeyR"], group: "navigation", path: "/admin-dashboard", label: constant("경영 리포트"), visibleFor: canViewAdminMenu },
  { id: "nav-finance", keys: ["KeyG", "KeyF"], group: "navigation", path: "/finance", label: constant("재무 관리"), visibleFor: canViewAdminMenu },
];

export const SHORTCUTS: Shortcut[] = [...GLOBAL_SHORTCUTS, ...NAV_SHORTCUTS];

/** role이 실제로 쓸 수 있는 단축키만 — 사이드바 가시성과 같은 SSOT(nav-visibility)를 읽는다. */
export function visibleShortcuts(role: RoleTab): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.visibleFor?.(role) ?? true);
}

const KEY_TEXT: Record<string, string> = { Slash: "?", Comma: "," };

function keyText(code: string): string {
  return KEY_TEXT[code] ?? code.replace(/^Key/, "");
}

/** 패널 표기 — "⌘K" · "⇧?" · "G then C". */
export function shortcutKeyLabel(shortcut: Shortcut): string {
  if (shortcut.keys.length > 1) return shortcut.keys.map(keyText).join(" then ");
  const prefix = shortcut.mod === "meta" ? "⌘" : shortcut.mod === "shift" ? "⇧" : "";
  return `${prefix}${keyText(shortcut.keys[0])}`;
}
