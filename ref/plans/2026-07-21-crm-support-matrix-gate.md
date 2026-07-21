# 미지원 기간·약정거리 UI 게이트 구현 계획

> spec = `ref/specs/2026-07-21-crm-support-matrix-gate-design.md` · 제프 회신 = `ref/2026-07-21-jeff-support-matrix-reply.md`

**Goal:** 견적 워크벤치에서 선택 금융사가 취급하지 않는 리스기간을 비활성화하고 약정거리를 목록에서 제거한다.

**Architecture:** 제프 `support-matrix` API를 CRM 서버가 릴레이(기존 `dealers` 릴레이 미러) → 클라가 세션 캐시로 1회 조회 → 순수 판정 함수가 `(금융사 라벨, 상품)`으로 지원집합을 돌려주고, 워크벤치가 그걸로 세그먼트/셀렉트를 게이트한다. 전 실패 경로 fail-open.

**Tech Stack:** Hono(릴레이) · React 훅 + 세션 캐시(`staff.ts` 패턴) · vitest/bun:test

**⚠️ 제프 API는 아직 미배포.** 구현·테스트는 목 데이터로 완결하고, 실 API 스모크는 제프 머지 후 별도 1회.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/routes/solution.ts` (수정) | `GET /support-matrix` 릴레이 추가 — dealers 릴레이 미러 |
| `src/routes/solution.test.ts` (수정) | 릴레이 테스트 |
| `client/src/lib/support-matrix.ts` (신규) | 조회·세션 캐시·방어 파싱·순수 판정 3함수 |
| `client/src/lib/support-matrix.test.ts` (신규) | 위 전량 |
| `client/src/components/quote-fields/QuoteFields.tsx` (수정) | `SegmentOption.disabled` additive |
| `client/src/components/quote-fields/QuoteFields.test.tsx` (수정) | additive 회귀 |
| `client/src/lib/solution-quote.ts` (수정) | `solutionMileageOf` export |
| `useQuoteWorkbench.ts` (수정) | `lenderByCard` state + 폴백 |
| `QuoteWorkbench.tsx` (수정) | 게이트 렌더 |
| `.../hooks/useQuoteWorkbench.gate.test.tsx` (신규) | 게이트·폴백 |

---

## Task 1: 서버 릴레이

**Files:** Modify `src/routes/solution.ts` · Test `src/routes/solution.test.ts`

- [ ] **Step 1: 기존 dealers 릴레이 테스트를 읽고 형식 파악**

Run: `grep -n "describe\|it(" src/routes/solution.test.ts | head -30`
목적: `solutionDeps.fetchImpl` 목 주입 방식과 app 요청 헬퍼를 그대로 쓴다.

- [ ] **Step 2: 실패 테스트 작성** (`src/routes/solution.test.ts` 끝에 추가)

케이스 5종 — dealers 테스트와 같은 목 패턴:
1. 200 패스스루: 업스트림 `{ok:true, matrix:[...]}` → 그대로 반환, `X-API-Key` 헤더 동봉
2. `PARTNER_QUOTE_API_URL` 미설정 → 503
3. 업스트림 401 → 503 (`AUTH_FAILED` 로그)
4. 업스트림 500 → 502
5. AbortError → 504

- [ ] **Step 3: 실패 확인**

Run: `bun run test:server src/routes/solution.test.ts`
Expected: FAIL — 404 (라우트 없음)

- [ ] **Step 4: 릴레이 구현** — `src/routes/solution.ts`의 `/dealers` 핸들러 **바로 아래**에 추가

```ts
// ── 지원집합(리스기간·약정거리) 매트릭스 릴레이 — 제프 external
// `GET /api/external/quotes/support-matrix`(계약 확정 2026-07-21, 회신 문서 참조).
// 업스트림 200 {ok:true, matrix:[{lenderCode, productType, leaseTermMonths, annualMileageKm}]}.
// null=미확정 / []=전부 미지원 구분은 해석하지 않고 그대로 패스스루한다(클라 판정 SSOT).
// env·인증·타임아웃·에러 매핑은 dealers 릴레이와 동일 계약(미러). 쿼리 파라미터 없음.
solution.get("/support-matrix", async (c) => {
  const env = (c.env ?? {}) as { PARTNER_QUOTE_API_URL?: string; PARTNER_QUOTE_API_KEY?: string };
  const url = env.PARTNER_QUOTE_API_URL ?? process.env.PARTNER_QUOTE_API_URL;
  const apiKey = env.PARTNER_QUOTE_API_KEY ?? process.env.PARTNER_QUOTE_API_KEY;
  if (!url) return c.json({ error: "솔루션 연결이 설정되지 않았습니다(PARTNER_QUOTE_API_URL 미설정)" }, 503);

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    console.error(`[solution] support-matrix PARTNER_QUOTE_API_URL 파싱 실패 — origin 파생 불가`);
    return c.json({ error: "솔루션 연결 설정이 올바르지 않습니다(PARTNER_QUOTE_API_URL 확인)" }, 503);
  }
  const upstreamUrl = `${origin}/api/external/quotes/support-matrix`;

  const requestId = `crm-${crypto.randomUUID()}`;
  const headers: Record<string, string> = { "X-Request-ID": requestId };
  if (apiKey) headers["X-API-Key"] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), solutionDeps.timeoutMs);
  const startedAt = Date.now();
  // ⚠️ 지역 변수 plain call — Workers Illegal invocation 가드(PR #202).
  const fetchImpl = solutionDeps.fetchImpl;
  try {
    const upstream = await fetchImpl(upstreamUrl, { headers, signal: controller.signal });
    let body: unknown = null;
    let bodyUnparsable = false;
    try {
      body = await upstream.json();
    } catch {
      if (controller.signal.aborted) {
        console.error(`[solution] support-matrix TIMEOUT(body-read) status=${upstream.status} request_id=${requestId}`);
        return c.json({ error: "계산 서버가 응답하지 않습니다(시간 초과)" }, 504);
      }
      bodyUnparsable = true;
    }
    console.log(`[solution] support-matrix status=${upstream.status} ${Date.now() - startedAt}ms request_id=${requestId}`);
    if (upstream.status === 401 || upstream.status === 403) {
      console.error(`[solution] AUTH_FAILED(${upstream.status}) request_id=${requestId} — PARTNER_QUOTE_API_KEY 확인 필요`);
      return c.json({ error: "솔루션 연결 인증이 실패했습니다(운영 설정 확인)" }, 503);
    }
    if (!upstream.ok) {
      const msg = (body as { error?: unknown } | null)?.error;
      const status = upstream.status >= 500 ? 502 : 400;
      return c.json({ error: typeof msg === "string" ? msg : "지원집합 조회에 실패했습니다" }, status);
    }
    if (bodyUnparsable || body === null) return c.json({ error: "계산 서버 응답을 해석하지 못했습니다" }, 502);
    return c.json(body as Record<string, unknown>);
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error(`[solution] support-matrix ${aborted ? "TIMEOUT" : "NETWORK_FAIL"} request_id=${requestId}`, e);
    if (aborted) return c.json({ error: "계산 서버가 응답하지 않습니다(시간 초과)" }, 504);
    return c.json({ error: "계산 서버에 연결하지 못했습니다" }, 502);
  } finally {
    clearTimeout(timer);
  }
});
```

- [ ] **Step 5: 통과 확인**

Run: `bun run test:server src/routes/solution.test.ts`
Expected: PASS (신규 5건 포함)

- [ ] **Step 6: 커밋**

```bash
git add src/routes/solution.ts src/routes/solution.test.ts
git commit -m "feat(crm): 지원집합 매트릭스 릴레이 — GET /api/solution/support-matrix (dealers 미러)"
```

---

## Task 2: 클라 조회·캐시·판정 lib

**Files:** Create `client/src/lib/support-matrix.ts` · Test `client/src/lib/support-matrix.test.ts` · Modify `client/src/lib/solution-quote.ts`

- [ ] **Step 1: `solutionMileageOf` export** — `client/src/lib/solution-quote.ts:49`

```ts
// export — 게이트(support-matrix.ts)가 표시 문자열 ↔ km 왕복에 쓴다(손 복제 금지).
export function solutionMileageOf(mileageValue: string): number | null {
```

- [ ] **Step 2: 실패 테스트 작성** (`client/src/lib/support-matrix.test.ts` 신규)

```ts
import { describe, expect, it } from "vitest";

import {
  parseSupportMatrix,
  resolveGateFallback,
  supportedMileagesFor,
  supportedTermsFor,
  type SupportMatrix,
} from "./support-matrix";

const RAW = {
  ok: true,
  matrix: [
    { lenderCode: "mg-capital", productType: "operating_lease", leaseTermMonths: [36, 48, 60], annualMileageKm: [10000, 20000, 30000] },
    { lenderCode: "bnk-capital", productType: "operating_lease", leaseTermMonths: [12, 24, 36, 48, 60], annualMileageKm: [10000, 15000, 20000, 30000, 40000] },
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

  it("null은 미확정으로 보존한다 — []와 의미가 정반대", () => {
    const m = parseSupportMatrix(RAW);
    expect(m.get("kdbc-capital::operating_lease")).toEqual({ leaseTermMonths: null, annualMileageKm: null });
  });

  it("배열도 null도 아닌 값·숫자 아닌 원소는 미확정으로 강등한다(파트너 드리프트 fail-open)", () => {
    const m = parseSupportMatrix({
      matrix: [{ lenderCode: "mg-capital", productType: "operating_lease", leaseTermMonths: "36,48", annualMileageKm: [10000, "20000"] }],
    });
    expect(m.get("mg-capital::operating_lease")).toEqual({ leaseTermMonths: null, annualMileageKm: null });
  });

  it("matrix가 없거나 배열이 아니면 빈 Map", () => {
    expect(parseSupportMatrix({}).size).toBe(0);
    expect(parseSupportMatrix(null).size).toBe(0);
    expect(parseSupportMatrix({ matrix: "x" }).size).toBe(0);
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
  });

  it("어휘 밖 라벨(수기 전용·구 어휘 저장값)은 null — 게이트 없음", () => {
    expect(supportedTermsFor(m, "미선택", "operating_lease")).toBeNull();
    expect(supportedTermsFor(m, "옛날캐피탈", "operating_lease")).toBeNull();
  });

  it("매트릭스에 행이 없으면 null — fail-open", () => {
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
  });

  it("미확정(null)이면 무변경 — 게이트 없음", () => {
    expect(resolveGateFallback(24, null, 60)).toBeNull();
  });

  it("전부 미지원([])이면 무변경 — 옮길 곳이 없다", () => {
    expect(resolveGateFallback(24, [], 60)).toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `bun run test:unit client/src/lib/support-matrix.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현** (`client/src/lib/support-matrix.ts` 신규)

```ts
import { useEffect, useState } from "react";

import { getJson } from "./http";
import { SOLUTION_LENDERS, type SolutionProductType } from "./solution-quote";

// 제프 지원집합 매트릭스(GET /api/solution/support-matrix 릴레이 — 계약 확정 2026-07-21).
// ⚠️ null = 미확정(제프 게이트 미착수) / [] = 전부 미지원. 의미가 정반대다 — "빈 배열로 통일"하는
// 리팩터 금지(테스트가 고정한다). 게이트는 UX 개선이고 정합성 방어선이 아니므로(방어선 = 제프
// 엔진의 미취급 throw) 조회 실패·드리프트·미확정 전부 fail-open(게이트 해제)으로 수렴시킨다.
export type LenderSupport = { leaseTermMonths: number[] | null; annualMileageKm: number[] | null };
export type SupportMatrix = Map<string, LenderSupport>;

const keyOf = (lenderCode: string, productType: string): string => `${lenderCode}::${productType}`;

// 배열이 아니거나 숫자 아닌 원소가 섞이면 미확정으로 강등 — 파트너 스키마 드리프트가 게이트를
// 잘못 켜는 것(정상 조합을 막음)보다 안 켜는 게 안전하다.
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

// 세션 캐시 + inflight dedupe(staff.ts 선례). TTL 없음 — 매트릭스는 워크북 갱신 주기(월 단위)로만
// 바뀌고 새로고침이 갱신 트리거다. 실패는 캐시하지 않는다(재진입이 재시도).
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
      return new Map<string, LenderSupport>();
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

// 컴포넌트용: 마운트 시 1회 로드. 실패는 빈 Map(전 호출부 fail-open)이라 에러 상태가 없다.
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

// 화면은 금융사 "라벨"을 쥐고 있다(select 값). 어휘 밖 라벨(CRM 수기 전용·구 어휘 저장값·"미선택")은
// 파트너 대상이 아니므로 null = 게이트 없음.
function supportOf(matrix: SupportMatrix, lenderLabel: string, productType: SolutionProductType): LenderSupport | null {
  const lender = SOLUTION_LENDERS.find((l) => l.label === lenderLabel);
  if (!lender) return null;
  return matrix.get(keyOf(lender.code, productType)) ?? null;
}

export function supportedTermsFor(matrix: SupportMatrix, lenderLabel: string, productType: SolutionProductType): number[] | null {
  return supportOf(matrix, lenderLabel, productType)?.leaseTermMonths ?? null;
}

export function supportedMileagesFor(matrix: SupportMatrix, lenderLabel: string, productType: SolutionProductType): number[] | null {
  return supportOf(matrix, lenderLabel, productType)?.annualMileageKm ?? null;
}

// 고른 값이 미지원이면 폴백값을 반환(호출부가 이동 + 안내), 무변경이면 null.
// 전부 미지원([])은 옮길 곳이 없으므로 무변경 — UI는 전량 비활성이 되고 조회는 어차피 미취급으로 막힌다.
export function resolveGateFallback(current: number, supported: number[] | null, fallback: number): number | null {
  if (supported === null || supported.length === 0) return null;
  if (supported.includes(current)) return null;
  return fallback;
}
```

- [ ] **Step 5: 통과 확인**

Run: `bun run test:unit client/src/lib/support-matrix.test.ts`
Expected: PASS (13건)

- [ ] **Step 6: 커밋**

```bash
git add client/src/lib/support-matrix.ts client/src/lib/support-matrix.test.ts client/src/lib/solution-quote.ts
git commit -m "feat(crm): 지원집합 조회·세션 캐시·순수 판정 lib (fail-open 수렴)"
```

---

## Task 3: SegmentGroup 옵션별 disabled (additive)

**Files:** Modify `client/src/components/quote-fields/QuoteFields.tsx:19,43` · Test `client/src/components/quote-fields/QuoteFields.test.tsx`

- [ ] **Step 1: 실패 테스트 작성** — `QuoteFields.test.tsx`의 `describe("SegmentGroup")` 안에 추가

```ts
  it("option.disabled를 안 넘기면 disabled 속성이 붙지 않는다 — 공유 프리미티브 기존 호출부 무변경", () => {
    render(<SegmentGroup value={60} options={[{ value: 12, label: "12개월" }, { value: 60, label: "60개월" }]} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "12개월" })).not.toBeDisabled();
  });

  it("option.disabled=true면 그 버튼만 비활성 — 그룹 disabled와 독립", () => {
    render(
      <SegmentGroup
        value={60}
        options={[{ value: 12, label: "12개월", disabled: true }, { value: 60, label: "60개월" }]}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "12개월" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "60개월" })).not.toBeDisabled();
  });
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/components/quote-fields/QuoteFields.test.tsx`
Expected: FAIL — 2번째 케이스에서 "12개월" 버튼이 비활성이 아님 (타입 에러도 발생)

- [ ] **Step 3: 구현** — `QuoteFields.tsx`

```ts
// :19 — 옵션별 disabled는 additive(미전달 = 종전과 동일). 워크벤치·계산기 공유 프리미티브라
// 기존 호출부 DOM 무변경이 계약(#265 워크벤치 DOM 기준). 지원집합 게이트가 이 필드를 쓴다.
export type SegmentOption<T extends string | number> = { value: T; label: string; disabled?: boolean };
```

```tsx
// :43
          disabled={disabled || option.disabled}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/components/quote-fields/QuoteFields.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/quote-fields/QuoteFields.tsx client/src/components/quote-fields/QuoteFields.test.tsx
git commit -m "feat(crm): SegmentGroup 옵션별 disabled — additive(기존 호출부 DOM 무변경)"
```

---

## Task 4: 워크벤치 배선

**Files:** Modify `useQuoteWorkbench.ts` · Modify `QuoteWorkbench.tsx` · Test `.../hooks/useQuoteWorkbench.gate.test.tsx` (신규)

- [ ] **Step 1: 게이트 상수 추가** — `quote-workbench-meta.ts` 끝

```ts
// 지원집합 게이트 폴백 — 20,000km·60개월은 파트너 5사 전부 지원(2026-07-21 실측)이라
// 어느 금융사로 바꿔도 성립한다. 이 전제가 깨지면 폴백이 다시 미지원으로 튄다.
export const GATE_FALLBACK_TERM_MONTHS = 60;
export const GATE_FALLBACK_MILEAGE_KM = 20000;
```

- [ ] **Step 2: `lenderByCard` state + 폴백** — `useQuoteWorkbench.ts`

`dealerOptionsByCard` 선언(:139) 아래에 추가:

```ts
  // 카드별 현재 선택 금융사 라벨 — 지원집합 게이트 렌더용. 금융사 "값"의 진실은 계속 카드 DOM
  // select(uncontrolled 계약 유지)이고, 이건 렌더 파생을 위한 거울이다. 갱신은 딜러와 같은
  // 생명주기(syncDealerOnLenderChange·복사·초기화·수정 진입)를 탄다.
  const [lenderByCard, setLenderByCard] = useState<Record<string, string>>({});
```

`supportMatrix` 획득 — 훅 상단(다른 훅 호출부 근처):

```ts
  const supportMatrix = useSupportMatrix();
```

`syncDealerOnLenderChange`(:781) 본문에 2줄 추가:

```ts
  function syncDealerOnLenderChange(target: EventTarget | null) {
    if (!(target instanceof HTMLSelectElement) || target.dataset.scField !== "lender") return;
    const cardEl = target.closest<HTMLElement>("[data-scenario-card]");
    const condId = cardEl?.dataset.scenarioCard;
    if (!cardEl || !condId) return;
    setLenderByCard((prev) => ({ ...prev, [condId]: target.value }));
    applyGateFallback(condId, target.value);
    resetCardDealer(cardEl, condId);
    void loadCardDealers(condId, target.value);
  }

  // 금융사 변경으로 현재 기간·약정거리가 미지원이 되면 폴백값으로 옮기고 1회 안내한다.
  // ⚠️ 폴백은 이 경로(금융사 변경)에서만 — 마운트·수정 진입에서 돌리면 사용자가 열자마자
  // 저장값이 바뀐다(spec §4.4 폴백 시점). 과거 견적의 미지원 조합은 그대로 보여야 정직하다.
  function applyGateFallback(condId: string, lenderLabel: string) {
    const product = solutionProductTypeOf(solutionWorkbenchPurchaseMethod);
    if (!product) return;
    const ui = cardUi[condId] ?? DEFAULT_CARD_UI;
    const moved: string[] = [];

    const nextTerm = resolveGateFallback(ui.termMonths, supportedTermsFor(supportMatrix, lenderLabel, product), GATE_FALLBACK_TERM_MONTHS);
    if (nextTerm !== null) {
      setManualTermMonthsFor(condId, nextTerm);
      moved.push(`기간 ${nextTerm}개월`);
    }

    const currentKm = solutionMileageOf(ui.mileageValue);
    if (currentKm !== null) {
      const nextKm = resolveGateFallback(currentKm, supportedMileagesFor(supportMatrix, lenderLabel, product), GATE_FALLBACK_MILEAGE_KM);
      const nextLabel = nextKm === null ? null : manualMileageOptions.find((o) => solutionMileageOf(o) === nextKm);
      if (nextLabel) {
        setManualMileageValue(condId, nextLabel);
        moved.push(`약정거리 ${nextLabel}`);
      }
    }

    if (moved.length > 0) onToast(`${lenderLabel} 미취급 조건이라 ${moved.join(" · ")}(으)로 변경했습니다`);
  }
```

반환 객체에 `lenderByCard`·`supportMatrix` 추가(`dealerOptionsByCard` 옆, :1619 근처).

`clearCardUiState`(:607)에 1줄:

```ts
    setLenderByCard({}); // 게이트 거울도 카드 종속 — 이전 견적 금융사 잔존 방지
```

조건 복사(`copyManualQuoteCondition` :444 근처, `setDealerOptionsByCard` 옆):

```ts
      setLenderByCard((prev) => (prev[sourceId] ? { ...prev, [targetId]: prev[sourceId] } : prev));
```

- [ ] **Step 3: 게이트 렌더** — `QuoteWorkbench.tsx`

import 추가:

```ts
import { supportedMileagesFor, supportedTermsFor } from "@/lib/support-matrix";
import { solutionMileageOf, solutionProductTypeOf } from "@/lib/solution-quote";
```

카드 렌더 안(`const dealerList = ...` :461 근처)에 파생 추가:

```tsx
                    // 지원집합 게이트(spec §4.4). 저장된 카드는 제외 — 편집 불가라 게이트 목적이 없고,
                    // option을 지우면 저장된 값이 목록에서 사라져 표시가 빈칸으로 깨진다.
                    const gateProduct = isConditionSaved ? null : solutionProductTypeOf(solutionWorkbenchPurchaseMethod);
                    const gateLender = lenderByCard[condition.id] ?? condition.lender;
                    const gateTerms = gateProduct ? supportedTermsFor(supportMatrix, gateLender, gateProduct) : null;
                    const gateMileages = gateProduct ? supportedMileagesFor(supportMatrix, gateLender, gateProduct) : null;
                    const termOptions = gateTerms === null
                      ? leaseTermSegmentOptions
                      : leaseTermSegmentOptions.map((o) => ({ ...o, disabled: !gateTerms.includes(o.value) }));
                    // 현재 선택값은 항상 살린다 — 폴백이 금융사 변경에서만 돌아, 수정 진입 시
                    // 과거 미지원 값이 목록에서 사라지면 표시가 깨진다.
                    const mileageOptions = gateMileages === null
                      ? manualMileageOptions
                      : manualMileageOptions.filter((o) => {
                          if (o === mileageValue) return true;
                          const km = solutionMileageOf(o);
                          return km !== null && gateMileages.includes(km);
                        });
```

기간 행(:488) `options` 교체:

```tsx
<SegmentGroup wide value={ui.termMonths} options={termOptions} disabled={isConditionSaved} onSelect={(m) => setManualTermMonthsFor(condition.id, m)} />
```

약정거리 행(:493) 목록 교체:

```tsx
{mileageOptions.map((option) => <option key={option}>{option}</option>)}
```

- [ ] **Step 4: 테스트 작성** (`.../hooks/useQuoteWorkbench.gate.test.tsx` 신규)

`SolutionLenderRankingModal.test.tsx`의 렌더 하네스를 참고해 워크벤치를 목 매트릭스와 함께 렌더한다. `@/lib/support-matrix`의 `useSupportMatrix`를 `vi.mock`으로 대체해 MG 매트릭스를 주입한다.

케이스 4종:
1. MG 선택 → 12·24개월 버튼 `disabled`, 36·48·60은 활성
2. MG 선택 → 약정거리 option이 10/20/30 3개만 (15·25·35·40 제거)
3. 미확정 금융사(산은) 선택 → 기간 5개 전부 활성·거리 7개 전부 (fail-open)
4. 24개월 선택 상태 + MG로 변경 → 60개월로 이동 + 토스트 1회

- [ ] **Step 5: 실행**

Run: `bun run test:unit client/src/components/customer-detail/hooks/useQuoteWorkbench.gate.test.tsx`
Expected: 먼저 FAIL(게이트 미배선 상태 확인) → 배선 후 PASS

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/customer-detail/ client/src/components/quote-fields/
git commit -m "feat(crm): 워크벤치 지원집합 게이트 — 기간 disabled·약정거리 필터·금융사 변경 폴백"
```

---

## Task 5: 통합 검증 + PR

- [ ] **Step 1: 검증 4종**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun run build
```
Expected: typecheck 0 · lint 0 problems · unit 전량 PASS · build 성공

- [ ] **Step 2: 서버 테스트**

Run: `bun run test:server`
Expected: PASS · 잔재 0 (fixture-residue tripwire)

- [ ] **Step 3: knip 드리프트 확인**

Run: `bun run knip`
Expected: unused export 7 / type 9 기준선 유지. 신규 export(`resetSupportMatrixCache` 등)가 잡히면 테스트에서 실제 사용 중인지 확인.

- [ ] **Step 4: 목 응답 브라우저 스모크**

제프 API 미배포이므로 실 API 스모크는 불가. 대신:
- **fail-open 경로**: 릴레이가 502/503을 반환하는 현 상태에서 워크벤치를 열어 **기간 5개·거리 7개가 전부 노출**되는지 확인(= 현행과 동일, 회귀 0).
- 게이트 경로는 Task 4 유닛이 커버.

- [ ] **Step 5: PR 생성**

```bash
git push -u origin feat/crm-support-matrix-gate
gh pr create --title "feat(crm): 미지원 기간·약정거리 워크벤치 UI 게이트" --body "..."
```

PR 본문에 반드시 포함:
- **제프 API 미배포 상태** — 머지해도 fail-open이라 현행과 동일하게 동작하고, 제프 배포 시 코드 변경 0으로 켜진다
- 기간 게이트가 실제로 걸리는 건 **MG 하나뿐**(기대치 오해 방지)
- 🟡 행위 변경: 금융사 변경 시 미지원 조건 자동 폴백 + 토스트

---

## Self-Review 결과

- **spec 커버리지**: §2 계약(Task 1·2) / §3 D1~D6(Task 2·4) / §4.1 릴레이(T1) / §4.2 캐시(T2) / §4.3 판정(T2) / §4.4 배선·프리미티브·폴백 시점(T3·T4) / §5 테스트(각 Task) — 누락 없음.
- **타입 일관성**: `SupportMatrix`·`LenderSupport`·`solutionMileageOf`·`GATE_FALLBACK_*`가 Task 2→4에서 같은 이름으로 쓰인다.
- **미결 1건(실행 중 확정)**: Task 4 Step 4의 워크벤치 렌더 하네스는 기존 테스트 파일 형식을 읽고 맞춘다 — 워크벤치 전체 렌더가 무거우면 `applyGateFallback`·옵션 파생을 순수 함수로 뽑아 그 단위로 테스트한다(게이트 판정 로직은 이미 Task 2에서 순수하게 커버됨).
