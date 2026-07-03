// 새 턴 앵커 스크롤 여백 — 앱 kChatNewTurnTargetTop(90, 앱바 포함)·kChatTimelineTurnBottomGap(28) 미러.
// CRM은 스크롤 컨테이너 기준이라 상단 20px(체감 동일).
export const NEW_TURN_TOP_GAP = 20;
export const NEW_TURN_BOTTOM_GAP = 28;

// 마지막 턴의 assistant 요소에 줄 min-height — 답변이 짧아도 질문이 상단에 고정되도록 아래 공간을 예약한다.
export function computeTurnMinHeight(bodyHeight: number, questionHeight: number): number {
  return Math.max(0, bodyHeight - NEW_TURN_TOP_GAP - NEW_TURN_BOTTOM_GAP - questionHeight);
}
