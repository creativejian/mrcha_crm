import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyntheticEvent } from "react";

import type { Customer } from "@/data/customers";
import { addTask, updateTask } from "@/lib/customer-children";
import type { CustomerDetailData } from "@/lib/customers";

import { useCustomerChecks } from "./useCustomerChecks";

vi.mock("@/lib/customer-children", () => ({
  addTask: vi.fn(async () => ({ id: "srv-1" })),
  updateTask: vi.fn(async () => ({})),
  deleteTask: vi.fn(async () => ({})),
}));

const addTaskMock = vi.mocked(addTask);
const updateTaskMock = vi.mocked(updateTask);

const detail = { tasks: [] } as unknown as CustomerDetailData;
const customer = { id: "cust-1", name: "김민준" } as Customer;

// 실 DOM form을 만들어 FormData가 진짜로 동작하는 SyntheticEvent를 흉내낸다.
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
    useCustomerChecks({ detail, customer, onToast, markRecentUpdate: vi.fn() }),
  );
  return { ...hook, onToast };
}

describe("useCustomerChecks — 마감 날짜(due='지정') 텍스트 정규화(2026-07-19, 로케일 무관 년/월/일 고정)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("유연한 날짜 입력(점 구분)도 정규화해 M/D 라벨로 저장한다", async () => {
    const { result } = setup();
    act(() => {
      result.current.handlers.save(formEvent({ due: "지정", dueDate: "2026.7.24", body: "할일" }));
    });
    await waitFor(() => expect(addTaskMock).toHaveBeenCalled());
    expect(addTaskMock).toHaveBeenCalledWith("cust-1", expect.objectContaining({ due: "7/24" }));
  });

  it("마감 날짜 형식이 틀리면 저장을 막고 안내 문구를 띄운다(addTask 미호출)", () => {
    const { result, onToast } = setup();
    act(() => {
      result.current.handlers.save(formEvent({ due: "지정", dueDate: "0724", body: "할일" }));
    });
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("년-월-일"));
    expect(addTaskMock).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(0);
  });

  it("수정 제출도 동일하게 정규화한다(무구분 8자리)", async () => {
    const seeded = {
      tasks: [{ id: "task-1", category: "체크", due: "7/20", body: "기존" }],
    } as unknown as CustomerDetailData;
    const { result } = renderHook(() =>
      useCustomerChecks({ detail: seeded, customer, onToast: vi.fn(), markRecentUpdate: vi.fn() }),
    );
    act(() => {
      result.current.handlers.update(formEvent({ due: "지정", dueDate: "20260731", body: "기존" }), "task-1", "7/20");
    });
    await waitFor(() => expect(updateTaskMock).toHaveBeenCalled());
    expect(updateTaskMock).toHaveBeenCalledWith("cust-1", "task-1", expect.objectContaining({ due: "7/31" }));
  });

  it("수정 제출에서 마감 날짜 형식이 틀리면 저장을 막는다(updateTask 미호출)", () => {
    const seeded = {
      tasks: [{ id: "task-1", category: "체크", due: "7/20", body: "기존" }],
    } as unknown as CustomerDetailData;
    const onToast = vi.fn();
    const { result } = renderHook(() =>
      useCustomerChecks({ detail: seeded, customer, onToast, markRecentUpdate: vi.fn() }),
    );
    act(() => {
      result.current.handlers.update(formEvent({ due: "지정", dueDate: "2026-13-40", body: "기존" }), "task-1", "7/20");
    });
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("년-월-일"));
    expect(updateTaskMock).not.toHaveBeenCalled();
  });
});
