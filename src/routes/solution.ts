// 파트너(financial-dolim-solution) 견적 계산 API 인증 릴레이 — 스펙 §구성 2.
// 매핑·조립은 클라(client/src/lib/solution-quote.ts)의 몫(B안 구조) — 여기는 zod 게이트 + 키/추적
// 헤더 부착 + 타임아웃만 담당하는 얇은 릴레이다. 서버 계약은 파트너 계약과 1:1.
import { Hono } from "hono";
import { z } from "zod";

import {
  SOLUTION_LEASE_TERMS,
  SOLUTION_LENDERS,
  SOLUTION_MILEAGES,
  type SolutionQuoteInput,
} from "../../client/src/lib/solution-quote";

// 어휘(금융사·기간·약정거리)는 클라 SSOT(client/src/lib/solution-quote.ts)에서 파생 — 손 복제로 인한
// 드리프트 방지. 스키마 출력 ↔ 클라 타입 정합은 아래 컴파일 타임 파리티 체크가 잠근다.
const LENDER_CODES = SOLUTION_LENDERS.map((l) => l.code);

// 파트너 계약 서브셋 검증(CanonicalQuoteInput 중 CRM이 실제로 보내는 필드).
const solutionCalcBody = z.object({
  lenderCode: z.enum(LENDER_CODES),
  productType: z.enum(["operating_lease", "long_term_rental"]),
  brand: z.string().min(1),
  modelName: z.string().min(1),
  masterMcCode: z.string().min(1),
  ownershipType: z.literal("company"),
  leaseTermMonths: z.literal(SOLUTION_LEASE_TERMS),
  annualMileageKm: z.literal(SOLUTION_MILEAGES),
  depositAmount: z.number().int().min(0),
  upfrontPayment: z.number().int().min(0),
  quotedVehiclePrice: z.number().int().min(1),
  discountAmount: z.number().int().min(0).optional(),
  evSubsidyAmount: z.number().int().min(0).optional(),
  residualMode: z.enum(["high", "standard"]).optional(),
  residualValueRatio: z.number().min(0).max(1).optional(),
  residualAmountOverride: z.number().int().min(0).optional(),
});

// 컴파일 타임 파리티: zod 스키마 출력이 클라 SolutionQuoteInput에 할당 가능해야 한다 — 서버 게이트가
// 클라 계약에 없는 값을 통과시키는 드리프트를 typecheck가 잡는다(역방향은 클라 타입이 number로 넓어 비대상).
const _parityCheck: SolutionQuoteInput = {} as z.infer<typeof solutionCalcBody>;
void _parityCheck;

const TIMEOUT_MS = 8000; // 앱 partner_quote.ts 미러(스펙 §파트너 계약)

// 테스트 주입 seam(embedOnWriteDeps·pushNotifyDeps와 동일 패턴 — mock.module 대신 전역 누출 없는 필드 교체).
// timeoutMs는 바디 스톨(헤더 도착 후 바디 정지 → 504) 분기를 테스트에서 즉시 발화시키기 위한 seam(기본값 불변).
export const solutionDeps = { fetchImpl: fetch, timeoutMs: TIMEOUT_MS };

export const solution = new Hono();

solution.post("/calculate", async (c) => {
  const env = (c.env ?? {}) as { PARTNER_QUOTE_API_URL?: string; PARTNER_QUOTE_API_KEY?: string };
  const url = env.PARTNER_QUOTE_API_URL ?? process.env.PARTNER_QUOTE_API_URL;
  const apiKey = env.PARTNER_QUOTE_API_KEY ?? process.env.PARTNER_QUOTE_API_KEY;
  if (!url) return c.json({ error: "솔루션 연결이 설정되지 않았습니다(PARTNER_QUOTE_API_URL 미설정)" }, 503);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "요청 본문이 JSON이 아닙니다" }, 400);
  }
  const parsed = solutionCalcBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "계산 입력이 유효하지 않습니다" }, 400);

  const requestId = `crm-${crypto.randomUUID()}`;
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Request-ID": requestId };
  if (apiKey) headers["X-API-Key"] = apiKey; // 미설정 = 개발 무인증 단계(external 전환 시 필수)

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), solutionDeps.timeoutMs);
  const startedAt = Date.now();
  // ⚠️ 반드시 지역 변수로 뽑아 plain call. `solutionDeps.fetchImpl(...)`는 메서드 호출이라 this=solutionDeps가
  // 되고, CF Workers의 global fetch는 this가 globalThis/undefined가 아니면 Illegal invocation으로 죽는다
  // (배정 알림 두 달 무발송 사고, PR #202 — push-notify.ts:45 동일 패턴).
  const fetchImpl = solutionDeps.fetchImpl;
  try {
    const upstream = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.data),
      signal: controller.signal,
    });
    // 바디 읽기 실패를 분리 처리 — .catch(() => null)로 뭉개면 ①바디 스트리밍 중 타임아웃(헤더는 8초 안에
    // 도착, 바디 정지)의 AbortError가 바깥 catch의 504에 못 닿고 ②non-JSON 200(프록시 HTML 등)이
    // HTTP 200 성공으로 둔갑한다.
    let body: unknown = null;
    let bodyUnparsable = false;
    try {
      body = await upstream.json();
    } catch {
      if (controller.signal.aborted) {
        console.error(`[solution] calculate TIMEOUT(body-read) status=${upstream.status} request_id=${requestId}`);
        return c.json({ error: "계산 서버가 응답하지 않습니다(시간 초과)" }, 504);
      }
      bodyUnparsable = true;
    }
    const ms = Date.now() - startedAt;
    console.log(
      `[solution] calculate lender=${parsed.data.lenderCode} product=${parsed.data.productType} status=${upstream.status} ${ms}ms request_id=${requestId}`,
    );
    // 401/403 = 파트너 키 오설정(운영 문제 — 호출자 입력 잘못 아님). 400 패스스루와 섞이면 "실패해도
    // 조용한" 부류가 된다 — tail에서 grep할 토큰을 남기고 503으로 구분(push-notify AUTH_FAILED 선례).
    if (upstream.status === 401 || upstream.status === 403) {
      console.error(`[solution] AUTH_FAILED(${upstream.status}) request_id=${requestId} — PARTNER_QUOTE_API_KEY 확인 필요`);
      return c.json({ error: "솔루션 연결 인증이 실패했습니다(운영 설정 확인)" }, 503);
    }
    if (!upstream.ok) {
      const msg = (body as { error?: unknown } | null)?.error;
      // 파트너 4xx(미취급 차종 등)는 사유 그대로 400 패스스루, 5xx는 502(호출자 잘못 아님).
      const status = upstream.status >= 500 ? 502 : 400;
      return c.json({ error: typeof msg === "string" ? msg : "계산에 실패했습니다" }, status);
    }
    // 200인데 바디가 JSON이 아니거나 비어 있으면 성공으로 둔갑시키지 않는다(클라 파서가 raw를 신뢰하는 전제).
    if (bodyUnparsable || body === null) return c.json({ error: "계산 서버 응답을 해석하지 못했습니다" }, 502);
    return c.json(body as Record<string, unknown>);
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error(`[solution] calculate ${aborted ? "TIMEOUT" : "NETWORK_FAIL"} request_id=${requestId}`, e);
    if (aborted) return c.json({ error: "계산 서버가 응답하지 않습니다(시간 초과)" }, 504);
    return c.json({ error: "계산 서버에 연결하지 못했습니다" }, 502);
  } finally {
    clearTimeout(timer);
  }
});
