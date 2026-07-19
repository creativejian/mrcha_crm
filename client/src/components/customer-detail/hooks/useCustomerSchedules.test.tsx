import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyntheticEvent } from "react";

import type { Customer } from "@/data/customers";
import { addSchedule, updateSchedule as apiUpdateSchedule } from "@/lib/customer-children";
import type { CustomerDetailData } from "@/lib/customers";

import { useCustomerSchedules } from "./useCustomerSchedules";

vi.mock("@/lib/customer-children", () => ({
  addSchedule: vi.fn(async () => ({ id: "srv-1" })),
  updateSchedule: vi.fn(async () => ({})),
  deleteSchedule: vi.fn(async () => ({})),
}));

const addScheduleMock = vi.mocked(addSchedule);
const updateScheduleMock = vi.mocked(apiUpdateSchedule);

const detail = { schedules: [] } as unknown as CustomerDetailData;
const customer = { id: "cust-1", name: "김민준" } as Customer;

// 실 DOM form을 만들어 FormData가 진짜로 동작하는 SyntheticEvent를 흉내낸다(정규화가 실제 제출 경로에서 도는지 검증).
function formEvent(fields: Record<string, string>): SyntheticEvent<HTMLFormElement> {
  const form = document.createElement("form");
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  return { preventDefault: () => {}, currentTarget: form } as unknown as SyntheticEvent<HTMLFormElement>;
}

function setup(onToast = vi.fn()) {
  const hook = renderHook(() =>
    useCustomerSchedules({ detail, customer, onToast, markRecentUpdate: vi.fn(), onCloseFloatingEditor: vi.fn() }),
  );
  return { ...hook, onToast };
}

describe("useCustomerSchedules — 날짜 텍스트 정규화(2026-07-19, 로케일 무관 년/월/일 고정)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("유연한 날짜 입력(점 구분)도 정규화해 addSchedule을 YYYY-MM-DD로 호출한다", async () => {
    const { result } = setup();
    act(() => {
      result.current.handlers.save(formEvent({ date: "2026.7.24", memo: "메모" }));
    });
    await waitFor(() => expect(addScheduleMock).toHaveBeenCalled());
    expect(addScheduleMock).toHaveBeenCalledWith(
      "cust-1",
      expect.objectContaining({ scheduledDate: "2026-07-24" }),
    );
  });

  it("날짜 형식이 틀리면 저장을 막고 안내 문구를 띄운다(addSchedule 미호출)", () => {
    const { result, onToast } = setup();
    act(() => {
      result.current.handlers.save(formEvent({ date: "0724", memo: "메모" }));
    });
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("년-월-일"));
    expect(addScheduleMock).not.toHaveBeenCalled();
    // 정규화 실패는 낙관 갱신도 일으키지 않는다(조용한 오염 방지).
    expect(result.current.items).toHaveLength(0);
  });

  it("수정 제출도 동일하게 정규화한다(무구분 8자리)", async () => {
    const seeded = {
      schedules: [{ id: "sch-1", scheduledDate: "2026-07-20", scheduledTime: null, type: "재연락", memo: "기존" }],
    } as unknown as CustomerDetailData;
    const { result } = renderHook(() =>
      useCustomerSchedules({ detail: seeded, customer, onToast: vi.fn(), markRecentUpdate: vi.fn(), onCloseFloatingEditor: vi.fn() }),
    );
    act(() => {
      result.current.handlers.update(formEvent({ date: "20260731", memo: "기존" }), "sch-1");
    });
    await waitFor(() => expect(updateScheduleMock).toHaveBeenCalled());
    expect(updateScheduleMock).toHaveBeenCalledWith(
      "cust-1",
      "sch-1",
      expect.objectContaining({ scheduledDate: "2026-07-31" }),
    );
  });

  it("수정 제출에서 날짜 형식이 틀리면 저장을 막는다(updateSchedule 미호출)", () => {
    const seeded = {
      schedules: [{ id: "sch-1", scheduledDate: "2026-07-20", scheduledTime: null, type: "재연락", memo: "기존" }],
    } as unknown as CustomerDetailData;
    const onToast = vi.fn();
    const { result } = renderHook(() =>
      useCustomerSchedules({ detail: seeded, customer, onToast, markRecentUpdate: vi.fn(), onCloseFloatingEditor: vi.fn() }),
    );
    act(() => {
      result.current.handlers.update(formEvent({ date: "2026-13-40", memo: "기존" }), "sch-1");
    });
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("년-월-일"));
    expect(updateScheduleMock).not.toHaveBeenCalled();
  });
});
