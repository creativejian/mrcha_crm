import { describe, expect, it } from "vitest";

import type { Customer } from "@/data/customers";
import { aiHintDisplay, aiHintPlainText, parseAiHintParts, resolveChance } from "./customer-table";

// 계약 가능성 판정에 필요한 필드만 채운 최소 고객 팩토리(나머지는 표시값과 무관).
function makeCustomer(overrides: Partial<Customer>): Customer {
  return {
    no: 1,
    customerId: "CU-2605-9999",
    receivedAt: "2026-05-14 10:00",
    assignedAt: "오늘 10:10",
    team: "상담",
    name: "테스트",
    customerType: "개인",
    customerTypeDetail: "4대보험",
    phone: "01000000000",
    vehicle: "GV80",
    method: "운용리스",
    advisor: "김지안",
    statusGroup: "상담중",
    status: "구매방식상담중",
    date: "5/14 10:00",
    source: "앱 견적요청",
    talkCount: "1/0",
    priority: "중간",
    nextAction: "",
    aiSummary: "",
    ...overrides,
  };
}

describe("resolveChance", () => {
  // Option A: 계약완료/출고완료면 override를 무시하고 무조건 "확정"으로 통일(목록↔상세 동일).
  it("계약완료 + override '낮음' → '확정'(override 무시)", () => {
    const customer = makeCustomer({ statusGroup: "계약완료", status: "딜러사계약중" });
    expect(resolveChance(customer, "낮음")).toBe("확정");
  });

  it("계약완료 + override 없음 → '확정'", () => {
    const customer = makeCustomer({ statusGroup: "계약완료", status: "딜러사계약중" });
    expect(resolveChance(customer, undefined)).toBe("확정");
  });

  it("출고완료(status) → '확정'", () => {
    const customer = makeCustomer({ statusGroup: "계약완료", status: "출고완료" });
    expect(resolveChance(customer, "낮음")).toBe("확정");
  });

  it("상담중 + override '보류' → '보류'(override 우선)", () => {
    const customer = makeCustomer({ statusGroup: "상담중", priority: "중간" });
    expect(resolveChance(customer, "보류")).toBe("보류");
  });

  it("상담중 + override 없음 → priority 기반 라벨('높음' → '높음')", () => {
    const customer = makeCustomer({ statusGroup: "상담중", priority: "높음" });
    expect(resolveChance(customer, undefined)).toBe("높음");
  });

  it("불발 → '낮음'", () => {
    const customer = makeCustomer({ statusGroup: "불발", status: "불발", priority: "낮음" });
    expect(resolveChance(customer, undefined)).toBe("낮음");
  });
});

describe("parseAiHintParts", () => {
  it("빈/공백 값 → 빈 배열(버튼 숨김 신호)", () => {
    expect(parseAiHintParts("")).toEqual([]);
    expect(parseAiHintParts("   ")).toEqual([]);
  });

  it("마커 없는 평문 → 단일 파트(구 DB 값 하위호환)", () => {
    expect(parseAiHintParts("초기비용 0원 선호")).toEqual([{ text: "초기비용 0원 선호" }]);
  });

  it("** 마커 → strong 파트 분해(선두·중간·연속)", () => {
    expect(parseAiHintParts("**X3 · GLC**를 비교 중이며 **총비용**에 민감")).toEqual([
      { text: "X3 · GLC", strong: true },
      { text: "를 비교 중이며 " },
      { text: "총비용", strong: true },
      { text: "에 민감" },
    ]);
  });
});

describe("aiHintDisplay (목업 테이블 폐기 후)", () => {
  it("목업 고객번호(CU-2605-0020)여도 aiSummary 기반으로만 파싱한다", () => {
    const customer = makeCustomer({ customerId: "CU-2605-0020", aiSummary: "**실데이터** 힌트" });
    expect(aiHintDisplay(customer).parts).toEqual([{ text: "실데이터", strong: true }, { text: " 힌트" }]);
  });
});

describe("aiHintPlainText", () => {
  it("마커 제거 평문(검색·레거시 셀용)", () => {
    expect(aiHintPlainText(makeCustomer({ aiSummary: "**X3** 비교 중" }))).toBe("X3 비교 중");
  });
});
