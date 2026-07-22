import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@client": path.resolve(__dirname, "client/src"),
    },
  },
  test: {
    // 테스트 타임존 고정 — **이 한 줄이 타임존 고정의 유일한 소유자다**(CI 워크플로우에 중복해서
    // 두지 말 것. 두 곳에 있으면 한쪽만 고쳐 어긋난다).
    // 날짜를 포맷하는 테스트 3건(`app-card` · `manage-status` · `build-timeline-rows`)이
    // `at.getHours()`처럼 **실행 환경의 로컬 타임존**을 그대로 쓴다. 팀 로컬은 전원 KST라 아무도
    // 몰랐는데 UTC인 CI 러너에서 9시간 어긋나며 드러났다(2026-07-22 CI 도입 첫 실행이 잡아냈다:
    // "expected '26/04/16 09:07' to be '26/04/16 18:07'"). 여기서 고정하면 실행 환경이 무엇이든
    // 결과가 같다 — 실측: `TZ=UTC` 셸에서도 1067 전량 통과.
    // ※ 이건 **테스트 결정론**만 해결한다. 앱이 뷰어의 로컬 타임존으로 시각을 표시하는 것(해외에서
    //   접속하면 상담 시각·출고일이 그 지역 시각으로 보인다)은 별개의 제품 동작 문제다.
    //   🚫 **그쪽은 고치지 않기로 했다(2026-07-22 유슨생 결정)** — 팀·사용자·서버 기준이 전부 KST
    //      하나라 실익이 없다. 재제안하지 말 것. 해외 사용자가 생기면 그때 제품 판단으로 다룬다.
    env: { TZ: "Asia/Seoul" },
    css: true,
    environment: "jsdom",
    globals: true,
    include: ["client/src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
