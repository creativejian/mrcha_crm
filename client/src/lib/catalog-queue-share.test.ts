// 배지 조회 중복 제거(2026-08-05). MC 마스터의 대기열·미부여 배지는 소비처가 여럿인데(사이드바 ·
// 브랜드/모델 목록 · 헤더 팝오버) 인스턴스마다 같은 URL을 따로 불렀다 — admin이 MC 마스터에 있으면
// 왕복이 4번 나갔고, 응답이 따로 도착하는 사이 배지들이 서로 다른 숫자를 보였다(1~2초).
//
// 여기서 잠그는 불변식 넷. 어느 하나가 풀려도 증상은 "가끔 숫자가 잠깐 어긋난다"뿐이라 눈으로는
// 못 잡는다 — 그래서 테스트가 유일한 그물이다.
//  ① 같은 계기로 출발한 조회는 **한 요청**으로 합쳐진다.
//  ② 한 소비처가 받아온 응답을 **나머지도 그대로** 본다(폴링·focus를 한 곳만 켜도 갈리지 않는다).
//  ③ 계기가 지나간 뒤의 재조회는 **진행 중 요청에 올라타지 않는다**(승인 전 숫자를 물려받지 않는다).
//  ④ 늦게 도착한 옛 응답은 **새 응답을 덮지 않는다**.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// broadcast(타 세션)는 Supabase 채널을 여는 모듈이라 구독 등록만 흉내 낸다(signals 테스트와 동형).
const remoteListeners = new Set<() => void>();
vi.mock("./catalog-change-realtime", () => ({
  onCatalogQueueRemoteChanged: (listener: () => void) => {
    remoteListeners.add(listener);
    return () => remoteListeners.delete(listener);
  },
  broadcastCatalogQueueChanged: () => undefined,
}));

// 왕복 횟수를 세는 지점 = getJson 호출. in-flight 공유는 이 호출 자체를 막으므로 그대로 계측이 된다.
const getJsonMock = vi.fn();
vi.mock("./http", () => ({
  getJson: (url: string) => getJsonMock(url) as Promise<unknown>,
  sendJson: vi.fn(),
}));

const { resetChangeRequestCachesForTest, useChangeRequestQueue } = await import("./catalog-change-requests");
const { useMcCodeGaps } = await import("./mc-code-gaps");
const { notifyQueueUpdated } = await import("./catalog-queue-signals");

const QUEUE_URL = "/api/catalog/change-requests?status=pending";
const GAPS_URL = "/api/catalog/models/mc-code-gaps";

function row(id: string) {
  return { id, kind: "trim.update", targetModelId: 10, targetBrandId: 3 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetChangeRequestCachesForTest();
  getJsonMock.mockReset();
});

describe("대기열 조회 공유", () => {
  it("소비처 둘이 같은 계기로 조회해도 왕복은 한 번 — 둘이 같은 응답을 본다", async () => {
    getJsonMock.mockResolvedValue([row("cr-1")]);

    const a = renderHook(() => useChangeRequestQueue(true));
    const b = renderHook(() => useChangeRequestQueue(true));

    await waitFor(() => expect(a.result.current.rows).toHaveLength(1));
    expect(b.result.current.rows).toBe(a.result.current.rows); // 같은 값이 아니라 **같은 응답**
    expect(getJsonMock.mock.calls.filter(([url]) => url === QUEUE_URL)).toHaveLength(1);
  });

  it("한 소비처가 받아온 응답을 나머지도 그대로 본다 — 폴링을 사이드바만 켜도 목록 배지가 따라온다", async () => {
    getJsonMock.mockResolvedValue([row("cr-1")]);
    const sidebar = renderHook(() => useChangeRequestQueue(true, { focus: true, pollMs: 60_000 }));
    const listBadge = renderHook(() => useChangeRequestQueue(true));
    await waitFor(() => expect(listBadge.result.current.rows).toHaveLength(1));

    // 폴링 소유자만 재조회한다(reload = 그 인스턴스의 tick).
    getJsonMock.mockResolvedValue([row("cr-1"), row("cr-2")]);
    act(() => sidebar.result.current.reload());

    await waitFor(() => expect(sidebar.result.current.rows).toHaveLength(2));
    expect(listBadge.result.current.rows).toHaveLength(2); // 방송이 없으면 여기서 1로 남는다
  });

  it("계기가 지나간 뒤의 재조회는 진행 중 요청에 올라타지 않는다 — 승인 전 숫자를 물려받으면 안 된다", async () => {
    const first = deferred<unknown>();
    getJsonMock.mockReturnValueOnce(first.promise);
    renderHook(() => useChangeRequestQueue(true));
    expect(getJsonMock).toHaveBeenCalledTimes(1);

    getJsonMock.mockResolvedValue([]); // 승인 뒤 응답 = 0건
    act(() => notifyQueueUpdated()); // 계기 = 세대 증가

    await waitFor(() => expect(getJsonMock).toHaveBeenCalledTimes(2));
  });

  it("늦게 도착한 옛 응답은 새 응답을 덮지 않는다 — 배지가 승인 전 숫자로 되돌아가면 안 된다", async () => {
    const stale = deferred<unknown>();
    getJsonMock.mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() => useChangeRequestQueue(true));

    getJsonMock.mockResolvedValue([]);
    act(() => notifyQueueUpdated());
    await waitFor(() => expect(result.current.rows).toEqual([]));

    await act(async () => {
      stale.resolve([row("cr-1"), row("cr-2")]); // 승인 전 조회가 뒤늦게 도착
      await stale.promise;
    });

    expect(result.current.rows).toEqual([]);
  });

  it("enabled:false는 조회하지 않고 남은 캐시도 말하지 않는다 — 권한 없는 화면의 숫자는 미로드다", async () => {
    getJsonMock.mockResolvedValue([row("cr-1")]);
    const loaded = renderHook(() => useChangeRequestQueue(true));
    await waitFor(() => expect(loaded.result.current.rows).toHaveLength(1));
    getJsonMock.mockClear();

    const denied = renderHook(() => useChangeRequestQueue(false));

    expect(denied.result.current.rows).toBeNull();
    expect(getJsonMock).not.toHaveBeenCalled();
  });
});

describe("고유번호 미부여 집계 조회 공유", () => {
  it("소비처 둘이 같은 계기로 조회해도 왕복은 한 번", async () => {
    getJsonMock.mockResolvedValue({ byBrand: { 3: 5 }, byModel: { 10: 5 } });

    const a = renderHook(() => useMcCodeGaps(true));
    const b = renderHook(() => useMcCodeGaps(true));

    await waitFor(() => expect(a.result.current.byBrand[3]).toBe(5));
    await waitFor(() => expect(b.result.current.byBrand[3]).toBe(5));
    expect(getJsonMock.mock.calls.filter(([url]) => url === GAPS_URL)).toHaveLength(1);
  });
});
