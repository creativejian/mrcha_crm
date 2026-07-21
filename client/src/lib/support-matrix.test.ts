import { describe, expect, it } from "vitest";

import {
  parseSupportMatrix,
  resolveGateFallback,
  supportedMileagesFor,
  supportedTermsFor,
  type SupportMatrix,
} from "./support-matrix";

// 제프 첫 응답 구성(회신 문서 2026-07-21 표) 축약 — MG는 확정, 산은은 Phase B 미착수라 null.
const RAW = {
  ok: true,
  matrix: [
    {
      lenderCode: "mg-capital",
      productType: "operating_lease",
      leaseTermMonths: [36, 48, 60],
      annualMileageKm: [10000, 20000, 30000],
    },
    {
      lenderCode: "bnk-capital",
      productType: "operating_lease",
      leaseTermMonths: [12, 24, 36, 48, 60],
      annualMileageKm: [10000, 15000, 20000, 30000, 40000],
    },
    { lenderCode: "kdbc-capital", productType: "operating_lease", leaseTermMonths: null, annualMileageKm: null },
  ],
};

describe("parseSupportMatrix", () => {
  it("행을 (lenderCode, productType) 키로 담는다 — 행 순서 비의존(제프 권고)", () => {
    const m = parseSupportMatrix(RAW);
    expect(m.get("mg-capital::operating_lease")).toEqual({
      leaseTermMonths: [36, 48, 60],
      annualMileageKm: [10000, 20000, 30000],
    });
  });

  it("null은 미확정으로 보존한다 — []와 의미가 정반대(제프 계약)", () => {
    const m = parseSupportMatrix(RAW);
    expect(m.get("kdbc-capital::operating_lease")).toEqual({ leaseTermMonths: null, annualMileageKm: null });
  });

  it("빈 배열은 빈 배열로 보존한다 — null로 뭉개면 '전부 미지원'이 '게이트 없음'이 된다", () => {
    const m = parseSupportMatrix({
      matrix: [{ lenderCode: "mg-capital", productType: "operating_lease", leaseTermMonths: [], annualMileageKm: [] }],
    });
    expect(m.get("mg-capital::operating_lease")).toEqual({ leaseTermMonths: [], annualMileageKm: [] });
  });

  it("배열도 null도 아닌 값·숫자 아닌 원소는 미확정으로 강등한다(파트너 드리프트 fail-open)", () => {
    const m = parseSupportMatrix({
      matrix: [
        {
          lenderCode: "mg-capital",
          productType: "operating_lease",
          leaseTermMonths: "36,48",
          annualMileageKm: [10000, "20000"],
        },
      ],
    });
    expect(m.get("mg-capital::operating_lease")).toEqual({ leaseTermMonths: null, annualMileageKm: null });
  });

  it("matrix가 없거나 배열이 아니면 빈 Map", () => {
    expect(parseSupportMatrix({}).size).toBe(0);
    expect(parseSupportMatrix(null).size).toBe(0);
    expect(parseSupportMatrix({ matrix: "x" }).size).toBe(0);
  });

  it("식별자 없는 행은 건너뛴다(다른 행은 살린다)", () => {
    const m = parseSupportMatrix({
      matrix: [
        { productType: "operating_lease", leaseTermMonths: [60], annualMileageKm: [20000] },
        { lenderCode: "mg-capital", productType: "operating_lease", leaseTermMonths: [60], annualMileageKm: [20000] },
      ],
    });
    expect(m.size).toBe(1);
    expect(m.get("mg-capital::operating_lease")?.leaseTermMonths).toEqual([60]);
  });
});

describe("supportedTermsFor / supportedMileagesFor", () => {
  const m: SupportMatrix = parseSupportMatrix(RAW);

  it("금융사 라벨 → 코드 변환으로 조회한다", () => {
    expect(supportedTermsFor(m, "MG캐피탈", "operating_lease")).toEqual([36, 48, 60]);
    expect(supportedMileagesFor(m, "BNK캐피탈", "operating_lease")).toEqual([10000, 15000, 20000, 30000, 40000]);
  });

  it("미확정(null)은 null 그대로 — 게이트 없음", () => {
    expect(supportedTermsFor(m, "산은캐피탈", "operating_lease")).toBeNull();
    expect(supportedMileagesFor(m, "산은캐피탈", "operating_lease")).toBeNull();
  });

  it("어휘 밖 라벨(미선택·CRM 수기 전용·구 어휘 저장값)은 null — 게이트 없음", () => {
    expect(supportedTermsFor(m, "미선택", "operating_lease")).toBeNull();
    expect(supportedTermsFor(m, "옛날캐피탈", "operating_lease")).toBeNull();
  });

  it("매트릭스에 행이 없으면 null — fail-open(조회 실패·미배포 포함)", () => {
    expect(supportedTermsFor(new Map(), "MG캐피탈", "operating_lease")).toBeNull();
    expect(supportedTermsFor(m, "MG캐피탈", "long_term_rental")).toBeNull();
  });
});

describe("resolveGateFallback", () => {
  it("지원값이면 무변경(null)", () => {
    expect(resolveGateFallback(60, [36, 48, 60], 60)).toBeNull();
  });

  it("미지원이면 폴백값을 돌려준다", () => {
    expect(resolveGateFallback(24, [36, 48, 60], 60)).toBe(60);
    expect(resolveGateFallback(25000, [10000, 20000, 30000], 20000)).toBe(20000);
  });

  it("미확정(null)이면 무변경 — 게이트 없음", () => {
    expect(resolveGateFallback(24, null, 60)).toBeNull();
  });

  it("전부 미지원([])이면 무변경 — 옮길 곳이 없다(폴백값도 미지원)", () => {
    expect(resolveGateFallback(24, [], 60)).toBeNull();
  });
});
