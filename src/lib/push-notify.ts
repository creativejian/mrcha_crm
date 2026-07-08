// 앱이 배포한 send-push Edge Function 호출 — device_tokens 조회·FCM v1 발송·만료 토큰 정리는
// send-push가 담당한다(스펙 §5.3). CRM은 {user_id,title,body}만 전달(딥링크 없는 알림).
// best-effort: 어떤 경우에도 throw 하지 않는다(호출부의 저장 응답을 깨지 않기 위해). 실패는 로그만.

// 테스트 주입점(embedOnWriteDeps 패턴 — mock.module 대신 전역 누출 없는 필드 교체).
export const pushNotifyDeps = { fetchImpl: fetch };

// 배정 알림 발송 게이트(embed-on-write의 EMBED_ON_WRITE 3규칙과 동일 원칙). 기본값으로 안전:
// 테스트가 실 prod send-push에 실호출하는 사고(embed의 실 Gemini 호출+master 오염류) 구조적 방지.
// ①명시 off는 항상 off ②NODE_ENV=test는 기본 off(명시 on만 허용 — 발송 검증 테스트가 여는 스위치)
// ③그 외(로컬 dev·prod)는 on.
export function assignmentPushEnabled(c: { env: unknown }): boolean {
  const env = (c.env ?? {}) as { PUSH_NOTIFY?: string };
  const flag = (env.PUSH_NOTIFY ?? process.env.PUSH_NOTIFY)?.trim().toLowerCase();
  if (flag === "off") return false;
  if (flag !== "on" && process.env.NODE_ENV === "test") return false;
  return true;
}

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
