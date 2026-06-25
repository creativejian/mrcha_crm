import { afterEach, describe, expect, it, vi } from "vitest";

// apiFetch(./api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { fetchWorkbenchVehicleCached, prefetchWorkbenchVehicle } from "./vehicles-cache";

const bundle = { brands: [], models: [], trims: [], trimDetail: { id: 1 } };
const ok = () => vi.fn(async () => new Response(JSON.stringify(bundle), { status: 200 }));

afterEach(() => { vi.restoreAllMocks(); });

describe("vehicles-cache", () => {
  it("같은 trimId 두 번째 호출은 캐시 hit(fetch 1회)", async () => {
    const spy = ok();
    vi.stubGlobal("fetch", spy);
    await fetchWorkbenchVehicleCached(101);
    await fetchWorkbenchVehicleCached(101);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("동시 호출은 inflight dedupe(fetch 1회)", async () => {
    const spy = ok();
    vi.stubGlobal("fetch", spy);
    await Promise.all([fetchWorkbenchVehicleCached(102), fetchWorkbenchVehicleCached(102)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("prefetch가 캐시를 채워 이후 fetch가 0", async () => {
    const spy = ok();
    vi.stubGlobal("fetch", spy);
    prefetchWorkbenchVehicle(103);
    await new Promise((r) => setTimeout(r, 0)); // prefetch 워밍 완료 대기
    await fetchWorkbenchVehicleCached(103);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("TTL 만료 후 재fetch", async () => {
    vi.useFakeTimers();
    const spy = ok();
    vi.stubGlobal("fetch", spy);
    await fetchWorkbenchVehicleCached(104);
    await vi.advanceTimersByTimeAsync(61_000);
    await fetchWorkbenchVehicleCached(104);
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
