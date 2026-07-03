import { describe, expect, it } from "vitest";

import { DRAIN_TICK_MS, nextDisplayLength } from "./assistant-drain";

describe("nextDisplayLength (앱 chat_streaming_controller 수치 미러)", () => {
  const target = "가".repeat(500);

  it("틱 주기는 38ms", () => {
    expect(DRAIN_TICK_MS).toBe(38);
  });

  it("도입부(<72자)는 2자/틱", () => {
    expect(nextDisplayLength(target, 0)).toBe(2);
    expect(nextDisplayLength(target, 70)).toBe(72);
  });

  it("72~159자는 4자/틱", () => {
    expect(nextDisplayLength(target, 72)).toBe(76);
    expect(nextDisplayLength(target, 159)).toBe(163);
  });

  it("잔여 >160자면 11자/틱, >56자면 7자/틱, 꼬리는 4자/틱", () => {
    expect(nextDisplayLength(target, 200)).toBe(211); // 잔여 300 > 160
    expect(nextDisplayLength("가".repeat(300), 200)).toBe(207); // 잔여 100 → 7
    expect(nextDisplayLength("가".repeat(230), 200)).toBe(204); // 잔여 30 → 4
  });

  it("타깃을 넘지 않는다 + 이미 완주면 그대로", () => {
    expect(nextDisplayLength("가나다", 2)).toBe(3);
    expect(nextDisplayLength("가나다", 3)).toBe(3);
    expect(nextDisplayLength("가나다", 10)).toBe(3);
  });

  it("UTF-16 서로게이트 페어 중간에서 자르지 않는다", () => {
    const emoji = "🚗".repeat(50); // 각 2 code unit — 홀수 경계가 생기면 페어를 함께 노출
    const next = nextDisplayLength(emoji, 0); // 도입부 step 2 → 2 (페어 1개, 이미 정렬됨)
    expect(next).toBe(2);
    const odd = "a" + "🚗".repeat(50); // 1 + 2n
    // step 2 → raw next=3은 "a🚗"(완전한 코드포인트 2개)로 이미 안전한 경계다.
    // slice(0,4)로 확장하면 오히려 끝에 lone high surrogate가 남아(`a🚗\ud83d`) 깨진 문자가 노출되므로 3이 맞다(직접 검증: Array.from(odd.slice(0,3)).length===2, /[\ud800-\udbff]$/.test(odd.slice(0,4))===true).
    const n2 = nextDisplayLength(odd, 1);
    expect(n2).toBe(3);
  });
});
