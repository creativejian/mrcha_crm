import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useReadonlyContent } from "./use-readonly-content";

type Item = { id: string; title: string };
type Detail = { id: string; body: string };

describe("useReadonlyContent", () => {
  it("loads the list on mount", async () => {
    const fetchList = vi.fn().mockResolvedValue([{ id: "1", title: "A" }]);
    const { result } = renderHook(() => useReadonlyContent<Item, Detail>(fetchList, vi.fn()));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([{ id: "1", title: "A" }]);
    expect(result.current.listError).toBe(false);
  });

  it("sets listError when the list fetch fails", async () => {
    const fetchList = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useReadonlyContent<Item, Detail>(fetchList, vi.fn()));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.listError).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it("opens a detail and clears detailLoading when it resolves", async () => {
    const fetchList = vi.fn().mockResolvedValue([{ id: "1", title: "A" }]);
    const fetchDetail = vi.fn().mockResolvedValue({ id: "1", body: "hello" });
    const { result } = renderHook(() => useReadonlyContent<Item, Detail>(fetchList, fetchDetail));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.openDetail("1"); });
    await waitFor(() => expect(result.current.selected).toEqual({ id: "1", body: "hello" }));
    expect(result.current.detailLoading).toBe(false);
    expect(result.current.detailError).toBe(false);
  });

  // 핵심 회귀(C#1): 상세 fetch 실패가 성공 로드된 목록을 통째로 지우면 안 된다.
  it("keeps the loaded list when a detail fetch fails", async () => {
    const fetchList = vi.fn().mockResolvedValue([{ id: "1", title: "A" }, { id: "2", title: "B" }]);
    const fetchDetail = vi.fn().mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useReadonlyContent<Item, Detail>(fetchList, fetchDetail));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.openDetail("1"); });
    await waitFor(() => expect(result.current.detailError).toBe(true));

    expect(result.current.items).toHaveLength(2); // 목록 유지
    expect(result.current.listError).toBe(false); // 목록 error 오염 안 됨
    expect(result.current.selected).toBeNull(); // 상세 안 열림
  });

  it("clears detail error and selection on close", async () => {
    const fetchList = vi.fn().mockResolvedValue([]);
    const fetchDetail = vi.fn().mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useReadonlyContent<Item, Detail>(fetchList, fetchDetail));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.openDetail("1"); });
    await waitFor(() => expect(result.current.detailError).toBe(true));

    act(() => { result.current.closeDetail(); });
    expect(result.current.detailError).toBe(false);
    expect(result.current.selected).toBeNull();
  });
});
