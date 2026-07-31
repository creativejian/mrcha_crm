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
| ④ crm.mrcha.app 스위치 | ✅ 2026-07-31 | **zone route 방식**(아래) — 롤백 = Pages 도메인 재부착 |
| ⑤ Workers Builds + watch paths | ✅ 2026-07-31 저녁 | 유슨생 대시보드 설정 + 첫 자동 빌드 success·배포 `c633d7a6` 실측 |
| ⑥ Pages 폐기 정리 | ✅ 2026-07-31 저녁 | 같은 날 완결(유슨생 "지금 폐기" 지시 — SEND_PUSH_SECRET 프로브 실증으로 앞당김). PR `#413` + 프로젝트 삭제 |

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
| `SEND_PUSH_SECRET` | `.env.local` | ✅ 인증 프로브 실증(07-31 저녁): 존재하지 않는 UUID로 send-push 직접 호출 — 무키 401 / 유키 200 `sent:0`(발송 0건으로 값 유효성만 검증) |
| `PARTNER_QUOTE_API_KEY` | `.env.local` | external support-matrix 200 / 무키 401 대조 |
| `PARTNER_QUOTE_API_URL` | **재구성** `https://mc.mrcha.app/api/external/quotes/calculate` | ⚠️`.env.local` 값은 dev 릴레이(`…/api/quotes/calculate`)라 그대로 쓰면 안 됨 |
| `GEMINI_PROXY_URL` | **재구성** `https://wmkbmlespgzkeekliwio.supabase.co/functions/v1/crm-gemini-proxy` | `.env.local`에 없음(로컬은 직결). POST 401(verify_jwt) = 도달 확인 |

빌드타임 `VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY`는 로컬 빌드가 `.env.local`에서
주입(vite `envDir` = 레포 루트). Workers Builds에도 빌드 변수로 등록 완료(⑤).

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

~~미실시~~ → **전량 실증 완료(07-31 저녁)**: 서류 업로드+AI 분류(crm-analyst Edge)는 유슨생 실기로 확인(W투어.jpg → 사업자등록증 자동 분류), SEND_PUSH_SECRET은 인증 프로브(아래 체크리스트).

## ④ 도메인 스위치 — 실행 결과 (2026-07-31 완료, zone route 방식)

**Custom Domain이 아니라 zone route**(`crm.mrcha.app/*` → `mrcha-crm`, wrangler.worker.jsonc
`routes`)로 전환했다. 함정 실측 3건이 방식을 결정했다:

1. **Custom Domain API는 기존 CNAME이 있으면 100117로 거부**("externally managed DNS records").
   crm의 CNAME(→ mrcha-crm.pages.dev)이 zone에 남아 있어 부착 불가.
2. **wrangler OAuth 토큰엔 DNS 쓰기 스코프가 없다**(dns_records 조회조차 Authentication error)
   — CNAME을 지울 수 없어 Custom Domain 경로가 막혔다. (이 과정에서 Pages 도메인을 먼저 뗐다가
   1분가량 522 — 즉시 재부착으로 복구. **순서 교훈: 뗄 준비가 다 되기 전에 떼지 말 것**.)
3. **Pages 커스텀 도메인이 살아 있는 동안 zone route는 그 호스트를 못 받는다**(Pages 우선).
   route 배포 후에도 Pages가 계속 서빙했고, Pages 도메인을 떼자 route가 인수했다.

**판별법**(전파 중 프로브 착시 주의): 응답 본문의 vite 번들 해시로 판별한다 —
`curl -s https://crm.mrcha.app/ | grep -o 'assets/index-[^"]*\.js'`가 Worker 배포본
(`client/dist/index.html`)과 일치하면 Worker 서빙. `/api/*`는 `bunx wrangler tail -c
wrangler.worker.jsonc`로 요청 이벤트 수신 확인(⚠️ `-c` 없이 돌리면 cwd의 Pages 설정 탓에
"Pages project" 에러). 미존재 `.txt` 200/404 프로브는 캐시·SPA fallback 차이로 신뢰 불가.

