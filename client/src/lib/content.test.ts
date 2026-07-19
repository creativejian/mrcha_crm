import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./http", () => ({ getJson: vi.fn() }));

import { formatContentDate } from "./content";

// 캐시 테스트는 모듈 스코프 캐시를 격리하려고 테스트마다 fresh 모듈을 받는다(vi.resetModules).
async function freshContent() {
  vi.resetModules();
  const http = await import("./http");
  const content = await import("./content");
  return { getJson: vi.mocked(http.getJson), ...content };
}

describe("formatContentDate", () => {
  it("returns empty string for null", () => {
    expect(formatContentDate(null)).toBe("");
  });

  // 인사이트·지식베이스가 서로 다른 연도 자릿수(4자리 vs 2자리)를 쓰던 드리프트 해소 — 4자리로 통일.
  it("formats an ISO date with a 4-digit year and zero-padded month/day", () => {
    expect(formatContentDate("2026-07-05T09:30:00+09:00")).toBe("2026.07.05");
  });
});

// 콘텐츠 fetch TTL 캐시 — 매 진입 콜드 fetch가 목록/상세 로딩 체감 지연의 원인이었다(캐시·dedupe 전무).
// 앱 소유 콘텐츠라 CRM 세션 중 변경이 드물어 TTL 내 재진입은 서버 왕복 0이 맞다.
describe("content fetch cache", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("TTL 내 재호출은 서버 왕복 없이 캐시를 반환한다", async () => {
    const { getJson, fetchInsights } = await freshContent();
    getJson.mockResolvedValue([{ id: "1" }]);

    const first = await fetchInsights();
    const second = await fetchInsights();

    expect(getJson).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("동시 호출은 in-flight를 공유한다(중복 왕복 0)", async () => {
    const { getJson, fetchKnowledgeArticles } = await freshContent();
    getJson.mockResolvedValue([{ id: "k" }]);

    const [a, b] = await Promise.all([fetchKnowledgeArticles(), fetchKnowledgeArticles()]);

    expect(getJson).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it("실패는 캐시하지 않는다 — 다음 호출이 재시도한다", async () => {
    const { getJson, fetchInsights } = await freshContent();
    getJson.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce([{ id: "2" }]);

    await expect(fetchInsights()).rejects.toThrow("network");
    await expect(fetchInsights()).resolves.toEqual([{ id: "2" }]);
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("TTL 경과 후에는 다시 fetch한다 · 상세는 id별 키 분리", async () => {
    vi.useFakeTimers();
    const { getJson, fetchInsight } = await freshContent();
    getJson.mockResolvedValue({ id: "a" });

    await fetchInsight("a");
    await fetchInsight("b"); // 다른 id = 다른 캐시 키
    expect(getJson).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await fetchInsight("a");
    expect(getJson).toHaveBeenCalledTimes(3);
  });
});
