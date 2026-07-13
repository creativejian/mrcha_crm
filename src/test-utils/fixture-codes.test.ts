import { Glob } from "bun";
import { expect, test } from "bun:test";

import {
  isRegisteredCustomerCode, isRegisteredQuoteCode, prefixRegex,
  TEST_CUSTOMER_CODE_PREFIXES, TEST_QUOTE_CODE_PREFIXES,
} from "./fixture-codes";
import { CUSTOMER_CODE_REGEX, QUOTE_CODE_REGEX } from "./fixture-residue";

// 테스트 소스가 registry 밖 접두사로 실 DB에 행을 만들면, 잔재 검사(check-test-residue)가
// 그 행을 못 본다. 즉 registry 드리프트 = 유령 행이 조용히 통과한다는 뜻이다.
// 새 접두사를 쓰려면 fixture-codes.ts에 먼저 등록해야 한다.

const SELF = "src/test-utils/fixture-codes.test.ts";

// 계약 스캔에서 명시적으로 제외하는 정당한 리터럴 보유 파일. 여기 추가하려면 "왜 registry 밖
// 코드 리터럴이 정당한지"를 주석으로 남길 것 — 픽스처 생성 파일은 절대 넣지 않는다.
const EXCLUDED = new Set([
  SELF, // 탐지기 자체 테스트가 코드 리터럴을 픽스처로 쓴다(DB에 안 남음)
  "src/test-utils/fixture-codes.ts", // registry 자신 — 접두사 리터럴의 원본 정의
]);

// 실 master DB에 쓰는 테스트만 대상 — 순수 유닛 테스트의 인메모리 객체(예: app-card-payload.test.ts의
// quoteCode "QT-2607-0001")는 DB에 남지 않으므로 registry와 무관하다. `getDefaultDb` 참조가 그 판별자다.
function touchesRealDb(source: string): boolean {
  return source.includes("getDefaultDb");
}

// 코드 리터럴을 필드명이 아니라 **값의 모양**으로 뽑는다.
// `quoteCode: QUOTE_CODE` 처럼 변수로 조립하는 경우(embed-sources.test.ts)가 실제로 있어서,
// `customerCode:` 앞뒤를 보는 방식으로는 놓친다 — 그 접두사(QT-EMBSRC-)가 바로 그렇게 registry에서 빠져 있었다.
// 접두사 뒤에 영숫자가 최소 1자 있어야 한다 — 그래야 실채번 형식을 단언하는 정규식
// `/^CU-\d{4}-\d{4}$/`(다음 문자가 `\`)를 코드 리터럴로 오인하지 않는다.
const CODE_LITERAL = /\b(CU|QT|PUSH)-[A-Za-z0-9][A-Za-z0-9-]*/g;

// 주석은 먼저 걷어낸다 — 규칙을 **설명하는 문장**이 그 규칙의 위반으로 잡히면 아무도 이 가드를 안 쓴다.
// (`profiles-write-guard.test.ts`가 같은 이유로 stripComments를 쓴다. 여기선 빼먹어 자기 형제 파일의
//  주석에 적힌 `CU-2606-0001`을 위반으로 잡았다.) `[^:]` 가드는 URL의 `//`를 주석으로 오인하지 않게 한다.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function extractCodeLiterals(source: string): string[] {
  return [...stripComments(source).matchAll(CODE_LITERAL)].map((m) => m[0]);
}

function isRegistered(code: string): boolean {
  return code.startsWith("QT-") ? isRegisteredQuoteCode(code) : isRegisteredCustomerCode(code);
}

// ── 탐지기 자체 검증 ────────────────────────────────────────────────
// "위반 0건"만 단언하면 정규식이 고장 나도 통과한다.

test("탐지기: 템플릿·따옴표·변수 조립 어느 쪽이든 접두사를 뽑는다", () => {
  expect(extractCodeLiterals("customerCode: `CU-DEL-${rand}`")).toEqual(["CU-DEL-"]);
  expect(extractCodeLiterals(`customerCode: "CU-SMOKE409"`)).toEqual(["CU-SMOKE409"]);
  expect(extractCodeLiterals("const QUOTE_CODE = `QT-EMBSRC-${x}`;")).toEqual(["QT-EMBSRC-"]);
  expect(extractCodeLiterals("values({ customerCode: `PUSH-TEST-${x}` })")).toEqual(["PUSH-TEST-"]);
});

test("탐지기: 코드가 없는 소스에선 아무것도 뽑지 않는다", () => {
  expect(extractCodeLiterals("customerCode: customers.customerCode,")).toEqual([]);
  expect(extractCodeLiterals("const { customerCode } = row;")).toEqual([]);
});

