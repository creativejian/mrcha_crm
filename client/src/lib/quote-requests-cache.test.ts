import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// apiFetch(./api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

// 백엔드 listQuoteRequests 응답 1행(camelCase) — 어댑터가 통과시킬 최소 형태.
const rawRows = [
  {
    id: "q1",
    createdAt: "2026-06-25T00:00:00Z",
    requesterName: "제임스",
    requesterPhone: null,
    paymentMethod: "lease",
    period: 60,
    depositType: null,
    rentalDeposit: 0,
    trimPrice: 0,
    status: "open",
    brandName: "기아",
    modelName: "레이",
    trimName: "프레스티지",
    optionCount: 0,
    matchedCustomerId: null,
    matchedCustomerName: null,
    matchedCustomerCode: null,
    matchType: "none",
  },
];
const okFetch = () => vi.fn(async () => new Response(JSON.stringify(rawRows), { status: 200 }));

// 캐시는 모듈 전역 상태(단일 키)라 테스트 간 격리를 위해 모듈을 리셋하고 매번 새로 import한다.
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("앱 견적요청 인박스 캐시", () => {
  it("두 번째 호출은 캐시 hit(fetch 1회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchAppQuoteRequestsCached } = await import("./quote-requests");
    await fetchAppQuoteRequestsCached();
    await fetchAppQuoteRequestsCached();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("force=true는 캐시를 우회해 재fetch(fetch 2회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchAppQuoteRequestsCached } = await import("./quote-requests");
    await fetchAppQuoteRequestsCached();
    await fetchAppQuoteRequestsCached(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("동시 호출은 inflight dedupe(fetch 1회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchAppQuoteRequestsCached } = await import("./quote-requests");
    await Promise.all([fetchAppQuoteRequestsCached(), fetchAppQuoteRequestsCached()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("prefetch가 캐시를 채워 이후 fetch가 0(총 1회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchAppQuoteRequestsCached, prefetchAppQuoteRequests } = await import("./quote-requests");
    prefetchAppQuoteRequests();
    await new Promise((r) => setTimeout(r, 0)); // prefetch 워밍 완료 대기
    await fetchAppQuoteRequestsCached();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("TTL 만료 후 재fetch", async () => {
    vi.useFakeTimers();
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchAppQuoteRequestsCached } = await import("./quote-requests");
    await fetchAppQuoteRequestsCached();
    await vi.advanceTimersByTimeAsync(61_000);
    await fetchAppQuoteRequestsCached();
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
