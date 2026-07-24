import { describe, expect, it } from "vitest";

import type { Customer } from "@/data/customers";
import { aiHintDisplay, aiHintPlainText, deliveryMethodDisplay, deliveryVehicleDisplay, parseAiHintParts, resolveChance } from "./customer-table";

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

// 계약·출고 관리 차량 열 — 계약 차량 저장값 → 계약 진행 견적 → **없음(null)**.
// ⚠️ 니즈(need_model)로 폴백하지 않는다(2026-07-24 유슨생 결정). 니즈는 최초 승격 때 한 번 박히고
// 갱신되지 않는 "계약 전 관심사"라 계약 실무 화면에서는 정보가 아니라 노이즈다. 더 나쁜 건 입력 유도가
// 죽는 것 — 니즈가 보이면 상담사가 진짜 계약 차량을 안 채운다(실측: 계약완료 8명 전원 계약 차량 미입력).
// 계약 견적이 없으면 CRM에 계약 차량 기록이 실제로 없는 것이므로, 모른다고 표시하고 채우게 한다.
describe("deliveryVehicleDisplay", () => {
  const base = { vehicle: "기아 레이", vehicleTrim: "26년형 프레스티지" } as Customer;

  it("계약 차량 저장값이 있으면 최우선", () => {
    expect(
      deliveryVehicleDisplay({
        ...base,
        delivery: { contractVehicle: "BMW 3 Series 320i", lender: null, contractDate: null, deliveredDate: null, deliveryMemo: null },
        contractingQuote: { id: "q1", brandName: "제네시스", modelName: "G80", trimName: null, purchaseMethod: null, lender: null },
      } as Customer),
    ).toBe("BMW 3 Series 320i");
  });

  it("계약 차량이 없으면 계약 진행 견적(브랜드·모델·트림 결합)", () => {
    expect(
      deliveryVehicleDisplay({
        ...base,
        delivery: null,
        contractingQuote: { id: "q1", brandName: "BMW", modelName: "3 Series", trimName: "320i LCI 2", purchaseMethod: null, lender: null },
      } as Customer),
    ).toBe("BMW 3 Series 320i LCI 2");
  });

  it("견적에 트림이 없으면 브랜드·모델만", () => {
    expect(
      deliveryVehicleDisplay({
        ...base,
        delivery: null,
        contractingQuote: { id: "q1", brandName: "제네시스", modelName: "G80", trimName: null, purchaseMethod: null, lender: null },
      } as Customer),
    ).toBe("제네시스 G80");
  });

  // 니즈가 있어도 무시한다 — 이게 이 함수의 핵심 계약이다.
  it("둘 다 없으면 null (니즈가 있어도 쓰지 않는다)", () => {
    expect(deliveryVehicleDisplay({ ...base, delivery: null, contractingQuote: null } as Customer)).toBeNull();
  });

  it("빈 문자열 저장값·빈 견적은 없는 것으로 본다", () => {
    expect(
      deliveryVehicleDisplay({
        ...base,
        delivery: { contractVehicle: "   ", lender: null, contractDate: null, deliveredDate: null, deliveryMemo: null },
        contractingQuote: { id: "q1", brandName: null, modelName: null, trimName: null, purchaseMethod: null, lender: null },
      } as Customer),
    ).toBeNull();
  });
});

// 구매방식도 같은 규칙 — 계약 진행 견적의 시나리오 값만 쓰고 니즈(need_method)는 쓰지 않는다.
// 실측: 제임스의 계약은 **운용리스**인데 니즈는 장기렌트라, 니즈를 쓰면 "BMW 3 Series · 장기렌트"라는
// 실재하지 않는 조합이 나온다. 차량을 비우면서 구매방식만 니즈로 남기면 같은 종류의 거짓이 남는다.
describe("deliveryMethodDisplay", () => {
  it("계약 진행 견적의 구매방식을 쓴다", () => {
    expect(
      deliveryMethodDisplay({
        method: "장기렌트",
        contractingQuote: { id: "q1", brandName: "BMW", modelName: "3 Series", trimName: null, purchaseMethod: "운용리스", lender: "iM캐피탈" },
      } as Customer),
    ).toBe("운용리스");
  });

  it("계약 견적이 없으면 null (니즈 구매방식을 쓰지 않는다)", () => {
    expect(deliveryMethodDisplay({ method: "장기렌트", contractingQuote: null } as Customer)).toBeNull();
  });

  it("견적에 구매방식이 비어 있어도 null", () => {
    expect(
      deliveryMethodDisplay({
        method: "장기렌트",
        contractingQuote: { id: "q1", brandName: "BMW", modelName: "3 Series", trimName: null, purchaseMethod: null, lender: null },
      } as Customer),
    ).toBeNull();
  });
});
