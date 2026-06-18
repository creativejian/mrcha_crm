# CRM 인증 — Supabase / Cloudflare 선행 작업 체크리스트

CRM 인증(카카오 로그인 + role 게이트)이 실제로 동작하려면 아래 외부 설정이 필요하다. 코드(백엔드 미들웨어·프론트)는 `feat/crm-auth`에서 진행 중이며, 이 문서의 작업이 끝나야 **실 로그인 e2e**가 동작한다.

선행 진행 현황(2026-06-18):
- ✅ `user_role` enum에 `dealer` 추가 (완료)
- ✅ Cloudflare Pages 프로젝트 생성 + GitHub 연결 + `crm.mrcha.app` 도메인 연결 (배포는 아직)
- ⏳ 아래 1~3 (Supabase) + 4 (CF 환경변수, 배포 시)

---

## 1. Custom Access Token Hook (role → JWT `user_role` claim) ⭐핵심

백엔드 미들웨어는 JWT의 top-level `user_role` claim으로 게이트한다. 이 claim을 Supabase가 토큰 발급 시 넣어주도록 Hook을 등록한다. **이게 없으면 claim이 없어 모든 로그인이 403(권한 없음)으로 막힌다.**

### 1-1. Function + 권한 (SQL Editor에서 실행)

```sql
-- profiles.role → JWT user_role claim 주입
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = (event->>'user_id')::uuid;
  claims := event->'claims';
  if v_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role::text));
  else
    claims := jsonb_set(claims, '{user_role}', 'null');
  end if;
  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- supabase_auth_admin만 실행/조회 (다른 role은 차단)
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.profiles to supabase_auth_admin;

-- profiles는 RLS 활성(정책 4개 존재) → auth admin 읽기 정책 추가(기존 정책 불변)
create policy "Allow auth admin to read profiles for token hook"
  on public.profiles as permissive for select
  to supabase_auth_admin using (true);
```

> `to_jsonb(v_role::text)` — enum을 **문자열**로 넣는다(백엔드 `verifyAndGate`는 `user_role`을 string으로 읽음). `dealer`도 enum에 있으므로 그대로 통과한다.

### 1-2. Hook 활성화 (대시보드)

- **Authentication → Hooks** → **Customize Access Token (JWT) Claims** (= Custom Access Token) → **Enable** → function `public.custom_access_token_hook` 선택.
- 적용 후 **새 로그인/토큰 갱신부터** `user_role` claim이 실린다(기존 발급 토큰엔 없음 — 재로그인 필요).

### 1-3. 검증

- 임의의 `staff`/`admin` 계정으로 로그인 → access_token을 jwt.io 등에 붙여 디코드 → payload에 `"user_role": "admin"` 같은 값이 있으면 성공.

---

## 2. Redirect URLs (allowlist)

로그인 후 CRM으로 돌아오는 redirect를 허용한다. **Site URL과 앱 기존 redirect는 건드리지 말고 추가만** 한다(앱과 같은 프로젝트 공유).

- **Authentication → URL Configuration → Redirect URLs**에 추가:
  - `https://crm.mrcha.app/**`
  - 로컬 개발: `http://127.0.0.1:5173/**` 와 `http://localhost:5173/**` (vite dev 포트)

> 카카오 디벨로퍼스 쪽은 추가 작업 없음 — 카카오 Redirect URI는 Supabase callback(프로젝트 단위)이라 이미 등록돼 있고, CRM은 `redirectTo`만 다르며 그건 Supabase가 검증한다.

---

## 3. 키 / URL 확보 (프론트·백엔드 env에 들어감)

- **Settings → API**:
  - **Project URL** → `SUPABASE_URL`(백엔드 JWKS) / `VITE_SUPABASE_URL`(프론트)
  - **publishable key** (신키 체계; 구 anon/public key 자리) → `VITE_SUPABASE_PUBLISHABLE_KEY`

---

## 4. Cloudflare Pages 환경변수 (배포 시)

CF Pages 프로젝트 → **Settings → Environment variables**에:
- `SUPABASE_URL` — 백엔드 미들웨어 JWKS 검증용
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — 프론트 빌드 주입(빌드 타임)

> 빌드 명령/출력은 이미 `wrangler.jsonc`(`pages_build_output_dir: client/dist`)에 맞춰져 있음. 빌드 커맨드는 `bun run build`.

---

## 적용 순서 권장

1. (지금) 1번 Hook + 2번 redirect를 먼저 적용 → 코드가 붙으면 로컬에서 카카오 로그인 e2e 테스트 가능(env는 `.env.local`/`.dev.vars`).
2. 프론트 인증 코드 완성 후 로컬 검증.
3. 통합 머지 → CF 배포(4번 env) → `crm.mrcha.app` 실환경 검증.
