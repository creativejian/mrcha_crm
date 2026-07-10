import { test, expect, afterEach } from "bun:test";

import { pushNotifyDeps, sendAssignmentPush } from "./push-notify";

const ORIGINAL_FETCH = pushNotifyDeps.fetchImpl;
afterEach(() => { pushNotifyDeps.fetchImpl = ORIGINAL_FETCH; });

test("sendAssignmentPush: send-push URL로 {user_id,title,body} POST", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  pushNotifyDeps.fetchImpl = (async (url: string | URL, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    return new Response(JSON.stringify({ message: "no tokens", sent: 0 }), { status: 200 });
  }) as typeof fetch;

  await sendAssignmentPush(
    { env: { SUPABASE_URL: "https://proj.test" } },
    { userId: "U-1", title: "담당 고객으로 배정되었습니다", body: "홍길동" },
  );

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://proj.test/functions/v1/send-push");
  expect(calls[0].body).toEqual({ user_id: "U-1", title: "담당 고객으로 배정되었습니다", body: "홍길동" });
});

// 콘솔 캡처 — 이 구역의 두 사고(#199 오염·#202 두 달 무발송)가 전부 "실패가 조용해서 늦게 발견"이었다.
// 로그가 관측 수단이므로 로그 자체를 테스트한다.
async function captureConsole(fn: () => Promise<void>): Promise<{ logs: string[]; warns: string[] }> {
  const logs: string[] = [];
  const warns: string[] = [];
  const [origLog, origWarn] = [console.log, console.warn];
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.log = origLog; console.warn = origWarn; }
  return { logs, warns };
}

// 앱 send-push는 device_tokens가 0개면 {message:"no tokens", sent:0}을 **200**으로 반환한다
// (앱 소스 supabase/functions/send-push/index.ts 확인). 즉 "아무도 못 받음"과 "N대 전달"이
// CRM 쪽에서 똑같이 200이다 — tail을 grep한 사람이 "알림 나간다"고 오판한다.
test("sendAssignmentPush: sent=0(대상 토큰 없음)은 성공 로그가 아니라 경고로 구분한다", async () => {
  pushNotifyDeps.fetchImpl = (async () =>
    new Response(JSON.stringify({ message: "no tokens", sent: 0 }), { status: 200 })) as unknown as typeof fetch;

  const { logs, warns } = await captureConsole(() =>
    sendAssignmentPush({ env: { SUPABASE_URL: "https://proj.test" } }, { userId: "U-1", title: "t", body: "b" }),
  );

  expect(warns.some((l) => l.includes("sent=0"))).toBe(true);
  expect(logs.some((l) => l.includes("배정 알림 →"))).toBe(false); // 성공 로그로 새면 안 된다
});

test("sendAssignmentPush: sent>0이면 성공 로그에 전달 대수를 남긴다", async () => {
  pushNotifyDeps.fetchImpl = (async () =>
    new Response(JSON.stringify({ message: "ok", sent: 3, cleaned: 1 }), { status: 200 })) as unknown as typeof fetch;

  const { logs } = await captureConsole(() =>
    sendAssignmentPush({ env: { SUPABASE_URL: "https://proj.test" } }, { userId: "U-1", title: "t", body: "b" }),
  );

  expect(logs.some((l) => l.includes("배정 알림 →") && l.includes("sent=3"))).toBe(true);
});

// 바디 파싱 실패가 발송 계약(best-effort·throw 없음)을 깨면 안 된다.
test("sendAssignmentPush: 응답 바디가 JSON이 아니어도 throw 없이 성공 로그를 남긴다", async () => {
  pushNotifyDeps.fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

  const { logs } = await captureConsole(() =>
    sendAssignmentPush({ env: { SUPABASE_URL: "https://proj.test" } }, { userId: "U-1", title: "t", body: "b" }),
  );

  expect(logs.some((l) => l.includes("배정 알림 →"))).toBe(true);
});

test("sendAssignmentPush: fetch 예외를 흡수(throw 안 함)", async () => {
  pushNotifyDeps.fetchImpl = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  await sendAssignmentPush({ env: { SUPABASE_URL: "https://proj.test" } }, { userId: "U-1", title: "t", body: "b" });
  expect(true).toBe(true);
});

test("sendAssignmentPush: SUPABASE_URL 부재 시 호출 없이 skip", async () => {
  // .env.local이 storage.ts 등 다른 용도로 SUPABASE_URL을 이미 채워두므로(c.env ?? process.env
  // 폴백 관례 — auth.ts/storage.ts/gemini-target.ts와 동일), 이 테스트는 gemini-target.test.ts와
  // 같은 패턴으로 process.env를 일시 제거해 "정말 미설정" 상태를 재현한다.
  const saved = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  try {
    let called = false;
    pushNotifyDeps.fetchImpl = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
    await sendAssignmentPush({ env: {} }, { userId: "U-1", title: "t", body: "b" });
    expect(called).toBe(false);
  } finally {
    if (saved !== undefined) process.env.SUPABASE_URL = saved;
  }
});

