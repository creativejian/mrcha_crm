/// <reference types="vite/client" />

// `@fontsource-variable/geist` ships only CSS (no type declarations) and is
// imported without an extension, so it doesn't match vite/client's `*.css`
// ambient module. TypeScript 6 (TS2882) requires a declaration for side-effect
// imports; the actual CSS bundling is handled by Vite at build time.
declare module "@fontsource-variable/geist";

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string | undefined;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
