import { describe, expect, it, vi } from "vitest";

vi.mock("./http", () => ({
  getJson: vi.fn(async () => ([
    { id: "m1", role: "user", content: "q", sources: null, createdAt: "2026-07-02T00:00:00Z" },
  ])),
}));
vi.mock("./api", () => ({ apiFetch: vi.fn() }));

import { getJson } from "./http";
import { apiFetch } from "./api";
import { askAssistantStream, fetchAssistantMessages } from "./assistant";

describe("assistant client", () => {
  it("fetchAssistantMessages: GET /messages", async () => {
    const rows = await fetchAssistantMessages();
    expect(getJson).toHaveBeenCalledWith("/api/assistant/messages");
    expect(rows[0].content).toBe("q");
  });
  it("fetchAssistantMessages(cursor): before/beforeId 쿼리 포함", async () => {
    await fetchAssistantMessages({ createdAt: "2026-07-02T00:00:00.000Z", id: "abc" });
    expect(getJson).toHaveBeenCalledWith(expect.stringContaining("before=2026-07-02T00%3A00%3A00.000Z"));
  });
});

function sseResponse(payload: string): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(payload));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("askAssistantStream", () => {
  it("text 청크마다 onChunk, done의 messages를 resolve한다", async () => {
    const payload =
      'event: text\ndata: {"chunk":"안녕"}\n\n' +
      'event: text\ndata: {"chunk":"하세요"}\n\n' +
      'event: done\ndata: {"messages":[{"id":"u1","role":"user","content":"q","sources":null,"createdAt":"2026-07-03T00:00:00.000Z"},{"id":"a1","role":"assistant","content":"안녕하세요","sources":[],"createdAt":"2026-07-03T00:00:00.001Z"}]}\n\n';
    vi.mocked(apiFetch).mockResolvedValue(sseResponse(payload));

    const chunks: string[] = [];
    const res = await askAssistantStream("q", { onChunk: (c) => chunks.push(c) }, new AbortController().signal);

    expect(chunks).toEqual(["안녕", "하세요"]);
    expect(res.messages).toHaveLength(2);
    expect(res.messages[1].content).toBe("안녕하세요");
    const init = vi.mocked(apiFetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ question: "q", stream: true });
  });

  it("멀티바이트 문자가 바이트 경계에서 갈라진 두 스트림 청크도 온전히 파싱한다", async () => {
    const full = new TextEncoder().encode('event: text\ndata: {"chunk":"한글"}\n\n');
    // "한"의 UTF-8 3바이트 중간에서 절단
    let cut = 0;
    for (let i = 12; i < full.length; i++) { if ((full[i] & 0xc0) === 0x80) { cut = i; break; } }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(full.slice(0, cut));
        controller.enqueue(full.slice(cut));
        controller.close();
      },
    });
    vi.mocked(apiFetch).mockResolvedValue(new Response(body, { status: 200 }));
    // done 없이 끝나므로 throw — 그 전에 onChunk가 온전한 "한글"을 받았는지가 검증 대상
    const chunks: string[] = [];
    await expect(askAssistantStream("q", { onChunk: (c) => chunks.push(c) }, new AbortController().signal)).rejects.toThrow();
    expect(chunks).toEqual(["한글"]);
  });

  it("error 이벤트는 서버 메시지로 throw한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue(sseResponse('event: error\ndata: {"code":"generation_failed","message":"일시적으로 답변에 실패했습니다."}\n\n'));
    await expect(askAssistantStream("q", { onChunk: () => {} }, new AbortController().signal)).rejects.toThrow("일시적으로 답변에 실패했습니다.");
  });

  it("HTTP 실패는 body.error로 throw한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ error: "질문을 입력하세요." }), { status: 400 }));
    await expect(askAssistantStream("q", { onChunk: () => {} }, new AbortController().signal)).rejects.toThrow("질문을 입력하세요.");
  });

  it("done 없이 스트림이 끝나면 throw한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue(sseResponse('event: text\ndata: {"chunk":"부분"}\n\n'));
    await expect(askAssistantStream("q", { onChunk: () => {} }, new AbortController().signal)).rejects.toThrow("응답이 완료되지 않았습니다.");
  });

  it("error 이벤트 throw 시 reader.cancel로 커넥션을 정리한다", async () => {
    let cancelled = false;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('event: error\ndata: {"code":"generation_failed","message":"실패"}\n\n'));
        // close하지 않음 — cancel 호출로만 정리되는 열린 커넥션 상황
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.mocked(apiFetch).mockResolvedValue(new Response(body, { status: 200 }));
    await expect(askAssistantStream("q", { onChunk: () => {} }, new AbortController().signal)).rejects.toThrow("실패");
    expect(cancelled).toBe(true);
  });

  it("done 수신 즉시 resolve한다 — 물리적 close를 기다리지 않고 finally cancel이 커넥션을 정리", async () => {
    let cancelled = false;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(
          'event: done\ndata: {"messages":[{"id":"u1","role":"user","content":"q","sources":null,"createdAt":"2026-07-03T00:00:00.000Z"},{"id":"a1","role":"assistant","content":"답","sources":[],"createdAt":"2026-07-03T00:00:00.001Z"}]}\n\n',
        ));
        // close하지 않음 — done 즉시 반환이 아니면 다음 read()에서 영원히 대기(중지 경합 창)
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.mocked(apiFetch).mockResolvedValue(new Response(body, { status: 200 }));
    const res = await askAssistantStream("q", { onChunk: () => {} }, new AbortController().signal);
    expect(res.messages).toHaveLength(2);
    expect(res.messages[1].content).toBe("답");
    expect(cancelled).toBe(true);
  });
});
