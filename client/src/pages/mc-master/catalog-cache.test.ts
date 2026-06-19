import { afterEach, beforeEach, expect, it, vi } from "vitest";

// apiFetch(@/lib/api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { fetchOptionsCached, getCachedOptions, prefetchOptions } from "./catalog-cache";

const BUNDLE = {
  options: [{ id: 1, type: "basic", name: "파노라마 선루프", price: 1200000 }],
  relations: [],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(BUNDLE), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.restoreAllMocks());

// 모듈 스코프 캐시라 테스트마다 고유 trimId로 격리한다.
it("첫 호출은 네트워크, 결과 반환 + 동기 캐시 채움", async () => {
  const trimId = 9001;
  expect(getCachedOptions(trimId)).toBeUndefined();
  const bundle = await fetchOptionsCached(trimId);
  expect(bundle.options[0].name).toBe("파노라마 선루프");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(getCachedOptions(trimId)?.options).toHaveLength(1);
});

it("두 번째 호출은 신선 캐시라 네트워크 생략", async () => {
  const trimId = 9002;
  await fetchOptionsCached(trimId);
  await fetchOptionsCached(trimId);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("force는 다시 네트워크", async () => {
  const trimId = 9003;
  await fetchOptionsCached(trimId);
  await fetchOptionsCached(trimId, { force: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("prefetchOptions는 캐시를 채운다", async () => {
  const trimId = 9004;
  prefetchOptions(trimId);
  // prefetch는 fire-and-forget이라 마이크로태스크가 끝날 때까지 대기
  await vi.waitFor(() => expect(getCachedOptions(trimId)).toBeDefined());
});
