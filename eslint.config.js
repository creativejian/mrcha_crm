import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // src/db/catalog.ts 는 catalog(차량 거울) introspect 자동생성물 — 수동 수정 금지, `bun run db:pull:catalog`로 재생성하므로 lint 제외.
    ignores: ["node_modules/", "client/dist/", "build/", "coverage/", "screenshots/", "test-results/", "playwright-report/", ".wrangler/", "src/db/catalog.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.config.{js,ts}", ".ladle/**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
