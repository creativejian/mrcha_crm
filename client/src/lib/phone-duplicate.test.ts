import { describe, expect, it } from "vitest";

import { findSameNumberLinked, type LinkedPhoneCandidate } from "./phone-duplicate";

// 같은 번호 "연결 고객" 판정 SSOT — 서버(견적요청 인박스)·클라(상담 인박스)가 물리 공유하는 순수 모듈.
// 이 유닛이 CI에서 판정 규칙을 잠근다(배선은 각 인박스 파생 테스트가 잠금).

const A: LinkedPhoneCandidate = { id: "c-a", name: "김민준", code: "CU-2605-0020", appUserId: "user-a", phoneDigits: "01095880812" };
const B: LinkedPhoneCandidate = { id: "c-b", name: "제임스", code: "CU-2606-0001", appUserId: "user-b", phoneDigits: "01095880812" };
const OTHER: LinkedPhoneCandidate = { id: "c-x", name: "박서연", code: "CU-2605-0019", appUserId: "user-x", phoneDigits: "01011112222" };

describe("findSameNumberLinked", () => {
  it("같은 번호의 다른 계정 고객만 — code 오름차순", () => {
    expect(findSameNumberLinked("01095880812", "user-new", [OTHER, B, A])).toEqual([
      { id: "c-a", name: "김민준", code: "CU-2605-0020" },
      { id: "c-b", name: "제임스", code: "CU-2606-0001" },
    ]);
  });

  it("본인 계정의 고객은 제외 — 그건 '연결됨' 확정 매칭이지 경고가 아니다", () => {
    expect(findSameNumberLinked("01095880812", "user-a", [A, B])).toEqual([
      { id: "c-b", name: "제임스", code: "CU-2606-0001" },
    ]);
  });

  it("요청자 번호가 없으면(null·빈 문자열) 빈 배열 — 빈 번호끼리의 오매칭 방지", () => {
    expect(findSameNumberLinked(null, "user-new", [A])).toEqual([]);
    expect(findSameNumberLinked("", "user-new", [{ ...A, phoneDigits: "" }])).toEqual([]);
  });

  it("일치 없음 → 빈 배열", () => {
    expect(findSameNumberLinked("01099999999", "user-new", [A, B, OTHER])).toEqual([]);
  });
});
