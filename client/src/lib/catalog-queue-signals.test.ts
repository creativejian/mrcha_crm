// 큐 신선도 신호 SSOT(2026-08-05). 계기를 하나라도 빠뜨리면 화면마다 다른 숫자가 뜬다 —
// 실제로 사이드바 배지가 "늘어나는 방향"만 60초 뒤처지고, 파란 배지가 타 세션 승인을 놓쳤다.
// 그 두 결함이 여기 통과 여부로 드러나야 한다.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// broadcast(타 세션)는 Supabase 채널을 여는 모듈이라 구독 등록만 흉내 낸다.
const remoteListeners = new Set<() => void>();
vi.mock("./catalog-change-realtime", () => ({
  onCatalogQueueRemoteChanged: (listener: () => void) => {
    remoteListeners.add(listener);
    return () => remoteListeners.delete(listener);
  },
}));

const { notifyCatalogWriteQueued, notifyMcCodesAssigned, notifyQueueUpdated, onCatalogWriteQueued, useCatalogQueueTick } =
  await import("./catalog-queue-signals");

function emitRemote() {
  for (const listener of remoteListeners) listener();
}

describe("useCatalogQueueTick", () => {
  it("적재·결정·타 세션 — 세 계기 모두에 반응한다(하나라도 빠지면 화면이 어긋난다)", () => {
    const { result } = renderHook(() => useCatalogQueueTick(true));
    const start = result.current;

    act(() => notifyCatalogWriteQueued());
    expect(result.current).toBeGreaterThan(start);

    const afterWrite = result.current;
    act(() => notifyQueueUpdated());
    expect(result.current).toBeGreaterThan(afterWrite);

    const afterDecision = result.current;
    act(() => emitRemote());
    expect(result.current).toBeGreaterThan(afterDecision);
  });

  it("decisions:false — 결정은 무시하되 적재·타 세션은 계속 듣는다(팀장 '내 요청' 축)", () => {
    const { result } = renderHook(() => useCatalogQueueTick(true, { decisions: false }));
    const start = result.current;

    act(() => notifyQueueUpdated());
    expect(result.current).toBe(start); // 결정은 안 듣는다

    act(() => emitRemote());
    expect(result.current).toBeGreaterThan(start); // 타 세션은 듣는다
  });

  it("고유번호 할당은 assigned를 켠 소비처만 듣는다", () => {
    const off = renderHook(() => useCatalogQueueTick(true));
    const on = renderHook(() => useCatalogQueueTick(true, { assigned: true }));
    const offStart = off.result.current;
    const onStart = on.result.current;

    act(() => notifyMcCodesAssigned());

    expect(off.result.current).toBe(offStart);
    expect(on.result.current).toBeGreaterThan(onStart);
  });

  it("enabled:false면 어떤 신호에도 반응하지 않는다 — 권한 없는 화면이 조회를 유발하면 안 된다", () => {
    const { result } = renderHook(() => useCatalogQueueTick(false, { assigned: true }));
    const start = result.current;

    act(() => {
      notifyCatalogWriteQueued();
      notifyQueueUpdated();
      notifyMcCodesAssigned();
      emitRemote();
    });

    expect(result.current).toBe(start);
  });

  it("리스너가 던져도 뒤 구독자와 발신자를 막지 않는다 — 알림은 커밋 뒤의 부가 효과다", () => {
    // 던지는 구독자를 **먼저** 등록한다: 격리가 없으면 여기서 순회가 끊겨 아래 훅이 신호를
    // 못 받고, 발신자(적재·승인이 이미 커밋된 뒤)까지 예외를 되받아 거짓 실패가 된다.
    const offThrower = onCatalogWriteQueued(() => {
      throw new Error("구독자 예외");
    });
    const { result } = renderHook(() => useCatalogQueueTick(true));
    const start = result.current;

    expect(() =>
      act(() => {
        notifyCatalogWriteQueued();
      }),
    ).not.toThrow();
    expect(result.current).toBeGreaterThan(start);

    offThrower();
  });
});
