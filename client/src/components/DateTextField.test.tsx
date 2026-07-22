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
    const { container } = render(<DateTextField ariaLabel="날짜" defaultValue="2026-07-01" name="date" onValueChange={onValueChange} />);
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

// 네이티브 픽커는 닫기 API·닫힘 이벤트가 없다 — 아이콘 재클릭 = "닫기 의도"로 재오픈을 막는 토글
// (2026-07-21 유슨생). 열림 판정은 플래그 휴리스틱: 아이콘 외 pointerdown·날짜 선택(change)이 해제한다.
describe("DateTextField — 달력 아이콘 재클릭 토글", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "showPicker");
  const showPicker = vi.fn();

  async function setupWithPicker() {
    showPicker.mockClear();
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      value: showPicker,
      configurable: true,
      writable: true,
    });
    vi.resetModules();
    const mod = await import("./DateTextField");
    const utils = render(<mod.DateTextField ariaLabel="날짜" value="" onValueChange={() => {}} />);
    return { ...utils, btn: screen.getByRole("button", { name: "달력에서 날짜 선택" }) };
  }

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(HTMLInputElement.prototype, "showPicker", originalDescriptor);
    else Reflect.deleteProperty(HTMLInputElement.prototype, "showPicker");
    vi.resetModules();
  });

  it("아이콘 재클릭은 showPicker를 다시 부르지 않고(닫기 의도), 그다음 클릭은 다시 연다", async () => {
    const { btn } = await setupWithPicker();
    fireEvent.pointerDown(btn);
    fireEvent.click(btn);
    expect(showPicker).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(btn); // 아이콘 위 pointerdown은 열림 플래그를 풀지 않는다(토글이 처리)
    fireEvent.click(btn);
    expect(showPicker).toHaveBeenCalledTimes(1); // 닫기 의도 — 재오픈 없음
    fireEvent.pointerDown(btn);
    fireEvent.click(btn);
    expect(showPicker).toHaveBeenCalledTimes(2); // 다시 열기
  });

  it("픽커 밖 클릭으로 닫힌 뒤에는 아이콘 클릭이 바로 다시 연다(죽은 클릭 없음)", async () => {
    const { btn } = await setupWithPicker();
    fireEvent.click(btn);
    expect(showPicker).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body); // 네이티브 dismiss와 같은 클릭 — 플래그 동기 해제
    fireEvent.click(btn);
    expect(showPicker).toHaveBeenCalledTimes(2);
  });

  it("날짜를 고르면(픽커 자연 닫힘) 아이콘 클릭이 바로 다시 연다", async () => {
    const { btn, container } = await setupWithPicker();
    fireEvent.click(btn);
    expect(showPicker).toHaveBeenCalledTimes(1);
    fireEvent.change(hiddenNativeInput(container), { target: { value: "2026-07-24" } });
    fireEvent.click(btn);
    expect(showPicker).toHaveBeenCalledTimes(2);
  });

  it("픽커 열린 채 언마운트 = dismiss 리스너 해제(배치 12 B#6③ — 제거 변이가 green이던 누수 사각)", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { btn, unmount } = await setupWithPicker();
    fireEvent.click(btn); // 열림 → document pointerdown 리스너 부착
    const added = addSpy.mock.calls.filter(([type]) => type === "pointerdown").map(([, fn]) => fn);
    expect(added.length).toBeGreaterThan(0);
    unmount();
    const removed = removeSpy.mock.calls.filter(([type]) => type === "pointerdown").map(([, fn]) => fn);
    for (const fn of added) expect(removed).toContain(fn); // 부착된 핸들러 전부 해제돼야 한다
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
