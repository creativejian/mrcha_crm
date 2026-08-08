import type { Shortcut } from "@/lib/keyboard-shortcuts";

// 시퀀스 매칭 상태머신(순수) — "G then C" 같은 2단 입력을 판정한다.
// ⚠️ 판정은 event.key가 아니라 **event.code**(물리 키)로 한다. 한글 입력 모드에서 g는 key="ㅎ"으로
// 오기 때문에 key로 읽으면 시퀀스가 통째로 죽는데 **영문 환경 테스트는 전부 통과**한다(스펙 §3.4).
// 대가로 Dvorak·AZERTY에서 어긋나지만 사용자가 전원 한국어 QWERTY라 수용했다.

// 시퀀스 유효 시간 — G만 누르고 방치하면 리셋된다. export하지 않는다(knip 기준선 0): 소비처가
// 없기도 하고, 테스트가 **절대값 1500을 하드코딩해 잠그는 게 의도**다. 상수를 import해 비교하면
// 값을 바꿔도 테스트가 따라가 UX 결정값이 조용히 흘러간다.
const SEQUENCE_TIMEOUT_MS = 1500;

export type KeyEventLike = {
  code: string;
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export type SequenceState = { prefix: string | null; at: number | null };

export const EMPTY_SEQUENCE: SequenceState = { prefix: null, at: null };

function hasModifier(event: KeyEventLike): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function matchesSingle(shortcut: Shortcut, event: KeyEventLike): boolean {
  if (shortcut.keys.length !== 1 || shortcut.keys[0] !== event.code) return false;
  if (shortcut.mod === "meta") return event.metaKey || event.ctrlKey;
  if (shortcut.mod === "shift") return event.shiftKey && !hasModifier(event);
  return !hasModifier(event) && !event.shiftKey;
}

/**
 * 한 번의 키 입력을 판정한다. 시계(now)는 호출자가 주입한다 — 안에서 Date.now()를 부르면
 * 타임아웃을 테스트할 수 없다.
 */
export function matchKeyEvent(
  state: SequenceState,
  event: KeyEventLike,
  now: number,
  shortcuts: Shortcut[],
): { next: SequenceState; hit: Shortcut | null } {
  // 단발 조합(⌘K·⇧?)이 먼저다 — 수식키가 붙은 입력은 시퀀스 후속이 될 수 없다.
  const single = shortcuts.find((shortcut) => matchesSingle(shortcut, event));
  if (single) return { next: EMPTY_SEQUENCE, hit: single };

  // 수식키 동반 입력은 시퀀스를 오염시키지 않고 상태만 비운다(⌘G가 G 접두로 남으면 안 된다).
  if (hasModifier(event)) return { next: EMPTY_SEQUENCE, hit: null };

  const alive = state.prefix != null && state.at != null && now - state.at < SEQUENCE_TIMEOUT_MS;
  if (alive) {
    const hit = shortcuts.find(
      (shortcut) => shortcut.keys.length === 2 && shortcut.keys[0] === state.prefix && shortcut.keys[1] === event.code,
    );
    // 접두가 살아 있는 동안의 입력은 성공이든 실패든 시퀀스를 닫는다(반쯤 열린 상태를 남기지 않는다).
    return { next: EMPTY_SEQUENCE, hit: hit ?? null };
  }

  // 새 시작 — 이 키로 시작하는 2단 시퀀스가 있을 때만 접두로 기억한다.
  const startsSequence = shortcuts.some((shortcut) => shortcut.keys.length === 2 && shortcut.keys[0] === event.code);
  return { next: startsSequence ? { prefix: event.code, at: now } : EMPTY_SEQUENCE, hit: null };
}
