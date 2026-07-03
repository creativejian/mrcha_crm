export type SseEvent = { event: string; data: string };

// SSE 증분 파서 — fetch ReadableStream 청크를 밀어 넣으면 그 시점까지 완성된 이벤트를 반환한다.
// 이벤트 경계 = 빈 줄, data 복수 라인은 \n으로 합침(SSE 규격), event 필드 없으면 "message".
// 입력은 이미 디코딩된 문자열이어야 한다 — ReadableStream<Uint8Array> 소비자는 반드시 TextDecoder를 `{ stream: true }`로 사용할 것(멀티바이트 경계 보호).
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buf = "";
  let event = "message";
  let dataLines: string[] = [];
  return (chunk: string): SseEvent[] => {
    buf += chunk;
    const out: SseEvent[] = [];
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") {
        if (dataLines.length > 0) out.push({ event, data: dataLines.join("\n") });
        event = "message";
        dataLines = [];
      } else if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    return out;
  };
}
