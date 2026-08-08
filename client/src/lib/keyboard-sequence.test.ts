import { describe, expect, it } from "vitest";

import { SHORTCUTS, visibleShortcuts } from "@/lib/keyboard-shortcuts";
import { EMPTY_SEQUENCE, matchKeyEvent, type KeyEventLike } from "@/lib/keyboard-sequence";

// 시퀀스 매칭 상태머신(순수). 시계는 인자로 주입한다 — Date.now()를 안에서 부르면 타임아웃을
// 테스트할 수 없다(updated_at 축의 "DB 시계" 규칙과 같은 이유: 시간은 소유자가 준다).
const all = visibleShortcuts("최고관리자");

function ev(code: string, extra: Partial<KeyEventLike> = {}): KeyEventLike {
  return { code, key: code.replace(/^Key/, "").toLowerCase(), shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...extra };
}

describe("matchKeyEvent", () => {
  it("G then C = 고객 관리로 간다", () => {
    const first = matchKeyEvent(EMPTY_SEQUENCE, ev("KeyG"), 1000, all);
    expect(first.hit).toBeNull();
    expect(first.next.prefix).toBe("KeyG");

    const second = matchKeyEvent(first.next, ev("KeyC"), 1200, all);
    expect(second.hit?.id).toBe("nav-customers-all");
    expect(second.next).toEqual(EMPTY_SEQUENCE);
  });

  // ⚠️ 한글 모드에서 g는 key="ㅎ"으로 온다. key로 판정하면 시퀀스가 통째로 죽는데
  // 영문 환경 테스트는 전부 통과한다(스펙 §3.4) — 그래서 code로 판정한다.
  it("한글 입력 모드(key='ㅎ', code='KeyG')에서도 매칭된다", () => {
    const first = matchKeyEvent(EMPTY_SEQUENCE, { ...ev("KeyG"), key: "ㅎ" }, 1000, all);
    expect(first.next.prefix).toBe("KeyG");

    const second = matchKeyEvent(first.next, { ...ev("KeyC"), key: "ㅊ" }, 1100, all);
    expect(second.hit?.id).toBe("nav-customers-all");
  });

  it("1.5초를 넘기면 접두가 리셋된다", () => {
    const first = matchKeyEvent(EMPTY_SEQUENCE, ev("KeyG"), 1000, all);
    const late = matchKeyEvent(first.next, ev("KeyC"), 2600, all);
    expect(late.hit).toBeNull();
    // 늦은 C는 새 시작으로 취급 — C로 시작하는 시퀀스가 없으니 빈 상태로 떨어진다.
    expect(late.next).toEqual(EMPTY_SEQUENCE);
  });

  it("1.5초 경계 직전은 살아 있다", () => {
    const first = matchKeyEvent(EMPTY_SEQUENCE, ev("KeyG"), 1000, all);
    expect(matchKeyEvent(first.next, ev("KeyC"), 2499, all).hit?.id).toBe("nav-customers-all");
  });

  it("수식키가 붙으면 시퀀스가 리셋된다", () => {
    const first = matchKeyEvent(EMPTY_SEQUENCE, ev("KeyG"), 1000, all);
    const withMeta = matchKeyEvent(first.next, ev("KeyC", { metaKey: true }), 1100, all);
    expect(withMeta.hit).toBeNull();
    expect(withMeta.next).toEqual(EMPTY_SEQUENCE);
  });

  it("등록되지 않은 후속 키는 무시하고 리셋", () => {
    const first = matchKeyEvent(EMPTY_SEQUENCE, ev("KeyG"), 1000, all);
    const miss = matchKeyEvent(first.next, ev("KeyZ"), 1100, all);
    expect(miss.hit).toBeNull();
    expect(miss.next).toEqual(EMPTY_SEQUENCE);
  });

  it("⌘K는 단발로 즉시 잡힌다", () => {
    const result = matchKeyEvent(EMPTY_SEQUENCE, ev("KeyK", { metaKey: true }), 1000, all);
    expect(result.hit?.id).toBe("global-search");
  });

  it("수식키 없는 K는 ⌘K를 발동시키지 않는다", () => {
    expect(matchKeyEvent(EMPTY_SEQUENCE, ev("KeyK"), 1000, all).hit).toBeNull();
  });

  it("⇧?(Shift+Slash)로 패널이 열린다", () => {
    const result = matchKeyEvent(EMPTY_SEQUENCE, ev("Slash", { shiftKey: true }), 1000, all);
    expect(result.hit?.id).toBe("shortcuts-panel");
  });

  // role 스코프가 매칭 단계에서도 걸린다 — 딜러가 G R을 눌러도 경영 리포트로 갈 수 없다.
  it("노출되지 않는 단축키는 매칭되지 않는다", () => {
    const dealer = visibleShortcuts("딜러");
    const first = matchKeyEvent(EMPTY_SEQUENCE, ev("KeyG"), 1000, dealer);
    expect(matchKeyEvent(first.next, ev("KeyR"), 1100, dealer).hit).toBeNull();
    // 딜러에게 열린 유일한 네비게이션은 G M이다.
    expect(matchKeyEvent(first.next, ev("KeyM"), 1100, dealer).hit?.id).toBe("nav-mc-master");
  });

  it("전량 레지스트리로도 접두 없는 첫 키는 hit이 없다", () => {
    expect(matchKeyEvent(EMPTY_SEQUENCE, ev("KeyG"), 1000, SHORTCUTS).hit).toBeNull();
  });
});
