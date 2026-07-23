import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getJson } from "./http";
import { SOLUTION_LENDERS } from "./solution-quote";
import {
  fetchSupportMatrix,
  parseSupportMatrix,
  resetSupportMatrixCache,
  resolveGateFallback,
  supportedMileagesFor,
  supportedTermsFor,
  type SupportMatrix,
} from "./support-matrix";

vi.mock("./http", () => ({ getJson: vi.fn() }));
const getJsonMock = vi.mocked(getJson);

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

describe("fetchSupportMatrix (세션 캐시)", () => {
  beforeEach(() => {
    resetSupportMatrixCache();
    getJsonMock.mockReset();
  });
  afterEach(() => {
    resetSupportMatrixCache();
  });

  it("성공 응답을 캐시한다 — 2회 호출해도 왕복 1회", async () => {
    getJsonMock.mockResolvedValue(RAW);
    const first = await fetchSupportMatrix();
    const second = await fetchSupportMatrix();
    expect(getJsonMock).toHaveBeenCalledTimes(1);
    expect(getJsonMock).toHaveBeenCalledWith("/api/solution/support-matrix");
    expect(second).toBe(first);
    expect(first.get("mg-capital::operating_lease")?.leaseTermMonths).toEqual([36, 48, 60]);
  });

  it("동시 호출은 inflight로 합친다 — 왕복 1회", async () => {
    getJsonMock.mockResolvedValue(RAW);
    const [a, b] = await Promise.all([fetchSupportMatrix(), fetchSupportMatrix()]);
    expect(getJsonMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("실패는 빈 Map(fail-open) + 캐시하지 않는다 — 재진입이 재시도", async () => {
    getJsonMock.mockRejectedValueOnce(new Error("503"));
    const failed = await fetchSupportMatrix();
    expect(failed.size).toBe(0);

    getJsonMock.mockResolvedValue(RAW);
    const retried = await fetchSupportMatrix();
    expect(getJsonMock).toHaveBeenCalledTimes(2);
    expect(retried.size).toBeGreaterThan(0);
  });
});

// 파트너 계약 4) fail-soft: 200이어도 항목별로 null 강등이 온다(메리츠 mileage는 워크북 DB 파생이라
// 그쪽 DB 상태에 따라 term은 배열인데 mileage만 null일 수 있다). "200 = 전부 확정"으로 가정 금지 —
// 축(기간/약정거리)마다 독립 판정해야 한다.
describe("항목별 null 강등(파트너 fail-soft)", () => {
  const MIXED = parseSupportMatrix({
    ok: true,
    matrix: [
      {
        lenderCode: "meritz-capital",
        productType: "operating_lease",
        leaseTermMonths: [12, 24, 36, 48, 60], // 확정
        annualMileageKm: null, // 워크북 DB 이슈로 강등
      },
    ],
  });

  it("같은 금융사에서 기간은 게이트하고 약정거리만 해제한다 — 축 독립", () => {
    expect(supportedTermsFor(MIXED, "메리츠캐피탈", "operating_lease")).toEqual([12, 24, 36, 48, 60]);
    expect(supportedMileagesFor(MIXED, "메리츠캐피탈", "operating_lease")).toBeNull();
  });

  it("강등된 축은 폴백도 돌지 않는다(무변경) — 확정된 축만 폴백", () => {
    expect(resolveGateFallback(25000, supportedMileagesFor(MIXED, "메리츠캐피탈", "operating_lease"), 20000)).toBeNull();
    expect(resolveGateFallback(24, supportedTermsFor(MIXED, "메리츠캐피탈", "operating_lease"), 60)).toBeNull();
  });
});

// ── 금융사 SSOT 드리프트 런타임 그물(2026-07-23) ────────────────────────────────
// `SOLUTION_LENDERS`는 파트너 목록의 하드코딩 미러라 조용히 낡을 수 있다. 매트릭스 응답이 파트너
// lender SSOT를 그대로 싣고 오므로(파라미터 없이 전량 반환) 워크벤치가 그걸 받을 때 1회 대조해
// 흔적을 남긴다. 판정 자체는 순수 모듈(solution-quote.detectLenderDrift)이 소유 — 여기선 **배선**만 잠근다.
// ⚠️ 화면 동작은 바꾸지 않는다(fail-open 유지) — 경고는 기록일 뿐 게이트가 아니다.
// 의도적 점검은 `bun run check:lenders`(파트너 직접 조회)가 담당한다.
describe("fetchSupportMatrix — 금융사 SSOT 드리프트 경고", () => {
  const rowsFor = (codes: readonly string[]) =>
    codes.map((code) => ({
      lenderCode: code,
      productType: "operating_lease",
      leaseTermMonths: [36, 48, 60],
      annualMileageKm: [10000, 20000, 30000],
    }));
  const ALL_CODES = SOLUTION_LENDERS.map((l) => l.code);
  const driftWarnings = () =>
    warnSpy.mock.calls.filter((call: unknown[]) => String(call[0]).includes("드리프트"));
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetSupportMatrixCache();
    getJsonMock.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    resetSupportMatrixCache();
    warnSpy.mockRestore();
  });

  it("파트너 목록이 현행 어휘와 같으면 조용하다", async () => {
    getJsonMock.mockResolvedValue({ matrix: rowsFor(ALL_CODES) });
    await fetchSupportMatrix();
    expect(driftWarnings()).toHaveLength(0);
  });

  it("파트너에 새 금융사가 생기면 경고한다(그 사는 CRM에서 선택 불가 = 기능 누락)", async () => {
    getJsonMock.mockResolvedValue({ matrix: rowsFor([...ALL_CODES, "new-capital"]) });
    await fetchSupportMatrix();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("new-capital"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("check:lenders")); // 다음 행동을 문구가 지시한다
  });

  it("파트너에서 금융사가 빠지면 경고한다(고를 수 있는데 계산이 거부되는 상태)", async () => {
    getJsonMock.mockResolvedValue({ matrix: rowsFor(ALL_CODES.filter((c) => c !== "nh-capital")) });
    await fetchSupportMatrix();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nh-capital"));
  });

  it("조회 실패(빈 매트릭스)는 드리프트로 오탐하지 않는다 — fail-open 경로 보호", async () => {
    // 이 가드가 없으면 파트너가 잠깐 죽을 때마다 "8사가 전부 사라졌다"가 뜬다(늑대소년).
    getJsonMock.mockRejectedValueOnce(new Error("503"));
    await fetchSupportMatrix();
    expect(driftWarnings()).toHaveLength(0);
  });

  it("두 번 호출해도 경고는 1회 — 세션 캐시가 재파싱을 막는다", async () => {
    getJsonMock.mockResolvedValue({ matrix: rowsFor([...ALL_CODES, "new-capital"]) });
    await fetchSupportMatrix();
    await fetchSupportMatrix();
    expect(driftWarnings()).toHaveLength(1);
  });
});
