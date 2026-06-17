import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";

// drizzle-kit 서브프로세스는 .env.local 을 자동 로드하지 않아(bun --env-file 도 `bun x` 조합에선
// 전달 안 됨) config 평가 시점에 직접 주입한다. 이미 설정된 환경변수(CI)는 덮어쓰지 않는다.
const envText = (() => {
  try {
    return readFileSync(".env.local", "utf8");
  } catch {
    return "";
  }
})();
for (const line of envText.split("\n")) {
  const match = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // drizzle는 crm + catalog 만 관리. public(앱 소유)은 절대 안 건드림(SET SCHEMA·view 보호).
  // catalog 는 introspect(drizzle.config.catalog.ts)로 adopt. 이 config는 crm DDL 전용.
  schemaFilter: ["crm"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
