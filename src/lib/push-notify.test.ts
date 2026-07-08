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
