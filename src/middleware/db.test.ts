import { test, expect } from "bun:test";

import { endAfterHold } from "./db";

test("endAfterHold: hold 없으면 즉시 end", async () => {
  let ended = false;
  await endAfterHold(undefined, async () => { ended = true; });
  expect(ended).toBe(true);
});

test("endAfterHold: hold 해소 전에는 end를 호출하지 않는다(스트림 마감 쿼리 보호)", async () => {
  let ended = false;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const done = endAfterHold(hold, async () => { ended = true; });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(ended).toBe(false); // 스트림이 살아있는 동안 연결 유지

  release();
  await done;
  expect(ended).toBe(true);
});

test("endAfterHold: hold가 reject여도 반드시 end(연결 누수 방지)", async () => {
  let ended = false;
  await endAfterHold(Promise.reject(new Error("stream failed")), async () => { ended = true; });
  expect(ended).toBe(true);
});
