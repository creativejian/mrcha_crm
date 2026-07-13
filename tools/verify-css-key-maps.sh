#!/bin/bash
# CSS 리팩토링(공용화·dead 제거)의 기계 검증 — #207 verify-dead-css.sh의 강화 일반판.
#
# 단순 byte-diff는 쓸 수 없다: 콤마 그룹으로 접으면 minifier 산출 블록 구성이 달라진다(계산값은 동일).
# 그래서 빌드 산출 CSS 전체를 "셀렉터 키 → 최종 선언 맵"으로 정규화해 전수 비교한다.
#   - 콤마 셀렉터는 키로 전개하고, 같은 키의 여러 블록은 문서 순서 last-wins로 접는다(= 동일 키 캐스케이드).
#   - at-rule(@media/@supports/@layer/@keyframes…)은 프리픽스로 합성해 문맥을 보존한다.
#   - baseline↔after의 키 집합 diff와 맵 변경 키가 **기대 목록과 정확히 일치**해야 통과.
#     (기대 밖 제거/추가/변경이 하나라도 있으면 실패 — "그 외 전부 불변"의 기계 증명)
#
# 한계(사용자가 확인할 것): 서로 다른 키가 같은 요소에 같은 특이도로 겹치는 경우의 "블록 순서"까지는
# 비교하지 않는다. 순서가 바뀌는 리팩토링이라면 겹치는 프로퍼티가 없음을 소스에서 별도 확인할 것.
#
# 사용법:
#   bash tools/verify-css-key-maps.sh baseline.css after.css expected.txt
#   expected.txt 형식(빈 줄·# 주석 허용):
#     removed <셀렉터 키>            # after에서 사라져야 하는 키 (at-rule 프리픽스는 " || " 결합)
#     changed <셀렉터 키>            # 선언 맵이 달라져도 되는 키 (변경 내용은 리포트로 출력)
set -u
B="${1:?baseline.css 경로가 필요합니다}"
A="${2:?after.css 경로가 필요합니다}"
E="${3:?expected.txt 경로가 필요합니다}"

JS="$(mktemp -t verify-css-key-maps.XXXXXX.js)"
trap 'rm -f "$JS"' EXIT
cat > "$JS" <<'EOF_JS'
const [b, a, e] = process.argv.slice(2);
const fs = require("fs");
const read = (p) => fs.readFileSync(p, "utf8");

// 최상위/중첩 블록 파서 — minified CSS 전제(주석 없음). 문자열 리터럴 안의 {}는
// url()/content 등에서 드물지만, 따옴표 안은 건너뛴다.
function parse(css) {
  const map = new Map(); // key -> [declString...]
  const walk = (src, prefix) => {
    let i = 0;
    while (i < src.length) {
      // 셀렉터/앳룰 머리 읽기: {, ;, EOF 중 먼저 오는 것까지
      let head = "";
      while (i < src.length) {
        const ch = src[i];
        if (ch === "\"" || ch === "'") {
          const q = ch; head += ch; i++;
          while (i < src.length && src[i] !== q) { head += src[i]; i++; }
          head += src[i]; i++; continue;
        }
        if (ch === "{" || ch === ";") break;
        head += ch; i++;
      }
      if (i >= src.length) break;
      if (src[i] === ";") { // @import 같은 문장 — 키로 보존
        i++;
        const key = (prefix ? prefix + " || " : "") + "@stmt " + head.trim();
        if (!map.has(key)) map.set(key, []);
        map.get(key).push("(statement)");
        continue;
      }
      // 블록 본문 추출(중괄호 짝 맞춤, 따옴표 스킵)
      i++; // consume {
      let depth = 1, body = "";
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === "\"" || ch === "'") {
          const q = ch; body += ch; i++;
          while (i < src.length && src[i] !== q) { body += src[i]; i++; }
          body += src[i]; i++; continue;
        }
        if (ch === "{") depth++;
        if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
        body += ch; i++;
      }
      const sel = head.trim();
      const scoped = prefix ? prefix + " || " + sel : sel;
      if (body.includes("{")) { walk(body, scoped); continue; } // 컨테이너 at-rule·keyframes
      // 선언 블록: 콤마 셀렉터를 키로 전개(at-rule 머리는 전개하지 않음)
      const keys = sel.startsWith("@") ? [scoped]
        : sel.split(",").map((s) => (prefix ? prefix + " || " : "") + s.trim());
      for (const k of keys) {
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(body);
      }
    }
  };
  walk(css, "");
  // 최종 선언 맵: 같은 키의 블록들을 문서 순서로 이어 last-wins
  const finals = new Map();
  for (const [k, bodies] of map) {
    const props = new Map();
    for (const body of bodies)
      for (const d of body.split(";")) {
        const t = d.trim(); if (!t) continue;
        const ci = t.indexOf(":");
        if (ci < 0) { props.set(t, ""); continue; }
        props.set(t.slice(0, ci).trim(), t.slice(ci + 1).trim());
      }
    finals.set(k, props);
  }
  return finals;
}

