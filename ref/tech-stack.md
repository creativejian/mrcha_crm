# 기술 스택

`financial-dolim-solution` 프로젝트의 전체 기술 스택. 신규 프로젝트(CRM 등) 와 추후 통합 호환을 위해 동일 기준으로 맞추는 용도.

> 작성 기준일: 2026-05-15 / package.json 버전 기준.

---

## 1. 런타임 / 패키지 매니저

| 항목 | 선택 | 비고 |
|---|---|---|
| 런타임 | **Bun 1.3.x** | Node.js 호환, 내장 test runner / TypeScript 직접 실행 |
| 패키지 매니저 | **Bun** | `bun install` / `bun add` |
| Node 호환 타입 | `@types/node ^24` (서버) / `^25` (클라이언트) | |

> **결정**: Node.js 가 아닌 Bun 런타임을 채택. CLI 스크립트도 `bun scripts/...ts` 로 직접 실행 — `tsx` / `ts-node` 불필요.

---

## 2. 백엔드

| 항목 | 패키지 | 버전 | 용도 |
|---|---|---|---|
| 웹 프레임워크 | `hono` | `^4.12.18` | 라우팅 / 미들웨어. Express 대체 |
| 요청 검증 | `@hono/zod-validator` | `^0.7.2` | Zod 스키마로 바디/쿼리/헤더 검증 |
| 스키마 / 유효성 | `zod` | `^4.4.3` | 타입 안전 스키마. API contract 정의 |
| 엔트리 (로컬) | `src/local-dev.ts` | — | `Bun.serve({ port, fetch: app.fetch })` |
| 엔트리 (배포) | `functions/[[path]].ts` | — | Cloudflare Pages Functions adapter |

```typescript
// src/local-dev.ts (로컬 개발)
import { app } from "@/app";
const server = Bun.serve({ port: 8788, fetch: app.fetch });
```

> **결정**: Cloudflare Pages 환경(에지 워커)과 Bun 로컬 환경 모두에서 동일 코드가 동작하도록 Hono 채택. Express/Fastify 는 Workers 와 비호환.

---

## 3. 데이터베이스 / ORM

| 항목 | 선택 | 비고 |
|---|---|---|
| DB | **PostgreSQL** (Supabase 호스팅) | `DATABASE_URL` 환경변수 |
| ORM | **Drizzle ORM** `^0.45.2` | 마이그레이션은 `drizzle-kit ^0.31.4` |
| 드라이버 | `postgres` (postgres.js) `^3.4.9` | TLS `require` 강제 |
| 마이그레이션 위치 | `./drizzle` | snake_case 자동 생성된 파일명 |
| 스키마 정의 | `src/db/schema.ts` | 단일 파일에 전 테이블 |
| 프로덕션 connection pooler | **Cloudflare Hyperdrive** | postgres.js 의 Workers 서브리퀘스트 제한 우회 |

```typescript
// drizzle.config.ts
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  verbose: true,
  strict: true,
});
```

명령어:
```bash
bun run db:generate   # 스키마 변경 → 마이그레이션 SQL 생성
bun run db:migrate    # 마이그레이션 적용
bun run db:push       # 스키마 직접 푸시 (dev 전용)
```

> **결정**: Prisma 대신 Drizzle 채택. 이유: 빌드 타임 의존성 제로, Edge Runtime 호환, SQL-first 설계, postgres.js 와 자연스럽게 페어링.

---

## 4. 프론트엔드

| 항목 | 패키지 | 버전 | 비고 |
|---|---|---|---|
| 프레임워크 | `react` + `react-dom` | `^19.2.6` | React 19 (Server Components 미사용 — `rsc: false`) |
| 빌드 / 개발 서버 | `vite` | `^8.0.11` | + `@vitejs/plugin-react ^6` |
| 언어 | TypeScript | `~5.9.3` | strict 모드 |
| 스타일 | **Tailwind CSS** | `^4.3.0` | + `@tailwindcss/vite ^4` (PostCSS 플러그인 X, Vite 전용 플러그인) |
| 컴포넌트 라이브러리 | **shadcn/ui** | `^4.7.0` | style: `base-nova`, baseColor: `neutral`, CSS variables 모드 |
| 헤드리스 UI 프리미티브 | `@base-ui/react` | `^1.4.1` | (Radix 대체. shadcn `base-nova` 스타일이 채택) |
| 클래스 합성 | `class-variance-authority`, `clsx`, `tailwind-merge` | — | shadcn 기본 스택 |
| 애니메이션 유틸 | `tw-animate-css` | `^1.4.0` | Tailwind 4 호환 keyframe 보조 |
| 아이콘 | **lucide-react** | `^1.14.0` | shadcn iconLibrary 설정 |
| 폰트 | `@fontsource-variable/geist` | `^5.2.8` | Variable font (모든 weight 단일 파일) |

