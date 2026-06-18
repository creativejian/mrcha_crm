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
});
