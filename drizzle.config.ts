import { defineConfig } from "drizzle-kit";

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
