import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // catalog(차량 거울)는 drizzle 관리 밖 — public만 generate/migrate/push 대상.
  // drizzle-kit 1.0+는 모든 schema를 기본 관리하므로 명시적으로 public만 제한해 catalog를 보호한다.
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
