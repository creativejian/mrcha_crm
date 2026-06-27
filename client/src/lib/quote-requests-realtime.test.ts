import { beforeEach, describe, expect, it, vi } from "vitest";

// supabase 클라 mock — channel().on().subscribe() 체인을 캡처하고 INSERT 콜백을 보관한다.
const channelHandlers: Array<() => void> = [];
const channel = {
  on: vi.fn((_event: string, _filter: unknown, cb: () => void) => {
    channelHandlers.push(cb);
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

import { subscribeNewQuoteRequests } from "./quote-requests-realtime";

beforeEach(() => {
  channelHandlers.length = 0;
  vi.clearAllMocks();
});

describe("subscribeNewQuoteRequests", () => {
  it("INSERT 이벤트가 오면 onInsert를 호출한다", () => {
    const onInsert = vi.fn();
    subscribeNewQuoteRequests(onInsert);
    expect(channelHandlers).toHaveLength(1);
    channelHandlers[0](); // 서버 INSERT 이벤트 시뮬레이션
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it("정리 함수가 removeChannel을 호출한다", () => {
    const cleanup = subscribeNewQuoteRequests(vi.fn());
    expect(removeChannel).not.toHaveBeenCalled();
    cleanup();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