**같은 날 오후 정식 Custom Domain 전환까지 완료**(유슨생 "지금 깔끔하게" 지시): 유슨생이
대시보드에서 crm CNAME 삭제(토큰에 DNS 스코프가 없어 사람 몫) → 5초 간격 재시도 루프가 삭제를
감지해 Custom Domain 즉시 부착(다운타임 체감 0 — DNS 캐시가 공백을 가림) → 설정을
`{"pattern":"crm.mrcha.app","custom_domain":true}`로 교체·재배포 → 과도기 zone route는
wrangler가 안 지워서 API DELETE로 수동 제거(⚠️ wrangler deploy는 config에서 뺀 route를
회수하지 않는다). 스위치 직후 prod 스모크: `/api/customers` 24 · SSE ask 200(text+done) ·
스모크 대화 원복 완료.

**최종 상태**: DNS 레코드는 Custom Domain이 소유(대시보드에 Worker 타입으로 표시),
zone route 0, CNAME 0. Pages 프로젝트·pages.dev 배포는 유지(⑥에서 폐기). workers.dev
서브도메인은 비활성(공개 표면 축소 — 의도 유지).

**롤백**(이제 3단계): ①Worker Custom Domain 제거(`DELETE …/workers/domains/{id}`) ②CNAME
재생성(crm → mrcha-crm.pages.dev, 프록시 on — 대시보드) ③Pages 도메인 재부착
(`POST …/pages/projects/mrcha-crm/domains` {"name":"crm.mrcha.app"}).

## ~~과도기 배포 규칙~~ (2026-07-31 저녁 해제)

~~main 머지 ≠ prod 배포 — 수동 `deploy:worker` 필수~~ → **Workers Builds 가동으로 해소.**
설정: 빌드 `bun install && bun run build && rm -f client/dist/_redirects` · 배포
`npx wrangler deploy -c wrangler.worker.jsonc` · 빌드 변수 `VITE_SUPABASE_URL`·
`VITE_SUPABASE_PUBLISHABLE_KEY`(값 OCR 기계 대조 검증) · watch paths 제외 `ref/*`·`*.md` ·
브랜치 빌드 off · 빌드 캐시 on. PR `#412` 머지 push의 첫 자동 빌드 success + 새 배포
`c633d7a6` 100% 활성 실측(번들 해시가 로컬 빌드와 동일 = 빌드 변수 정합 증명).
함정: 연결 다이얼로그가 "내부 오류" 토스트를 띄워도 **실제로는 저장됐을 수 있다** — 재제출하면
"A trigger already exists". 설정 페이지 새로고침으로 실상태 확인이 정답.

## ⑥ 전환 후 정리 — ✅ 완료 (2026-07-31 저녁, PR `#413` squash `b7a16de`)

- ✅ `wrangler.worker.jsonc` → `wrangler.jsonc` 승격(bare wrangler 커맨드 자연 동작 — tail `-c`
  필수 함정 소멸), `functions/[[path]].ts`·`client/public/_redirects` 삭제, `deploy:worker` rm
  단계 제거, app.test.ts는 Workers 엔트리 동일성 잠금(`export default app === app`)으로 교체.
- ✅ **머지 전 대시보드 선행**: Workers Builds 배포 명령 `-c` 제거(유슨생) → 머지 빌드 success ·
  배포 `ba250b10` · `/quotes` 딥링크 200(`_redirects` 없이 SPA 폴백 검증).
- ✅ **Pages 프로젝트 삭제**: 배포 1,273개를 API 루프로 선삭제해야 했다(프로젝트 DELETE가
  8000076 "too many deployments"로 거부 — 라이브 배포 1개는 남아도 삭제 통과). 앱
  `mr-cha-app` 프로젝트는 불가침 확인. ⚠️ 함정 2: ①이 삭제 루프를 zsh에서 돌리면
  `for id in $ids`가 워드 분리를 안 해 전량 000 실패한다(bash 스크립트로 실행할 것)
  ②`functions/` 삭제는 `profiles-write-guard.test.ts`의 `SCAN_ROOTS`를 던지게 했다(존재하지
  않는 루트 = Glob.scan throw — CI test:pure가 잡음, 로컬 test:pure를 건너뛴 실수).
- 잔여 CF 권고(rate limiting·AI Gateway 실측·프리뷰 재평가)는 브리프 참조.
