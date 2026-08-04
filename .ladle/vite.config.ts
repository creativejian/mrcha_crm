import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Ladle 전용 vite 설정(2026-08-04) — 앱 설정(`client/vite.config.ts`)을 그대로 물리면
// **dev 서버가 흰 화면으로 죽는다**: `Missing field 'moduleType'`
// (plugin `builtin:vite-react-refresh-wrapper`).
//
// 원인: 이 레포는 **rolldown-vite**를 쓰는데 Ladle은 자기 의존성으로 **일반 vite**를 번들한다
// (`@ladle/react/node_modules/vite`). 앱 설정의 `@vitejs/plugin-react`가 rolldown 빌트인
// react-refresh 래퍼를 기대하는 상태로 일반 vite 안에서 돌면서 transform 결과 규약이 어긋난다.
// **Ladle은 react 플러그인을 자체적으로 넣으므로** 여기서는 넣지 않는 것이 맞다(중복이자 충돌원).
//
// 프로덕션 빌드(`bun run build:ladle`)는 이 경로를 타지 않아 전부터 정상이었다 — 그래서
// "빌드는 되는데 dev만 흰 화면"이었다.
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../client/src"),
    },
  },
});
