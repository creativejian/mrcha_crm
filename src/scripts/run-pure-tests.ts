// CI용 순수 서버 테스트 러너 — DB·시크릿 없이 도는 src 테스트만 골라 bun test로 돌린다.
// (0725 경량 정합성 체크 후속: 계약 tripwire — profiles-write-guard·roles-parity·fixture-codes
//  드리프트 — 가 test:server에만 있어 로컬에서 안 돌리면 영구 침묵이었다. ⚠️ test:server 전체를
//  CI에 넣는 게 아니다 — 그쪽은 공유 master에 붙는다, ci.yml 헤더 경고 참조.)
//
// 선별은 **제외 registry(fail-closed)**다: src/test-utils/db-bound-tests.ts에 등록된 파일만 빼고
// 전부 돌린다. 새 DB 의존 테스트를 등록하지 않으면 여기(=CI)서 시끄럽게 실패한다 — 포함 목록의
// "새 순수 테스트가 조용히 CI 밖에 남는" 공백을 반대 방향으로 뒤집은 설계.
//
// ⚠️ bun은 `.env.local`을 **자동 로드**한다(실측 2026-07-25: 플래그 없이 DATABASE_URL이 LOADED).
//    그래서 `--env-file=/dev/null`로 자동 로드를 끊고(실측: EMPTY) 민감 env도 지워, **로컬 실행이
//    CI 실행과 동형**이 되게 한다 — 로컬에선 초록인데 CI만 빨간 상태를 구조적으로 없앤다.
import { Glob } from "bun";

import { DB_BOUND_TEST_FILES } from "../test-utils/db-bound-tests";

const root = new URL("../..", import.meta.url).pathname;
const all = [...new Glob("src/**/*.test.ts").scanSync(root)].sort();

// registry 스테일 탐지 — 테스트 파일을 옮기거나 지웠으면 등록도 함께 정리해야 한다.
const missing = DB_BOUND_TEST_FILES.filter((p) => !all.includes(p));
if (missing.length > 0) {
  console.error(`db-bound-tests registry에 실존하지 않는 파일이 등록돼 있다(이동/삭제 시 함께 정리할 것):\n${missing.join("\n")}`);
  process.exit(1);
}

const bound = new Set<string>(DB_BOUND_TEST_FILES);
const pure = all.filter((f) => !bound.has(f));
console.log(`순수 테스트 ${pure.length}파일 실행 (src 전체 ${all.length} − DB 의존 registry ${DB_BOUND_TEST_FILES.length})`);

// 민감 env 제거 — bun 자동 .env 로드 차단(--env-file=/dev/null)과 이중 방어.
const env: Record<string, string | undefined> = { ...process.env };
for (const k of ["DATABASE_URL", "GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "HYPERDRIVE"]) delete env[k];

const proc = Bun.spawnSync(["bun", "test", "--env-file=/dev/null", ...pure], {
  cwd: root,
  env,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(proc.exitCode ?? 1);