test("탐지기: 실채번 형식을 단언하는 정규식은 코드 리터럴이 아니다", () => {
  // 접두사만 있고 영숫자가 안 따라오는 조각(`CU-\d{4}`)을 잡으면 매 실행 오탐이 난다.
  expect(extractCodeLiterals("expect(body.customerCode).toMatch(/^CU-\\d{4}-\\d{4}$/);")).toEqual([]);
  expect(extractCodeLiterals("expect(body.quoteCode).toMatch(/^QT-\\d{4}-\\d{4}$/);")).toEqual([]);
  // 반면 실채번 리터럴이 DB 테스트에 박혀 있으면 잡혀야 한다(등록 안 되므로 위반).
  expect(extractCodeLiterals(`"CU-2606-0001"`)).toEqual(["CU-2606-0001"]);
});

test("탐지기: 주석 속 코드는 위반이 아니다", () => {
  expect(extractCodeLiterals("// 실고객 CU-2606-0001 은 잔재가 아니다")).toEqual([]);
  expect(extractCodeLiterals("/* CU-EMBRT-abc 가 유령으로 떴다 */")).toEqual([]);
  expect(extractCodeLiterals('const u = "https://x.test"; // QT-TEST-1')).toEqual([]);
  // 코드에 있으면 여전히 잡힌다
  expect(extractCodeLiterals('const c = "CU-DEL-x"; // CU-2606-0001')).toEqual(["CU-DEL-x"]);
});

test("탐지기: 실 DB 사용 여부를 getDefaultDb로 판별한다", () => {
  expect(touchesRealDb('const db = getDefaultDb();')).toBe(true);
  expect(touchesRealDb('const q = { quoteCode: "QT-2607-0001" };')).toBe(false);
});

test("registry: 미등록 접두사를 거부한다", () => {
  expect(isRegisteredCustomerCode("CU-DEL-abc")).toBe(true);
  expect(isRegisteredCustomerCode("PUSH-TEST-abc")).toBe(true); // CU- 규칙 이탈 케이스
  expect(isRegisteredCustomerCode("CU-2606-0001")).toBe(false); // 실고객 채번은 등록돼 있으면 안 된다
  expect(isRegisteredQuoteCode("QT-TEST-1")).toBe(true);
  expect(isRegisteredQuoteCode("QT-2607-0005")).toBe(false); // 실견적 채번
});

test("prefixRegex: 정규식 메타문자를 이스케이프한다", () => {
  expect(prefixRegex(["CU-A-"])).toBe("^(CU-A-)");
  expect(prefixRegex(["A.B", "C+"])).toBe("^(A\\.B|C\\+)");
});

// ── 계약: 실 DB 테스트의 모든 픽스처 코드가 registry에 있다 ─────────

// .test.ts만 훑으면 픽스처 생성이 비 .test.ts 시드 헬퍼로 옮겨갔을 때 미검출된다(텍스트 판정이라
// import를 못 쫓는다) — src 전체 .ts를 훑는다. 판별자는 여전히 touchesRealDb(getDefaultDb)라
// 순수 모듈은 대상 밖이고, 프로덕션 채번 템플릿(`CU-${yymm}-`)은 접두사 뒤 영숫자 요구로 안 잡힌다.
test("계약: 실 DB를 만지는 src 소스가 쓰는 CU-/QT-/PUSH- 코드는 전부 registry에 등록돼 있다", async () => {
  const violations: string[] = [];
  let dbFiles = 0;
  for await (const rel of new Glob("**/*.ts").scan({ cwd: "src" })) {
    const path = `src/${rel}`;
    if (EXCLUDED.has(path)) continue;
    const source = await Bun.file(path).text();
    if (!touchesRealDb(source)) continue;
    dbFiles += 1;
    for (const code of new Set(extractCodeLiterals(source))) {
      if (!isRegistered(code)) violations.push(`${path} — "${code}"`);
    }
  }
  // 실패했다면 새 픽스처 접두사가 등록 없이 들어왔다는 뜻이다.
  // registry(fixture-codes.ts)에 추가할 것. 정규식을 고쳐 회피하지 말 것.
  expect(violations).toEqual([]);
  expect(dbFiles).toBeGreaterThan(30); // 빈 글롭·판별자 고장으로 통과하는 것 방지(테스트+쿼리 모듈 합산)
});

test("registry: 접두사에 중복·공백이 없다", () => {
  const all = [...TEST_CUSTOMER_CODE_PREFIXES, ...TEST_QUOTE_CODE_PREFIXES];
  expect(new Set(all).size).toBe(all.length);
  for (const p of all) expect(p.trim()).toBe(p);
});

// 잔재 검사가 쓰는 Postgres 정규식이 실채번을 오인하지 않는지 — 이 파일은 DB를 쓰지 않으므로
// 실채번 리터럴을 적어도 위 계약 스캔에 걸리지 않는다(fixture-residue.test.ts는 걸린다).
test("잔재 정규식: 실채번 코드는 잔재로 오인하지 않는다", () => {
  expect(new RegExp(CUSTOMER_CODE_REGEX).test("CU-2606-0001")).toBe(false);
  expect(new RegExp(CUSTOMER_CODE_REGEX).test("CU-DEL-abc")).toBe(true);
  expect(new RegExp(QUOTE_CODE_REGEX).test("QT-2607-0005")).toBe(false);
  expect(new RegExp(QUOTE_CODE_REGEX).test("QT-TEST-1")).toBe(true);
});
