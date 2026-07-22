import { defineConfig, devices } from "@playwright/test";

// ⚠️ 현재 이 설정을 쓰는 spec은 0개다(2026-07-22 배치 13에서 전부 폐기).
// 구 spec 3종(crm-visual·crm-screenshot·customer-detail-screenshot)은 전부 `page.goto("/")` 직후
// CRM 화면을 기대했는데, 2026-06-18 카카오 로그인 게이트(#36) 도입 후 로그인 화면에서 멈춰
// 약 두 달간 실행 자체가 불가능했다(스냅샷 베이스라인도 로그인 이전 UI라 재촬영 없이는 전량 불일치).
// 설정만 남긴 이유 = 브라우저 검증을 재도입할 때 재작성 비용을 아끼기 위해서다.
// **재도입 시 로그인 처리부터 붙일 것** — AGENTS.md "로컬 브라우저 스모크 로그인 우회"의
// magiclink 절차로 세션을 수립한 뒤 storageState로 저장하는 형태가 아니면 또 같은 벽에 막힌다.
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.015,
      threshold: 0.25,
    },
  },
  reporter: "list",
  webServer: {
    command: "bun run dev:client -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    baseURL: process.env.CRM_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
      },
    },
  ],
});
