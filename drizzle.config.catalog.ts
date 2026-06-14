import { defineConfig } from "drizzle-kit";

// 일회성 introspect 전용 config — catalog(차량 거울) schema 타입을 src/db/catalog.ts 로 pull 한다.
// 평소 마이그레이션은 drizzle.config.ts(public)를 쓴다. 이 파일은 차량 master 스키마가 바뀔 때만 재실행.
export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle/_catalog_introspect",
  schemaFilter: ["catalog"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
