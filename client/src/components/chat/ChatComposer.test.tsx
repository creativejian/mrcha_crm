import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ChatSession } from "@/lib/chat";

import { ChatComposer } from "./ChatComposer";

const session = { mode: "human", assignedStaffId: "staff-1" } as ChatSession;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("ChatComposer", () => {
  it("전송 실패 시 입력창이 비어 있으면 원문을 복원한다", async () => {
    const user = userEvent.setup();
    const sending = deferred<boolean>();
    const onSend = vi.fn(() => sending.promise);
    render(<ChatComposer onSend={onSend} onTyping={vi.fn()} session={session} staffId="staff-1" />);

    const input = screen.getByPlaceholderText("고객에게 보낼 메시지를 입력하세요");
    await user.type(input, "안녕하세요{Enter}");
    expect(onSend).toHaveBeenCalledWith("안녕하세요");
    expect(input).toHaveValue(""); // 낙관적으로 비움

    sending.resolve(false);
    await screen.findByDisplayValue("안녕하세요"); // 실패 → 원문 복원
  });

  it("전송 실패 시 그 사이 새로 입력한 텍스트를 원문으로 덮어쓰지 않는다", async () => {
    const user = userEvent.setup();
    const sending = deferred<boolean>();
    const onSend = vi.fn(() => sending.promise);
    render(<ChatComposer onSend={onSend} onTyping={vi.fn()} session={session} staffId="staff-1" />);

    const input = screen.getByPlaceholderText("고객에게 보낼 메시지를 입력하세요");
    await user.type(input, "메시지A{Enter}");
    await user.type(input, "메시지B"); // 전송 중 이어서 작성

    sending.resolve(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(input).toHaveValue("메시지B"); // 작성 중이던 내용 유지(A로 덮어쓰지 않음)
  });
});
