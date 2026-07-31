# CRM Pages → Workers 마이그레이션 (2026-07-31)

목적 = **Workers Logs**(7일 보존·검색 로그). Pages는 실시간 tail뿐이라 "조용한 prod 실패"
(#202 두 달 무발송·#145~#147 SSE 524)의 증거가 안 남았다. 브리프 07-31 오후 인계 절차 ①~⑤의
판정 SSOT. 상세 배경 = `ref/session-archive.md` 07-31 오후 블록.

## 진행 상태

| 단계 | 상태 | 비고 |
|---|---|---|
| ① Worker 병행 생성 | ✅ 2026-07-31 | `mrcha-crm` → https://mrcha-crm.dolcejian.workers.dev |
| ② env·시크릿 재입력 | ✅ 2026-07-31 | 아래 체크리스트 — 7종 전부 `secret bulk` 입력·검증 |
| ③ workers.dev 전체 스모크 | ✅ 2026-07-31 | 아래 스모크 결과 |
| ④ crm.mrcha.app 스위치 | ⏸ 유슨생 확인 대기 | 롤백 = 도메인 되돌리기 |
| ⑤ Workers Builds + watch paths | ⏸ ④ 이후 | 자동 이관 없음 — 수동 재설정 |

## 구성 (커밋된 파일)

- **`wrangler.worker.jsonc`** — 병행 기간 전용 설정(Pages 빌드가 `wrangler.jsonc`를 읽어서 분리).
  `main: src/worker.ts` + `assets`(client/dist, SPA fallback, `run_worker_first: ["/api/*"]`) +
  Hyperdrive 동일 바인딩 + **`observability.enabled: true`**(이번 마이그레이션의 목적).
- **`src/worker.ts`** — `export default app` 한 줄 엔트리. 모듈 워커라 ExecutionContext가 자동
  전달 — Pages 엔트리(functions/[[path]].ts)의 수동 전달 누락 → SSE 데드락 함정 구조 소멸.
- **`package.json`** — `deploy:worker` = 빌드 → `client/dist/_redirects` 삭제 → deploy.

### 함정 실측 2건 (재발 방지)

- **`_redirects` SPA 캐치올(`/* /index.html 200`)을 Workers 검증기가 무한 루프로 거부**(코드
  100324). Pages는 허용하던 룰. Workers에선 `not_found_handling: "single-page-application"`이
  같은 역할이라 파일 자체가 불필요.
- **`.assetsignore`로는 제외 불가** — wrangler가 assets 루트의 `_redirects`/`_headers`를 일반
  자산이 아니라 설정 파일로 특수 취급(ignore 매칭보다 먼저 읽음). 그래서 deploy 스크립트에서
  빌드 후 물리 삭제한다. Pages 폐기 때 `client/public/_redirects`도 함께 지울 것.

## env·시크릿 체크리스트 (Pages → Worker 재입력, 2026-07-31 완료)

평문 vars 2종은 `wrangler.worker.jsonc`에 커밋(Pages 프로덕션과 동일 값 실측 —
`wrangler pages download config`로 확인): `APP_ENV=development` · `SUPABASE_URL`.
플래그류(`PUSH_NOTIFY`·`EMBED_ON_WRITE`·`AI_HINT_ON_WRITE`·`NODE_ENV`)는 **Pages에도 미설정**
(코드 기본값) — Worker에도 넣지 않는다.

시크릿 7종(`bunx wrangler secret put <NAME> -c wrangler.worker.jsonc`, 값은 Pages에서 내보내기
불가라 아래 출처로 재구성):

| 이름 | 출처 | 검증 |
|---|---|---|
| `DATABASE_URL` | `.env.local` (session pooler) | prod에선 HYPERDRIVE가 항상 우선 — 폴백 전용 |
| `SUPABASE_SECRET_KEY` | `.env.local` | 서류 서명 URL 스모크 200 |
| `GEMINI_API_KEY` | `.env.local` | SSE ask 스모크 정상 |
| `SEND_PUSH_SECRET` | `.env.local` | (실발송 스모크는 안 함 — 실기기 e2e 보류 항목) |
| `PARTNER_QUOTE_API_KEY` | `.env.local` | external support-matrix 200 / 무키 401 대조 |
| `PARTNER_QUOTE_API_URL` | **재구성** `https://mc.mrcha.app/api/external/quotes/calculate` | ⚠️`.env.local` 값은 dev 릴레이(`…/api/quotes/calculate`)라 그대로 쓰면 안 됨 |
| `GEMINI_PROXY_URL` | **재구성** `https://wmkbmlespgzkeekliwio.supabase.co/functions/v1/crm-gemini-proxy` | `.env.local`에 없음(로컬은 직결). POST 401(verify_jwt) = 도달 확인 |

빌드타임 `VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY`는 로컬 빌드가 `.env.local`에서
주입(vite `envDir` = 레포 루트). Workers Builds 전환 시 빌드 env로 등록 필요(⑤에서).

## 스모크 결과 (2026-07-31, workers.dev)

- 정적/SPA: `/` 200 · `/quotes` 딥링크 200(index.html) — 배포 직후 수십 초는 404 전파 지연 있음
- `/api/health` 200 `hyperdrive:true` · 무토큰 `/api/customers` 401(게이트 정상)
- 관리자 JWT(magiclink 절차): `/api/customers` 24명 · `/api/vehicles/brands` 33(catalog 스키마)
  · `/api/me/live-consulting` 200
- **SSE** `/api/assistant/ask`(stream): 200 · text 2 + done 1 · RAG 소스 포함 — dbHold·waitUntil·
  Gemini 프록시(Authorization 포워딩) 전 경로 검증. 스모크 대화 2행 삭제 원복 완료
  (`crm.assistant_messages` — 임베딩 source_type에 assistant 없음 실측, 직접 삭제 안전)
- 서류함: 서명 URL 발급 → 실파일 GET 200(724KB, 읽기 전용)
- 브라우저(agent-browser, 해시 세션 — Supabase redirect 허용목록 무관): 대시보드·고객 목록
  실데이터 렌더 확인

미실시: 서류 **업로드**(쓰기)·FCM 실발송 — 도메인 스위치 후 실기 1회에서 확인 권장.

## ④ 도메인 스위치 절차 (대기 중)

1. CF 대시보드: Pages `mrcha-crm` → Custom domains에서 `crm.mrcha.app` 제거
2. Worker `mrcha-crm` → Settings → Domains & Routes → Custom Domain `crm.mrcha.app` 추가
3. 즉시 스모크: 로그인(카카오 OAuth — 오리진 불변이라 allowlist 무관)·고객 목록·업무 AI 1문
4. **롤백** = 역순(Worker 도메인 제거 → Pages에 재추가). Pages 배포는 그대로 살아 있다.

## ⑤ 전환 후 정리 목록 (Pages 폐기 시)

- Workers Builds 연결(빌드 `bun install && bun run build && rm -f client/dist/_redirects`,
  배포 `wrangler deploy -c wrangler.worker.jsonc`) + **watch paths 재설정**(`ref/*`·`*.md`
  제외 — Pages 설정은 자동 이관 안 됨) + 빌드 env에 `VITE_*` 2종
- `wrangler.worker.jsonc` → `wrangler.jsonc`로 승격(파일 교체), `functions/[[path]].ts` 삭제,
  `src/app.test.ts`의 onRequest 테스트 제거, `knip.json` entry 정리
- `client/public/_redirects` 삭제 + `deploy:worker`의 `rm` 단계 제거
- Pages 프로젝트 삭제(또는 보관), 문서 갱신(AGENTS.md·CLAUDE.md의 CF Pages 서술 → Workers)
- 프리뷰 보호(Access)·rate limiting 등 CF 잔여 권고는 브리프 참조
