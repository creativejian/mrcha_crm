import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchStaffDirectory, resetStaffDirectoryCache, staffNameOf } from "./staff";
import { getJson } from "./http";

vi.mock("./http", () => ({ getJson: vi.fn() }));
const getJsonMock = vi.mocked(getJson);

const ROWS = [
  { id: "11111111-1111-1111-1111-111111111111", name: "김지안", role: "admin" },
  { id: "22222222-2222-2222-2222-222222222222", name: "강현준", role: "manager" },
];

afterEach(() => {
  resetStaffDirectoryCache();
  getJsonMock.mockReset();
});

describe("fetchStaffDirectory", () => {
  it("1회 fetch 후 캐시 — 재호출에 네트워크 0", async () => {
    getJsonMock.mockResolvedValue(ROWS);
    expect(await fetchStaffDirectory()).toEqual(ROWS);
    expect(await fetchStaffDirectory()).toEqual(ROWS);
    expect(getJsonMock).toHaveBeenCalledTimes(1);
  });

  it("동시 호출은 inflight 공유(dedupe)", async () => {
    getJsonMock.mockResolvedValue(ROWS);
    const [a, b] = await Promise.all([fetchStaffDirectory(), fetchStaffDirectory()]);
    expect(a).toEqual(ROWS);
    expect(b).toEqual(ROWS);
    expect(getJsonMock).toHaveBeenCalledTimes(1);
  });

  it("실패는 캐시하지 않는다 — 다음 호출이 재시도", async () => {
    getJsonMock.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchStaffDirectory()).rejects.toThrow("boom");
    getJsonMock.mockResolvedValue(ROWS);
    expect(await fetchStaffDirectory()).toEqual(ROWS);
  });
});

describe("staffNameOf", () => {
  it("캐시 미로드면 null, 로드 후 id→이름(미지 id는 null)", async () => {
    expect(staffNameOf(ROWS[0].id)).toBeNull();
    getJsonMock.mockResolvedValue(ROWS);
    await fetchStaffDirectory();
    expect(staffNameOf(ROWS[0].id)).toBe("김지안");
    expect(staffNameOf("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
