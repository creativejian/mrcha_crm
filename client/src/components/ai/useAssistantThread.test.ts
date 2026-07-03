import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askAssistantStream, fetchAssistantMessages, type AssistantMessage } from "@/lib/assistant";

import { AI_HISTORY_PAGE, useAssistantThread } from "./useAssistantThread";

vi.mock("@/lib/assistant", () => ({ askAssistantStream: vi.fn(), fetchAssistantMessages: vi.fn() }));

const askStream = vi.mocked(askAssistantStream);
const fetchMessages = vi.mocked(fetchAssistantMessages);

// createdAt은 (createdAt,id) 복합 정렬 기준 — i를 초 단위로 깔아 순서를 만든다.
function msg(i: number, role: "user" | "assistant" = "user"): AssistantMessage {
  return {
    id: `m${String(i).padStart(4, "0")}`,
    role,
    content: `내용${i}`,
    sources: null,
    createdAt: new Date(1750000000000 + i * 1000).toISOString(),
  };
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
    askStream.mockImplementation(async (_q, handlers) => {
      handlers.onChunk("답변");
      return { messages: [msg(10, "user"), msg(11, "assistant")] };
    });
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

    askStream.mockRejectedValueOnce(new Error("일시 오류"));
    await act(async () => {
      await result.current.submit("같은 질문");
    });
    expect(messageIds(result.current.entries)).toEqual(["pending:같은 질문:err"]);

    askStream.mockImplementationOnce(async (_q, handlers) => {
      handlers.onChunk("답변");
      return { messages: [msg(20, "user"), msg(21, "assistant")] };
    });
    await act(async () => {
      await result.current.submit("다른 질문");
    });
    // 시간순: 먼저 실패한 turn이 위, 나중 성공 대화가 아래(역전 금지).
    expect(messageIds(result.current.entries)).toEqual(["pending:같은 질문:err", "m0020", "m0021"]);

    askStream.mockImplementationOnce(async (_q, handlers) => {
      handlers.onChunk("답변");
      return { messages: [msg(30, "user"), msg(31, "assistant")] };
    });
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

  it("submit(스트리밍): onChunk가 드레인을 거쳐 streamText로 표시되고, done 후 영속본으로 교체된다", async () => {
    fetchMessages.mockResolvedValue([]);
    const user = msg(1, "user");
    const assistant = msg(2, "assistant");
    askStream.mockImplementation(async (_q, handlers) => {
      handlers.onChunk("답변본문입니다");
      return { messages: [user, assistant] };
    });

    const { result } = renderHook(() => useAssistantThread());
    await act(async () => {
      await result.current.submit("질문");
    });

    expect(result.current.entries.map((e) => e.kind)).toEqual(["message", "message"]);
    expect(result.current.asking).toBe(false);
  });

  it("submit(0청크 즉시 done): onChunk 없이 완료돼도 영속본으로 교체된다", async () => {
    fetchMessages.mockResolvedValue([]);
    askStream.mockImplementation(async () => ({ messages: [msg(1, "user"), msg(2, "assistant")] }));

    const { result } = renderHook(() => useAssistantThread());
    await act(async () => {
      await result.current.submit("질문");
    });

    expect(result.current.entries.map((e) => e.kind)).toEqual(["message", "message"]);
    expect(result.current.asking).toBe(false);
  });

  it("submit 중 streamText가 점진 노출된다(드레인 틱)", async () => {
    fetchMessages.mockResolvedValue([]);
    let release!: () => void;
    askStream.mockImplementation((_q, handlers) => {
      handlers.onChunk("가".repeat(200));
      return new Promise((res) => {
        release = () => res({ messages: [msg(1, "user"), msg(2, "assistant")] });
      });
    });

    const { result } = renderHook(() => useAssistantThread());
    let submitP!: Promise<boolean>;
    act(() => {
      submitP = result.current.submit("질문");
    });

    await waitFor(() => {
      const pending = result.current.entries.find((e) => e.kind === "pending");
      expect(pending && pending.kind === "pending" ? (pending.streamText?.length ?? 0) : 0).toBeGreaterThan(0);
    });
    const early = result.current.entries.find((e) => e.kind === "pending");
    expect(early!.kind === "pending" && early!.streamText!.length).toBeLessThan(200); // 도입부 2자/틱 — 전체가 한 번에 나오지 않음

    act(() => release());
    await act(async () => {
      await submitP;
    });
    expect(result.current.entries.map((e) => e.kind)).toEqual(["message", "message"]);
  });

  it("stop: abort 후 재조회로 서버 저장본과 동기화하고 pending을 제거한다", async () => {
    askStream.mockImplementation((_q, handlers, signal) => {
      handlers.onChunk("부분답변");
      return new Promise((_res, rej) => {
        signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    });
    const stopped = [msg(1, "user"), { ...msg(2, "assistant"), content: "부분답변 (중단됨)" }];
    fetchMessages.mockResolvedValueOnce(stopped); // stop 후 재조회 응답

    const { result } = renderHook(() => useAssistantThread());
    let submitP!: Promise<boolean>;
    act(() => {
      submitP = result.current.submit("질문");
    });
    await waitFor(() => expect(result.current.asking).toBe(true));

    act(() => result.current.stop());
    await act(async () => {
      await submitP;
    });

    expect(result.current.entries.map((e) => e.kind)).toEqual(["message", "message"]);
    const last = result.current.entries.at(-1)!;
    expect(last.kind === "message" && last.message.content).toBe("부분답변 (중단됨)");
    expect(result.current.asking).toBe(false);
  }, 10000);

  it("stop: 재조회의 마지막 행이 아직 빈 placeholder면 재시도해 마감본을 받는다(prod 마감 지연 흡수)", async () => {
    askStream.mockImplementation((_q, handlers, signal) => {
      handlers.onChunk("부분답변");
      return new Promise((_res, rej) => {
        signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    });
    const placeholder = { ...msg(2, "assistant"), content: "" };
    fetchMessages.mockResolvedValueOnce([msg(1, "user"), placeholder]); // 1차: 서버 마감 전
    fetchMessages.mockResolvedValueOnce([msg(1, "user"), { ...msg(2, "assistant"), content: "부분답변 (중단됨)" }]); // 2차: 마감 완료

    const { result } = renderHook(() => useAssistantThread());
    let submitP!: Promise<boolean>;
    act(() => {
      submitP = result.current.submit("질문");
    });
    await waitFor(() => expect(result.current.asking).toBe(true));
    act(() => result.current.stop());
    await act(async () => {
      await submitP;
    });

    expect(fetchMessages).toHaveBeenCalledTimes(2);
    const last = result.current.entries.at(-1)!;
    expect(last.kind === "message" && last.message.content).toBe("부분답변 (중단됨)");
  }, 10000);

  it("entries: 빈 content의 assistant 행(마감 전 placeholder/유령)은 표시하지 않는다", async () => {
    fetchMessages.mockResolvedValue([msg(1, "user"), { ...msg(2, "assistant"), content: "" }, msg(3, "assistant")]);
    const { result } = renderHook(() => useAssistantThread());
    await act(async () => result.current.ensureHistory());

    expect(result.current.entries.map((e) => (e.kind === "message" ? e.message.id : "pending"))).toEqual([
      msg(1).id,
      msg(3).id,
    ]);
  });

  it("stop: 재조회가 실패해도 pending은 제거된다(이중 표시 방지)", async () => {
    askStream.mockImplementation((_q, handlers, signal) => {
      handlers.onChunk("부분");
      return new Promise((_res, rej) => {
        signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    });
    fetchMessages.mockRejectedValueOnce(new Error("network"));

    const { result } = renderHook(() => useAssistantThread());
    let submitP!: Promise<boolean>;
    act(() => {
      submitP = result.current.submit("질문");
    });
    await waitFor(() => expect(result.current.asking).toBe(true));
    act(() => result.current.stop());
    await act(async () => {
      await submitP;
    });

    expect(result.current.entries.filter((e) => e.kind === "pending")).toHaveLength(0);
  }, 10000);

  it("스트리밍 실패(error 이벤트): pending이 에러 turn으로 남는다", async () => {
    fetchMessages.mockResolvedValue([]);
    askStream.mockRejectedValue(new Error("일시적으로 답변에 실패했습니다."));
    const { result } = renderHook(() => useAssistantThread());
    await act(async () => {
      await result.current.submit("질문");
    });
    const pending = result.current.entries.find((e) => e.kind === "pending");
    expect(pending!.kind === "pending" && pending!.error).toBe("일시적으로 답변에 실패했습니다.");
  });
});
