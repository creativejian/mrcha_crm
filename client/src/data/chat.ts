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

// 앱과 공유하는 system 메시지 문구 — 문자열 계약은 해제됨(2026-07-11 메타 플래그 전환 완결).
// 앱 판별은 전부 metadata.system_kind kind-first(kind 있으면 문구를 보지 않는다 — 앱 #640·#643,
// CRM은 lib/chat.ts insertSystemMessage가 아래 CHAT_SYSTEM_KIND_*를 부착). 문구는 표시용 +
// 과거 행(kind null) 폴백용으로만 쓰인다. 문구를 바꿀 땐 ①캐시된 구 앱 번들(문구 판별)이
// 소진될 며칠 유예 후 반영 ②앱 표시 문구(HandoffSystemMessages kind 스위치) 동기화를 위해
// 앱팀에 사전 공유 한 줄. 임의 변경 금지 대상은 이제 문구가 아니라 아래 kind 값이다.
export const CHAT_SYSTEM_MSG_TAKEOVER = "담당 상담사가 연결되었습니다.";
export const CHAT_SYSTEM_MSG_RETURN = "상담사 연결이 종료되었습니다. 차선생이 대화를 이어갑니다.";

// chat_messages.metadata.system_kind — 문구 매칭을 대체한 구조화 신호(앱 chat_message_metadata.dart
// ChatSystemKind와 일치 실측, 2026-07-11 확정). 위 문구와 항상 짝으로 실린다.
// **이 값이 앱과의 계약이다** — 임의 변경 금지.
export const CHAT_SYSTEM_KIND_TAKEOVER = "handoff_takeover";
export const CHAT_SYSTEM_KIND_RETURN = "handoff_return";
