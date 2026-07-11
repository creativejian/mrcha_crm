// 앱 채팅 세션/메시지 상수 미러. SSOT = 앱 레포 mr-cha-app:
//   lib/core/constants/app_status.dart (mode 값), chat_messages CHECK 제약 (sender_type 값).
// CRM은 값만 미러하고 라벨은 콘솔 관점으로 따로 둔다. 앱 스키마 변경 시 여기부터 맞출 것.
export const CHAT_SESSION_MODES = ["ai", "pending", "human"] as const;
export type ChatSessionMode = (typeof CHAT_SESSION_MODES)[number];

// 콘솔 표시 라벨(앱 고객측 라벨과 다름 — 상담원 관점).
export const CHAT_MODE_LABELS: Record<ChatSessionMode, string> = {
  pending: "상담원 연결 요청",
  human: "상담원 상담중",
  ai: "AI 상담중",
};

// 큐 탭 순서: 요청이 가장 급하므로 pending 먼저.
export const CHAT_QUEUE_TABS = ["all", "pending", "human", "ai"] as const;
export type ChatQueueTab = (typeof CHAT_QUEUE_TABS)[number];
export const CHAT_TAB_LABELS: Record<ChatQueueTab, string> = {
  all: "전체",
  pending: CHAT_MODE_LABELS.pending,
  human: CHAT_MODE_LABELS.human,
  ai: CHAT_MODE_LABELS.ai,
};

// ⚠️ 앱과의 문자열 결합 — 한 글자도 바꾸지 말 것(2026-07-10 실측 → 2026-07-11 범위 정밀화).
// 핸드오버 **상태**는 chat_sessions.mode 기반이라 문구와 무관하지만, 앱은 이 문구를
// mr-cha-app handoff_system_messages.dart의 6개 함수(isExternalNotification /
// isHandoffSeparator / isAppHiddenInactivityWarning / separatorDisplayText /
// toastText / toastDuration)에서 startsWith/exact 매칭 키로 써서
// **알림 dispatch·핸드오버 구분선·토스트 문구/지속시간**을 결정한다.
// 즉 "담당 상담사가 **배정**되었습니다"처럼 다듬는 순간 그 UI들이 **예외 없이 조용히** 깨진다.
// 리포지토리가 달라 타입도 테스트도 이 결합을 잡지 못한다. 문구를 바꿔야 하면 앱 팀에 먼저 알린다.
// (해소 진행 중: public.chat_messages.metadata jsonb 라이브(앱 #640) — CRM 몫은 완료:
//  lib/chat.ts insertSystemMessage가 아래 CHAT_SYSTEM_KIND_*를 metadata.system_kind로 부착한다.
//  앱 감지 7곳이 kind-first로 전환 완료할 때까지는 여전히 이 문구가 계약이다.)
export const CHAT_SYSTEM_MSG_TAKEOVER = "담당 상담사가 연결되었습니다.";
export const CHAT_SYSTEM_MSG_RETURN = "상담사 연결이 종료되었습니다. 차선생이 대화를 이어갑니다.";

// chat_messages.metadata.system_kind — 문구 매칭을 대체할 구조화 신호(앱팀 합의 네임스페이스,
// 2026-07-11 확정). 위 문구와 항상 짝으로 실린다. 값도 앱과의 계약 — 임의 변경 금지.
export const CHAT_SYSTEM_KIND_TAKEOVER = "handoff_takeover";
export const CHAT_SYSTEM_KIND_RETURN = "handoff_return";