const expected = { removed: new Set(), changed: new Set() };
for (const line of read(e).split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const sp = t.indexOf(" ");
  const kind = t.slice(0, sp), key = t.slice(sp + 1).trim();
  if (kind === "removed") expected.removed.add(key);
  else if (kind === "changed") expected.changed.add(key);
  else { console.error("expected.txt 형식 오류:", t); process.exit(2); }
}

const B = parse(read(b)), A = parse(read(a));
let fail = false;
const report = (ok, msg) => { console.log((ok ? "  ✓ " : "  ✗ ") + msg); if (!ok) fail = true; };

console.log("=== ① 제거된 키 = 기대 목록과 정확히 일치 ===");
const removed = [...B.keys()].filter((k) => !A.has(k));
for (const k of removed) report(expected.removed.has(k), `제거됨: ${k}`);
for (const k of expected.removed) {
  if (!B.has(k)) report(false, `기대 제거 키가 baseline에 없음(오타?): ${k}`);
  else if (A.has(k)) report(false, `기대 제거 키가 after에 남음: ${k}`);
}

console.log("=== ② 추가된 키 = 0 ===");
const added = [...A.keys()].filter((k) => !B.has(k));
for (const k of added) report(false, `추가됨: ${k}`);
if (added.length === 0) console.log("  ✓ 추가된 키 없음");

console.log("=== ③ 선언 맵 변경 키 = 기대 목록과 정확히 일치 (그 외 전 키 불변) ===");
let same = 0; const diffs = [];
for (const [k, bp] of B) {
  if (!A.has(k)) continue;
  const ap = A.get(k);
  const propsEqual = bp.size === ap.size && [...bp].every(([p, v]) => ap.get(p) === v);
  if (propsEqual) { same++; continue; }
  diffs.push(k);
  const detail = [];
  for (const [p, v] of bp) if (ap.get(p) !== v) detail.push(`${p}: ${JSON.stringify(v)} -> ${JSON.stringify(ap.get(p))}`);
  for (const [p, v] of ap) if (!bp.has(p)) detail.push(`${p}: (없음) -> ${JSON.stringify(v)}`);
  report(expected.changed.has(k), `변경: ${k}\n      ${detail.join("\n      ")}`);
}
for (const k of expected.changed)
  if (!diffs.includes(k)) report(false, `기대 변경 키가 실제로는 불변(오타?): ${k}`);
console.log(`  ✓ 그 외 ${same}개 키 선언 맵 전부 불변`);

console.log("=== 규모 ===");
console.log(`  셀렉터 키: ${B.size} -> ${A.size} (제거 ${removed.length}·추가 ${added.length})`);
console.log(`  바이트:    ${fs.statSync(b).size} -> ${fs.statSync(a).size}`);
process.exit(fail ? 1 : 0);
EOF_JS
exec bun "$JS" "$B" "$A" "$E"
