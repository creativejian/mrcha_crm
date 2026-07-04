import { describe, expect, it } from "vitest";

import {
  formatKimAdvisorValue,
  formatKimJobValue,
  formatKimLocationValue,
  hasKimAppSourceQueue,
  isKimAutomaticSource,
  parseKimAdvisorValue,
  parseKimJobValue,
  parseKimLocationValue,
  parseKimSourceValue,
} from "./kim-status-fields";

describe("직군 (job)", () => {
  it("parseKimJobValue는 '유형 · 상세'를 가르고, 미상 유형은 개인+4대보험으로 폴백", () => {
    expect(parseKimJobValue("개인사업자 · 카페")).toEqual({ type: "개인사업자", detail: "카페" });
    expect(parseKimJobValue("이상한값")).toEqual({ type: "개인", detail: "4대보험" });
  });
  it("formatKimJobValue는 상세가 비면 유형별 기본값", () => {
    expect(formatKimJobValue("개인", "")).toBe("개인 · 4대보험");
    expect(formatKimJobValue("법인사업자", "")).toBe("법인사업자 · 미입력");
  });
  it("round-trip(개인 · 4대보험)", () => {
    const { type, detail } = parseKimJobValue("개인 · 4대보험");
    expect(formatKimJobValue(type, detail)).toBe("개인 · 4대보험");
  });
});

describe("거주지 (location)", () => {
  it("parseKimLocationValue는 등록된 시도/구만 통과시키고 나머지는 '확인 필요'", () => {
    expect(parseKimLocationValue("인천광역시 · 연수구")).toEqual({ province: "인천광역시", detail: "연수구" });
    expect(parseKimLocationValue("없는도 · 없는구")).toEqual({ province: "확인 필요", detail: "확인 필요" });
    expect(parseKimLocationValue("서울특별시 · 없는구")).toEqual({ province: "서울특별시", detail: "확인 필요" });
  });
  it("formatKimLocationValue는 확인 필요/빈 상세를 단순화", () => {
    expect(formatKimLocationValue("확인 필요", "강남구")).toBe("확인 필요");
    expect(formatKimLocationValue("서울특별시", "확인 필요")).toBe("서울특별시");
    expect(formatKimLocationValue("서울특별시", "강남구")).toBe("서울특별시 · 강남구");
  });
});

describe("상담경로 (source)", () => {
  it("parseKimSourceValue는 등록 옵션/레거시를 정규화하고 미등록은 기타로", () => {
    expect(parseKimSourceValue("앱 견적비교")).toBe("앱 견적비교");
    expect(parseKimSourceValue("디엘홈페이지")).toBe("디엘(상담)");
    expect(parseKimSourceValue("지인 소개행사")).toBe("기타");
  });
  it("isKimAutomaticSource는 자동+레거시 소스를 true", () => {
    expect(isKimAutomaticSource("앱 견적비교")).toBe(true);
    expect(isKimAutomaticSource("디엘홈페이지")).toBe(true);
    expect(isKimAutomaticSource("대표전화")).toBe(false);
  });
  it("hasKimAppSourceQueue는 앱 관련 소스 판단", () => {
    expect(hasKimAppSourceQueue("앱 AI상담")).toBe(true);
    expect(hasKimAppSourceQueue("대표전화")).toBe(false);
  });
});

describe("담당자 (advisor)", () => {
  it("parseKimAdvisorValue는 '담당자 · 팀'을 가르고, 미상 팀/담당자는 폴백", () => {
    expect(parseKimAdvisorValue("이주선 · 상담팀")).toEqual({ team: "상담팀", advisor: "이주선" });
    expect(parseKimAdvisorValue("없는사람 · 없는팀")).toEqual({ team: "인천본사", advisor: "김지안" });
  });
  it("formatKimAdvisorValue는 미배정/빈 값을 '미배정'", () => {
    expect(formatKimAdvisorValue("상담팀", "이주선")).toBe("이주선 · 상담팀");
    expect(formatKimAdvisorValue("상담팀", "미배정")).toBe("미배정");
    expect(formatKimAdvisorValue("상담팀", "")).toBe("미배정");
  });
});
