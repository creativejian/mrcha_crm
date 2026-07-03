import { test, expect } from "bun:test";

import { sleepUnlessAborted } from "./sleep";

// 하트비트 주기·쓰기 타임아웃(routes/assistant.ts)이 의존하는 계약 — 지금까지 prod tail로만 검증되던 경로.

test("이미 abort된 signal이면 즉시 해소(리스너 미등록)", async () => {
  const ac = new AbortController();
  ac.abort();
  let added = 0;
  const origAdd = ac.signal.addEventListener.bind(ac.signal);
  ac.signal.addEventListener = ((...args: Parameters<typeof origAdd>) => { added++; return origAdd(...args); }) as typeof origAdd;

  const start = performance.now();
  await sleepUnlessAborted(10_000, ac.signal);
  expect(performance.now() - start).toBeLessThan(100);
  expect(added).toBe(0);
});

test("abort 없으면 ms 경과 후 해소 + abort 리스너 해제(누수 방지)", async () => {
  const ac = new AbortController();
  let removed = 0;
  const origRemove = ac.signal.removeEventListener.bind(ac.signal);
  ac.signal.removeEventListener = ((...args: Parameters<typeof origRemove>) => { removed++; return origRemove(...args); }) as typeof origRemove;

  const start = performance.now();
  await sleepUnlessAborted(20, ac.signal);
  expect(performance.now() - start).toBeGreaterThanOrEqual(15);
  expect(removed).toBe(1); // 매 하트비트 틱마다 호출되므로 리스너가 남으면 스트림 수명 동안 누적된다
});

test("대기 중 abort되면 타임아웃 전에 즉시 해소", async () => {
  const ac = new AbortController();
  const start = performance.now();
  const sleeping = sleepUnlessAborted(10_000, ac.signal);
  setTimeout(() => ac.abort(), 10);
  await sleeping;
  expect(performance.now() - start).toBeLessThan(1_000);
});
