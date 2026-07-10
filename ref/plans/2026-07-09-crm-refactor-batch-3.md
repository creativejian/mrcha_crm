# 0709 리팩토링 배치 3 — 감사 결과 · 실행 계획

Last updated: 2026-07-09 (유슨생 세션 `0709-total-refactoring`)

**범위**: 배치 2(#179~#184) 이후 머지된 **#185~#202** 구간(66파일, +2743/-730).
**방법**: 5앵글 병렬 감사(업무 AI / 알림·푸시 / 서버 쿼리·라우트 / 클라 / 크로스커팅) → 후보 27건 → 6개 적대 검증관이 전건 반박 시도 → CONFIRMED/ADJUSTED/REFUTED 판정.
**착수 범위(유슨생 승인, A안)**: **상+중 정합성 5건만.** dead code·툴체인·소형 정비는 이 문서에 박제하고 다음 배치로.

---

## 이번에 고치는 것 (3 PR)

### PR A — 업무 AI 리포트 정합성 (지금 오답)
브랜치 `fix/crm-report-lines-order-unit`

**🔴 실버그(LIVE)**: `customer_consultations` 도구가 **최신 상담을 버린다**.
- `src/db/queries/assistant-tools.ts:244` `orderBy(consultationRequests.createdAt)` = **ASC(오래된 순)**.
- `capReportLines`(`:42-46`)가 30행에서 절단 → 실측 제임스(`faf23ef2`) 상담 44건(dismissed 1 제외) 중 **1월대 30건만 남고 최신 14건(~5/28) 유실**.
- 절단 문구가 `외 14명 — 상위 30명만 표시` — 행이 **상담**인데 "명"으로 오표기(헬퍼가 고객 리스트 리포트 전제).
- ⚠️ 브리프에 PR #196 검증으로 "제임스 상담 내역 **정확 나열**"이라 기록돼 있으나, 44건 중 30건만·오래된 쪽만 나왔다. **기록이 틀렸다.**
- `customer_quotes`(`:209`)도 동일 결함(ASC + "명"). 고객당 최대 4건이라 **현재 미발동(latent)**.

**수정**: 두 도구 `orderBy(desc(createdAt))` + `capReportLines(lines, unit)` 단위 인자화("명"/"건").
**행위 변경**: 30행 초과 시에만 — 최신 우선 보존 + 라벨 "건". 미만이면 순서만 최신 우선으로 바뀜(모델 인용 품질↑).
**검증**: `capReportLines` 순수 유닛(단위·절단) + 실 DB 정렬 테스트(2건 시드 → lines[0]=최신).

### PR B — `daysSince` KST 달력일 통일
브랜치 `fix/crm-stale-days-kst`

**드리프트**: 같은 활동 소스(`staffActivityAt`)·같은 임계(`STALE_THRESHOLDS` 7/15/30)를 보는데 **일수 계산법만 갈렸다.**
- 서버 `assistant-tools.ts:23-28` = `Math.floor((Date.now()-t)/86_400_000)` — **경과 24h 개수**(tz 무관).
- 클라 `manage-status.ts:33` = `Math.round((dayStart(now)-dayStart(at))/MS_DAY)` — **브라우저 로컬 달력일 차**.
- 파리티 테스트(`manage-status-parity.test.ts`)는 **버킷 경계만** 잠그고 days 계산법은 안 잠근다.

**실례**: now=1/8 12:00 KST, 활동=1/1 13:00 KST → 경과 6일 23시간.
서버 `floor(6.96)=6` → 임계 7 미달 → `stale_customers`에 **안 뜸**. 클라 달력일=7 → 목록 배지 **"확인필요"**. 같은 화면에서 모순 — #180(배치2 B)이 자식 집합 드리프트로 없앤 것과 **같은 부류, 다른 메커니즘**.

**수정**: KST 달력일 인덱스 차로 양쪽 통일.
- 서버 `src/lib/kst-date.ts`에 `kstDayDiff(from, to)` 추가 → `daysSince`가 소비.
- 클라 `manage-status.ts`의 `dayStart`(로컬 tz) → KST 고정 인덱스. `Math.round` 제거(정수 차라 불필요).
- 파리티 테스트를 **계산법 동치까지** 확장(경계 케이스 표 — 서버 함수 테스트 전용 import, 기존 패턴).

**"서버 UTC ↔ 클라 KST에서 완전 일치가 원리적으로 가능한가"** → **가능하다.** `daysSince`는 UTC 달력이 아니라 tz-무관 경과시간이라 애초에 UTC 문제가 아니다. 한국은 고정 UTC+9·DST 없음이라 서버가 KST 달력일을 결정론적으로 재현한다(`kstDateOf`가 이미 `today_actions`에서 그렇게 쓰인다).

**🟡 이사님 확인 포인트(PR 본문 명시)**: AI `stale_customers`/`delivery_risk` 리포트에 뜨는 고객 집합이 경계에서 바뀐다(목록 배지와 **일치하는 방향**). 클라 days는 한국 브라우저에선 무변경, 해외 tz 브라우저에서만 KST로 고정된다.

**함께 기록(이번 범위 밖)**: 클라 배지는 `재문의`(recontacted) 오버라이드와 `manageStatusOverride`(수동 상태)가 stale 버킷보다 우선하는데 AI 도구엔 그 개념이 없다 → 30일+ 방치인 재문의 고객은 목록 "재문의" / AI "장기방치". 별도 판단 필요.

### PR C — 승격 경로 정합성 + 알림 가드 방어
브랜치 `fix/crm-promotion-embed-and-link-guard`

**C-1. 상담 승격이 앱 견적요청 임베딩을 스케줄하지 않는다 (잠복)**
- `src/routes/quote-requests.ts:41`·`:54` — link·create-customer **양쪽**에서 `scheduleQuoteRequestEmbeds` 호출.
- `src/routes/consultations.ts:41-50`(create-customer)은 `customer_profile`만, `:28-38`(link)은 **아무것도** 스케줄 안 함.
- 그런데 상담 승격 두 경로 모두 `app_user_id`를 세팅한다(`queries/consultations.ts:115`·`:150`).
- `quote_request` 청크는 `customers.app_user_id = req.user_id` 연결이 있어야만 적재된다(`embed-sources.ts:216-232` — 없으면 `return null`).
- ⇒ 상담 경로로 승격된 유저의 앱 견적요청은 **백필을 돌려야만** 코퍼스에 실린다. 승격 후엔 견적요청 인박스가 그 요청에 승격 액션을 더는 노출하지 않아(matchType이 `app_user`로 전환) **어느 경로도 훅을 다시 부르지 않는다.** 자동 백필 cron 없음.

**감사원 충돌 판정**: 앵글3이 "문서화된 의도"라며 인용한 `routes/consultations.ts:24-27` 주석은 ①연결이 세팅하는 필드는 `customer_profile` 청크 구성요소가 아니다 ②**상담신청 문의 자체**는 임베딩이 아니라 도구로 답한다 — 이 둘만 말한다. **그 유저의 `quote_request` 청크에 대해서는 침묵한다.** 두 명제는 다르다. **앵글1이 맞다.**

**실측**: `public.consultations` user_id ∩ `public.quote_requests` user_id = **1명**. 상담 인박스(Task 8)가 보류라 현재 도달 불가 = **잠복**. Task 8 착수 시 즉시 발현.

**수정**: 상담 link·create-customer 양쪽에 `scheduleQuoteRequestEmbeds` 추가(`listQuoteRequestIdsByUser` 재사용). 청크 텍스트 불변 → **백필 소급 불필요**(누락 적재를 정상화할 뿐).

**C-2. link의 "고객 → 앱계정" 역방향 재연결 무가드**
- 409 가드는 `and(eq(customers.appUserId, req.userId), ne(customers.id, customerId))` — "**들어오는 userId**가 다른 고객에 이미 붙었나"만 본다(정방향).
- update는 대상 고객의 기존 `appUserId`를 **조건 없이 덮어쓴다**.
- `crm.customers.app_user_id`에 UNIQUE 인덱스/제약 **0건**(psql 실측) → DB도 안 막는다.
- 전화 매칭 후보 산출이 이미 연결된 고객을 배제하지 않는다(`quote-requests.ts:126-141` — `byApp=false → matchType="phone"`).

**시나리오(quote-request 경로는 지금 도달 가능 — `AppRequestsPage` 배선됨)**: 고객 X가 userB에 연결된 상태에서, userA(미연결)의 요청이 X의 전화번호와 매칭 → 인박스 후보 X → "연결" 클릭 → 정방향 가드 통과 → `X.app_user_id`가 userB→userA로 **조용히 교체**. userB의 앱 요청/상담은 매칭 상실, 그 `quote_request` 청크는 고아가 된다.

⚠️ 앵글3은 `consultations.ts`를 주 사례로 지목했으나 그 경로는 **UI 없음(잠복)**. 실제로 지금 터질 수 있는 인스턴스는 **대칭 코드인 `quote-requests.ts` link**다.

**수정**: update 전 대상 고객의 `app_user_id`가 non-null이고 `req.userId`와 다르면 `ConflictError`(→409). **양쪽(consultations + quote-requests) 동시 수정** — 안 그러면 새 드리프트.
**🟡 이사님 확인 포인트(PR 본문 명시)**: fail-closed 409. "기존 연결 고객으로 유도" UX 대안은 별도 판단(정방향 가드가 이미 같은 정책이라 일관).

**C-3. `withNotifyGuard` 없는 `advisor_quotes` UPDATE (테스트 방어)**
- `src/db/queries/customer-quotes.send.test.ts:125-128`은 guard 밖 autocommit, 같은 파일 `:334`는 동일 연산을 guard로 감쌌다(불일치).
- **현재 위험 0** — 막고 있는 건 앱 소유 트리거 `notify_advisor_quote`의 2분기(psql 실측: `IF TG_OP='UPDATE' AND NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at THEN RETURN NEW`).
- 즉 안전의 유일한 지지대가 **우리가 통제 못 하는 남의 트리거 조건**이다. 앱이 "열람 알림"을 추가하면 테스트 1회가 실 고객 FCM을 쏜다(#199 재현).
- **수정**: `:334`와 동일하게 guard로 감쌈(1줄). 트랜잭션 내 read-after 어서션 없어 안전.

---

## ✅ 나머지 착수분 완료 (2026-07-09, PR #206 · #207 · #208)

### PR D — dead code + 툴체인 위생 (#206 `7e245c1`)
- dead export 3: `stageSignal` · `statusGroupByStatus`(App.tsx:82이 **글자 그대로 동일한 로직을 로컬 재정의**해 쓰고 있었다 → lib export를 import하도록 통합) · `listConsultationIdsByUser`(주석이 "임베딩 훅용"이라 오도 — 상담 RAG는 #196에서 폐기)
- `.advisor-change-pill` 잔재(#197 정리 누락): CSS 룰 + `isTableControlTarget`의 `.closest()` 셀렉터 조각(항상 null 반환하던 no-op)
- `knip.json`: entry에 `drizzle.config.catalog.ts`(`"*.config.ts"` 글롭이 `.catalog.ts`를 매치 못 함)·`src/scripts/**` 추가, `supabase/functions/**` ignore, knip이 스스로 지적한 stale 설정 정리 → **Unused files 0 · Configuration hints 0**
- `.env.example`: `SUPABASE_URL`(없으면 인증 500)·`GEMINI_API_KEY`·`GEMINI_PROXY_URL` 추가. `CRM_BASE_URL`은 `playwright.config.ts:21`이 쓰므로 유지(용도 주석)
- `embeddings.test.ts` 랜덤 서픽스(실 master 잔존 0 — 예방)

### PR E — dead CSS 23클래스 (#207 `9bd6f29`)
- **⚠️ 감사 표에 없던 함정 2개를 발견했다**:
  1. `@keyframes stage-status-popover-in`은 **live**다 — 이름만 `stage-status-*`일 뿐 live 클래스 `.stage-two-step-popover`가 쓴다.
  2. `.stage-status-popover, .chance-status-popover` 블록의 `position:absolute`는 아래 `.chance-status-popover` 블록이 재선언하지 않는다 → **블록 삭제 금지, 조각만 제거**.
- 기계 검증 `tools/verify-dead-css.sh` 신설(재사용 가능). 단순 byte-diff 불가 — 결합 셀렉터에서 조각을 빼면 **minifier가 같은 셀렉터의 두 블록을 접는다**(계산값 동일). 그래서 ①제거 대상 0회 ②live 15종 등장 불변 + `:has()` 4종 보존 ③접힌 블록은 **계산값**으로 비교(`z-index:90`이 남아있지만 같은 블록 뒤의 `z-index:160`이 이긴다 — "존재 여부"가 아니라 "마지막에 이기는 값") ④keyframes 정의·사용 유지.
- 선언 블록 2545→2515, 275,395→271,860 bytes. 시각 회귀 0.

### PR F — 서버 소형 정비 (#208 `0463268`)
- `sent:0` 로깅 분리(앱 `send-push/index.ts:39-41`이 `{message:"no tokens", sent:0}` **200** 반환 — "아무도 못 받음"과 "N대 전달"이 tail에서 구분 안 됐다). `sent=0`은 warn, 성공은 `sent=N` 병기. best-effort 계약 불변.
- `metaById` 가드: 라우팅 도구 경로(hits>0)에서 결과를 버리는 원격 왕복 제거. 버튼 경로는 빈 배열 단축이 이미 흡수하고 있었다.
- `customer_quotes`↔`customer_consultations` 미러 → `nameFilter{Params,Conds,Label}` 뼈대 공유(행위 무변경).
- `removeOrphanObject` 헬퍼 1벌 — 같은 Storage 삭제 실패를 5곳이 무로그, 3곳이 서로 다른 문구로 처리하던 것 통일(단일 grep 토큰).

**통합 검증**: typecheck 0 · lint 0 · knip clean · test:server **412** · test:unit **478** · build.

---

## PR G — `guardedDb`로 발송 통합 경로 커버리지 복원 (#209 `50b5444`)

**틀린 근거를 바로잡았다.** `notify-gate.ts`의 "`app.request()`는 dbMiddleware가 별도 커넥션이라 SET LOCAL이 닿지 않는다"는 인과 서술은 **사실이 아니었다**. 테스트 환경엔 `c.env.HYPERDRIVE`가 없어 `dbMiddleware`의 `!connStr` 브랜치가 타고, 라우트도 테스트도 **같은 `getDefaultDb()` 싱글톤**을 쓴다. 진짜 봉쇄는 커넥션이 아니라 *라우트가 자기 `c.var.db.transaction()`을 여는데 거기에 SET LOCAL을 주입할 seam이 없다*는 것이었다. 주석도 함께 정정.

- `guardedDb(db)`(`test-utils/notify-gate.ts`) — Proxy로 `transaction()`만 가로채 콜백 첫 문장에서 `set_config('app.skip_notify','on',true)`. 메서드는 원본에 `bind`(drizzle이 `this.session`/`this.dialect`를 읽는다 — private 필드 없음을 실측 확인).
- `setTestDb(db)`(`middleware/db.ts`) — fallback(`!connStr`) 브랜치 **+ `NODE_ENV==='test'`**에서만 읽는 주입 seam. **⚠️ 로컬 dev도 `!connStr`을 탄다** — NODE_ENV 게이트가 없으면 로컬 dev 실알림이 조용히 죽는다(회귀 테스트로 잠금). prod(`HYPERDRIVE`)는 seam을 아예 읽지 않는다.
- `routes/customers.send.test.ts` 4종: 발송→advisor_quotes 커밋 / 견적요청 completed 전이 / DELETE 카드 회수 + open 복원 / 앱 미연결 스킵.

**안전 근거는 합성이다** — ①guardedDb가 GUC를 켠다(`notify-gate.test.ts`, 대조군: 맨 db는 안 켜진다) ②setTestDb가 라우트 `c.var.db`를 바꾼다(`db.test.ts` identity 프로브). 그래서 통합 테스트는 업무 동작만 단언한다.

**실측**: 트리거 `on_advisor_quote_sent` 활성(`tgenabled=O`) · `notify_advisor_quote`에 가드 존재 · `advisor_quotes` INSERT 발생(행 단언 통과) · **그럼에도 `net._http_response` 증가분 0** · `net.http_request_queue` 0 · 테스트 잔재 0행.

**커버 한계**: 데코레이터는 `db.transaction()` 경로만 커버한다. autocommit 단발 쿼리엔 SET LOCAL이 안 걸리므로 알림 테이블에 그렇게 쓰는 테스트는 여전히 `withNotifyGuard`가 필요하다.

## PR H — 자유 질문 라우터 병렬화 (#210 `c31d112`)

라우터는 `question`+`history`만 쓰고 hits에 의존하지 않는데, `Promise.all([history, embed→search, staffName])` **완주 후** 순차 실행되고 있었다. 같은 슬롯으로 이동.

**프레이밍**: Gemini 왕복 수·비용은 **그대로**. 줄어드는 건 벽시계뿐 — `(임베딩+검색)+라우팅` → `max(임베딩+검색, 히스토리+라우팅)`.

**실측(로컬, 실 Gemini·실 master)** — 라우터가 일관되게 ~510~540ms라 자유 질문마다 그만큼 사라진다:

| 질문 | embed | search | route | 직렬 | 병렬 | 절감 |
|---|---:|---:|---:|---:|---:|---:|
| 김지안 견적 몇 개야 | 770 | 214 | 507 | 1491ms | 984ms | **-507ms** |
| 제임스 요즘 어떤 상태야 | 390 | 123 | 535 | 1048ms | 535ms | **-513ms** |
| 앱으로 들어온 고객 누구야 | 500 | 36 | 536 | 1072ms | 536ms | **-536ms** |

**골든 먼저**(별도 커밋) — 기존 테스트는 최종값만 봐 호출 순서·부정 가드를 안 잠갔다: ①tool 지정 시 라우터 미호출 ②라우터는 멀티턴 history를 받는다 ③라우터 call → `runAssistantTool`은 그 뒤(결과 의존) ④임베딩 실패 → 500, 도구 미실행. **변이 검증 실관찰**: `history`를 `[]`로 바꾸면 ②가, `toolKey` 가드를 풀면 ①이 정확히 실패. 겹침 자체도 테스트로 잠갔고(구 코드 RED 실관찰 → GREEN).

**의도한 행위 변화 1건**: 검색이 먼저 실패하면 이미 출발한 라우팅 응답이 버려진다(실패 경로에서 라우팅 1회 추가). `routeAssistantTool`은 자체 catch로 `null`만 반환해 `Promise.all`을 reject시키지 않으므로 **500 계약은 불변**.

**통합 검증(main)**: typecheck 0 · lint 0 · knip clean · test:server **431** · test:unit **478** · build. `net._http_response` 증가분 0.

---

## 남은 것 (미착수 — 저우선)

> 라우터 병렬화·`guardedDb`는 **완료**(PR H·PR G — 위 참조).

| 항목 | 위치 | 판정 |
|---|---|---|
| `createQuoteCode` `"2606"` | `quote-workbench-meta.ts:252` | ADJUSTED — DB 유입 **불가**(서버가 `nextQuoteCode`로 무조건 채번). 낙관 카드 일시 표시만, cosmetic |
| knip 잔여 unused exports 5 + types 7 | | 저우선 — 파일 내부 사용(`export` 키워드만 불필요)·배럴 re-export(`formatTerm`)·타입 전용. 개별 판단 필요 |
| dismiss 존재검증 없음 | `queries/consultations.ts` | 무해(멱등·dangling 행은 매칭 0). **현행 유지가 합리** |
| 게이트 3규칙 2벌 | `push-notify.ts` ↔ `embed-on-write.ts` | CONFIRMED 로직 **완전 동일**(미묘한 차이 0). **단 추출 비권장** — 각 사본이 사이트 특화 문서를 달고 있고, "조용한 실패" 2건을 겪은 구역에서 명시성이 실이익 |

---

## 기각 (제안했다면 오히려 사고)

| 후보 | 반박 근거 |
|---|---|
| `QuoteWorkbench.tsx:416-417` onChange+onInput 이중 바인딩 제거 | React가 텍스트 input에 둘 다 발화하는 건 **사실**이나, 이건 **델리게이션 컨테이너**라 텍스트만 좁히는 게 구조적으로 불가. 컨테이너 onChange는 uncontrolled 금융사 select(`:445` `defaultValue`)의 미리보기 갱신 **유일 경로**. Safari sacred rule 위험 대비 이득 = 측정 안 된 sub-ms |
| draft 필터 `setCurrentPage(1)` 누락 | **이미 호출된다** — 공용 렌더러 `renderDraftFilter` 옵션 onClick(`CustomerManagementPage.tsx:720`). 인용된 `:753-779`는 설정 객체일 뿐 |
| 역할→한글 라벨 맵 파리티 추가 | `ROLE_CLAIM_TO_TAB`(값 타입 `RoleTab` — UI 탭 **식별자**, `roleAccountMeta` 객체 키) ↔ `CRM_ROLE_LABELS`(AI 표시 라벨). **개념이 다른 두 맵이 값만 우연히 같다. 공유하면 잘못.** `ROLE_CLAIM_TO_TAB`은 export도 안 됨 |
| 라우터 프롬프트에 `customer_consultations` 유도 라인 추가 | 유도는 **선언 description**(`assistant-tools.ts:74`, "반드시 이 함수를 쓴다")에 이미 존재. 오라우팅 증거 0(골든은 `fakeFetch` 파싱만 잠금) |
| `CRM_BASE_URL` 죽은 키 삭제 | `playwright.config.ts:21`이 사용(live) |
| `.env.example`에 `VITE_*` 2키 추가 | `.env.production`(git 추적, `.gitignore:14` 예외)이 담당 — 빌드타임 공개값 |

---

## 검증 예산

- PR별: `bun run typecheck` 0 · `bun run lint` 0 · 해당 테스트 스위트.
- 배치 종료: 4종 + `bun run build`.
- PR B는 클라·서버 양쪽이라 `test:unit` + `test:server` 둘 다.
- PR A/C는 실 DB 테스트 — `bun run test:server`(npm 스크립트의 `EMBED_ON_WRITE=off PUSH_NOTIFY=off` 프리픽스 필수, **직접 `bun test <파일>` 금지**).
- 알림 트리거 4테이블에 쓰는 테스트는 `withNotifyGuard` 필수.
