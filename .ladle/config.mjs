export default {
  stories: "client/src/**/*.stories.{ts,tsx}",
  // ⚠️ 앱 설정(client/vite.config.ts)을 물리면 dev 서버가 흰 화면으로 죽는다 — 사유는
  // .ladle/vite.config.ts 상단 주석(rolldown-vite ↔ Ladle 번들 vite 비호환).
  viteConfig: "./.ladle/vite.config.ts",
  port: 61000,
  addons: {
    a11y: {
      enabled: true,
    },
    width: {
      enabled: true,
      options: {
        desktop: 1440,
        laptop: 1280,
        tablet: 768,
      },
      defaultState: 0,
    },
  },
};
