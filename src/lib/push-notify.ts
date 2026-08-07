// 앱이 배포한 send-push Edge Function 호출 — device_tokens 조회·FCM v1 발송·만료 토큰 정리는
// send-push가 담당한다(스펙 §5.3). 기존 배정·담당자 확인은 {user_id,title,body,subtitle?}를,
// 사건형 알림은 {user_id,tag}를 전달한다. tag 사건의 표시 문구는 앱 consumer가 고정한다.
// 공유 시크릿 헤더 X-Push-Secret(있을 때만 — 아래 fail-open 주석).
// best-effort: 어떤 경우에도 throw 하지 않는다(호출부의 저장 응답을 깨지 않기 위해). 실패는 로그만.
//
// ⚠️ 이 모듈이 CRM에서 send-push를 부르는 단일 접점이다. 담당자 배정·담당자 확인과
// 빠른견적 발송 준비 사건이 여기로 모인다. 최종 견적 도착 알림은 public.advisor_quotes INSERT →
// on_advisor_quote_sent 트리거가 보내므로 이 모듈의 책임이 아니다.

// 테스트 주입점(embedOnWriteDeps 패턴 — mock.module 대신 전역 누출 없는 필드 교체).
export const pushNotifyDeps = { fetchImpl: fetch };

// 푸시 발송 게이트(기존 export 이름은 호출부 호환을 위해 유지, embed-on-write의 3규칙과 동일 원칙).
// 기본값으로 안전:
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

type PushPayload = {
  userId: string;
  title?: string;
  body?: string;
  subtitle?: string;
  tag?: string;
};

async function sendPush(
  c: { env: unknown },
  msg: PushPayload,
  logLabel: string,
): Promise<void> {
  try {
    const env = (c.env ?? {}) as { SUPABASE_URL?: string; SEND_PUSH_SECRET?: string };
    const base = env.SUPABASE_URL ?? process.env.SUPABASE_URL;
    if (!base) {
      console.error(`[push] SUPABASE_URL 미설정 — ${logLabel} skip`);
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
      body: JSON.stringify({
        user_id: msg.userId,
        ...(msg.title !== undefined ? { title: msg.title } : {}),
        ...(msg.subtitle !== undefined ? { subtitle: msg.subtitle } : {}),
        ...(msg.body !== undefined ? { body: msg.body } : {}),
        ...(msg.tag !== undefined ? { tag: msg.tag } : {}),
      }),
    });
    if (!res.ok) {
      // 401은 네트워크·5xx와 섞이면 안 된다 — 시크릿 누락은 "실패해도 조용한" 부류라 tail에서
      // grep할 토큰(AUTH_FAILED)을 남긴다. 앱은 Sentry warning, CRM은 이 로그 — 이중 감시.
      if (res.status === 401) {
        console.error(`[push] AUTH_FAILED(401) — SEND_PUSH_SECRET 확인 필요, ${logLabel} 미발송 user=${msg.userId}`);
      } else {
        console.error(`[push] ${logLabel} 발송 실패 user=${msg.userId} status=${res.status}`);
      }
      return;
    }
    // 200이어도 대상 기기 토큰이 0이면 아무도 못 받는다 — 앱 send-push가 `{message:"no tokens", sent:0}`을
    // 200으로 반환한다(앱 소스 확인). 성공 로그만 보고 "알림이 나갔다"고 오판하지 않도록 sent를 함께 남기고,
    // sent=0은 warn으로 분리한다. 이 구역의 두 사고(#199 오염·#202 두 달 무발송)가 모두 "실패가 조용해서
    // 늦게 발견"이었다. 바디 파싱 실패는 무시한다(best-effort 계약 — 발송 동작은 이미 끝났다).
    const sent = await res.json().then((b) => (b as { sent?: number }).sent).catch(() => undefined);
    if (sent === 0) {
      console.warn(`[push] ${logLabel} 대상 기기 없음(sent=0) user=${msg.userId} — device_tokens 미등록`);
    } else {
      console.log(`[push] ${logLabel} → user=${msg.userId} sent=${sent ?? "?"}`);
    }
  } catch (e) {
    console.error(`[push] ${logLabel} 예외 user=${msg.userId}:`, e);
  }
}

export function sendAssignmentPush(
  c: { env: unknown },
  // subtitle은 iOS 2줄 알림용(앱 send-push가 이미 지원 — parse.ts `raw.subtitle ?? ""`). 생략 가능.
  // tag는 앱 consumer(privacySafeNotification)의 사건 분기 키 — 담당자 확인(2단계)이 subtitle
  // 문자열 정확 일치에만 기대던 결합을 푼다(2026-08-07, tag-first·문구 폴백은 앱에 잔존).
  msg: { userId: string; title: string; body: string; subtitle?: string; tag?: string },
): Promise<void> {
  return sendPush(c, msg, "배정 알림");
}

// 빠른견적 3단계 사건. CRM caller는 표시 문구를 정하지 않고 사건 tag만 보낸다.
// 앱 send-push consumer가 `quote-request-ready-for-send`를 승인된 고정 문구로 변환한다.
export function sendQuoteRequestReadyForSendPush(c: { env: unknown }, userId: string): Promise<void> {
  return sendPush(c, { userId, tag: "quote-request-ready-for-send" }, "견적 발송 준비 알림");
}
