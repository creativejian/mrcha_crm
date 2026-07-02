import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => void;
const handlers: { event: string; filter: Record<string, unknown>; cb: Handler }[] = [];
const channel = {
  on: vi.fn((_type: string, filter: Record<string, unknown>, cb: Handler) => {
    handlers.push({ event: String(filter.event), filter, cb });
    return channel;
  }),
  subscribe: vi.fn(() => channel),
};
const removeChannel = vi.fn();

vi.mock("./supabase", () => ({
  supabase: {
    channel: vi.fn(() => channel),
    removeChannel: (c: unknown) => removeChannel(c),
  },
}));

import { subscribeChatMessages, subscribeChatSessions } from "./chat-realtime";

beforeEach(() => {
  handlers.length = 0;
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
