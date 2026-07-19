import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DateTextField } from "./DateTextField";

function hiddenNativeInput(container: HTMLElement) {
  return container.querySelector('input[type="date"]') as HTMLInputElement;
}

describe("DateTextField — controlled(value/onValueChange)", () => {
  it("타이핑은 정규화 없이 원문 그대로 onValueChange에 전달한다(정규화는 제출 시점 책임)", () => {
    const onValueChange = vi.fn();
    render(<DateTextField ariaLabel="날짜" onValueChange={onValueChange} value="" />);
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "0724" } });
    expect(onValueChange).toHaveBeenCalledWith("0724");
  });

  it("숨긴 native input에서 날짜를 고르면 ISO 값이 onValueChange로 전달된다", () => {
    const onValueChange = vi.fn();
    const { container } = render(<DateTextField ariaLabel="날짜" onValueChange={onValueChange} value="2026-07-01" />);
    fireEvent.change(hiddenNativeInput(container), { target: { value: "2026-07-24" } });
    expect(onValueChange).toHaveBeenCalledWith("2026-07-24");
  });

  it("숨긴 native input이 빈 값(취소)이면 onValueChange를 호출하지 않는다", () => {
    const onValueChange = vi.fn();
    const { container } = render(<DateTextField ariaLabel="날짜" onValueChange={onValueChange} value="2026-07-01" />);
    fireEvent.change(hiddenNativeInput(container), { target: { value: "" } });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("DateTextField — uncontrolled(name/defaultValue → FormData)", () => {
  it("숨긴 native input에서 고른 ISO 값이 텍스트 input DOM 값에 반영되고 FormData로도 읽힌다", () => {
    const { container } = render(
      <form>
        <DateTextField ariaLabel="날짜" defaultValue="2026-07-01" name="date" />
      </form>,
    );
    fireEvent.change(hiddenNativeInput(container), { target: { value: "2026-07-24" } });
    const textInput = screen.getByLabelText("날짜") as HTMLInputElement;
    expect(textInput.value).toBe("2026-07-24");
    const form = container.querySelector("form") as HTMLFormElement;
    expect(new FormData(form).get("date")).toBe("2026-07-24");
  });

  it("uncontrolled여도 onValueChange가 있으면 픽 값으로 호출한다", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <DateTextField ariaLabel="날짜" defaultValue="2026-07-01" name="date" onValueChange={onValueChange} />,
    );
    fireEvent.change(hiddenNativeInput(container), { target: { value: "2026-07-24" } });
    expect(onValueChange).toHaveBeenCalledWith("2026-07-24");
  });

  it("타이핑도 name으로 FormData에 반영된다(정규화 없이 원문 — 기존 uncontrolled 동작과 동일)", () => {
    const { container } = render(
      <form>
        <DateTextField ariaLabel="날짜" name="date" />
      </form>,
    );
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026.7.24" } });
    const form = container.querySelector("form") as HTMLFormElement;
    expect(new FormData(form).get("date")).toBe("2026.7.24");
  });
});

describe("DateTextField — showPicker 미지원 환경(jsdom)에서 달력 버튼 fail-open 게이트", () => {
  it("달력 버튼을 렌더하지 않는다(텍스트 입력은 여전히 동작)", () => {
    render(<DateTextField ariaLabel="날짜" value="" onValueChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "달력에서 날짜 선택" })).toBeNull();
    expect(screen.getByLabelText("날짜")).toBeInTheDocument();
  });
});

describe("DateTextField — showPicker 지원 환경(모듈 재평가로 게이트 반대편 분기 잠금)", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "showPicker");

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(HTMLInputElement.prototype, "showPicker", originalDescriptor);
    else Reflect.deleteProperty(HTMLInputElement.prototype, "showPicker");
    vi.resetModules();
  });

  it("showPicker가 존재하는 환경에서는 달력 버튼이 렌더된다", async () => {
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    vi.resetModules();
    const mod = await import("./DateTextField");
    render(<mod.DateTextField ariaLabel="날짜" value="" onValueChange={() => {}} />);
    expect(screen.getByRole("button", { name: "달력에서 날짜 선택" })).toBeInTheDocument();
  });
});
