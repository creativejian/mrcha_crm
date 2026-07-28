import { describe, expect, test } from "vitest";

import { caretAfterDigits, digitsBefore } from "./thousands-input";
import { formatThousands } from "./trim-format";

// 커서 좌표 변환의 순수 부분. 실제 커서 이동은 requestAnimationFrame + DOM이라 여기서 검증할 수
// 없으므로(실기로 확인), **논리 좌표 계산**만 잠근다 — 이게 틀리면 커서가 엉뚱한 자리로 간다.

describe("digitsBefore", () => {
  test("콤마는 세지 않는다", () => {
    expect(digitsBefore("5,500,000", 3)).toBe(2); // "5,5" → 5, 5
    expect(digitsBefore("5,500,000", 1)).toBe(1); // "5"
    expect(digitsBefore("5,500,000", 2)).toBe(1); // "5," — 콤마는 무시
  });

  test("맨 앞은 0, 맨 뒤는 전체 숫자 개수", () => {
    expect(digitsBefore("5,500,000", 0)).toBe(0);
    expect(digitsBefore("5,500,000", 9)).toBe(7);
  });

  test("빈 문자열", () => {
    expect(digitsBefore("", 0)).toBe(0);
  });
});

describe("caretAfterDigits", () => {
  test("숫자 n개를 지난 직후 위치", () => {
    expect(caretAfterDigits("550,000", 2)).toBe(2); // 55|0,000
    expect(caretAfterDigits("550,000", 3)).toBe(3); // 550|,000
    expect(caretAfterDigits("550,000", 4)).toBe(5); // 550,0|00 — 콤마를 건너뛴다
  });

  test("0이면 맨 앞", () => {
    expect(caretAfterDigits("550,000", 0)).toBe(0);
  });

  test("숫자보다 큰 값을 요구하면 맨 뒤(전부 지운 뒤 재입력)", () => {
    expect(caretAfterDigits("550", 9)).toBe(3);
    expect(caretAfterDigits("", 3)).toBe(0);
  });
});

describe("왕복 — 중간 숫자를 지웠을 때 커서가 그 자리에 남는다", () => {
  // 유슨생이 실기에서 밟은 정확한 경로: "5,500,000"의 세 번째 문자(숫자 5)를 백스페이스로 지운다.
  test("5,500,000 에서 중간 5를 지우면 커서가 첫 숫자 뒤에 남는다", () => {
    const before = "5,500,000";
    const caretBefore = 3; // 5,5|00,000
    const wanted = digitsBefore(before, caretBefore); // 숫자 2개 앞
    // 브라우저가 index 2의 문자를 지운 상태 = onChange가 받는 값
    const raw = "5,00,000";
    const next = formatThousands(raw); // "500,000"
    expect(next).toBe("500,000");
    // 지운 숫자 하나만큼 줄었으므로 커서는 숫자 1개 뒤여야 한다(5|00,000).
    expect(caretAfterDigits(next, wanted - 1)).toBe(1);
  });

  test("콤마 자리에서 백스페이스를 눌러도 커서가 튀지 않는다", () => {
    // "5,500,000" 에서 caret=2(콤마 바로 뒤)에 백스페이스 → 콤마가 지워지고 재포맷되면 원상복구.
    const raw = "5500,000"; // 콤마 하나 지워진 상태
    const next = formatThousands(raw);
    expect(next).toBe("5,500,000"); // 포맷이 콤마를 되살린다
    // 커서 앞 숫자는 1개였으므로 여전히 첫 숫자 뒤 — 끝으로 튀지 않는다.
    expect(caretAfterDigits(next, 1)).toBe(1);
  });
});
