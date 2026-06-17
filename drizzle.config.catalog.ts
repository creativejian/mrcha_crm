import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";

// drizzle-kit 서브프로세스는 .env.local 을 자동 로드하지 않아 config 평가 시점에 직접 주입한다.
// 이미 설정된 환경변수(CI)는 덮어쓰지 않는다.
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

// 일회성 introspect 전용 config — catalog(차량) schema 타입을 pull 한다.
// 평소 마이그레이션은 drizzle.config.ts(crm)를 쓴다. 이 파일은 catalog 스키마가 바뀔 때만 재실행.
export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle/_catalog_introspect",
  schemaFilter: ["catalog"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
