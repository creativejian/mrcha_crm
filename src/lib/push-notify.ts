// 앱이 배포한 send-push Edge Function 호출 — device_tokens 조회·FCM v1 발송·만료 토큰 정리는
// send-push가 담당한다(스펙 §5.3). CRM은 {user_id,title,body}만 전달(딥링크 없는 알림).
// best-effort: 어떤 경우에도 throw 하지 않는다(호출부의 저장 응답을 깨지 않기 위해). 실패는 로그만.

// 테스트 주입점(embedOnWriteDeps 패턴 — mock.module 대신 전역 누출 없는 필드 교체).
export const pushNotifyDeps = { fetchImpl: fetch };

export async function sendAssignmentPush(
  c: { env: unknown },
  msg: { userId: string; title: string; body: string },
): Promise<void> {
  try {
    const env = (c.env ?? {}) as { SUPABASE_URL?: string };
    const base = env.SUPABASE_URL ?? process.env.SUPABASE_URL;
    if (!base) {
      console.error("[push] SUPABASE_URL 미설정 — 배정 알림 skip");
      return;
    }
    const res = await pushNotifyDeps.fetchImpl(`${base}/functions/v1/send-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: msg.userId, title: msg.title, body: msg.body }),
    });
    if (!res.ok) {
      console.error(`[push] 배정 알림 발송 실패 user=${msg.userId} status=${res.status}`);
      return;
    }
    console.log(`[push] 배정 알림 → user=${msg.userId} "${msg.title}"`);
  } catch (e) {
    console.error(`[push] 배정 알림 예외 user=${msg.userId}:`, e);
  }
}
