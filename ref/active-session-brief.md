# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-20

Purpose: `영실아 이어가자` / `CRM 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. 인증 설계/플랜: `ref/specs/2026-06-18-crm-auth-design.md`, `ref/plans/2026-06-18-crm-auth-*.md`. CRM 도메인 스펙: `ref/specs/2026-06-17-crm-*`.

## Current Focus (2026-06-20) — #3 서류 **완료**(업로드 #58·미리보기 UX #59#60·**오피스제거+이미지/PDF 병합다운로드 #68**·**분류 변경 버그수정 #69** 전부 main+prod 배포·브라우저 검증 OK). 다음=enum/lookup 설계 또는 #4 견적

- 인증+CF 배포 + 코드리뷰(#43~#45) + **고객 읽기(#46/#51)** + **mc-master UX/성능(#47~#52)** + **딥링크(#53)** + **고객 쓰기 #1 본체(#54)·#2 자식CRUD(#55)** + **전화번호 숫자만저장(#56)·010 prefix+상세 로딩 병렬(#57)** + **상세 결과캐시(1d73cc2)·로그인 로고(c213f14)** 전부 main 머지. **crm.mrcha.app 라이브**.
- 김민준(`CU-2605-0020`) 상세는 이제 읽기+쓰기(상태/니즈/구매방식·출고시기/메모/할일/일정)가 DB 연동되고, 진입 로딩도 캐시+병렬로 거의 즉시. 김민준 외 고객은 아직 구 일반 레이아웃(읽기만).
- **다음 작업 후보**: ①**enum/lookup 도메인 정리**(별도 설계 — 시작 전 이사님께 "업무 어휘를 코드/배포 없이 직접 수정(관리 UI)까지 원하는지" 확인 필요. 서류 `customer_documents`의 title/doc_type 분류 중복 컬럼 정리도 여기서). ②**#4 견적**(crm.quotes·quote_scenarios, 고객 FK 연결됨). 이후 #5 advisor 배정.

## 리팩토링 트랙 (2026-06-20, 별도 사이클) — 안전 작업 소진, 본체 분해만 남음

- **PR #61~#78 머지**(코드베이스 전체 분석 5에이전트 기반). 죽은코드·도메인상수·lib/http 통일·백엔드 run()·**Topbar usePopoverDismiss(#72)**·**CSS brand 토큰화(#73**, `#5836ff` 399곳→`var(--brand)`, 검증=정적 diff로 시각변화0)·**거대파일 분해 1~4차(#74~#77)**: `CustomerDetailPage` **6099→5706줄**, 도메인별 타입+상수+헬퍼를 `lib/kim-detail-utils`·`kim-schedule`·`kim-status-fields`·`kim-popover-frames`로 분리(+단위테스트 42).
- **renderRow 분해(#78 머지)**: `CustomerManagementPage.renderRow` **481→87줄** 조립함수로. ①순수 헬퍼/상수/타입→`lib/customer-table.ts`(신규, page·셀 공유→순환 import 방지) ②9개 셀(select/info/vehicle/stage/chance/nextAction/operation/finalUpdate/actions)→`CustomerManagementRow.tsx`(신규) 컴포넌트 추출(셀 props=의존 상태/핸들러/ref 1:1). page **1691→1012줄**. legacy stage 죽은분기 전용 `changeCustomerStatus`·`stageSignal` 제거(`openStageFor` 인프라는 무해 잔존→소규모 후속). typecheck0·lint0·test:unit189·build OK.
- **다음 = 본체 `KimMinjunDetailContent` ~4500줄 분해**(Tier3 최고위험, props/상태/JSX 얽힘). 영역 컴포넌트(서류함·견적 워크벤치·니즈·상담작업) 추출은 **신중 설계 + 상태 전달 구조 검토 선행**. 별도 세션.
- **보류**: 견적 도메인 분리는 #4(crm.quotes) 데이터화 이후(mock·`KimQuoteItem` 타입 변경 가능). CSS 후속(죽은CSS=동적클래스 위험·spacing=안티패턴). `kim` prefix 일반화 리네임은 김민준 시범→전체표준 확정 후 일괄.
- **관례**: 거대파일 분해는 브랜치 먼저(#75 main 직접커밋 사고). 동작보존=typecheck0(참조정합)+단위테스트(입출력캡처).

## 완료 (2026-06-20)

- **보안: auth 훅 search_path 고정 (직접 DDL, 마이그레이션 없음)**: Supabase Security Advisor "Function Search Path Mutable" 경고 대상 `public.custom_access_token_hook`(CRM 인증 #36의 JWT `user_role` claim 주입 훅, `profiles.role`→claim) 에 `ALTER FUNCTION public.custom_access_token_hook(jsonb) SET search_path = '';` 적용. 본문이 이미 `public.profiles`/`public.user_role`로 정규화돼 있어 **동작 불변**(호출 검증 OK: 없는 user→`user_role:null`, 실제 user→`user_role:"admin"`). **앱+CRM 공유 Auth 훅**(토큰 발급마다 호출)이라 적용 후 카카오 로그인 정상 확인 권장. drizzle 관리 밖(public)이라 마이그레이션 파일 없음 — 재현은 위 SQL. **남은 advisor 경고 2건**(`increment_faq_click_count`·`transition_estimate_status`, SECURITY DEFINER + authenticated EXECUTE)은 **앱 함수**라 앱팀 영역.
- **고객 쓰기 #3 — 서류 업로드 (#58 머지)**: 김민준 서류함을 메모리(objectURL)→Supabase **private 버킷 + secret key 백엔드 경유**로 영속화. 6커밋 — ①검증유틸 `src/lib/document-validation.ts`(MIME 화이트리스트 이미지/PDF(원래 오피스 포함→#68서 제거)·20MB·`safeFileName` **ASCII-safe 정규화** — 한글 등 non-ASCII는 Supabase Storage 키가 `Invalid key`로 거부하므로 제거(확장자 보존, 원본명은 DB file_name 보존), 실 업로드 왕복으로 검증, TDD). ②`src/lib/storage.ts`(secret key supabase, upload/remove/signedUrl, env=`SUPABASE_SECRET_KEY`, legacy service_role 아님). ③`db/queries/customer-documents.ts`(add/update/delete/path/reorder/nextSortOrder, `id AND customer_id` 가드) + `getCustomer` documents 정렬·`file_path` 비노출. ④`routes/customers.ts` 서류 라우트 5(`POST` multipart·`PATCH docType`·`PATCH reorder`·`DELETE`·`GET …/url`) + 서버테스트 4(storage `mock.module`). ⑤프론트 `lib/customer-documents.ts` 5종(성공 시 `invalidateCustomerDetail`). ⑥`CustomerDetailPage` Kim 서류함 핸들러 DB연결(낙관+롤백·임시 id `kim-` 가드·미리보기 signed URL[objectUrl 우선]·오피스 다운로드 링크). **캐비엇**: signed URL TTL 60s(PDF iframe range 재요청 끊김 시 상향 검토); reorder는 `customer_id` 가드라 타 고객 무해하나 200 멱등(미래 multi-advisor 재검토). **검증**: typecheck0·lint0·test:unit 125·test:server 46·build OK. **상태**: secret key(로컬+CF)·private 버킷 `customer-documents` 등록 완료. **다운로드=blob 방식**(supabase signed URL Content-Disposition이 한글을 이중인코딩해 깨져서 — `%25EC…` 실증 — 프론트가 blob+`a.download`로 원본명 보존; 다운로드 fetch는 Storage CORS 의존, 배포환경 확인). 경로=`{customerId}/{objectId}-{ASCII safeName}`. 브라우저 수동검증은 배포환경에서. **후속 #59**(머지): 미리보기 잘림(이미지 폭맞춤+세로 스크롤)·분류 select 발견성(분류 변경은 원래 native `<select>`로 동작했으나 텍스트로 위장돼 못 알아봄 → 드롭다운 화살표 상시+hover 강조) CSS 수정. 자동분류는 파일명 기반이라 단서 없으면 "기타서류"(내용 OCR은 후속); 우상단 ⬇️=목록PDF(개별 다운로드는 미리보기 모달). **후속 #60**(머지, 미리보기 UX 종합): 모달=drawer 영역 중앙(좌측 목록 안 덮음)·헤더에 다운로드 버튼(blob 원본)·로딩 `onLoad` 한꺼번에·이미지 미리보기=**Supabase 이미지변환 썸네일**(w1000·q70, 1.4MB→~318KB; **다운로드는 원본** url/downloadUrl 분리)·스크롤 전파 차단(`body.kim-doc-preview-open`+drawer `overflow:hidden` + backdrop `overscroll-behavior:contain`)·모달 **고정크기 660×900**(로딩↔이미지 점프 제거, 이미지 `object-fit:contain`). **우측 여백은 원본 이미지(스캔본) 자체 여백**이라 그대로. PDF/오피스는 변환 불가라 원본. 스펙 `ref/specs/2026-06-20-crm-customer-documents-design.md`(후속 반영 섹션 포함)·플랜 `ref/plans/2026-06-20-crm-customer-documents.md`. **후속 #68**(머지): ⓐ오피스 허용 제거 — 이미지/PDF만(이사님 결정. `ALLOWED_MIME`=`application/pdf`+`image/*`만, `addDocumentFiles` 필터·`input accept`·서버 415테스트 정정). ⓑ서류함 우상단 ⬇️ = 이미지/PDF를 **하나의 PDF로 병합 다운로드**(금융사 일괄제출) — 신규 `client/src/lib/document-merge.ts`(pdf-lib): 표시순서대로 PDF=`copyPages`·이미지=A4 contain+**canvas JPEG 재인코딩**(progressive/webp/heic 등 pdf-lib 미지원 포맷도 안전)·실패항목 skip 집계·`김민준-서류.pdf`. **pdf-lib는 병합 시점에만 동적 import**(초기번들 1293→872KB, 별도청크 421KB). 기존 목록텍스트PDF(`exportDocumentBundleAsPdf`/`downloadTextAsPdf`) 대체. **후속 #69**(머지): 서류 **분류 변경이 재진입 시 옛값으로 되돌아오던 버그** 수정 — 분류 진실원본=`doc_type`(PATCH가 갱신)인데 재진입 초기화가 화면 제목을 레거시 `title` 컬럼에서 읽어 미반영(바뀐 값은 서브라인 status 자리에 노출)이었음. 초기화 매핑을 `title:d.docType??d.title`·`status:"분류완료"`로 통일(기존 깨진 데이터도 `doc_type` 우선이라 자동복원, 마이그레이션 불필요). **남은 정리**: DB `title`/`doc_type` 두 컬럼이 분류 중복 → title 컬럼 제거·status 출처(자동/수동) 영속은 **enum/lookup 사이클**에서.
- **전화번호 정규화 (#56·#57)**: DB는 **숫자만 11자리**(`01095880812`) 저장(기존 20행 `regexp_replace`로 정규화·시드/쓰기도 숫자만). 표시는 `lib.formatPhone`로 `010-9588-0812`. 입력/수정은 **010 고정 prefix + 뒤 8자리(4-4)만**(`KimPhoneStatusInput`, `saveStatusField` phone이 `010`+8 저장). 이전 프리뷰(replace) 입력의 **백스페이스 전체삭제 버그**도 일반 편집으로 수정.
- **상세 로딩 perf (#57·1d73cc2·4042617)**: ①`getCustomer` 자식 5쿼리 **순차(6왕복)→`Promise.all` 병렬(2왕복)**. ②행 hover 프리패치 + ③**결과 캐시(TTL 60s)+쓰기 시 무효화** — 재진입 즉시(왕복 0), 쓰기(updateCustomer·자식 CRUD) 성공 시 `invalidateCustomerDetail(id)`로 stale 방지. ④로딩 중 "헤더 먼저" progressive 제거→중립 스켈레톤(준비되면 한 번에). 체감 거의 즉시.
- **로그인 로고 (c213f14)**: 로그인 화면 `Mr. Cha CRM` 위 차선생 로고(앱 로그인과 동일 `mrcha-logo-color.svg`, 80px 라운드).
- **고객 쓰기 #2 — 자식 CRUD (#55 머지)**: 메모/할일/일정 추가·수정·삭제·완료토글 DB 저장. 4커밋 — ①`customer_schedules.done` 컬럼(drizzle 0002, 일정 완료용). ②백 `customer-children.ts`(query 9: add/update/delete × memo/task/schedule, where=`id AND customer_id`) + `routes/customers.ts` 중첩 라우트 9개(`POST /:id/{memos,tasks,schedules}`·`PATCH·DELETE /:id/…/:childId`) + 서버테스트 3(라운드트립·404). ③프론트 `lib/customer-children.ts` 9개 + `CustomerDetailSchedule.done`. ④Kim 핸들러 12개 wiring(낙관+롤백, **추가 시 임시 id→서버 uuid 교체**, 토글=PATCH done, 일정 완료 시드 `detail.schedules.filter(done)`). **캐비엇**: 추가 직후 POST 해소 전(임시 id) 그 항목 조작은 `id.startsWith("kim-")` 가드로 API 생략(드문 race). **검증**: typecheck0·lint0·test:unit 125·test:server 39·build OK. 브라우저 유지확인 수동.
- **고객 쓰기 #1 — 본체 필드 (#54 머지)**: 고객 본체 컬럼 인라인 수정을 `PATCH /api/customers/:id`로 저장(낙관+롤백). 4커밋 — ①백 `updateCustomer` query + `PATCH /:id`(`customerWriteSchema` 14컬럼 partial, export) + 서버테스트 5(schema·404·400·비파괴200). ②프론트 `lib.updateCustomer`+`CustomerWritePatch` + chance 읽기(`CustomerRow.chance`·`Customer.chance`·`toCustomer`). ③`App.updateCustomerWorkflow`가 statusGroup/status/chance PATCH(목록·상세 공통, 계약완료→확정 동기화, 롤백) + `fetchCustomers`가 chance로 `chanceOverrides` 시드. ④Kim 핸들러 `savePatch` 헬퍼로 연락처/직군/거주지/상담경로/니즈/구매방식/출고시기 PATCH+롤백. **캐비엇**: 비컬럼 구매조건(계약기간 등)은 편집되나 미저장(새로고침 원복, 견적 도메인); manageStatus·advisor 미저장(컬럼없음/다음). **검증**: typecheck0·lint0·test:unit 125·test:server 36·build OK. 브라우저 유지확인은 수동(인증 세션).
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

- ~~읽기 #51~~ · ~~딥링크 #53~~ · ~~쓰기 #1 #54~~ · ~~쓰기 #2 #55~~ · ~~전화번호 #56·#57~~ · ~~상세 로딩 perf~~ ✅ main 머지 · ~~서류 #3 #58~~ ✅ main 머지(위 "완료" 참고).
- **enum/lookup 도메인 정리 (별도 설계 사이클, 고객 쓰기와 시너지)** — crm 스키마는 현재 전부 text. 업무 어휘(진행상태 1/2차·유입경로·서류종류·할일분류 등)는 **lookup 테이블**(이사님이 배포 없이 수정), 기술 내부값(customer_type·*_mode·quote app/decision/entry_mode 등)은 **enum**. 종속(status_group→status)은 lookup이 자연. 쓰기 PATCH 검증이 도메인 물려받음.
- **견적(quotes) 읽기/쓰기** — crm.quotes·quote_scenarios. 고객 FK 연결됨.
- (선택) Topbar 전역검색 DB 연결, 정산 도메인, 목록 페이지네이션 서버사이드(현재 클라, 20명은 충분).
- (후속, 선택) **prepare:true 전환** — direct origin(5432)은 prepared statement 지원. 현재 두 경로 모두 `prepare:false`(6543 fallback 호환). plan 캐싱 perf 원하면 Hyperdrive 경로만 true.

## ⚠️ Caveats

- CF Pages env: VITE_* 공개값은 `.env.production`(커밋)으로 빌드 주입, 비밀(DATABASE_URL)은 CF secret. 환경변수는 `wrangler.jsonc`로 관리(대시보드는 secret만 가능).
- **DATABASE_URL secret 변경 후 재배포 필수** — 기존 배포는 옛 값. (단 Hyperdrive **origin** 변경은 `wrangler hyperdrive update <id>`로 server-side라 재배포 불요. binding id 불변.)
- **서류 업로드(#3) 규약**: 백엔드는 **신규 secret key**(`SUPABASE_SECRET_KEY`, `sb_secret_…` — publishable 체계의 짝, **legacy service_role 아님**)로 Storage admin. 키는 **백엔드 전용**(프론트 노출 금지, 프론트엔 signed URL만). private 버킷 `customer-documents`. secret key는 CF secret(prod·preview) 변경 후 재배포 필요. 새 서류 쓰기 경로도 `invalidateCustomerDetail` 필수(상세 캐시 불변식). signed URL TTL 60s(PDF iframe range 끊김 시 상향 검토).
- `src/db/client.ts`는 fallback 시 `process.env.DATABASE_URL` 읽음 — CF는 nodejs_compat로 process.env 채움. CF prod 정상 경로는 `c.env.HYPERDRIVE.connectionString`(요청별 생성).
- postgres-js `max:1`(tx 롤백 깸)·`fetch_types:false`(타입파싱 깸)는 **금지**(검증됨).
- **Hyperdrive 코드 불변식**: Hyperdrive 경로는 요청별 `createDbClient`+응답 후 `client.end()`. db를 모듈/요청 간 메모이즈하면 'Worker hung' 재발. 메모이즈는 fallback(getDefaultDb)만.
- CF prod 배포는 엣지 롤아웃에 ~1분 — 머지 직후 e2e는 옛/새 isolate 혼재로 일부 실패할 수 있음. `/api/health`의 `hyperdrive:true` 일관 확인 후 재검증.
- `DATABASE_URL`(fallback, 6543 transaction pooler)은 Hyperdrive origin(direct 5432)과 **별개**. 둘 다 유지.
- role 변경은 토큰 갱신(~1h)/재로그인까지 반영 안 됨(claim 방식).
- **mc-master는 프런트 캐시(`catalog-cache.ts`) 경유** — query를 직접 호출 말고 `fetchModelsCached`/`fetchTrimsCached`/`fetchTrimColorsCached`/`fetchOptionSummaryCached` 사용. 편집 후 목록 갱신은 `{force:true}`(reload* 함수) 필수 — 안 그러면 30s 동안 옛 데이터.
- **Hyperdrive read 캐싱 보류 결정**: `/api/catalog/*`는 읽기+쓰기 공용이라 켜면 편집 직후 stale + 프런트 force-refetch 무력화. 캐싱은 읽기 전용 `/api/vehicles/*`(고객 견적)에만, 필요 시 별도 cached 바인딩+PR.
- **고객 상세 캐시 불변식**: `lib/customers.ts` `detailCache`(프론트, TTL 60s)는 쓰기 성공 시 반드시 `invalidateCustomerDetail(customerId)`로 버려야 함. **새 쓰기 경로(서류#3·견적#4·advisor#5 등)를 추가하면 그 lib 함수에도 invalidate 호출 필수** — 안 그러면 재진입 시 stale.
- **전화번호 저장 규약**: DB=**숫자만 11자리**(`010`+8). 표시는 `lib.formatPhone`, 입력은 010 고정 prefix+뒤 8자리(`KimPhoneStatusInput`). 새 phone 입출력은 이 규약 따를 것.
- **커밋 메시지에 skip-ci 마커 금지**: feature 브랜치 커밋(spec/plan/brief 포함)에 그 토큰을 쓰면 squash 본문에 합쳐져 **CF 배포가 스킵**됨(2026-06-19 #51·#53서 2회 사고). 그 토큰은 머지와 무관한 main 직접 docs 커밋에만. 보정=마커 없는 빈 커밋 트리거 or CF 대시보드 수동 빌드.

## Verification (2026-06-19)

- (2026-06-20 서류 #3 + 후속 #68·#69) `typecheck` 0 · `lint` 0 · `test:unit` **140** · `test:server` **47**(`bun test --env-file=.env.local`; #68서 오피스 415 +1) · `build` OK(pdf-lib 동적 import 코드스플릿 확인). **브라우저 검증 완료(배포본)**: 업로드·미리보기·다운로드·**이미지/PDF 병합 다운로드(`김민준-서류.pdf`)·분류 변경 재진입 유지** 전부 정상. secret key·버킷 등록 완료.
- 전화번호: prod 20행 전부 숫자 11자리 확인. 상세 로딩: 재진입 캐시 hit 즉시·쓰기 후 무효화 확인(사용자 체감 "빨라짐").
- (이전) `test:unit` 99 · `test:server` 28 기준 항목은 아래 유지.
- crm.mrcha.app: 카카오 로그인 화면 · SPA 라우팅(`/`,`/quotes` 200) · `/api` 게이트(401) · **mc-master 첫 로드 6/6 정상**.
- **Hyperdrive(#41 #42)**: prod `/api/catalog/models` **25동시×6=150/150 200**(hang 0, 500 0), mc-master 첫 로드 6엔드포인트 동시 전부 200. `/api/health` → `hyperdrive:true`.
- **Topbar·mc-master 성능(d2ae492 b6d7c52 384c997)**: `typecheck`/`lint`/`build`/`test:unit` 99 통과. 체감은 배포 후 확인.

## Collaboration

- (Codex 세션) User=이사님, assistant=영실. (Claude Code 세션) 호칭은 CLAUDE.md 팀 구성(송실장/유슨생).
- 판단 질문(`어때`/`괜찮을까`/`너 생각은?`): 추천·트레이드오프 먼저 + `적용할까요?`. 실행어(`응`/`해줘`/`진행해`): 즉시 실행.
- 팀 공유 결정·맥락은 git(`ref/*.md`, `AGENTS.md`)에. 로컬 메모리는 공유 안 됨.
