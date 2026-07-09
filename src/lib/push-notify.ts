// 앱이 배포한 send-push Edge Function 호출 — device_tokens 조회·FCM v1 발송·만료 토큰 정리는
// send-push가 담당한다(스펙 §5.3). CRM은 {user_id,title,body}만 전달(딥링크 없는 알림) +
// 공유 시크릿 헤더 X-Push-Secret(있을 때만 — 아래 fail-open 주석).
// best-effort: 어떤 경우에도 throw 하지 않는다(호출부의 저장 응답을 깨지 않기 위해). 실패는 로그만.
//
// ⚠️ CRM이 send-push를 부르는 유일한 지점이다(소비처 = routes/customers.ts 고객 담당자 배정 PATCH).
// 견적 발송 알림은 public.advisor_quotes INSERT → on_advisor_quote_sent 트리거가 보내므로 CRM 코드 0줄.

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
    const env = (c.env ?? {}) as { SUPABASE_URL?: string; SEND_PUSH_SECRET?: string };
    const base = env.SUPABASE_URL ?? process.env.SUPABASE_URL;
    if (!base) {
      console.error("[push] SUPABASE_URL 미설정 — 배정 알림 skip");
      return;
    }
    // 공유 시크릿 헤더(앱 send-push 인증). 미설정이면 헤더를 생략하고 호출은 그대로 한다(fail-open):
    // 앱의 3단 배포 중 어느 구간에서도 배정 알림이 끊기지 않게. CRM은 발신 측이라 fail-closed의
    // 보안 이득이 없고, 알림이 조용히 사라지는 쪽이 더 나쁘다. 3단계(401 강제) 후 누락은 아래 로그로 드러난다.
    const secret = env.SEND_PUSH_SECRET ?? process.env.SEND_PUSH_SECRET;
    if (!secret) console.warn("[push] SEND_PUSH_SECRET 미설정 — 헤더 없이 호출(앱 401 전환 후 발송 실패)");
    // ⚠️ 반드시 지역 변수로 뽑아 plain call한다. `pushNotifyDeps.fetchImpl(...)`는 메서드 호출이라
    // this=pushNotifyDeps가 되고, Workers의 global fetch는 this가 globalThis/undefined가 아니면
    // `TypeError: Illegal invocation`으로 죽는다(2026-07-09 prod tail 실측 — 아래 catch가 삼켜서
    // #193 이후 배정 알림이 한 번도 나가지 않았다. 로컬 bun의 fetch는 this를 안 따져 미검출).
    // gemini-post.ts:14 `const fetchImpl = opts.fetchImpl ?? fetch`가 같은 이유로 안전한 형태다.
    const fetchImpl = pushNotifyDeps.fetchImpl;
    const res = await fetchImpl(`${base}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Push-Secret": secret } : {}),
      },
      body: JSON.stringify({ user_id: msg.userId, title: msg.title, body: msg.body }),
    });
    if (!res.ok) {
      // 401은 네트워크·5xx와 섞이면 안 된다 — 시크릿 누락은 "실패해도 조용한" 부류라 tail에서
      // grep할 토큰(AUTH_FAILED)을 남긴다. 앱은 Sentry warning, CRM은 이 로그 — 이중 감시.
      if (res.status === 401) {
        console.error(`[push] AUTH_FAILED(401) — SEND_PUSH_SECRET 확인 필요, 배정 알림 미발송 user=${msg.userId}`);
      } else {
        console.error(`[push] 배정 알림 발송 실패 user=${msg.userId} status=${res.status}`);
      }
      return;
    }
    console.log(`[push] 배정 알림 → user=${msg.userId} "${msg.title}"`);
  } catch (e) {
    console.error(`[push] 배정 알림 예외 user=${msg.userId}:`, e);
  }
}
