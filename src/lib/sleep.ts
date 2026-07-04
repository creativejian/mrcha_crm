// signal이 abort될 때까지 최대 ms 대기 — abort 시 즉시 해소(정상 종료 후 하트비트 잔류 지연 방지).
// SSE 하트비트(lib/sse-liveness.ts)의 주기·쓰기 타임아웃이 사용한다.
export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(t); signal.removeEventListener("abort", done); resolve(); };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}
