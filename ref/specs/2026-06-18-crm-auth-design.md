# CRM 인증 설계 (카카오 로그인 + 역할 게이트 + Cloudflare 배포)

- 작성일: 2026-06-18
- 상태: **승인됨 (구현 전)** — brainstorming 합의 결과
- 관련: CRM 도메인(고객·견적) DB 연결의 선행 작업. 인증 컨텍스트(담당자)가 쓰기보다 먼저 깔려야 함.

## 1. 배경 / 목적

- 앱은 `mrcha.app`, CRM은 `crm.mrcha.app`으로 운영한다.
- 배포는 Cloudflare Pages Functions(이미 구조 존재: `wrangler.jsonc` + `functions/[[path]].ts` + Hono).
- 로그인은 **카카오만** 허용한다. **`customer`를 제외한 역할(staff/manager/admin/dealer)만** CRM에 접근한다.
- 현재 CRM 백엔드(Hono)는 인증이 전혀 없고(mock), postgres에 직접 연결(`DATABASE_URL`=master)해 **Supabase RLS를 우회**한다 → 인가를 RLS에 기댈 수 없고, **백엔드 미들웨어에서 직접 게이트**해야 한다.

## 2. 결정 요약

| 항목 | 결정 |
|---|---|
| JWT 검증 | **JWKS edge 검증**(jose, 매 요청 외부 왕복 없음, Web Crypto 기반 edge 호환) |
| 작업 범위 | **로그인 게이트 + role 연동** (mock 역할 탭 수동 전환 제거) |
| 역할 체계 | **단일 `profiles.role`** — `customer / staff / manager / admin / dealer` |
| role 전달 | **Custom Access Token Hook으로 JWT claim(top-level `user_role`)에 role 주입** (DB 왕복 0, CRM이 `profiles`를 read조차 안 함 → public 불가침 경계에 부합) |
| 역할 매핑 | `admin→최고관리자 · manager→팀장 · staff→상담사 · dealer→딜러` |

### claim 방식의 트레이드오프 (수용함)
- role이 토큰에 박히므로 **role 변경이 토큰 갱신(기본 1시간) 또는 재로그인까지 반영 안 됨**. 승격은 무해, **강등(권한 회수) 즉시성만** 주의. 내부 도구라 수용하되, 즉시 차단이 필요하면 강등 시 `auth.admin.signOut(userId)`로 세션 무효화하는 보강을 **후속**으로 둔다.

## 3. 아키텍처 개요

```
[브라우저 · crm.mrcha.app SPA]
  supabase-js → 카카오 signInWithOAuth (publishable key)
  → Supabase Auth 세션(access_token JWT, 자동 저장/갱신)
  → fetch 래퍼가 모든 /api 호출에 Authorization: Bearer <token> 주입

[Cloudflare Pages Functions · Hono]
  auth 미들웨어 (모든 /api/* 보호):
   1) Authorization 헤더에서 JWT 추출 (없으면 401)
   2) Supabase JWKS로 서명 검증 (jose, JWKS 캐시 → 왕복 없음)
      issuer=${SUPABASE_URL}/auth/v1, audience='authenticated'
   3) payload.user_role claim 확인
   4) user_role === 'customer' 또는 claim 없음 → 403
      그 외(staff/manager/admin/dealer) → 통과, c.set("user", { id, role })

[화면 권한]
  role claim → 화면 권한 매핑 (프론트/백엔드 둘 다 토큰에서 읽음)
   admin→최고관리자 · manager→팀장 · staff→상담사 · dealer→딜러
  mock 수동 전환 제거, 로그인 role 고정
  미인증 → /login 리다이렉트, customer/미허용 → "접근 권한 없음"
```

핵심 단위 4개: ① 프론트 인증 클라이언트(supabase-js 래퍼 + fetch 인터셉터), ② 백엔드 auth 미들웨어(JWKS 검증 + claim 게이트), ③ role→화면권한 매핑, ④ 로그인/가드 UI.

## 4. 컴포넌트 상세

### 4.1 백엔드 auth 미들웨어 (Hono)
- 위치: `src/middleware/auth.ts`. `app.use("/api/*", authMiddleware)`로 적용하되 `/api/health`는 공개.
- JWKS: `jose`의 `createRemoteJWKSet(${SUPABASE_URL}/auth/v1/.well-known/jwks.json)` + `jwtVerify(token, jwks, { issuer, audience: 'authenticated' })`. JWKS는 캐시.
- 게이트: `payload.user_role`(Hook이 주입). `customer`/미존재 → 403. 그 외 통과.
- **DB 조회·`profiles` 정의 없음**(claim 방식). 미들웨어는 토큰만으로 판단.
- 에러: 토큰 없음/형식오류/만료/서명불일치 → 401, customer → 403. 응답은 기존 `{ error }` JSON 형식.

