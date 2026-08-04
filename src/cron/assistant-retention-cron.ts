// 업무 AI 대화 30일 rolling retention(2026-08-04) — 회원탈퇴 계약 회신 §7의 이행.
// 같은 일일 크론 트리거(wrangler.jsonc `0 1 * * *` = 10:00 KST)에 얹지만 **탈퇴 잡과는 독립
// 실행**이다(worker.ts에서 waitUntil 둘) — 한쪽이 실패해도 다른 쪽이 멈추지 않는다.
//
// 왜 rolling이 필요한가: `crm.assistant_messages`는 고객 FK가 없고 user 턴은 직원이 친 자유
// 텍스트라 "이 행이 누구 이야기인가"를 구조적으로 완전히 추적할 수 없다. 탈퇴 고객의 관련
// turn만 골라 지우는 것은 provenance 계측(turn_id·subject_customer_ids) 이후에야 정확해지고,
// 그 이전 과거분은 영원히 정확해지지 않는다 — 그래서 **시간 상한**이 유일한 확실한 방어선이다.
// 앱 팀 회신에 이 한계를 명시했다(`ref/2026-08-01-app-account-deletion-crm-reply.md` §7).
import { createDbClient, getDefaultDb } from "../db/client";
import { purgeAssistantMessagesOlderThan } from "../db/queries/assistant-messages";

/**
 * 보존 기한(일). 앱 팀 회신에 "30일 rolling"으로 명시한 계약값이라 **임의 변경 금지** —
 * 늘리려면 앱 팀 공유가 선행이다(처리방침 문서에 실리는 숫자다).
 */
export const ASSISTANT_RETENTION_DAYS = 30;

export type AssistantRetentionCronEnv = {
  HYPERDRIVE?: { connectionString: string };
};

export async function runAssistantRetentionCron(env: AssistantRetentionCronEnv): Promise<void> {
  // prod = Hyperdrive 요청별 클라이언트(Workers는 소켓 재사용 불가), 로컬·테스트 = 싱글톤 폴백.
  // 탈퇴 크론과 같은 관례지만 연결은 따로 연다 — 두 잡의 실패를 격리하는 값이 연결 1개보다 크다.
  const made = env.HYPERDRIVE?.connectionString ? createDbClient(env.HYPERDRIVE.connectionString) : null;
  const db = made?.db ?? getDefaultDb();
  try {
    const purged = await purgeAssistantMessagesOlderThan(ASSISTANT_RETENTION_DAYS, db);
    // 0건도 남긴다 — "잡이 돌긴 했다"의 유일한 흔적이다(웹훅 없음: 개인정보 파기는 조용한 정상
    // 동작이고, 매일 알림을 쏘면 그 채널이 곧 무시된다).
    console.log(`[assistant-retention] ${ASSISTANT_RETENTION_DAYS}일 경과 대화 ${purged}행 파기`);
  } catch (e) {
    // 던지지 않는다 — waitUntil 안에서 던지면 스케줄 실행이 실패로 기록될 뿐 복구가 없고,
    // 다음 날 잡이 밀린 분까지 함께 지운다(멱등).
    console.error("[assistant-retention] 파기 실패:", e);
  } finally {
    if (made) await made.client.end();
  }
}
