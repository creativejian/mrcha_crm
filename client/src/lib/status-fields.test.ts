import { describe, expect, it } from "vitest";

import {
  formatAdvisorValue,
  formatJobValue,
  formatLocationValue,
  hasAppSourceQueue,
  isAutomaticSource,
  parseAdvisorValue,
  parseJobValue,
  parseLocationValue,
  parseSourceValue,
} from "./status-fields";

describe("직군 (job)", () => {
  it("parseJobValue는 '유형 · 상세'를 가르고, 미상 유형은 개인+4대보험으로 폴백", () => {
    expect(parseJobValue("개인사업자 · 카페")).toEqual({ type: "개인사업자", detail: "카페" });
    expect(parseJobValue("이상한값")).toEqual({ type: "개인", detail: "4대보험" });
  });
  it("formatJobValue는 상세가 비면 유형별 기본값", () => {
    expect(formatJobValue("개인", "")).toBe("개인 · 4대보험");
    expect(formatJobValue("법인사업자", "")).toBe("법인사업자 · 미입력");
  });
  it("round-trip(개인 · 4대보험)", () => {
    const { type, detail } = parseJobValue("개인 · 4대보험");
    expect(formatJobValue(type, detail)).toBe("개인 · 4대보험");
  });
});

describe("거주지 (location)", () => {
  it("parseLocationValue는 등록된 시도/구만 통과시키고 나머지는 '확인 필요'", () => {
    expect(parseLocationValue("인천광역시 · 연수구")).toEqual({ province: "인천광역시", detail: "연수구" });
    expect(parseLocationValue("없는도 · 없는구")).toEqual({ province: "확인 필요", detail: "확인 필요" });
    expect(parseLocationValue("서울특별시 · 없는구")).toEqual({ province: "서울특별시", detail: "확인 필요" });
  });
  it("formatLocationValue는 확인 필요/빈 상세를 단순화", () => {
    expect(formatLocationValue("확인 필요", "강남구")).toBe("확인 필요");
    expect(formatLocationValue("서울특별시", "확인 필요")).toBe("서울특별시");
    expect(formatLocationValue("서울특별시", "강남구")).toBe("서울특별시 · 강남구");
  });
});

describe("상담경로 (source)", () => {
  it("parseSourceValue는 등록 옵션/레거시를 정규화하고 미등록은 기타로", () => {
    expect(parseSourceValue("앱 견적요청")).toBe("앱 견적요청");
    expect(parseSourceValue("디엘홈페이지")).toBe("디엘(상담)");
    expect(parseSourceValue("지인 소개행사")).toBe("기타");
  });
  it("isAutomaticSource는 자동+레거시 소스를 true", () => {
    expect(isAutomaticSource("앱 견적요청")).toBe(true);
    expect(isAutomaticSource("디엘홈페이지")).toBe(true);
    expect(isAutomaticSource("대표전화")).toBe(false);
  });
  it("hasAppSourceQueue는 앱 관련 소스 판단", () => {
    expect(hasAppSourceQueue("앱 AI상담")).toBe(true);
    expect(hasAppSourceQueue("대표전화")).toBe(false);
  });
});

describe("담당자 (advisor)", () => {
  it("parseAdvisorValue는 '담당자 · 팀'을 가르고, 미상 팀/담당자는 폴백", () => {
    expect(parseAdvisorValue("이주선 · 상담팀")).toEqual({ team: "상담팀", advisor: "이주선" });
    expect(parseAdvisorValue("없는사람 · 없는팀")).toEqual({ team: "인천본사", advisor: "김지안" });
  });
  it("formatAdvisorValue는 미배정/빈 값을 '미배정'", () => {
    expect(formatAdvisorValue("상담팀", "이주선")).toBe("이주선 · 상담팀");
    expect(formatAdvisorValue("상담팀", "미배정")).toBe("미배정");
    expect(formatAdvisorValue("상담팀", "")).toBe("미배정");
  });
});
