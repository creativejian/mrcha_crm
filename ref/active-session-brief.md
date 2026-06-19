# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-19

Purpose: `영실아 이어가자` / `CRM 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. 인증 설계/플랜: `ref/specs/2026-06-18-crm-auth-design.md`, `ref/plans/2026-06-18-crm-auth-*.md`. CRM 도메인 스펙: `ref/specs/2026-06-17-crm-*`.

## Current Focus (2026-06-19) — 고객 쓰기 #1(본체 필드) 구현 완료(브랜치 `feat/crm-customer-write-fields`, PR/머지 대기). 다음=자식 CRUD(#2)

- 인증+CF 배포 + 코드리뷰 후속(#43~#45) + **CRM 고객 읽기(#46)** + **mc-master UX/성능(#47~#52)** + **고객 상세 읽기 연결(#51)** + **라우팅 딥링크(#53)** 전부 main 머지. **crm.mrcha.app 라이브**.
- **방금 완료(브랜치): 고객 쓰기 #1 — 본체 필드** — 상태필드(연락처/직군/거주지/상담경로)·니즈·구매방식·출고시기·진행상태·계약가능성을 `PATCH /api/customers/:id`로 저장(낙관 갱신+실패 롤백). 새로고침 유지. 설계/플랜 `ref/{specs,plans}/2026-06-19-crm-customer-write-fields*.md`.
- **다음 작업: 고객 쓰기 #2 — 자식 CRUD** — 메모/할일/일정 POST·PATCH·DELETE(임시 id→서버 uuid 교체). 이후 #3 서류(파일 업로드), #4 견적, #5 advisor 배정. + (별도 설계 사이클) enum/lookup 도메인 정리.

## 완료 (2026-06-19)

- **고객 쓰기 #1 — 본체 필드 (브랜치 `feat/crm-customer-write-fields`, PR 대기)**: 고객 본체 컬럼 인라인 수정을 `PATCH /api/customers/:id`로 저장(낙관+롤백). 4커밋 — ①백 `updateCustomer` query + `PATCH /:id`(`customerWriteSchema` 14컬럼 partial, export) + 서버테스트 5(schema·404·400·비파괴200). ②프론트 `lib.updateCustomer`+`CustomerWritePatch` + chance 읽기(`CustomerRow.chance`·`Customer.chance`·`toCustomer`). ③`App.updateCustomerWorkflow`가 statusGroup/status/chance PATCH(목록·상세 공통, 계약완료→확정 동기화, 롤백) + `fetchCustomers`가 chance로 `chanceOverrides` 시드. ④Kim 핸들러 `savePatch` 헬퍼로 연락처/직군/거주지/상담경로/니즈/구매방식/출고시기 PATCH+롤백. **캐비엇**: 비컬럼 구매조건(계약기간 등)은 편집되나 미저장(새로고침 원복, 견적 도메인); manageStatus·advisor 미저장(컬럼없음/다음). **검증**: typecheck0·lint0·test:unit 125·test:server 36·build OK. 브라우저 유지확인은 수동(인증 세션).
- **고객 상세 라우팅 딥링크 (#53 머지)**: 선택 고객을 React 상태(`selectedCustomerNo`/`customerDetailPanelOpen`)가 아니라 **URL이 single source of truth**로. 2커밋 — ①`lib/customer-route.ts` `customerCodeFromLocation(pathname,search)` 순수함수(+테스트 7): `/customer-detail/:code`→path code, `/customers?customer=`→쿼리값. ②`App.tsx` — 상태 2개 제거+버그폴백(`?? customers[0]`) 제거, `customersLoaded` 추가, `selectedCode`/`selectedCustomer`/`isDrawerOpen` URL 파생, 라우트 `/customer-detail/:code`(+`/customer-detail`→리다이렉트, 로딩/없음 처리), 핸들러 navigate화(드로어 열림=`?customer=` push, 재오픈=replace), ESC/백드롭=navigate. `CustomerDetailPage`/`CustomerManagementPage` 무변경(값 출처만). 보너스: 브라우저 뒤로가기 자연 동작. **검증**: typecheck 0·lint 0·test:unit 124·build OK. e2e는 인증 세션 필요라 새로고침/공유 **수동 확인**.
- **고객 상세 읽기 연결 (#51 머지)**: 김민준 상세 drawer를 실 DB로. 4커밋 — ①`lib/customers.ts` `CustomerDetailData`/`toCustomerDetail`(순수)/`fetchCustomerDetail` + `Customer.id`(uuid, 상세 fetch 키) + 단위테스트(toCustomerDetail/formatActivity, 미사용 `fetchCustomer` 제거). ②시드 `scripts/seed-customers.ts`에 김민준 풀세트 전용 블록(컬럼 update + 자식 delete→insert로 멱등 — tasks 4/memos 3/schedules 1/documents 2, needTrim·needColors·needTiming·needMemo·residence). ③`CustomerDetailPage.tsx` — `KimMinjunDetailContent`에 `detail` prop 추가, in-scope `useState` 초기값을 const 6개 제거 후 `detail` 파생으로 교체(statusValues/needs/purchaseFields[구매방식·출고시기]/schedules/checkItems+completed/customerMemos/documents), `KimMinjunDetailHeader` 텍스트 prop화. ④외곽 `CustomerDetailPage`가 `customer.id`로 자체 fetch(로딩/에러 게이팅, `key={customer.id}` 마운트), `.kim-detail-loading` CSS. **메모 createdAt은 `formatActivity`("26/05/14 13:18")** — 정렬은 HH:mm만 보는 `kimTimeLabelMinutes`와 호환. **검증**: typecheck 0·lint 0·test:unit 109·test:server 31·build OK·시드 멱등·`getCustomer` 데이터 형태 일치. **e2e**: `tools/customer-detail-screenshot.spec.ts` 헤더 assertion 정정했으나, #46 이후 목록/상세가 API(JWKS 인증)라 **헤드리스 e2e는 로그인 세션 필요 → 브라우저 시각 확인은 수동**(로그인 후 `bun run dev` 또는 배포본).
- **mc-master UX/성능 (#47~#50)**: ①고객상세 전체화면 헤더 중복 제거(#47, customer-detail은 CustomerDetailPage 자체 헤더 있어 App.tsx 공통헤더 숨김). ②브랜드/모델 전환 잔상 제거(#48 — brandId/modelId 변경 시 **렌더 중 캐시 동기 리셋**, React 'adjusting state when a prop changes' 패턴. useEffect 비동기 setState라 페인트 후 갱신→이전선택 한 프레임 잔상이었음. catalog-cache에 동기 getter getCachedTrims/TrimColors/OptionSummary). ③재진입 속도+트림뷰 브랜드 복원(#49 — brands도 catalog-cache 캐시+`useState` lazy init, `modelId→brandId` 역인덱스로 사이드바·isDomestic 정합. 재진입 시 brands만 미캐시라 블로킹이었음). ④앱 로드 시 카탈로그 프리워밍(#50 — App.tsx 마운트 시 `prefetchCatalog`로 brands+첫모델 미리). **한계**: 트림 URL 직접진입/새로고침은 역인덱스 miss→첫브랜드 폴백(brandId URL 미반영, 후속). 첫 로드 0ms는 불가(네트워크 baseline ~0.5s).
- **CRM 고객 읽기 DB 연결 (#46)**: CRM 도메인 첫 DB 연결. catalog와 동일 3계층 — `db/queries/customers.ts`(`listCustomers`+상담메모용 customer_tasks lateral join·`getCustomer` 자식 묶음) → `routes/customers.ts`(`GET /api/customers`·`/:id`, app.ts 마운트) → `lib/customers.ts`(`fetchCustomers`·DB→`Customer` adapter, `no`는 customerCode 파생, advisor "미배정" 폴백). `App.tsx`가 목업→API 로드(로딩/에러·selectedCustomer null 가드). 시드 `scripts/seed-customers.ts`(멱등, 목업 20명)·`seed:customers`. **범위 외(다음)**: 쓰기(상태/메모/니즈 PATCH)·advisor 이름(profiles)·정산·Topbar 전역검색·견적. 스펙 `ref/specs/2026-06-19-crm-customers-read-design.md`, 플랜 `ref/plans/2026-06-19-crm-customers-read.md`.
- **청소+안정성 (#43)**: unused export 제거(`getCachedTrims`·`wonText`, `modelHasCodes`는 export만) · AuthProvider `getSession().catch`+`getRoleClaim` try/catch(무한로딩 방지, claim 실패는 권한없음 폴백) · Topbar 아바타 실패상태를 boolean→실패URL 저장(재로그인 시 자동 재시도).
- **MCMasterPage 훅 분리 (#44)**: 550→434줄. `mc-master/useMcMasterCatalog(modelId)`(로딩/캐시/reload*) + `useMcMasterSelection`(선택/드래그). 동작보존(test:unit 99). 두 영역 걸친 핸들러(onDrop/bulkDelete/doMove)는 컴포넌트 유지.
- **catalog 라우트 분리 (#45)**: 238→18줄. `routes/catalog/{shared,models,trims,options}.ts`. sub-app 마운트 아님 — `register*(catalog)` 함수가 절대경로 그대로 등록(경로 100% 보존, 23라우트·프론트17 매칭 확인). shared=공통 스키마/`dbErrorMessage`/`run`. trim 본문은 `trimBody` 하나로 create=`.extend({modelId})`/patch=`.partial()`.

## 완료 (이전 세션, 전부 main 머지)

- **인증 통합 (#36)**: 백엔드 JWKS 게이트(top-level `user_role`, customer/무토큰 차단) + 프론트 카카오 로그인/AuthProvider/RequireAuth/`apiFetch` 토큰주입/role 고정(mock 역할탭 제거). `src/auth/*`·`src/middleware/auth.ts`·`src/app.ts`(createApp) · `client/src/lib/{supabase,api,auth}.ts`·`client/src/auth/*`.
- **CF 배포 정상화**: #37 SPA 라우팅(`functions/[[path]].ts`가 `/api`만 Hono, 나머지 정적+`_redirects`) · #38 prod VITE env(`.env.production` 커밋 + `wrangler.jsonc` vars `SUPABASE_URL`) · #39 onError 진단 · #40 연결 복원력.
- **DATABASE_URL → transaction pooler(6543)** (CF production+preview secret). CF Workers 동시 연결 한계 해결.
- **mc-master 연결 안정화 (#40)**: `apiFetch` GET 5xx 재시도(backoff+jitter, 쓰기 제외) + `MCMasterPage` loadError 성공시 리셋. 첫 로드 비결정적 500 복구(검증 6/6 배너0).
- **Cloudflare Hyperdrive 도입 (#41 #42)** — 동시 연결 **근본책 완료**. db를 요청 컨텍스트화(`createDbClient`/`getDefaultDb`+`dbMiddleware`가 `c.var.db` 주입, query는 `executor` 일원화). **핵심 교훈 2가지**: ①Workers는 요청 간 DB 소켓 재사용 불가 → Hyperdrive 경로는 **요청마다 생성 + `waitUntil(client.end())`**(메모이즈 ❌, 재사용 시 'Worker hung'). fallback(로컬/테스트)만 싱글톤. ②Hyperdrive origin은 **direct connection**(`db.<ref>.supabase.co:5432`, user `postgres`)이어야 함 — session pooler는 `pool_size 15` EMAXCONNSESSION로 막힘. binding `HYPERDRIVE`(id `a09fec47…`), 캐싱 disabled, `origin_connection_limit 20`. 검증: prod 25동시×6=150/150 200, hang0 500 0. 스펙 `ref/specs/2026-06-18-crm-hyperdrive-design.md`.
- **Topbar 프로필 실제화 (d2ae492)** — 우상단 아바타=카카오 `avatar_url`(AuthProvider가 세션 user_metadata에서 노출, http→https 정규화, 로드실패→기본아이콘), 이름=`full_name`(없으면 email). 권한은 기존 `roleTab`(user_role claim) 그대로. cjLogo 목업 제거. `client/src/auth/AuthProvider.tsx`(name·avatarUrl 추가)·`App.tsx`·`components/Topbar.tsx`.
- **mc-master 성능: 프런트 캐시+프리패치 (b6d7c52 384c997)** — prod 클릭 랙(요청별 연결+Hyperdrive 왕복, 로컬은 웜 싱글톤이라 빠름) 흡수. `client/src/pages/mc-master/catalog-cache.ts`(제네릭 `makeCache`: 모델·트림·색상·옵션요약, 30s 신선도 + inflight dedupe + 모델 이미지 워밍). 브랜드/모델 hover→프리패치, 재방문 즉시(SWR), 편집 후 `{force:true}` 갱신, 썸네일 `loading=lazy`. **Hyperdrive read 캐싱은 보류**(Caveats).

## Next

- ~~고객 상세 읽기 연결~~ ✅ #51. ~~라우팅 딥링크~~ ✅ #53. ~~고객 쓰기 #1(본체 필드)~~ ✅ 완료(브랜치 `feat/crm-customer-write-fields`, PR 대기) — 위 "완료" 참고.
- **고객 쓰기 #2 — 자식 CRUD (1순위)** — 메모/할일/일정 POST·PATCH·DELETE. 핵심: 새로 추가 항목의 임시 id(`kim-*-${Date.now()}`)를 서버 발급 uuid로 교체, 완료토글(done)·정렬 유지. (서류=#3 파일업로드·스토리지, 견적=#4, advisor 배정=#5.)
- **enum/lookup 도메인 정리 (별도 설계 사이클, 고객 쓰기와 시너지)** — crm 스키마는 현재 전부 text. 업무 어휘(진행상태 1/2차·유입경로·서류종류·할일분류 등)는 **lookup 테이블**(이사님이 배포 없이 수정), 기술 내부값(customer_type·*_mode·quote app/decision/entry_mode 등)은 **enum**. 종속(status_group→status)은 lookup이 자연. 쓰기 PATCH 검증이 도메인 물려받음.
- **견적(quotes) 읽기/쓰기** — crm.quotes·quote_scenarios. 고객 FK 연결됨.
- (선택) Topbar 전역검색 DB 연결, 정산 도메인, 목록 페이지네이션 서버사이드(현재 클라, 20명은 충분).
- (후속, 선택) **prepare:true 전환** — direct origin(5432)은 prepared statement 지원. 현재 두 경로 모두 `prepare:false`(6543 fallback 호환). plan 캐싱 perf 원하면 Hyperdrive 경로만 true.

## ⚠️ Caveats

- CF Pages env: VITE_* 공개값은 `.env.production`(커밋)으로 빌드 주입, 비밀(DATABASE_URL)은 CF secret. 환경변수는 `wrangler.jsonc`로 관리(대시보드는 secret만 가능).
- **DATABASE_URL secret 변경 후 재배포 필수** — 기존 배포는 옛 값. (단 Hyperdrive **origin** 변경은 `wrangler hyperdrive update <id>`로 server-side라 재배포 불요. binding id 불변.)
- `src/db/client.ts`는 fallback 시 `process.env.DATABASE_URL` 읽음 — CF는 nodejs_compat로 process.env 채움. CF prod 정상 경로는 `c.env.HYPERDRIVE.connectionString`(요청별 생성).
- postgres-js `max:1`(tx 롤백 깸)·`fetch_types:false`(타입파싱 깸)는 **금지**(검증됨).
- **Hyperdrive 코드 불변식**: Hyperdrive 경로는 요청별 `createDbClient`+응답 후 `client.end()`. db를 모듈/요청 간 메모이즈하면 'Worker hung' 재발. 메모이즈는 fallback(getDefaultDb)만.
- CF prod 배포는 엣지 롤아웃에 ~1분 — 머지 직후 e2e는 옛/새 isolate 혼재로 일부 실패할 수 있음. `/api/health`의 `hyperdrive:true` 일관 확인 후 재검증.
- `DATABASE_URL`(fallback, 6543 transaction pooler)은 Hyperdrive origin(direct 5432)과 **별개**. 둘 다 유지.
- role 변경은 토큰 갱신(~1h)/재로그인까지 반영 안 됨(claim 방식).
- **mc-master는 프런트 캐시(`catalog-cache.ts`) 경유** — query를 직접 호출 말고 `fetchModelsCached`/`fetchTrimsCached`/`fetchTrimColorsCached`/`fetchOptionSummaryCached` 사용. 편집 후 목록 갱신은 `{force:true}`(reload* 함수) 필수 — 안 그러면 30s 동안 옛 데이터.
- **Hyperdrive read 캐싱 보류 결정**: `/api/catalog/*`는 읽기+쓰기 공용이라 켜면 편집 직후 stale + 프런트 force-refetch 무력화. 캐싱은 읽기 전용 `/api/vehicles/*`(고객 견적)에만, 필요 시 별도 cached 바인딩+PR.

## Verification (2026-06-18)

- `typecheck` 0 · `lint` 0 · `test:unit` 99 · `test:server` 28(--env-file=.env.local) · `build` OK.
- crm.mrcha.app: 카카오 로그인 화면 · SPA 라우팅(`/`,`/quotes` 200) · `/api` 게이트(401) · **mc-master 첫 로드 6/6 정상**.
- **Hyperdrive(#41 #42)**: prod `/api/catalog/models` **25동시×6=150/150 200**(hang 0, 500 0), mc-master 첫 로드 6엔드포인트 동시 전부 200. `/api/health` → `hyperdrive:true`.
- **Topbar·mc-master 성능(d2ae492 b6d7c52 384c997)**: `typecheck`/`lint`/`build`/`test:unit` 99 통과. 체감은 배포 후 확인.

## Collaboration

- (Codex 세션) User=이사님, assistant=영실. (Claude Code 세션) 호칭은 CLAUDE.md 팀 구성(송실장/유슨생).
- 판단 질문(`어때`/`괜찮을까`/`너 생각은?`): 추천·트레이드오프 먼저 + `적용할까요?`. 실행어(`응`/`해줘`/`진행해`): 즉시 실행.
- 팀 공유 결정·맥락은 git(`ref/*.md`, `AGENTS.md`)에. 로컬 메모리는 공유 안 됨.
