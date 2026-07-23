// 금융사 SSOT parity 검사 (2026-07-23).
//
//   bun run check:lenders     어긋나면 목록 출력 후 exit 1
//
// `client/src/lib/solution-quote.ts`의 `SOLUTION_LENDERS`는 파트너(제프) 금융사 목록의
// **하드코딩 미러**다(그렇게 두는 이유는 그 파일 주석 참조 — 컴파일타임 타입·저장 라벨 계약·
// CRM 상위집합·파트너 없이도 뜨는 드롭다운). 미러는 조용히 낡을 수 있어서 이 스크립트가 대조한다.
//
// 대조 원천 = 파트너 `GET /api/external/quotes/support-matrix`. 별도 lenders API를 요청하지 않은
// 이유는 이 응답이 **파라미터 없이 전량 반환**이고 행이 그쪽 lender SSOT를 그대로 싣기 때문이다
// (회신 `ref/2026-07-21-jeff-support-matrix-reply.md`).
//
// ⚠️ **code 드리프트만 잡는다** — 매트릭스에 한글 표시명(label)이 없어 개명은 못 잡는다.
// 개명은 표시만 낡고 계산은 code 기준이라 안 깨진다. 요청문 = `ref/2026-07-23-jeff-lender-name-request.md`.
//
// CI에는 넣지 않는다 — CI는 파트너 네트워크·시크릿이 없다(env 없이 도는 게 CI 설계 전제).
// 런타임 그물은 별도로 있다: 워크벤치가 매트릭스를 받을 때 `fetchSupportMatrix`가 1회 경고한다.
import { detectLenderDrift, hasLenderDrift, SOLUTION_LENDERS } from "../../client/src/lib/solution-quote";

const url = process.env.PARTNER_QUOTE_API_URL;
const apiKey = process.env.PARTNER_QUOTE_API_KEY;
if (!url) {
  console.error("[lenders] PARTNER_QUOTE_API_URL 미설정 — .env.local을 확인하세요.");
  process.exit(2);
}

// calculate 전체 URL에서 origin 파생(서버 릴레이 src/routes/solution.ts와 동일 관례).
let origin: string;
try {
  origin = new URL(url).origin;
} catch {
  console.error(`[lenders] PARTNER_QUOTE_API_URL 파싱 실패 — origin 파생 불가: ${url}`);
  process.exit(2);
}

const headers: Record<string, string> = { "X-Request-ID": `crm-lenders-${crypto.randomUUID()}` };
if (apiKey) headers["X-API-Key"] = apiKey;

const upstreamUrl = `${origin}/api/external/quotes/support-matrix`;
const res = await fetch(upstreamUrl, { headers });
if (!res.ok) {
  console.error(`[lenders] 파트너 조회 실패 ${res.status} — ${upstreamUrl}`);
  process.exit(2);
}

const raw: unknown = await res.json();
const rows = (raw as { matrix?: unknown } | null)?.matrix;
if (!Array.isArray(rows)) {
  console.error("[lenders] 응답에 matrix 배열이 없습니다 — 파트너 계약 변경 가능성.");
  process.exit(2);
}

// 행에서 금융사 코드만 뽑는다(중복 제거) — productType별로 여러 행이 온다.
const partnerCodes = [
  ...new Set(
    rows
      .map((row) => (typeof row === "object" && row !== null ? (row as Record<string, unknown>).lenderCode : null))
      .filter((code): code is string => typeof code === "string"),
  ),
];

if (partnerCodes.length === 0) {
  console.error("[lenders] 응답에 lenderCode가 하나도 없습니다 — 파트너 계약 변경 가능성.");
  process.exit(2);
}

const drift = detectLenderDrift(partnerCodes);
if (!hasLenderDrift(drift)) {
  console.log(`[lenders] 금융사 SSOT 일치 ✅ (파트너 ${partnerCodes.length}사 = SOLUTION_LENDERS ${SOLUTION_LENDERS.length}사)`);
  process.exit(0);
}

console.error("\n[lenders] ⚠️ 금융사 SSOT가 파트너와 어긋납니다\n");
if (drift.onlyPartner.length > 0) {
  console.error(`  파트너에만 있음 (CRM에서 선택 불가 = 기능 누락): ${drift.onlyPartner.join(", ")}`);
  console.error(`    → client/src/lib/solution-quote.ts의 SOLUTION_LENDERS에 { code, label } 추가(순서 = 파트너 표시 순서)`);
}
if (drift.onlyCrm.length > 0) {
  console.error(`  CRM에만 있음 (고를 수 있는데 계산이 거부됨): ${drift.onlyCrm.join(", ")}`);
  console.error(`    → 파트너가 실제로 뺐는지 먼저 확인. 뺐다면 SOLUTION_LENDERS에서 제거하되,`);
  console.error(`       그 금융사로 저장된 과거 견적은 "구 어휘 표시 유지" option이 계속 보여준다(표시는 안 깨짐).`);
}
console.error("");
process.exit(1);
