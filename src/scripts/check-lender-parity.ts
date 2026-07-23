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
// 축 3개: 추가·삭제·**개명**. 개명 축은 제프가 `lenderName`을 실어 주면서 열렸다(회신
// `ref/2026-07-23-jeff-lender-name-reply.md`). ⚠️ 그 필드가 없는 응답(배포 전·구 캐시)에서는
// 개명 축만 조용히 건너뛴다 — 판정 보류를 출력으로 알린다(오탐 대신 침묵을 명시).
//
// CI에는 넣지 않는다 — CI는 파트너 네트워크·시크릿이 없다(env 없이 도는 게 CI 설계 전제).
// 런타임 그물은 별도로 있다: 워크벤치가 매트릭스를 받을 때 `fetchSupportMatrix`가 1회 경고한다.
import { detectLenderDrift, extractPartnerLenders, hasLenderDrift, SOLUTION_LENDERS } from "../../client/src/lib/solution-quote";

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
// 추출·판정은 순수 모듈 한 벌을 런타임 경고와 공유한다(손 복제 금지 — 두 소비처가 갈라지면 무의미).
const partnerLenders = extractPartnerLenders(raw);
if (partnerLenders.length === 0) {
  console.error("[lenders] 응답에 lenderCode가 하나도 없습니다 — 파트너 계약 변경 가능성.");
  process.exit(2);
}
// `lenderName`은 2026-07-23 추가분 — 아직 안 실려 오면 개명 축은 판정 자체를 건너뛴다(오탐 방지).
const named = partnerLenders.filter((l) => l.name !== null).length;

const drift = detectLenderDrift(partnerLenders);
if (!hasLenderDrift(drift)) {
  console.log(`[lenders] 금융사 SSOT 일치 ✅ (파트너 ${partnerLenders.length}사 = SOLUTION_LENDERS ${SOLUTION_LENDERS.length}사)`);
  console.log(
    named === partnerLenders.length
      ? `[lenders] 표시명도 전량 일치 ✅ (lenderName ${named}건)`
      : `[lenders] ⓘ 표시명 판정 보류 — lenderName 미탑재 ${partnerLenders.length - named}건(파트너 배포 전이면 정상)`,
  );
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
if (drift.renamed.length > 0) {
  console.error(`  표시명 변경 (계산은 정상 — 화면 표기만 낡음):`);
  for (const r of drift.renamed) console.error(`    ${r.code}: CRM "${r.crm}"  →  파트너 "${r.partner}"`);
  console.error(`    → SOLUTION_LENDERS의 label을 파트너 값으로 갱신. code는 그대로라 계산·딜러·지원집합은 무영향.`);
  console.error(`       ⚠️ label은 저장 견적(crm.quotes.scenarios[].lender)에 박히는 값이라 과거 견적은 구 표기로 남는다`);
  console.error(`          — 그 표시는 "구 어휘 표시 유지" option이 담당하므로 화면은 안 깨진다(소급 갱신 불필요).`);
}
console.error("");
process.exit(1);
