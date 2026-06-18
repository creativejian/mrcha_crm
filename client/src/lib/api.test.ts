import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { apiFetch } from "./api";
import { supabase } from "./supabase";

afterEach(() => vi.restoreAllMocks());

describe("apiFetch", () => {
  it("세션이 있으면 Authorization: Bearer 헤더를 붙인다", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "tok123" } },
    } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await apiFetch("/api/catalog/brands");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok123");
  });

  it("세션이 없으면 Authorization 헤더가 없다", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await apiFetch("/api/catalog/brands");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("호출자가 넘긴 헤더는 Authorization 주입 후에도 유지된다", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "tok" } },
    } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await apiFetch("/api/foo", { headers: { "content-type": "application/json" } });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const h = new Headers(init.headers);
    expect(h.get("Authorization")).toBe("Bearer tok");
    expect(h.get("content-type")).toBe("application/json");
  });

  it("GET이 5xx면 재시도해 복구한다", async () => {
    vi.useFakeTimers();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "t" } },
    } as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const p = apiFetch("/api/catalog/models?brandId=2");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("GET이 계속 5xx면 최대 3회 시도 후 마지막 응답을 반환한다", async () => {
    vi.useFakeTimers();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "t" } },
    } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));

    const p = apiFetch("/api/catalog/models?brandId=2");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(500);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("쓰기(POST)는 5xx여도 재시도하지 않는다", async () => {
    vi.useFakeTimers();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "t" } },
    } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));

    const p = apiFetch("/api/catalog/models", { method: "POST" });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
