import { Glob } from "bun";
import { expect, test } from "bun:test";

// 파기 쿼리(`.delete(테이블)`)는 **반드시 `.where(...)`를 동반한다** — tripwire (2026-08-06 배치 16).
//
// 배경(실측): 배치 16 감사에서 파기 경로에 변이를 주입해 보니, **`WHERE` 절을 지운 변이 3건이
// CI 8단계(typecheck·lint·knip·format·unit·pure·build·edge)를 전량 통과**했다.
//   · `purgeCustomerCore`의 고객 DELETE → **전 고객 삭제**(CASCADE로 자식 7종·임베딩·서류까지)
//   · `listRetentionDueCustomers`의 필터 → **전 고객 수렴 파기**(사람 조작 없이 크론이 자동 발화)
//   · `deleteDealerProposals`의 dealerUserId 필터 → **전 딜러 제안 삭제**
// 셋 다 그물이 **있긴 있었다** — 다만 전부 `db-bound-tests.ts` registry에 등재된 실 DB 테스트라
// `test:server`(로컬 전용, 공유 master 접속)에서만 돈다. 즉 **"그물이 있다"와 "PR이 빨개진다"가
// 다른 말**이었다. 이 파일은 그 셋을 CI로 끌어오려고 만들었다 — 순수 소스 스캔이라 DB가 필요 없다.
//
// 왜 형태로 잠그나:
//  1. **증상이 없다.** WHERE 하나가 빠져도 타입은 맞고 lint도 통과하며, 사고는 크론이 도는 다음
//     새벽이나 누가 삭제 버튼을 누르는 순간에 **한꺼번에** 난다.
//  2. **복구 경로가 없다.** 고객 하드 삭제·탈퇴 파기·딜러 제안 삭제는 전부 이력을 남기지 않는다
//     (`customer_deletions`는 익명 감사 스냅샷일 뿐 원본을 되살리지 못한다).
//  3. **동작 테스트를 CI로 옮길 수 없다.** 이 쿼리들은 실 DB가 있어야 검증되는데, `test:server`는
//     공유 master에 붙어 픽스처 행·운영 디스코드 알림·FCM 푸시를 실제로 발생시킨다(AGENTS.md).
//     그래서 **형태만이라도** CI가 잠근다.
//
// ⚠️ 정규식을 좁히거나 대상 폴더를 줄여 회피하지 말 것. 전량 삭제가 정말 의도인 자리는 아래
// `ALLOW`에 사유와 함께 등록해 "언제 누가 왜 열었는지"가 커밋에 남게 한다(profiles-write-guard 관례).

// 전량 삭제가 **의도**인 자리만 등록한다.
const ALLOW: { file: string; table: string; reason: string }[] = [
  {
    file: "src/db/queries/assistant-messages.ts",
    table: "assistantMessages",
    reason:
      "출시 전 1회 전량 정리(`bun run purge:assistant`)의 실행부 — 전 직원 대화를 지우는 것이 목적이라 WHERE가 없는 게 맞다. 스크립트는 `--yes` 없이는 조회만 하고, 실행 시점 직원 사전 공지가 계약 조건이다(AGENTS.md 업무 AI 대화 보존 계약).",
  },
];

const ROOT = new URL("../..", import.meta.url).pathname;

// 다른 tripwire들은 **검사 대상 코드를 문자열 리터럴로 인용**하므로 스캔에서 뺀다
// (실측: profiles-write-guard의 ALLOW에 `hit: "drizzle: .delete(dealerProfiles)"` 4건이 있어
// 도입 첫 실행에서 그대로 오탐이 났다).
// ⚠️ 패턴(`*-guard.test.ts`)으로 열어두지 않고 **명시 목록**으로 둔다 — 패턴이면 진짜 파기 코드를
// 담은 파일이 이름만으로 면제받을 수 있다. 새 guard가 생기면 여기 한 줄 추가한다.
const SKIP_FILES = new Set([
  "src/db/delete-where-guard.test.ts",
  "src/db/profiles-write-guard.test.ts",
  "src/db/updated-at-clock-guard.test.ts",
]);

// drizzle 테이블만 골라내려고 스키마 파일에서 export 이름을 수집한다. 이걸 안 하면
// `listeners.delete(listener)` 같은 Map/Set 호출까지 잡혀 tripwire가 노이즈가 된다.
async function collectTableNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const rel of ["src/db/schema.ts", "src/db/public-app.ts", "src/db/catalog.ts"]) {
    const src = await Bun.file(`${ROOT}${rel}`).text();
    for (const m of src.matchAll(/^export const (\w+)\s*=\s*\w+\.table\(/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^export const (\w+)\s*=\s*pgTable\(/gm)) names.add(m[1]);
  }
  return names;
}

test("스키마 테이블 이름을 수집한다 — 이게 비면 아래 검사가 조용히 무력해진다", async () => {
  const tables = await collectTableNames();
  // 도입 시점 실측 = crm 20 + catalog 7 + public 미러. 회귀로 0이나 한 자릿수가 되면 검사가 죽는다.
  expect(tables.size).toBeGreaterThan(20);
  expect(tables.has("customers")).toBe(true);
});

test("파기 쿼리는 WHERE를 동반한다 — 전량 삭제는 ALLOW 등록 필수", async () => {
  const tables = await collectTableNames();
  const violations: string[] = [];

  for (const dir of ["src", "client/src"]) {
    for await (const rel of new Glob("**/*.ts").scan({ cwd: `${ROOT}${dir}`, onlyFiles: true })) {
      const file = `${dir}/${rel}`;
      if (SKIP_FILES.has(file)) continue;
      const src = await Bun.file(`${ROOT}${file}`).text();
      for (const m of src.matchAll(/\.delete\(\s*(\w+)\s*\)/g)) {
        const table = m[1];
        if (!tables.has(table)) continue; // Map/Set 등 — drizzle 파기가 아니다
        // statement 끝(다음 세미콜론)까지에 .where(가 있는지. 체이닝이 여러 줄이어도 잡힌다.
        const start = m.index;
        const end = src.indexOf(";", start);
        const stmt = end === -1 ? src.slice(start) : src.slice(start, end);
        if (/\.where\(/.test(stmt)) continue;
        if (ALLOW.some((a) => a.file === file && a.table === table)) continue;
        const line = src.slice(0, start).split("\n").length;
        violations.push(`${file}:${line} — .delete(${table})에 .where()가 없다`);
      }
    }
  }

  expect(violations).toEqual([]);
});