`client/components.json`:
```json
{
  "style": "base-nova",
  "tailwind": { "css": "src/index.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

> **결정**: Next.js 채택 안 함 — Cloudflare Pages 정적 호스팅 + Hono API 분리 구조. SSR / Server Components 불필요한 비즈니스 SaaS 에는 Vite + Hono 조합이 더 가볍고 명료.
> shadcn `base-nova` 스타일 사용. **숫자 표시 폰트 불변 규칙: `font-mono tabular-nums font-normal` (bold 금지)** — 견적 금액 정렬용.

---

## 5. 호스팅 / 배포

| 항목 | 선택 | 비고 |
|---|---|---|
| 정적 / 함수 호스팅 | **Cloudflare Pages** | `pages_build_output_dir: client/dist` |
| API Functions | Cloudflare Pages Functions (`functions/[[path]].ts`) | Workers 기반 |
| Compatibility | `nodejs_compat` 플래그 활성 | postgres.js 지원 위해 필수 |
| DB 커넥션 풀 | **Cloudflare Hyperdrive** | 바인딩 `HYPERDRIVE` |
| 로컬 dev | `wrangler pages dev` 또는 `Bun.serve` (포트 8788) | |
| Compatibility date | `2026-03-17` | |

`wrangler.jsonc`:
```jsonc
{
  "name": "mg-lease-web",
  "compatibility_date": "2026-03-17",
  "pages_build_output_dir": "client/dist",
  "compatibility_flags": ["nodejs_compat"],
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "..." }]
}
```

> **결정**: Vercel / Netlify 가 아닌 Cloudflare Pages — Hyperdrive 무료 티어, 글로벌 엣지 배포, Workers 통합. 단점은 cold start 시 nodejs_compat 모드 필요.

---

## 6. 개발 도구 / CLI

| 항목 | 선택 | 비고 |
|---|---|---|
| 타입 체크 | `tsc --noEmit` (TypeScript 5.9) | `bun run typecheck` |
| 린터 / 포매터 | **(없음)** | Biome / ESLint / Prettier 미설치 — 타입 체커 + 코드 리뷰로 일관성 유지 |
| 테스트 | **`bun:test`** (Bun 내장) | Jest 호환 API. `bun test` |
| Excel 파싱 | `xlsx` `^0.18.5` | 워크북 → 시트 → 셀 파싱 (read-only) |
| Wrangler CLI | `wrangler ^4.90` | Cloudflare Pages 배포 |

```typescript
// 테스트 패턴 (Bun:test)
import { expect, test, describe } from "bun:test";
test("...", () => { expect(actual).toBe(expected); });
```

---

## 7. 프로젝트 구조 (참고)

```
.
├── src/
│   ├── app.ts                    # Hono 라우트 정의 (모든 API 엔드포인트)
│   ├── local-dev.ts              # Bun.serve 로컬 entry
│   ├── db/
│   │   └── schema.ts             # Drizzle 스키마 (단일 파일)
│   └── domain/                   # 도메인 로직 (lender, vehicle, quote 등)
├── client/
│   ├── src/
│   │   ├── pages/                # 페이지 컴포넌트
│   │   ├── components/           # 재사용 UI
│   │   ├── components/ui/        # shadcn 생성 컴포넌트
│   │   └── lib/utils.ts          # cn() 등 유틸
│   ├── vite.config.ts            # `/api` 프록시 → 8788
│   └── components.json           # shadcn 설정
├── functions/
│   └── [[path]].ts               # Cloudflare Pages Functions adapter
├── drizzle/                      # 자동 생성 마이그레이션 SQL
├── drizzle.config.ts
├── wrangler.jsonc
├── tsconfig.json                 # paths: { "@/*": ["./src/*"] }
└── package.json
```

---

## 8. 환경 변수

| 변수 | 용도 | 위치 |
|---|---|---|
| `DATABASE_URL` | Postgres 연결 문자열 (Supabase) | `.dev.vars` (로컬), Cloudflare Pages Settings (prod) |
| `APP_ENV` | `development` / `production` | `wrangler.jsonc` vars / 배포 시 override |

`.dev.vars` 형식 (gitignore):
```
DATABASE_URL=postgresql://...
```

---

## 9. 신규 프로젝트 stack 매칭 체크리스트

CRM 프로젝트와 동일하게 맞춰야 하는 핵심:

- [ ] **런타임**: Bun (Node 아님)
- [ ] **백엔드**: Hono + Zod + `@hono/zod-validator`
- [ ] **DB**: PostgreSQL + Drizzle ORM + postgres.js 드라이버
- [ ] **호스팅**: Cloudflare Pages + Hyperdrive + `nodejs_compat`
- [ ] **프론트**: React 19 + Vite 8 + TypeScript 5.9
- [ ] **스타일**: Tailwind CSS 4 + shadcn/ui (`base-nova`, baseColor `neutral`)
- [ ] **아이콘**: lucide-react
- [ ] **폰트**: Geist Variable
- [ ] **테스트**: `bun:test`
- [ ] **TypeScript paths**: `@/*` → `./src/*` (서버) / `./client/src/*` (클라이언트)
- [ ] **포매터**: 별도 미설치 — 코드 리뷰 + tsc 로 일관성 유지

추후 통합 시 데이터베이스 / 인증 (현재는 Supabase 의존) / 외부 API contract (`src/domain/external/cheapest-quote-types.ts` 참고) 가 결합 지점이 될 가능성이 높습니다.
