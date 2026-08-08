import { describe, expect, it } from "vitest";

import { shouldIgnoreKeyEvent } from "@/lib/keyboard-guard";

// 단축키를 무시해야 하는 상황 판정(순수). 리스너는 이 함수 결과만 보고 빠져나간다.

function el(tag: string, editable = false): HTMLElement {
  const node = document.createElement(tag);
  if (editable) node.setAttribute("contenteditable", "true");
  return node;
}

describe("shouldIgnoreKeyEvent", () => {
  it("일반 영역에서는 통과", () => {
    expect(shouldIgnoreKeyEvent(el("div"), false, false)).toBe(false);
    expect(shouldIgnoreKeyEvent(null, false, false)).toBe(false);
  });

  // 검색·메모·견적 입력 중 g가 화면을 바꾸면 안 된다.
  it.each(["input", "textarea", "select"])("%s 포커스 중에는 무시", (tag) => {
    expect(shouldIgnoreKeyEvent(el(tag), false, false)).toBe(true);
  });

  it("contentEditable 안에서는 무시", () => {
    expect(shouldIgnoreKeyEvent(el("div", true), false, false)).toBe(true);
  });

  // ⚠️ IME 조합 중 keydown은 조합 키로 발화한다(ChatComposer·AiAssistantPanel 선례).
  // code 판정으로 바꿔도 이 가드는 여전히 필요하다 — 조합 중 발화 자체를 걸러야 한다.
  it("IME 조합 중에는 무시", () => {
    expect(shouldIgnoreKeyEvent(el("div"), true, false)).toBe(true);
  });

  it("패널이 열려 있으면 무시", () => {
    expect(shouldIgnoreKeyEvent(el("div"), false, true)).toBe(true);
  });
});