// ── send-push 공유 시크릿(X-Push-Secret) ─────────────────────────────────────
// 앱이 send-push에 `X-Push-Secret` 검사를 도입한다(verify_jwt=false + 내부 인증 0이라 URL·user_id만
// 알면 임의 푸시 주입이 가능했다). 3단 무중단 배포의 CRM 몫 — 시크릿이 없으면 헤더를 생략하고 호출은
// 그대로 한다(fail-open). CRM은 발신 측이라 fail-closed의 보안 이득이 없고, 반대로 배포 순서가
// 어긋난 구간에서 배정 알림이 조용히 사라지는 쪽이 나쁘다(앱 팀 합의).
function captureHeaders(status = 200) {
  const calls: Array<{ headers: Record<string, string> }> = [];
  pushNotifyDeps.fetchImpl = (async (_url: string | URL, init?: { headers?: Record<string, string> }) => {
    calls.push({ headers: init?.headers ?? {} });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return calls;
}

test("sendAssignmentPush: SEND_PUSH_SECRET 있으면 X-Push-Secret 헤더 동봉", async () => {
  const calls = captureHeaders();
  await sendAssignmentPush(
    { env: { SUPABASE_URL: "https://proj.test", SEND_PUSH_SECRET: "s3cr3t" } },
    { userId: "U-1", title: "t", body: "b" },
  );
  expect(calls[0].headers["X-Push-Secret"]).toBe("s3cr3t");
  expect(calls[0].headers["Content-Type"]).toBe("application/json");
});

test("sendAssignmentPush: SEND_PUSH_SECRET 없으면 헤더 생략하되 호출은 진행(fail-open)", async () => {
  const saved = process.env.SEND_PUSH_SECRET;
  delete process.env.SEND_PUSH_SECRET; // .env.local에 값이 들어와도 이 테스트는 "미설정"을 재현
  try {
    const calls = captureHeaders();
    await sendAssignmentPush({ env: { SUPABASE_URL: "https://proj.test" } }, { userId: "U-1", title: "t", body: "b" });
    expect(calls).toHaveLength(1); // fail-open — 알림이 끊기지 않는다
    expect(calls[0].headers["X-Push-Secret"]).toBeUndefined();
  } finally {
    if (saved !== undefined) process.env.SEND_PUSH_SECRET = saved;
  }
});

// 401은 다른 실패(네트워크·5xx)와 섞이면 안 된다 — 앱이 401 강제 전환한 뒤 시크릿이 빠져 있으면
// 배정 알림이 조용히 사라진다(실패해도 조용해서 늦게 발견되는 부류). tail에서 grep할 토큰을 남긴다.
function captureErrors() {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  return { lines, restore: () => { console.error = original; } };
}

test("sendAssignmentPush: 401은 AUTH_FAILED 토큰으로 구분 로깅", async () => {
  captureHeaders(401);
  const { lines, restore } = captureErrors();
  try {
    await sendAssignmentPush({ env: { SUPABASE_URL: "https://proj.test" } }, { userId: "U-1", title: "t", body: "b" });
  } finally { restore(); }
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("AUTH_FAILED");
  expect(lines[0]).toContain("SEND_PUSH_SECRET");
  expect(lines[0]).toContain("U-1");
});

// 🔴 prod 실버그(2026-07-09, CF tail 실측): `pushNotifyDeps.fetchImpl(...)`는 **메서드 호출**이라
// this=pushNotifyDeps가 되고, Workers의 global fetch는 this가 globalThis(또는 undefined)가 아니면
// `TypeError: Illegal invocation`으로 죽는다. sendAssignmentPush의 try/catch가 그걸 삼켜서
// #193 머지 이후 prod 배정 알림이 한 번도 나가지 않았다(로컬 bun의 fetch는 this를 안 따져 미검출).
// 호출 전에 지역 변수로 뽑아 plain call하면 this=undefined(ESM strict)라 안전하다 — gemini-post.ts와 동일 패턴.
test("sendAssignmentPush: fetch를 plain call로 호출한다(this 미바인딩 — Workers Illegal invocation 방지)", async () => {
  let called = false;
  let hadThis = true; // 초기값은 실패 방향 — 호출이 아예 없으면 아래 단언이 걸린다
  pushNotifyDeps.fetchImpl = function (this: unknown) {
    called = true;
    hadThis = this !== undefined; // 메서드 호출이면 this=pushNotifyDeps → Workers에서 Illegal invocation
    return Promise.resolve(new Response("{}", { status: 200 }));
  } as unknown as typeof fetch;

  await sendAssignmentPush({ env: { SUPABASE_URL: "https://proj.test" } }, { userId: "U-1", title: "t", body: "b" });

  expect(called).toBe(true);
  expect(hadThis).toBe(false);
});

test("sendAssignmentPush: 401 외 실패는 기존 문구 유지(AUTH_FAILED 아님)", async () => {
  captureHeaders(500);
  const { lines, restore } = captureErrors();
  try {
    await sendAssignmentPush({ env: { SUPABASE_URL: "https://proj.test" } }, { userId: "U-1", title: "t", body: "b" });
  } finally { restore(); }
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain("AUTH_FAILED");
  expect(lines[0]).toContain("status=500");
});
