import { sleepUnlessAborted } from "./sleep";

// SSE 클라 생존 감시 — streamAsk(routes/assistant.ts)에서 추출한 타이밍·race·상태 기계장치.
// CF Pages에서 클라 disconnect는 어느 채널로도 신뢰 있게 전달되지 않는다(2026-07-03 prod 실측:
// sse.onAbort·raw signal 미발화 + pending read/write가 reject 없이 얼어붙음 → finalize가
// waitUntil 유예(~30s)를 넘겨 취소돼 유령 placeholder). 대응 2중(이 모듈):
// ① 하트비트: SSE 코멘트(": hb") 주기 송출 — 쓰기 실패/타임아웃 = 사망 판정(신호 없는 런타임의 최후 채널)
// ② raceDead: gen 읽기·클라 쓰기를 사망 promise와 race — 어떤 await에 얼어붙어도 릴레이 탈출 보장
// 채널 배선(sse.onAbort·raw signal)과 도메인(업스트림 중단·선저장/finalize)은 호출 라우트가 소유한다.

export type SseLivenessOptions = {
  /** 하트비트 코멘트 송출 채널(sse.write) — 성공/실패가 유일하게 신뢰 가능한 생존 신호. */
  writeRaw: (chunk: string) => Promise<unknown>;
  /** 죽은 클라 감지 주기. */
  heartbeatMs: number;
  /** SSE 쓰기는 정상 소비 시 즉시 완료 — 이 이상 지연이면 사망 간주. */
  writeTimeoutMs: number;
  /** 하트비트가 사망을 판정했을 때 1회 통지(source = "heartbeat-timeout" | "heartbeat-write-fail"). */
  onDead: (source: "heartbeat-timeout" | "heartbeat-write-fail") => void;
};

export type SseLiveness = {
  /** 임의 await를 사망 promise와 race — 사망 시 "dead" 반환으로 릴레이 탈출을 보장한다. */
  raceDead: <T>(p: Promise<T>) => Promise<T | "dead">;
  /** 외부 채널(sse.onAbort·raw signal·onDead 처리부)이 사망을 알릴 때 호출 — 멱등. */
  markDead: () => void;
  /** 스트림 정상 종료 시 하트비트 정지(finally에서 호출). */
  stop: () => void;
};

export function createSseLiveness(opts: SseLivenessOptions): SseLiveness {
  const { writeRaw, heartbeatMs, writeTimeoutMs, onDead } = opts;
  const hbStop = new AbortController();
  let dead = false;
  let resolveDead!: () => void;
  const clientDead = new Promise<"dead">((resolve) => { resolveDead = () => resolve("dead"); });
  const markDead = () => { dead = true; resolveDead(); };
  const raceDead = <T,>(p: Promise<T>): Promise<T | "dead"> => Promise.race([p, clientDead]);

  void (async () => {
    for (;;) {
      await sleepUnlessAborted(heartbeatMs, hbStop.signal);
      if (hbStop.signal.aborted || dead) return;
      try {
        const ok = await Promise.race([
          writeRaw(": hb\n\n").then(() => true),
          sleepUnlessAborted(writeTimeoutMs, hbStop.signal).then(() => false),
        ]);
        if (!ok && !hbStop.signal.aborted) { onDead("heartbeat-timeout"); return; }
        if (!ok) return;
      } catch {
        onDead("heartbeat-write-fail");
        return;
      }
    }
  })();

  return { raceDead, markDead, stop: () => hbStop.abort() };
}
