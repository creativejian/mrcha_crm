import { Glob } from "bun";
import { expect, test } from "bun:test";

// public.profiles 쓰기 금지 계약(2026-07-10, 앱 팀과 합의) — tripwire.
//
// 배경: 앱의 휴대폰 인증 게이트가 `profiles.full_name / phone_number / phone_verified_at`으로만
// 판정되는데, 그 컬럼들이 authenticated 롤에 UPDATE로 열려 있어 SMS 인증을 통째로 우회할 수 있었다.
// 앱이 `REVOKE UPDATE ON public.profiles FROM anon, authenticated`로 닫으면서, CRM에는
// "앞으로도 profiles를 UPDATE 하지 않는다"는 계약을 요청했다.
//
// CRM 입장에서 이 테이블이 특별한 이유가 둘 있다.
//  1. `public.custom_access_token_hook`이 `profiles.role`을 JWT `user_role` claim으로 복사하고,
//     그 claim이 CRM의 유일한 인증 게이트다(`src/auth/verify.ts`). role 위조 = CRM 관리자 접근.
//  2. CRM은 `profiles.full_name / phone_number`를 고객 레코드로 적재한다
//     (`queries/quote-requests.ts` 승격 경로) — 상담사가 실제로 전화를 거는 번호의 출처다.
//
// CRM 서버는 `postgres` 롤이라 위 REVOKE의 대상이 아니다. **DB가 우리를 막아주지 않는다.**
// 계약을 지키는 건 순전히 우리 몫이고, 주석은 지켜지지 않는다는 걸 겪었다(`notify-gate.ts`의
// 틀린 "별도 커넥션" 서술이 인시던트 구역을 오래 무테스트로 남겼다). 그래서 기계로 잠근다.
//
// 쓰기가 필요해지면 이 테스트를 우회하지 말고 **앱 팀에 서버 경로를 요청**한다(그쪽 확약).
// 예외를 뚫어야 한다면 여기에 명시적으로 등록해 "언제 누가 왜 열었는지"가 커밋에 남게 한다.

const SCAN_ROOTS = ["src", "client/src", "supabase/functions"];
const SELF = "src/db/profiles-write-guard.test.ts";

// 주석 안의 "profiles를 UPDATE 하지 않는다" 같은 설명문이 탐지에 걸리지 않게 먼저 걷어낸다.
// `[^:]` 가드는 URL(`https://`)이 줄 주석으로 오인되는 것을 막는다.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// CRM이 DB에 쓰는 경로는 셋뿐이다 — drizzle(서버) · supabase-js(브라우저) · 원시 SQL.
const RULES: { name: string; re: RegExp }[] = [
  // drizzle: ex.insert(profiles) / db.update(profiles) / tx.delete(profiles)
  { name: "drizzle", re: /\.(?:insert|update|delete)\(\s*profiles\s*[,)]/g },
  // supabase-js: from("profiles") … .update({...}) — 사이에 다른 .from(이 끼면 다른 문장이다.
  { name: "supabase-js", re: /\.from\(\s*["'`]profiles["'`]\s*\)(?:(?!\.from\()[\s\S]){0,160}?\.(?:insert|update|delete|upsert)\(/g },
  // 원시 SQL: sql`update public.profiles set ...`
  { name: "raw-sql", re: /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?profiles\b/gi },
];

// 소스 1개에서 profiles 쓰기로 보이는 조각을 뽑는다(순수 — 아래 탐지기 자체 테스트가 이걸 쓴다).
function findProfileWrites(source: string): string[] {
  const code = stripComments(source);
  return RULES.flatMap(({ name, re }) =>
    [...code.matchAll(re)].map((m) => `${name}: ${m[0].replace(/\s+/g, " ").slice(0, 80)}`),
  );
}

// ── 탐지기 자체 검증 ────────────────────────────────────────────────
// "위반 0건"만 단언하면 정규식이 고장 나도 통과한다. 잡아야 할 것과 흘려보내야 할 것을 각각 고정한다.

test("탐지기: drizzle profiles 쓰기 3종을 잡는다", () => {
  expect(findProfileWrites(`await ex.update(profiles).set({ phoneNumber: p })`)).toHaveLength(1);
  expect(findProfileWrites(`await db.insert(profiles).values({ id })`)).toHaveLength(1);
  expect(findProfileWrites(`await tx.delete(profiles).where(eq(profiles.id, id))`)).toHaveLength(1);
});

test("탐지기: supabase-js profiles 쓰기를 잡는다(줄바꿈 포함)", () => {
  expect(findProfileWrites(`supabase.from("profiles").update({ role: "admin" })`)).toHaveLength(1);
  expect(findProfileWrites(`const { error } = await supabase\n  .from("profiles")\n  .upsert({ id, full_name })`)).toHaveLength(1);
});

test("탐지기: 원시 SQL profiles 쓰기를 잡는다", () => {
  expect(findProfileWrites("await db.execute(sql`update public.profiles set role = 'admin'`)")).toHaveLength(1);
  expect(findProfileWrites("await db.execute(sql`delete from profiles where id = ${id}`)")).toHaveLength(1);
});

test("탐지기: 읽기는 흘려보낸다(profiles는 read 전용으로 계속 쓰인다)", () => {
  expect(findProfileWrites(`await ex.select({ fullName: profiles.fullName }).from(profiles)`)).toEqual([]);
  expect(findProfileWrites(`supabase.from("profiles").select("full_name")`)).toEqual([]);
  // 실시간 상담 콘솔의 PostgREST embed(chat.ts) — 문자열 안의 profiles.
  expect(findProfileWrites(`const S = "*, profiles!chat_sessions_user_id_fkey(full_name, email)";`)).toEqual([]);
  // 다른 테이블 쓰기는 무관.
  expect(findProfileWrites(`supabase.from("chat_messages").insert({ message })`)).toEqual([]);
});

test("탐지기: 주석 속 설명문은 위반이 아니다", () => {
  expect(findProfileWrites(`// CRM은 profiles를 UPDATE 하지 않는다\n// update public.profiles 금지`)).toEqual([]);
  expect(findProfileWrites(`/* delete from profiles 는 앱 Edge Function만 */`)).toEqual([]);
  expect(findProfileWrites(`const url = "https://example.test"; // update profiles`)).toEqual([]);
});

// ── 저장소 계약 ────────────────────────────────────────────────────

test("계약: CRM 저장소 어디에서도 public.profiles에 쓰지 않는다", async () => {
  const violations: string[] = [];
  for (const root of SCAN_ROOTS) {
    for await (const rel of new Glob("**/*.{ts,tsx}").scan({ cwd: root })) {
      const path = `${root}/${rel}`;
      if (path === SELF) continue;
      for (const hit of findProfileWrites(await Bun.file(path).text())) violations.push(`${path} — ${hit}`);
    }
  }
  // 실패했다면 profiles 쓰기가 새로 들어왔다는 뜻이다. 정규식을 고치지 말고 위 주석의 계약을 읽을 것.
  expect(violations).toEqual([]);
});

test("계약: 스캔이 실제로 파일을 훑었다(빈 글롭으로 통과하는 것 방지)", async () => {
  let files = 0;
  for (const root of SCAN_ROOTS) {
    for await (const _ of new Glob("**/*.{ts,tsx}").scan({ cwd: root })) files += 1;
  }
  expect(files).toBeGreaterThan(100);
});
