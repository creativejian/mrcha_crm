import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askAssistant, fetchAssistantMessages, type AssistantMessage } from "@/lib/assistant";

import { AI_HISTORY_PAGE, useAssistantThread } from "./useAssistantThread";

vi.mock("@/lib/assistant", () => ({ askAssistant: vi.fn(), fetchAssistantMessages: vi.fn() }));

const ask = vi.mocked(askAssistant);
const fetchMessages = vi.mocked(fetchAssistantMessages);

// createdAt은 (createdAt,id) 복합 정렬 기준 — i를 초 단위로 깔아 순서를 만든다.
function msg(i: number, role: "user" | "assistant" = "user"): AssistantMessage {
  return { id: `m${String(i).padStart(4, "0")}`, role, content: `내용${i}`, sources: null, createdAt: new Date(1750000000000 + i * 1000).toISOString() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function messageIds(entries: ReturnType<typeof useAssistantThread>["entries"]) {
  return entries.map((e) => (e.kind === "message" ? e.message.id : `pending:${e.question}${e.error ? ":err" : ""}`));
}

describe("useAssistantThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ensureHistory: 최근 페이지 로드 → 메시지 entries + hasMore(꽉 찬 페이지)", async () => {
    fetchMessages.mockResolvedValue(Array.from({ length: AI_HISTORY_PAGE }, (_, i) => msg(i)));
    const { result } = renderHook(() => useAssistantThread());
    await act(async () => result.current.ensureHistory());

    expect(result.current.historyStatus).toBe("loaded");
    expect(result.current.entries).toHaveLength(AI_HISTORY_PAGE);
    expect(result.current.hasMore).toBe(true);
  });

  it("ensureHistory: 실패 시 error 상태 → 재호출로 복구 가능(세션 내 영구 고착 금지)", async () => {
    fetchMessages.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useAssistantThread());
    await act(async () => result.current.ensureHistory());
    expect(result.current.historyStatus).toBe("error");

    fetchMessages.mockResolvedValue([msg(1)]);
    await act(async () => result.current.ensureHistory());
    expect(result.current.historyStatus).toBe("loaded");
    expect(result.current.entries).toHaveLength(1);
  });

  it("늦게 도착한 초기 히스토리가 그 사이 성공한 새 대화를 지우지 않는다(merge, not replace)", async () => {
    const initial = deferred<AssistantMessage[]>();
    fetchMessages.mockReturnValue(initial.promise);
    ask.mockResolvedValue({ messages: [msg(10, "user"), msg(11, "assistant")] });
    const { result } = renderHook(() => useAssistantThread());

    act(() => {
      void result.current.ensureHistory();
    });
    await act(async () => {
      await result.current.submit("새 질문");
    });
    expect(messageIds(result.current.entries)).toEqual(["m0010", "m0011"]);

    // 초기 fetch가 이제서야 옛 스냅샷(새 대화 미포함)으로 resolve — 덮어쓰면 방금 답변이 소실된다.
    await act(async () => initial.resolve([msg(1, "user"), msg(2, "assistant")]));
    expect(messageIds(result.current.entries)).toEqual(["m0001", "m0002", "m0010", "m0011"]);
  });

  it("실패 turn은 제자리(시간순)를 유지하고, 동일 문구 재질문 성공에도 소실되지 않는다", async () => {
    fetchMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useAssistantThread());
    await act(async () => result.current.ensureHistory());

    ask.mockRejectedValueOnce(new Error("일시 오류"));
    await act(async () => {
      await result.current.submit("같은 질문");
    });
    expect(messageIds(result.current.entries)).toEqual(["pending:같은 질문:err"]);

    ask.mockResolvedValueOnce({ messages: [msg(20, "user"), msg(21, "assistant")] });
    await act(async () => {
      await result.current.submit("다른 질문");
    });
    // 시간순: 먼저 실패한 turn이 위, 나중 성공 대화가 아래(역전 금지).
    expect(messageIds(result.current.entries)).toEqual(["pending:같은 질문:err", "m0020", "m0021"]);

    ask.mockResolvedValueOnce({ messages: [msg(30, "user"), msg(31, "assistant")] });
    await act(async () => {
      await result.current.submit("같은 질문"); // 동일 문구 재질문 성공
    });
    // tempId 기준 관리라 텍스트가 같아도 기존 실패 이력은 남는다.
    expect(messageIds(result.current.entries)).toEqual(["pending:같은 질문:err", "m0020", "m0021", "m0030", "m0031"]);
  });

  it("loadOlder: 이전 페이지 prepend + 새 배치의 가장 오래된 메시지를 스크롤 앵커로 노출", async () => {
    fetchMessages.mockResolvedValueOnce(Array.from({ length: AI_HISTORY_PAGE }, (_, i) => msg(100 + i)));
    const { result } = renderHook(() => useAssistantThread());
    await act(async () => result.current.ensureHistory());

    const older = Array.from({ length: AI_HISTORY_PAGE }, (_, i) => msg(i));
    fetchMessages.mockResolvedValueOnce(older);
    await act(async () => result.current.loadOlder());

    expect(fetchMessages).toHaveBeenLastCalledWith({ createdAt: msg(100).createdAt, id: "m0100" });
    await waitFor(() => expect(result.current.entries).toHaveLength(AI_HISTORY_PAGE * 2));
    expect(messageIds(result.current.entries)[0]).toBe("m0000");
    expect(result.current.prependAnchorRef.current).toBe("m0000"); // 새 배치 최상단 노출용
    expect(result.current.hasMore).toBe(true);
  });
});
