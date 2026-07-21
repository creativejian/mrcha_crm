import { useEffect, useState } from "react";

import { getJson } from "./http";
import { SOLUTION_LENDERS, type SolutionProductType } from "./solution-quote";

// 파트너(제프) 지원집합 매트릭스 — `GET /api/solution/support-matrix` 릴레이.
// 계약 확정 2026-07-21(요청 ref/2026-07-21-jeff-support-matrix-request.md · 회신 …-reply.md).
//
// ⚠️ `null` = 미확정(파트너 게이트 미착수) / `[]` = 전부 미지원. **의미가 정반대다** —
// "빈 배열로 통일"하는 리팩터 금지(파싱·판정 테스트가 양쪽을 고정한다).
//
// 이 게이트는 UX 개선이지 정합성 방어선이 아니다 — 진짜 방어선은 파트너 엔진의 미취급 throw이고
// CRM은 그 400 문구를 이미 표면화한다. 그래서 조회 실패·스키마 드리프트·미확정·어휘 밖 금융사를
// 전부 `null`(게이트 없음)로 수렴시킨다(fail-open). 게이트를 잘못 켜서 정상 조합을 막는 것이
// 안 켜는 것보다 나쁘다.
type LenderSupport = { leaseTermMonths: number[] | null; annualMileageKm: number[] | null };
export type SupportMatrix = Map<string, LenderSupport>;

// 행 순서에 의존하지 않는다(파트너 권고) — (lenderCode, productType)로만 찾는다.
const keyOf = (lenderCode: string, productType: string): string => `${lenderCode}::${productType}`;

function parseSupportList(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return raw;
}

export function parseSupportMatrix(raw: unknown): SupportMatrix {
  const out: SupportMatrix = new Map();
  const rows = (raw as { matrix?: unknown } | null)?.matrix;
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { lenderCode, productType, leaseTermMonths, annualMileageKm } = row as Record<string, unknown>;
    if (typeof lenderCode !== "string" || typeof productType !== "string") continue;
    out.set(keyOf(lenderCode, productType), {
      leaseTermMonths: parseSupportList(leaseTermMonths),
      annualMileageKm: parseSupportList(annualMileageKm),
    });
  }
  return out;
}

// 세션 캐시 + inflight dedupe(staff.ts 선례). TTL 없음 — 매트릭스는 파트너 워크북 갱신 주기로만
// 바뀌고 새로고침이 갱신 트리거다. 실패는 캐시하지 않는다(재진입이 재시도).
// ⚠️ 파트너 계약: 이 엔드포인트는 그쪽 DB 문제에도 500이 아니라 **200 + 영향받는 항목만 null 강등**을
// 준다(fail-soft). "200 = 전부 확정"으로 가정하면 안 되고 **항상 항목(금융사×축)별로 null을 본다**.
// 어느 사가 워크북 DB 파생인지는 파트너 내부 사정이라 여기 열거하지 않는다(2026-07-21 시점 메리츠
// mileage가 그 예). 같은 금융사의 집합이 응답마다 달라질 수 있다는 뜻이라 캐시를 영구 보관하지 않는다.
let cache: SupportMatrix | null = null;
let inflight: Promise<SupportMatrix> | null = null;

export async function fetchSupportMatrix(): Promise<SupportMatrix> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = getJson<unknown>("/api/solution/support-matrix")
    .then((raw) => {
      const parsed = parseSupportMatrix(raw);
      cache = parsed;
      return parsed;
    })
    .catch(() => {
      console.warn("[workbench] 지원집합 조회 실패 — 기간·약정거리 게이트 비활성(fail-open)");
      return new Map() as SupportMatrix;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// 테스트 전용 — 모듈 캐시 초기화(케이스 간 오염 방지).
export function resetSupportMatrixCache(): void {
  cache = null;
  inflight = null;
}

// 컴포넌트용: 마운트 시 1회 로드. 실패도 빈 Map이라 에러 상태가 없다(전 호출부 fail-open).
export function useSupportMatrix(): SupportMatrix {
  const [matrix, setMatrix] = useState<SupportMatrix>(cache ?? new Map());
  useEffect(() => {
    let alive = true;
    void fetchSupportMatrix().then((m) => {
      if (alive) setMatrix(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return matrix;
}

// 화면이 쥐고 있는 건 금융사 "라벨"(select 값)이다. 어휘 밖 라벨("미선택"·CRM 수기 전용·구 어휘
// 저장값)은 파트너 대상이 아니므로 null = 게이트 없음.
function supportOf(
  matrix: SupportMatrix,
  lenderLabel: string,
  productType: SolutionProductType,
): LenderSupport | null {
  const lender = SOLUTION_LENDERS.find((l) => l.label === lenderLabel);
  if (!lender) return null;
  return matrix.get(keyOf(lender.code, productType)) ?? null;
}

export function supportedTermsFor(
  matrix: SupportMatrix,
  lenderLabel: string,
  productType: SolutionProductType,
): number[] | null {
  return supportOf(matrix, lenderLabel, productType)?.leaseTermMonths ?? null;
}

export function supportedMileagesFor(
  matrix: SupportMatrix,
  lenderLabel: string,
  productType: SolutionProductType,
): number[] | null {
  return supportOf(matrix, lenderLabel, productType)?.annualMileageKm ?? null;
}

// 고른 값이 미지원이면 폴백값을 반환(호출부가 이동 + 안내), 무변경이면 null.
// 전부 미지원(`[]`)은 옮길 곳이 없으므로 무변경 — UI는 전량 비활성이 되고 조회는 어차피
// 파트너 미취급으로 막힌다(값을 바꿔봐야 그것도 미지원).
export function resolveGateFallback(
  current: number,
  supported: number[] | null,
  fallback: number,
): number | null {
  if (supported === null || supported.length === 0) return null;
  if (supported.includes(current)) return null;
  return fallback;
}
