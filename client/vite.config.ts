import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// ⚠️ `__dirname`을 쓰지 않는다 — Vite가 설정을 런타임에 직접 읽는 `configLoader: 'native'`를
// 다음 메이저의 기본값으로 예고했고, 그 경로는 ESM이라 `__dirname`이 아예 없다(지금은 경고만
// 내고 넘어가지만 기본값이 바뀌는 순간 설정 로드가 깨진다). `import.meta.dirname`은 Node 20.11+·
// Bun에서 동작한다. ⚠️ `.ladle/vite.config.ts`는 **바꾸지 말 것** — Ladle이 자체 번들한 구 vite를
// 써서 그 파일을 분리해 흰 화면을 막아둔 것이라, 최신 문법을 넣으면 그 회피책이 깨진다.
export default defineConfig({
  // 이미 절대경로라 path.resolve로 감싸지 않는다(감싸면 아무 일도 하지 않는다).
  root: import.meta.dirname,
  // root가 client/라 envDir 기본값도 client/가 된다. .env.local은 프로젝트 루트에
  // 있으므로 envDir을 루트로 지정해야 VITE_SUPABASE_* 가 dev/build 런타임에 주입된다.
  envDir: path.resolve(import.meta.dirname, ".."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8788",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
