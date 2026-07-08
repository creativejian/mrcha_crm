import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchLiveConsulting, saveLiveConsulting } from "./live-consulting";
import { getJson, sendJson } from "./http";

vi.mock("./http", () => ({ getJson: vi.fn(), sendJson: vi.fn() }));
const getJsonMock = vi.mocked(getJson);
const sendJsonMock = vi.mocked(sendJson);

afterEach(() => {
  getJsonMock.mockReset();
  sendJsonMock.mockReset();
});

describe("fetchLiveConsulting", () => {
  it("GET 응답 receiving 반환", async () => {
    getJsonMock.mockResolvedValue({ receiving: false });
    expect(await fetchLiveConsulting()).toBe(false);
    expect(getJsonMock).toHaveBeenCalledWith("/api/me/live-consulting");
  });
});

describe("saveLiveConsulting", () => {
  it("PATCH body {receiving} 전송, 응답 receiving 반환", async () => {
    sendJsonMock.mockResolvedValue({ receiving: true });
    expect(await saveLiveConsulting(true)).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith("/api/me/live-consulting", "PATCH", { receiving: true });
  });
});
