import { describe, expect, it } from "vitest";

import { deliveryRegionOf, deliveryTimingTextOf } from "./quote-delivery";

// 지역 either/or 분기 — 계약 §5-4(ref/2026-07-24-app-delivery-contract-reply.md).
// 할부/일시불은 등록 지역, 그 외(리스·렌트·미정)는 인수 지역.
describe("deliveryRegionOf", () => {
  const both = {
    deliveryRegionCode: "seoul",
    deliveryRegionName: "서울특별시",
    registrationRegionCode: "busan",
    registrationRegionName: "부산광역시",
  };

  it("리스·렌트는 인수 지역을 본다", () => {
    expect(deliveryRegionOf({ paymentMethod: "lease", ...both })).toBe("서울특별시");
    expect(deliveryRegionOf({ paymentMethod: "rent", ...both })).toBe("서울특별시");
  });

  it("할부·일시불은 등록 지역을 본다", () => {
    expect(deliveryRegionOf({ paymentMethod: "installment", ...both })).toBe("부산광역시");
    expect(deliveryRegionOf({ paymentMethod: "cash", ...both })).toBe("부산광역시");
  });

  // V2 미정 경로부터 생기는 새 케이스 — 기존 실데이터 113건은 전부 non-null이라 이 분기는 테스트로만 지킨다.
  it("구매방식 미정(null)은 인수 지역을 본다", () => {
    expect(deliveryRegionOf({ paymentMethod: null, ...both })).toBe("서울특별시");
  });

  it("해당 버킷이 비어 있으면 반대 버킷으로 넘어가지 않는다", () => {
    expect(
      deliveryRegionOf({
        paymentMethod: "installment",
        deliveryRegionCode: "seoul",
        deliveryRegionName: "서울특별시",
        registrationRegionCode: null,
        registrationRegionName: null,
      }),
    ).toBeNull();
  });

  it("name이 없으면 code로 폴백한다(앱은 쌍으로 보내지만 방어)", () => {
    expect(
      deliveryRegionOf({
        paymentMethod: "lease",
        deliveryRegionCode: "jeju",
        deliveryRegionName: null,
        registrationRegionCode: null,
        registrationRegionName: null,
      }),
    ).toBe("jeju");
  });

  it("레거시 행(둘 다 null)은 null", () => {
    expect(
      deliveryRegionOf({
        paymentMethod: "lease",
        deliveryRegionCode: null,
        deliveryRegionName: null,
        registrationRegionCode: null,
        registrationRegionName: null,
      }),
    ).toBeNull();
  });
});

// 절대화 매핑 — 계약 D3(앵커 병기 안 함)·D4(마감형 "~까지").
// ⚠️ 이 문구는 need_timing 시드로 DB에 박히고 업무 AI 청크 텍스트가 된다 — 형식을 바꾸면 전량 재임베딩.
describe("deliveryTimingTextOf", () => {
  it("as_soon_as_favorable은 월과 무관한 고정 문구", () => {
    expect(deliveryTimingTextOf("as_soon_as_favorable", null, null)).toBe("좋은 조건 즉시");
  });

  it("current_month는 reference_month 그대로", () => {
    expect(deliveryTimingTextOf("current_month", "2026-07", null)).toBe("2026년 7월");
  });

  it("next_month는 reference + 1", () => {
    expect(deliveryTimingTextOf("next_month", "2026-07", null)).toBe("2026년 8월");
  });

  it("within_three_months는 reference + 3, 마감형", () => {
    expect(deliveryTimingTextOf("within_three_months", "2026-07", null)).toBe("2026년 10월까지");
  });

  // 월 덧셈은 정수 연산으로 한다(Date 경유 시 타임존·말일 함정).
  it("연을 넘긴다", () => {
    expect(deliveryTimingTextOf("next_month", "2026-12", null)).toBe("2027년 1월");
    expect(deliveryTimingTextOf("within_three_months", "2026-11", null)).toBe("2027년 2월까지");
    expect(deliveryTimingTextOf("within_three_months", "2026-10", null)).toBe("2027년 1월까지");
  });

  it("specific_month는 target_month를 쓴다", () => {
    expect(deliveryTimingTextOf("specific_month", "2026-07", "2026-10")).toBe("2026년 10월");
  });

  it("undecided는 시드하지 않는다(null)", () => {
    expect(deliveryTimingTextOf("undecided", "2026-07", null)).toBeNull();
  });

  it("레거시 행(mode null)은 null", () => {
    expect(deliveryTimingTextOf(null, null, null)).toBeNull();
  });

  // DB CHECK가 막지만 CRM은 앱 데이터를 신뢰하지 않는다 — 짝이 안 맞으면 조용히 숨긴다(틀린 월을 박느니 미표시).
  it("짝이 안 맞거나 형식이 깨지면 null", () => {
    expect(deliveryTimingTextOf("current_month", null, null)).toBeNull();
    expect(deliveryTimingTextOf("specific_month", "2026-07", null)).toBeNull();
    expect(deliveryTimingTextOf("current_month", "2026-7", null)).toBeNull();
    expect(deliveryTimingTextOf("current_month", "abcd-ef", null)).toBeNull();
    expect(deliveryTimingTextOf("current_month", "2026-13", null)).toBeNull();
    expect(deliveryTimingTextOf("current_month", "2026-00", null)).toBeNull();
  });

  it("미지의 mode는 null(앱이 어휘를 늘려도 화면이 깨지지 않는다)", () => {
    expect(deliveryTimingTextOf("someday_maybe", "2026-07", null)).toBeNull();
  });
});
