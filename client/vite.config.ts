import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname),
  // root가 client/라 envDir 기본값도 client/가 된다. .env.local은 프로젝트 루트에
  // 있으므로 envDir을 루트로 지정해야 VITE_SUPABASE_* 가 dev/build 런타임에 주입된다.
  envDir: path.resolve(__dirname, ".."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
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
