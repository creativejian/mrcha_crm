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

// ⚠️ 앱과의 문자열 결합 — 한 글자도 바꾸지 말 것(2026-07-10 앱 코드 실측).
// 앱은 CRM이 chat_messages에 넣은 이 문구를 **접두사 매칭**으로 읽어 상담 상태를 복원한다:
//
//   mr-cha-app/lib/core/constants/handoff_system_messages.dart:20-21
//     text.startsWith('담당 상담사가 연결') || text.startsWith('상담사 연결이 종료')
//
// 즉 "담당 상담사가 **배정**되었습니다"처럼 다듬는 순간 앱의 상태 복원이 **예외 없이 조용히** 깨진다.
// 리포지토리가 달라 타입도 테스트도 이 결합을 잡지 못한다. 문구를 바꿔야 하면 앱 팀에 먼저 알린다.
// (앱 팀도 이 구조가 취약하다는 데 동의했고, 문구 대신 chat_messages 메타 필드로 신호를 주고받는
//  쪽으로 옮기기로 했다 — 그때까지는 이 상수가 계약이다.)
export const CHAT_SYSTEM_MSG_TAKEOVER = "담당 상담사가 연결되었습니다.";
export const CHAT_SYSTEM_MSG_RETURN = "상담사 연결이 종료되었습니다. 차선생이 대화를 이어갑니다.";