### 4.2 프론트 인증
- `@supabase/supabase-js` 도입. `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)`.
- `lib/auth.ts` — supabase 클라이언트 + `signInWithKakao()`(`signInWithOAuth({ provider:'kakao', options:{ redirectTo } })`) + `signOut()`. 세션은 supabase-js가 localStorage 자동 저장·갱신.
- `lib/api.ts` — **fetch 래퍼**: `getSession()`의 `access_token`을 `Authorization: Bearer`로 주입. 기존 `lib/catalog.ts`·`lib/vehicles.ts`의 `fetch(...)`를 이 래퍼 경유로 교체. 401 시 세션 만료 처리(재로그인 유도).
- `AuthProvider`(context) — 부팅 시 세션 확인 → 사용자 role(top-level `user_role` claim; supabase-js `auth.getClaims()` 또는 access_token 디코드로)·닉네임(`user_metadata`) 보관. `onAuthStateChange` 구독.
- `LoginPage`(`/login`) — 카카오 버튼만. OAuth 콜백 복귀 시 supabase-js가 URL 토큰 교환(`detectSessionInUrl`).
- 라우트 가드 — 미인증 → `/login`. role 없음/`customer` → "접근 권한 없음" + 로그아웃.
- `App.tsx` — `AuthProvider`로 감싸고 **mock 역할 탭 수동 전환 state 제거** → claim role 고정.

### 4.3 role → 화면 권한
- 별도 `/api/me` 불필요(서버가 실제 게이트이므로 프론트는 표시·UI 분기용으로 토큰 claim 사용).
- 매핑: `admin→최고관리자 · manager→팀장 · staff→상담사 · dealer→딜러`.
- `mc-master`의 `canEdit`(현재 "최고관리자")를 비롯한 권한 분기가 claim role을 따름.

### 4.4 환경변수 / 배포
- 프론트(VITE_): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- 백엔드(Functions): `SUPABASE_URL`(JWKS). 인증엔 `DATABASE_URL` 불필요(claim 방식)지만 catalog API가 이미 사용.
- Cloudflare Pages 환경변수 등록 + custom domain `crm.mrcha.app`. 로컬은 `.dev.vars`/`.env.local`.

### 4.5 에러처리 / 테스트
- 미들웨어 단위테스트(`test:server`): 테스트용 키쌍으로 JWT 서명 + JWKS 주입(jose) → role claim별 검증. `customer`→403, `staff/manager/admin/dealer`→통과, 무효/만료/서명불일치→401.
- 프론트 라우트 가드 테스트(미인증→/login, customer→거부 화면).
- 토큰 만료는 supabase-js 자동 refresh, 401 시 재로그인 유도.

## 5. 선행 의존 (앱 · Supabase = 이사님/직접 처리, CRM 코드 밖)
1. **`user_role` enum에 `dealer` 추가** + 앱 쪽 딜러 처리
2. **Custom Access Token Hook 등록**(`profiles.role` → JWT top-level `user_role` claim)
3. **Supabase Auth redirect allowlist에 `crm.mrcha.app` 추가** (Site URL 포함)
4. 카카오 provider (이미 설정됨 — 앱이 사용 중)

> 카카오 디벨로퍼스 자체는 추가 작업 없음(카카오↔Supabase 연결은 Supabase 프로젝트 단위로 이미 등록, CRM은 redirectTo만 다름 → Supabase가 검증).

## 6. 범위 밖 (후속)
- CRM 내 역할 승격 UI (현재 승격은 앱에서 처리)
- 강등 즉시 차단(세션 무효화) 보강
- 역할별 화면 세부 권한(딜러 전용 화면 등)
- 고객/견적 DB 연결(인증 완료 후 본 작업)

## 7. 구현 순서 (개략)
1. 백엔드 auth 미들웨어 + 단위테스트 (선행 의존이 안 끝나도 테스트용 키로 검증 가능)
2. 프론트 supabase-js 도입 + `lib/auth`/`lib/api` 래퍼 + `AuthProvider`
3. `LoginPage` + 라우트 가드 + mock 역할 탭 제거 + role 매핑
4. 환경변수/배포 설정 (선행 의존 완료 후 실배포 검증)
