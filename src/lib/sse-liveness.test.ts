import { test, expect } from "bun:test";

import { createSseLiveness } from "./sse-liveness";

// streamAsk(routes/assistant.ts)에서 추출한 클라 생존 감시 계약 — 지금까지 prod tail로만 검증되던
// 하트비트 3분기(정상 정지 / write-timeout / write-throw)와 raceDead/markDead를 유닛으로 고정한다.
// 타이머는 실시간 소값(sleep.test.ts 컨벤션) — CF에서 쓰기 성공/실패가 유일한 사망 판정 채널이라는 전제.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function harness(overrides?: {
  writeRaw?: (chunk: string) => Promise<unknown>;
  heartbeatMs?: number;
  writeTimeoutMs?: number;
}) {
  const writes: string[] = [];
  const deaths: string[] = [];
  const live = createSseLiveness({
    writeRaw: overrides?.writeRaw ?? (async (chunk) => { writes.push(chunk); }),
    heartbeatMs: overrides?.heartbeatMs ?? 10,
    writeTimeoutMs: overrides?.writeTimeoutMs ?? 50,
    onDead: (source) => { deaths.push(source); },
  });
  return { live, writes, deaths };
}

test("하트비트: 주기마다 SSE 코멘트(': hb')를 송출하고 사망 통지는 없다", async () => {
  const { live, writes, deaths } = harness();
  await wait(35);
  live.stop();
  expect(writes.length).toBeGreaterThanOrEqual(2);
  expect(new Set(writes)).toEqual(new Set([": hb\n\n"]));
  expect(deaths).toEqual([]);
});

test("정상 정지: stop() 이후에는 송출도 사망 통지도 없다", async () => {
  const { live, writes, deaths } = harness();
  live.stop();
  await wait(30);
  expect(writes).toEqual([]);
  expect(deaths).toEqual([]);
});

test("write-timeout: 쓰기가 writeTimeoutMs 안에 안 끝나면 onDead('heartbeat-timeout') 1회 후 정지", async () => {
  let attempts = 0;
  const { live, deaths } = harness({
    writeRaw: () => { attempts++; return new Promise(() => {}); }, // 죽은 클라: 쓰기가 영원히 pending
    heartbeatMs: 5,
    writeTimeoutMs: 10,
  });
  await wait(40);
  live.stop();
  expect(deaths).toEqual(["heartbeat-timeout"]);
  expect(attempts).toBe(1); // 사망 판정 후 루프 탈출 — 재시도 없음
});

test("write-throw: 쓰기가 throw하면 onDead('heartbeat-write-fail') 1회 후 정지", async () => {
  let attempts = 0;
  const { live, deaths } = harness({
    writeRaw: () => { attempts++; return Promise.reject(new Error("stream closed")); },
    heartbeatMs: 5,
  });
  await wait(30);
  live.stop();
  expect(deaths).toEqual(["heartbeat-write-fail"]);
  expect(attempts).toBe(1);
});

test("markDead 이후 틱은 송출 없이 조용히 종료한다", async () => {
  const { live, writes, deaths } = harness({ heartbeatMs: 5 });
  live.markDead();
  await wait(20);
  live.stop();
  expect(writes).toEqual([]);
  expect(deaths).toEqual([]); // 사망은 외부(라우트)가 이미 알고 있음 — 재통지 금지
});

test("쓰기 대기 중 stop()이면 사망 통지 없이 종료한다(스트림 정상 종료 경합)", async () => {
  const { live, deaths } = harness({
    writeRaw: () => new Promise(() => {}),
    heartbeatMs: 5,
    writeTimeoutMs: 100,
  });
  await wait(12); // 첫 쓰기가 시작된 뒤
  live.stop(); // 정상 종료가 write-timeout 판정보다 먼저
  await wait(30);
  expect(deaths).toEqual([]);
});

test("raceDead: markDead가 먼저면 'dead'를 반환한다", async () => {
  const { live } = harness();
  const frozen = live.raceDead(new Promise<string>(() => {})); // 얼어붙은 read/write
  live.markDead();
  expect(await frozen).toBe("dead");
  live.stop();
});

test("raceDead: 대상 promise가 먼저 완료되면 값을 그대로 반환한다", async () => {
  const { live } = harness();
  expect(await live.raceDead(Promise.resolve("chunk"))).toBe("chunk");
  live.stop();
});
