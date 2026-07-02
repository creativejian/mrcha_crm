import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// postgres_changes({new,old})와 broadcast({payload}) 콜백을 모두 받도록 느슨한 payload 타입.
type Handler = (payload: Record<string, unknown>) => void;
type StatusCb = ((status: string) => void) | undefined;
const handlers: { event: string; filter: Record<string, unknown>; cb: Handler }[] = [];
const channelTopics: string[] = [];
const statusCbs: StatusCb[] = [];
const channel = {
  on: vi.fn((_type: string, filter: Record<string, unknown>, cb: Handler) => {
    handlers.push({ event: String(filter.event), filter, cb });
    return channel;
  }),
  subscribe: vi.fn((cb?: (status: string) => void) => {
    statusCbs.push(cb);
    return channel;
  }),
  send: vi.fn(),
};
const removeChannel = vi.fn();

vi.mock("./supabase", () => ({
  supabase: {
    channel: vi.fn((topic: string) => {
      channelTopics.push(topic);
      return channel;
    }),
    removeChannel: (c: unknown) => removeChannel(c),
  },
}));

import { joinTypingChannel, subscribeChatMessages, subscribeChatSessions } from "./chat-realtime";

beforeEach(() => {
  handlers.length = 0;
  channelTopics.length = 0;
  statusCbs.length = 0;
  vi.clearAllMocks();
});

describe("subscribeChatSessions", () => {
  it("INSERT/UPDATE 이벤트에서 mode 전이를 콜백으로 넘긴다", () => {
    const onChange = vi.fn();
    subscribeChatSessions(onChange);
    expect(handlers.map((h) => h.event)).toEqual(["INSERT", "UPDATE"]);
    handlers[1].cb({ new: { mode: "pending" }, old: { mode: "ai" } });
    expect(onChange).toHaveBeenCalledWith({ newMode: "pending", oldMode: "ai" });
    handlers[0].cb({ new: { mode: "ai" }, old: {} });
    expect(onChange).toHaveBeenCalledWith({ newMode: "ai", oldMode: null });
  });
  it("정리 함수가 removeChannel을 호출한다", () => {
    const cleanup = subscribeChatSessions(vi.fn());
    cleanup();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeChatMessages", () => {
  it("user_id 필터로 INSERT/UPDATE row를 넘긴다", () => {
    const onRow = vi.fn();
    subscribeChatMessages("u1", onRow);
    expect(handlers).toHaveLength(2);
    expect(handlers[0].filter.filter).toBe("user_id=eq.u1");
    const row = { id: "m1", user_id: "u1" };
    handlers[0].cb({ new: row, old: {} });
    expect(onRow).toHaveBeenCalledWith(row);
  });
});

it("공존 구독마다 채널 topic이 고유하다(supabase-js topic 재사용 충돌 방지)", () => {
  subscribeChatSessions(vi.fn());
  subscribeChatSessions(vi.fn());
  subscribeChatMessages("u1", vi.fn());
  subscribeChatMessages("u1", vi.fn());
  expect(new Set(channelTopics).size).toBe(4);
});

it("SUBSCRIBED마다 onResync를 호출한다(최초 join 포함 — 초기 스냅샷 갭 보정)", () => {
  const onResync = vi.fn();
  subscribeChatSessions(vi.fn(), onResync);
  const cb = statusCbs[0];
  cb?.("SUBSCRIBED");
  expect(onResync).toHaveBeenCalledTimes(1);
  cb?.("CHANNEL_ERROR");
  expect(onResync).toHaveBeenCalledTimes(1);
  cb?.("SUBSCRIBED");
  expect(onResync).toHaveBeenCalledTimes(2);
});

describe("joinTypingChannel", () => {
  // 모듈 레벨 채널 매니저(유예 teardown)라 fake timer로 흐름 제어 + 테스트별 uid 분리.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers(); // 유예 teardown 소진 → 매니저 Map 정리(테스트 간 오염 방지)
    vi.useRealTimers();
  });

  it("topic이 앱과 동일한 typing:<uid>다(suffix 고유화 금지 — broadcast 상호운용)", () => {
    const { cleanup } = joinTypingChannel("t1", vi.fn());
    expect(channelTopics).toEqual(["typing:t1"]);
    cleanup();
  });
  it("sender_type 'user'(고객)만 콜백하고 'staff'는 무시한다", () => {
    const onTyping = vi.fn();
    const { cleanup } = joinTypingChannel("t2", onTyping);
    expect(handlers[0].event).toBe("typing");
    handlers[0].cb({ payload: { sender_type: "user" } });
    expect(onTyping).toHaveBeenCalledTimes(1);
    handlers[0].cb({ payload: { sender_type: "staff" } });
    expect(onTyping).toHaveBeenCalledTimes(1);
    cleanup();
  });
  it("sendTyping은 1s leading-edge throttle로 staff payload를 보낸다", () => {
    vi.setSystemTime(1000);
    const { sendTyping, cleanup } = joinTypingChannel("t3", vi.fn());
    sendTyping(); // 첫 입력 — 즉시 전송
    vi.setSystemTime(1999);
    sendTyping(); // 1s 미만 — 무시
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "typing",
      payload: { sender_type: "staff" },
    });
    vi.setSystemTime(2000);
    sendTyping(); // 1s 경과 — 재전송
    expect(channel.send).toHaveBeenCalledTimes(2);
    cleanup();
  });
  it("cleanup은 유예(250ms) 후 removeChannel을 호출한다", () => {
    const { cleanup } = joinTypingChannel("t4", vi.fn());
    cleanup();
    expect(removeChannel).not.toHaveBeenCalled(); // 즉시 해체 금지(재join 유예)
    vi.advanceTimersByTime(250);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
  it("유예 안에 재join하면(StrictMode 재mount) 산 채널을 재사용하고 해체하지 않는다", () => {
    const first = joinTypingChannel("t5", vi.fn());
    first.cleanup();
    const onTyping2 = vi.fn();
    const second = joinTypingChannel("t5", onTyping2); // 250ms 유예 안 재join
    vi.advanceTimersByTime(1000);
    expect(removeChannel).not.toHaveBeenCalled(); // 옛 타이머 취소됨
    expect(channelTopics).toEqual(["typing:t5"]); // supabase.channel 1회 = 같은 채널 재사용
    handlers[0].cb({ payload: { sender_type: "user" } });
    expect(onTyping2).toHaveBeenCalledTimes(1); // 새 리스너로 수신 정상
    second.cleanup();
    vi.advanceTimersByTime(250);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
