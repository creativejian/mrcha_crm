export default {
  stories: "client/src/**/*.stories.{ts,tsx}",
  viteConfig: "./client/vite.config.ts",
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
