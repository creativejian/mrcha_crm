// 계산기 fail-loud 순수 헬퍼 잠금(배치 7 A#1·A#8).
// - failureNoteFromEntries: 에러성 전사 실패 사유 표면화 판정(전멸에서만 — 일부 성공은 현행 유지).
// - percentGuardReason: 조회 시작 전 % 상한 검증(워크벤치 buildSolutionQuoteInput reason 문구 미러).
// - feeRateFraction/feePreviewWon: CM/AG % 파생 — '.' 입력이 NaN payload가 되던 제프 원형
//   parseFloat 경로의 회귀 그물(parsePercentInput SSOT 재사용).
import { describe, expect, it } from "vitest";

import {
  distanceGuardReason,
  failureNoteFromEntries,
  feePreviewWon,
  feeRateFraction,
  percentGuardReason,
  type LenderFailureCheckEntry,
} from "./calc-guards";

const entry = (patch: Partial<LenderFailureCheckEntry>): LenderFailureCheckEntry => ({
  result: null,
  loading: false,
  notAvailable: false,
  error: null,
  ...patch,
});

describe("failureNoteFromEntries", () => {
  it("전멸(표시 행 0) + 에러성 실패 ≥ 1건 → 첫 error 사유를 반환한다", () => {
    const entries = [
      entry({ notAvailable: true }),
      entry({ error: "솔루션 연결이 설정되지 않았습니다" }),
      entry({ error: "계산 서버에 연결하지 못했습니다" }),
    ];
    expect(failureNoteFromEntries(entries)).toBe("솔루션 연결이 설정되지 않았습니다");
  });

  it("일부라도 성공(표시 가능한 행 ≥ 1)이면 null — 현행(부분 실패 조용) 유지", () => {
    const entries = [
      entry({ result: { monthlyPayment: 1 } }),
      entry({ error: "계산 서버에 연결하지 못했습니다" }),
    ];
    expect(failureNoteFromEntries(entries)).toBeNull();
  });

  it("전멸이어도 전부 미취급(error 없음)이면 null — '조회 결과가 없습니다' 어휘 유지", () => {
    const entries = [entry({ notAvailable: true }), entry({ notAvailable: true })];
    expect(failureNoteFromEntries(entries)).toBeNull();
  });

  it("loading 중인 행은 표시 가능으로 치지 않는다(결과 필터 술어와 동일)", () => {
    const entries = [
      entry({ result: { monthlyPayment: 1 }, loading: true }),
      entry({ error: "계산 응답을 해석하지 못했습니다" }),
    ];
    expect(failureNoteFromEntries(entries)).toBe("계산 응답을 해석하지 못했습니다");
  });

  it("빈 배열은 null", () => {
    expect(failureNoteFromEntries([])).toBeNull();
  });
});

describe("percentGuardReason", () => {
  const base = {
    downPaymentType: "none" as const,
    downPayment: "0",
    depositType: "none" as const,
    deposit: "0",
    cmFeePercent: "",
    agFeePercent: "",
  };

  it("선수금 % 모드 100 초과 → 보증금·선수금 사유(워크벤치 문구 미러)", () => {
    expect(percentGuardReason({ ...base, downPaymentType: "percent", downPayment: "150" })).toBe(
      "보증금·선수금 %는 100 이하로 입력해 주세요",
    );
  });

  it("보증금 % 모드 101 → 사유 / 100 정확히는 통과(경계)", () => {
    expect(percentGuardReason({ ...base, depositType: "percent", deposit: "101" })).toBe(
      "보증금·선수금 %는 100 이하로 입력해 주세요",
    );
    expect(percentGuardReason({ ...base, depositType: "percent", deposit: "100" })).toBeNull();
  });

  it("amount 모드 큰 값은 % 상한과 무관 — 통과", () => {
    expect(percentGuardReason({ ...base, downPaymentType: "amount", downPayment: "99999999" })).toBeNull();
  });

  it("CM/AG % 100 초과 → CM/AG 사유(워크벤치 문구 미러)", () => {
    expect(percentGuardReason({ ...base, cmFeePercent: "150" })).toBe(
      "CM/AG 수수료 %는 100 이하로 입력해 주세요",
    );
    expect(percentGuardReason({ ...base, agFeePercent: "100.5" })).toBe(
      "CM/AG 수수료 %는 100 이하로 입력해 주세요",
    );
  });

  it("CM/AG '.'·빈 칸·정상 범위는 통과(0 의미)", () => {
    expect(percentGuardReason({ ...base, cmFeePercent: "." })).toBeNull();
    expect(percentGuardReason({ ...base, cmFeePercent: "1.5", agFeePercent: "2" })).toBeNull();
  });

  it("선수금·CM 동시 위반이면 보증금·선수금 사유가 먼저(워크벤치 검증 순서 미러)", () => {
    expect(
      percentGuardReason({ ...base, downPaymentType: "percent", downPayment: "200", cmFeePercent: "200" }),
    ).toBe("보증금·선수금 %는 100 이하로 입력해 주세요");
  });
});

describe("feeRateFraction / feePreviewWon — CM/AG % 파생(parsePercentInput SSOT)", () => {
  it("'.' 입력은 NaN이 아니라 0 — payload NaN→JSON null→릴레이 400 전사 차단", () => {
    // RED 실관찰용 핵심 케이스: 제프 원형 parseFloat('.') = NaN.
    expect(feeRateFraction(".")).toBe(0);
    expect(feePreviewWon(50_000_000, ".")).toBe(0);
  });

  it("빈 칸은 0(현행 폴백과 동일 — 하위 호환)", () => {
    expect(feeRateFraction("")).toBe(0);
    expect(feePreviewWon(50_000_000, "")).toBe(0);
  });

  it("정상 소수 입력은 분율/원 환산 정확", () => {
    expect(feeRateFraction("1.5")).toBe(0.015);
    expect(feePreviewWon(50_000_000, "1.5")).toBe(750_000);
  });

  it("여분 소수점('1.2.3')은 parsePercentInput 흡수 규칙(→1.23)을 따른다", () => {
    // 제프 원형 parseFloat('1.2.3')=1.2와 다른 의도적 이탈 — 워크벤치 파싱 SSOT와 동일 의미론.
    expect(feeRateFraction("1.2.3")).toBeCloseTo(0.0123, 10);
    expect(feePreviewWon(10_000_000, "1.2.3")).toBe(123_000);
  });
});

describe("distanceGuardReason — 렌트 무제한 조회 차단(배치 7 A#2)", () => {
  it("'unlimited'는 사유와 함께 차단한다(파트너 계약에 무제한 표현 부재 — 종전 8사 400 전사 무사유 은닉)", () => {
    expect(distanceGuardReason({ annualDistance: "unlimited" })).toBe(
      "무제한 약정거리는 파트너 계산이 지원하지 않습니다 — 약정거리를 선택해 주세요",
    );
  });

  it("숫자 약정거리는 통과한다(생략 전송 대안은 기각 — 제프 엔진 `?? 20_000` 기본값이라 무음 오계산)", () => {
    expect(distanceGuardReason({ annualDistance: "20000" })).toBeNull();
    expect(distanceGuardReason({ annualDistance: "40000" })).toBeNull();
  });
});
