// 파트너(financial-dolim-solution) 견적 계산 API 인증 릴레이 — 스펙 §구성 2.
// 매핑·조립은 클라(client/src/lib/solution-quote.ts)의 몫(B안 구조) — 여기는 zod 게이트 + 키/추적
// 헤더 부착 + 타임아웃만 담당하는 얇은 릴레이다. 서버 계약은 파트너 계약과 1:1.
import { Hono } from "hono";
import { z } from "zod";

import { SOLUTION_LENDERS } from "../../client/src/lib/solution-quote";

// 금융사 어휘는 클라 SSOT(client/src/lib/solution-quote.ts)에서 파생 — 이중 유지로 인한 드리프트 방지.
const LENDER_CODES = SOLUTION_LENDERS.map((l) => l.code);

// 파트너 계약 서브셋 검증(CanonicalQuoteInput 중 CRM이 실제로 보내는 필드) — 타입은
// client/src/lib/solution-quote.ts의 SolutionQuoteInput과 값 일치(파리티는 Task 1 유닛이 잠금).
const solutionCalcBody = z.object({
  lenderCode: z.enum(LENDER_CODES),
  productType: z.enum(["operating_lease", "long_term_rental"]),
  brand: z.string().min(1),
  modelName: z.string().min(1),
  masterMcCode: z.string().min(1),
  ownershipType: z.literal("company"),
  leaseTermMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48), z.literal(60)]),
  annualMileageKm: z.union([
    z.literal(10000),
    z.literal(15000),
    z.literal(20000),
    z.literal(25000),
    z.literal(30000),
    z.literal(35000),
    z.literal(40000),
  ]),
  depositAmount: z.number().int().min(0),
  upfrontPayment: z.number().int().min(0),
  quotedVehiclePrice: z.number().int().min(1),
  discountAmount: z.number().int().min(0).optional(),
  evSubsidyAmount: z.number().int().min(0).optional(),
  residualMode: z.enum(["high", "standard"]).optional(),
  residualValueRatio: z.number().min(0).max(1).optional(),
  residualAmountOverride: z.number().int().min(0).optional(),
});

// 테스트 주입 seam(embedOnWriteDeps·pushNotifyDeps와 동일 패턴 — mock.module 대신 전역 누출 없는 필드 교체).
export const solutionDeps = { fetchImpl: fetch };

const TIMEOUT_MS = 8000; // 앱 partner_quote.ts 미러(스펙 §파트너 계약)

export const solution = new Hono();

solution.post("/calculate", async (c) => {
  const env = (c.env ?? {}) as { SOLUTION_QUOTE_API_URL?: string; SOLUTION_QUOTE_API_KEY?: string };
  const url = env.SOLUTION_QUOTE_API_URL ?? process.env.SOLUTION_QUOTE_API_URL;
  const apiKey = env.SOLUTION_QUOTE_API_KEY ?? process.env.SOLUTION_QUOTE_API_KEY;
  if (!url) return c.json({ error: "솔루션 연결이 설정되지 않았습니다(SOLUTION_QUOTE_API_URL 미설정)" }, 503);

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
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
    const body: unknown = await upstream.json().catch(() => null);
    const ms = Date.now() - startedAt;
    console.log(
      `[solution] calculate lender=${parsed.data.lenderCode} product=${parsed.data.productType} status=${upstream.status} ${ms}ms request_id=${requestId}`,
    );
    if (!upstream.ok) {
      const msg = (body as { error?: unknown } | null)?.error;
      // 파트너 4xx(미취급 차종 등)는 호출자 잘못이 아니므로 사유 그대로 400 패스스루, 5xx는 502.
      const status = upstream.status >= 500 ? 502 : 400;
      return c.json({ error: typeof msg === "string" ? msg : "계산에 실패했습니다" }, status);
    }
    return c.json((body ?? { error: "빈 응답" }) as Record<string, unknown>);
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error(`[solution] calculate ${aborted ? "TIMEOUT" : "NETWORK_FAIL"} request_id=${requestId}`, e);
    if (aborted) return c.json({ error: "계산 서버가 응답하지 않습니다(시간 초과)" }, 504);
    return c.json({ error: "계산 서버에 연결하지 못했습니다" }, 502);
  } finally {
    clearTimeout(timer);
  }
});
