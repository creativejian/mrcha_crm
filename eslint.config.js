import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // src/db/catalog.ts 는 catalog(차량) introspect 기반 정본 — `bun run db:pull:catalog` 재생성 산출물을 정리한 것이라 lint 제외.
    // drizzle/_catalog_introspect/ 는 db:pull:catalog 원본 산출물(재생성 가능, gitignore) — lint 제외.
    // .claude/worktrees/ 는 subagent 격리 워크트리(저장소 복사본) — 정리 전까지 `eslint .`이 복사본까지 스캔해 오탐이 나므로 제외.
    ignores: [
      "node_modules/",
      "client/dist/",
      "build/",
      "coverage/",
      "screenshots/",
      "test-results/",
      "playwright-report/",
      ".wrangler/",
      "src/db/catalog.ts",
      "drizzle/_catalog_introspect/",
      "supabase/functions/",
      ".claude/",
    ],
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
