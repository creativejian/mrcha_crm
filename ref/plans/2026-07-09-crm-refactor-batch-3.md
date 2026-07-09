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

## 다음 배치로 넘기는 것 (감사 완료·미착수)

| 항목 | 위치 | 판정 |
|---|---|---|
| dead CSS 24클래스(~100줄) | `styles/customer-list.css` | CONFIRMED. **⚠️ `:619/633/1030/1065/526/729`는 live 클래스와 결합된 셀렉터 — 라인 통삭 시 목록 화면 시각 회귀. 조각 단위 수술 + 빌드 산출 CSS byte-diff 기계 검증 필수** |
| `.advisor-change-pill` 잔재 | `customer-list.css:223` + `CustomerManagementPage.tsx:212`(`.closest()` 문자열) | CONFIRMED(#197 정리 누락) |
| dead export 3 | `customer-table.ts:231`(`stageSignal`), `:27`(`statusGroupByStatus` — App.tsx:82이 동일 로직 로컬 재정의), `queries/consultations.ts:68`(`listConsultationIdsByUser`) | CONFIRMED. 마지막 건은 Task 8 예약분 여부 확인 |
| knip.json entry 2 + Deno ignore | `knip.json` | CONFIRMED — 상시 오탐 9건이 진짜 dead를 가림. `src/scripts/**`, `drizzle.config.catalog.ts` 추가, `supabase/functions/**` ignore |
| `.env.example` 2줄 | `SUPABASE_URL`(없으면 인증 500), `GEMINI_API_KEY` | CONFIRMED |
| `sent:0`을 성공 로깅 | `push-notify.ts:46-64` | CONFIRMED(관측 공백, 버그 아님). 앱 소스로 계약 확정 — `send-push/index.ts:39-41`이 `{message:"no tokens", sent:0}` **200** 반환. 로그에 `sent` 병기 |
| `capReportLines` 미러 보일러플레이트 | `assistant-tools.ts:59-60, 193-252` | CONFIRMED(저위험). `customer_quotes`↔`customer_consultations` 파라미터·필터라벨·조건조립 3벌 |
| 라우터 병렬화 | `routes/assistant.ts:113-149` | ADJUSTED — **"왕복 1회 절감"이 아니라 "지연 겹침·비용 중립"**. 라우터는 hits 비의존 확인. TTFB 이득 |
| `metaById` 가드 | `routes/assistant.ts:150` | ADJUSTED — 버튼 경로는 `ids.length===0` 단축이라 무해. **라우터-call 경로(hits>0)만** 실낭비 |
| `embeddings.test.ts` 고정 픽스처 | `:14` `CU-EMBTEST-9990` | CONFIRMED(예방). 실 master 잔존 행 **0** — 지금 깨진 상태 아님 |
| `guardedDb` 데코레이터로 포기 커버리지 복원 | `notify-gate.ts:40-44` | CONFIRMED(성립). **`notify-gate.ts:36`의 "별도 커넥션" 인과 서술은 틀렸다** — 테스트에선 `HYPERDRIVE` 부재로 라우트도 `getDefaultDb()` 싱글톤. 진짜 봉쇄는 라우트가 자기 `.transaction()`을 여는데 SET LOCAL 주입 seam이 없는 것. prod 미들웨어에 `NODE_ENV==='test' && !connStr` 한정 seam 필요 — **비용/이득 팀 판단** |
| `createQuoteCode` `"2606"` | `quote-workbench-meta.ts:252` | ADJUSTED — DB 유입 **불가**(서버가 `nextQuoteCode`로 무조건 채번). 낙관 카드 일시 표시만, cosmetic |
| dismiss 존재검증 없음 | `queries/consultations.ts:157-164` | 무해(멱등·dangling 행은 매칭 0). 현행 유지도 합리 |
| `removeObject` 로그 불일치 | `routes/customers.ts:419,422,425,488,489` ↔ `:435,518,519` | 저우선(로그만) |
| 게이트 3규칙 2벌 | `push-notify.ts:16-22` ↔ `embed-on-write.ts:69,76` | CONFIRMED 로직 **완전 동일**(미묘한 차이 0). **단 추출 비권장** — 각 사본이 사이트 특화 문서를 달고 있고, "조용한 실패" 2건을 겪은 구역에서 명시성이 실이익 |

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
