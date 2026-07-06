# CRM 리팩토링 배치 2 (2026-07-06 감사 → PR A~F)

> 감사 배경: #168~#178 머지 직후 4앵글 감사(서버 코퍼스 파이프라인 · 서버 AI 라우트/도구/scope · 클라 배정 UI/할인/빠른 질문 · 크로스커팅 이월 재평가+테스트 위생).
> 후보 27건 전건 적대 검증(반박 시도) 통과 — 중복 합산 고유 23건. 정합성 버그 5건 + 정리·구조 다수.
> 이 문서는 6개 PR 묶음의 스코프 고정용. 실행: 유슨생 세션(0706-AI-refactoring), 순서 A → B → C → D → E → F.
> 마이그레이션 번호는 실행 시점 `db:generate` 결과 기준(B가 E보다 선행).

## PR A — 정합성 픽스 (브랜치 `refactor/crm-batch2-a-integrity`)

### A-1. 앱 견적요청 승격(create-customer)이 프로필 임베딩 훅 누락 (bug)

- `createCustomerFromRequest`(src/db/queries/quote-requests.ts:329~345)가 신규 고객 INSERT에 needModel·needTrim·needMethod·source를 시드 — 전부 `CUSTOMER_PROFILE_EMBED_KEYS`(src/routes/customers.ts:54~59) 구성 필드인데, 라우트(src/routes/quote-requests.ts:49~56)는 quote_request 청크만 스케줄하고 customer_profile은 안 함. #170 불변("프로필 구성 필드 write 시 재임베딩")이 이 경로에서 깨짐 — 승격 고객은 다음 프로필 PATCH/백필 전까지 "상담경로가 앱인 고객"류 근거 누락(source 값은 프로필 청크에만 실림).
- 픽스: create-customer 성공 분기에서 `scheduleEmbedOnWrite(c, { sourceType: "customer_profile", sourceId: row.id })` 추가. 기존-고객 dedupe 반환 경로도 무조건 호출(hash skip이 no-op 흡수). customers.embed.test.ts 승격 배선 테스트에 profile job 어설션 추가로 잠금. 기존 승격 고객 갭은 다음 백필 1회로 보정(PR 본문 명시).

### A-2. GET /api/staff — dealer 노출 + 정렬 비결정 (bug, 2건 병합)

- staff.ts:18이 `CRM_ROLES`(dealer 포함 — 로그인 게이트 어휘)로 필터해 dealer 계정이 생기면 배정 후보 select에 노출. 딜러 배정 시 `{advisorId: 딜러uuid}` scope 매칭으로 AI 조회가 열려 assistant-scope의 fail-closed 전제와 모순(현재 dealer 실계정 0 — 잠재).
- staff.ts:15~18 orderBy 부재 — Postgres heap 순서라 세션 간 비결정. 편집기 `staff[0]` 기본 선택(StatusFieldEditors.tsx:197)이 비결정 첫 행을 시드 → 미배정 고객에서 그대로 '배정' 제출 시 비결정 대상 배정.
- 픽스: `ADVISOR_ROLES = ["admin","manager","staff"]`를 **staff.ts 로컬**에 신설(verify.ts 금지 — CRM_ROLES는 Edge 복제본 패리티 잠금 대상이라 접점 회피) + `.orderBy(profiles.fullName, profiles.id)`(타이브레이커). staff.test.ts의 `CRM_ROLES.has` 단언을 ADVISOR_ROLES 기준으로 좁히고 dealer 미노출·정렬 assert 추가.

### A-3. link 중복 연결 가드 + quote_request 고객 해석 결정성 (bug)

- `linkRequestToCustomer`(src/db/queries/quote-requests.ts:277~282)는 다른 고객이 이미 같은 app_user_id를 가졌는지 미가드(createCustomerFromRequest:302~306의 dedupe와 비대칭) — 동일 app_user_id 고객 2명이 생길 수 있는 유일 경로. 그 상태에선 로더(embed-sources.ts:101 ORDER BY 없는 `[cust]`)와 백필(innerJoin 임의 행)이 서로 다른 고객을 골라 hash 플립플롭 + staff scope 귀속 요동(현재 실데이터 중복 0건 — 잠재).
- 픽스: link 시 동일 app_user_id 기연결 타 고객 존재하면 **409 거절**(fail-closed — "그 고객으로 연결 유도" UX 대안은 이사님 판단, PR 본문 기록) + 로더/백필 조인에 `orderBy(customers.createdAt, customers.id)` 결정성 1줄×2. resolveCustomerByAppUser 헬퍼·중복 픽스처 테스트는 과잉으로 기각(가드가 들어가면 도달 불가 상태).

### 검증

typecheck 0 · lint 0 · test:server(+신규) · test:unit · build. 클라 변경 0.

## PR B — 활동 파생 seam 통일 (브랜치 `refactor/crm-batch2-b-activity-seam`)

- **실드리프트 확인(버그)**: #171 `lastActivityAt`(assistant-tools.ts:27~33) = GREATEST(updated_at, memos, tasks, schedules, **quotes**) vs #154 `staffActivityAt`(customers.ts:35~41) = GREATEST(…, **documents**). 주석은 "동일 취지"인데 4번째 자식이 갈려 서류만 최근인 고객이 목록 배지 '정상' ↔ AI '응답 지연' 리포트 동시 등장(같은 화면 모순). quotes 상관 서브쿼리는 #165 인덱스 셋 밖(무인덱스).
- 픽스: 활동 파생 SQL 조각을 1벌 추출(customers.ts export 또는 src/db/queries/activity.ts)해 listCustomers·도구 실행기 공유. 집합은 **합집합 5자식(memos/tasks/schedules/documents/quotes)으로 통일** — 행위 변경: 목록 배지가 견적 활동을 인정(덜 stale한 방향으로만), 도구가 서류 활동 인정. **이사님 사후 컨펌 포인트로 PR 본문 명시.**
- `crm.quotes(customer_id, created_at)` 인덱스 마이그(`db:generate`→`db:migrate`, schemaFilter crm).
- staleBucket 7/15/30 임계 named const를 seam에 공유 + 클라 manage-status와 임계 파리티 테스트(quick-prompt-tools 패턴 — 서버 모듈 테스트 전용 import).

## PR C — 서버 소형 정비 + 테스트 위생 (브랜치 `refactor/crm-batch2-c-server-tidy`)

행위 무변경(7번만 경미한 잘림 변경):

1. **DELETE 임베딩 정리 4벌 → 헬퍼**: customers.ts:268/300/332/363의 동형 `deleteEmbeddingBySource(...).catch(로그)`를 embed-on-write.ts `cleanupEmbeddingOnDelete(sourceType, sourceId, db)`(동기 await 유지 — 삭제는 동기가 의도)로 1벌화. 로그 문자열·정책 주석 헬퍼로 이동.
2. **KST 헬퍼 중립 이동**: dateLabelOf/kstDateOf/kstDateLabel(assistant-corpus.ts:126~143 — 일정 섹션에 갇힌 범용 유틸, 4도메인+prompt가 교차 소비)을 `src/lib/kst-date.ts`로 순수 이동, 소비처 import 교체. assistant-tools.ts의 kstTodayDate·KST_OFFSET_MS(byte-동일 복제) 제거 → `kstDateOf(new Date())`. **yymmKstOf(business-code)·stampLabelOf(app-card-payload)는 출력이 달라 불변**(주석 상호참조만) — 전면 kst.ts 통합은 과잉으로 기각.
3. **searchEmbeddings scope 타입 직결**: `"all" | string[] | {advisorId}` → `CustomerScope` import(assistant-scope SSOT). string[] 분기(prod 호출자 0 — B1 유산)·빈 배열 테스트 제거, 주석 갱신.
4. **StreamAskArgs.hits dead 필드 제거**(:199 선언·:162 전달·:114 `hits: []` 배선 단순화) — #171 게이트 hits→promptChunks 전환 잔재. userPrompt 사전 조립(선택안)은 게이트가 promptChunks 의존이라 기각.
5. **ASSISTANT_TOOL_DECLARATIONS Record화**: `Record<AssistantToolKey, {...}>` + KEYS.map 파생(LABELS 동일 패턴 — 신규 도구 누락·name 오타 컴파일 강제, payload byte-동일).
6. **today_actions·quote_ready 독립 2쿼리 Promise.all**(원격 왕복 1회 절감 — assistant.ts:105 선례의 일관 적용).
7. **stale_customers·delivery_risk 상한**: days desc 정렬 후 named const(30) slice + 잘림 시 '외 N명' 행(slice 전 총건수 — 모델이 총량 인지). 다른 도구(20/30 cap)와 대칭.
8. **백필 quoteRequestOptions 필터**: `.where(inArray(quoteRequestId, uniqueReqs ids))`(빈 배열 가드) — 트림 조회와 대칭, 미연결 요청 옵션 오버패치 제거.
9. **assistant.test.ts 위생**: streamRagFakes → `ragFakes(seen, overrides?)` 일반화(스트림/논스트림 공용) + `askJson` 요청 헬퍼. 고정벡터 8회·인라인 스텁 8블록·보일러플레이트 22회 해소. 파일 내 한정, 어서션은 각 테스트 유지, embedTexts=throw 부정 가드는 테스트 내 명시 override 유지.

## PR D — 코퍼스 미러 공유 (브랜치 `refactor/crm-batch2-d-corpus-mirror`)

- loadCorpusSource(embed-sources.ts) ↔ 백필 gather가 profile 17컬럼·quote 11필드+시나리오·quote_request 필드+trim 조인 프로젝션을 문자 그대로 미러 — **타입별 select 프로젝션 상수 + 행→빌더 입력 매핑 함수를 embed-sources.ts에 두고 백필이 재사용**(단건 load 재사용은 N+1이라 배치 collect의 조인/그룹핑/dedupe 구조는 백필 잔류).
- cleanupOrphans의 타입별 SQL 분기를 **타입별 SQL 조각 상수로 분해해 로더/빌더 곁에 병치**(유일한 무보호 드리프트 축 = orphan SQL ↔ 빌더 빈 텍스트 판정 미러) — 최종 delete는 조각 join 조립.
- **전면 레코드화({load,collectAll,orphanPredicate} 순회)는 기각** — collect 형태가 타입마다 이질적(서류함 aggregate 그룹·앱요청 dedupe+배치 조인·니즈 1쿼리→3분기)이라 억지 추상.
- 검증: typecheck·test:server(embed-sources/corpus 테스트 불변) + **백필 실 실행 전건 hash skip 실측**(행위 무변경의 기계 증명).

## PR E — 어휘·라벨 SSOT (브랜치 `refactor/crm-batch2-e-vocab-ssot`)

1. **라벨 사전 물리 공유(이월① 부분 실행)**: PAYMENT_METHOD_LABEL/DEPOSIT_TYPE_LABEL을 `client/src/data/quote-request-labels.ts`(순수 데이터)로 이동 — 서버→client/src/data import는 확립 경계(assistant-corpus·lookup-validate·schema 선례). src/lib/quote-request-labels.ts 삭제, 소비처(클라 quote-requests.ts·서버 queries/quote-requests·assistant-corpus) 교체, 클라 쪽 "Flutter 앱 SSOT 일치" 주석 승계. 파리티 테스트 후보는 물리 이동으로 대체 기각. STATUS_LABEL은 클라 전용 잔류(서버 status 미포함이 의도). **앱카드 라벨 헬퍼군(~150줄) 전면 공유는 계속 팀 합의 대기.**
2. **`source: "앱 견적요청"` 상수화(이월④)**: `APP_QUOTE_REQUEST_SOURCE`를 client/src/data/customers.ts에 두고 SOURCE_AUTOMATIC_OPTIONS[0]이 이 상수를 참조(집합 원소 구조 보장) — 서버 INSERT(queries/quote-requests.ts:340)·클라 비교(CustomerManagementPage.tsx:610) import. **assistant-corpus LABEL "앱 견적요청"은 제외**(근거 표시 라벨 — source 어휘 개명이 재임베딩과 결합되면 안 됨). 실익 = 어휘 개명 시(0015 전례) 승격 INSERT 23514 런타임 장애·클라 무음 미스를 컴파일 타임 단일 수정으로.
3. **appStatus "viewed" 축소(이월③ 승격)**: 이번 범위 #175가 방어 분기를 또 늘림(assistant-corpus:100) — zod enum에서 제거(+400 회귀 테스트), APP_STATUSES 축소+CHECK 마이그, assistant-corpus :50 주석·:100 분기 정리(**corpus test 68~74 "viewed도 발송 표기" 케이스 함께 교체** — 안 하면 red), 클라 read 타입 customer-quotes.ts:40 정리. viewed 실데이터 0행 실측 — 청크 텍스트 불변이라 **백필 소급 불필요**.

## PR F — 클라 정비 + CSS (브랜치 `refactor/crm-batch2-f-client`)

1. **할인 환산 산술 1벌화**: `Math.round(basis * value / 100)` 물리 3벌(quote-workbench-meta.ts:31 역산 ↔ useQuoteWorkbench.ts:426 합산·:448 단위 전환 — 역산↔정산 일치가 primaryDiscount 정합의 load-bearing 불변인데 forward 쪽 무테스트) → quote-workbench-meta.ts에 순수 `discountLineWon(unit, value, basis)` 추출(단위테스트) + 3곳 소비. sync의 basis DOM 읽기 인라인(:421~423)은 기존 `discountBasis` 헬퍼 재사용으로 1벌화.
2. **advisorOptionsByTeam 목업 이름 제거**: #177이 ADVISOR_NAMES를 폐기했지만 status-fields.ts:14~20에 목업 이름 이중 소스 잔존 — 팀 키 배열 상수(ADVISOR_TEAMS)로 축소, parseAdvisorValue → `parseAdvisorTeam`(advisor 폴백은 프로덕션 소비처 0인 dead — 소비되는 순간 오배정 함정). 팀 select 표시 잔존(의도)은 불변. StatusFieldEditors 2곳·status-fields.test 갱신.
3. **할인 %/금액 세그먼트 버튼 겹침 CSS(#168 follow-up·이월⑥)**: 기전 실측 확정 — `.kim-jeff-discount-row`(customer-detail-workbench.css:1006) 5컬럼 min 합이 top-grid 1/3 섹션 폭 초과 → auto 트랙(세그먼트, overflow:hidden이라 min 0) 2px 붕괴 + `.kim-jeff-money-input`(:1283 width:144px, position:relative 나중 페인트)이 덮음. 픽스: col3 `max-content` + money-input `width:auto; max-width:144px`(**`.kim-jeff-discount-row` 스코프 한정** — 다른 form-row 불변). 시각 변화 있음 — **실 워크벤치 스크린샷 검증 필수.**

## 기각(하지 않음)

quote-request-labels 파리티 테스트(E-1 물리 이동이 대체) · resolveCustomerByAppUser 헬퍼+중복 픽스처(A-3 link 가드로 도달 불가) ·
KST 4벌 전면 통합(yymmKstOf/stampLabelOf 출력 상이 — byte-동일 2벌만 해소) · 코퍼스 전면 레코드화(collect 이질 — 억지 추상) ·
StreamAskArgs userPrompt 사전 조립(게이트 promptChunks 의존 — 계약 증가) · 크로스파일 테스트 공용 헬퍼(0705 기각 유지).

## 계속 보류(재평가 결과 유지)

- 카드 9 Record→CardUiState(M~L) · dead CSS 동적접두 10종(#167 본문) — 이번 범위 무관, 실행 압력 없음.
- 클라↔서버 앱카드 라벨 헬퍼군(~150줄) 물리 공유 — 팀 합의 필요(E-1은 순수 상수 2맵만 부분 실행).
- ai-refactor-backlog B 트리거 3건(supersede 드레인·프록시 allowlist 4번째 메서드) — 미충족(도구 라우팅은 기존 geminiPost/target 경유).
- lastActivityAt 클라 임계(manage-status) 물리 공유 — B의 파리티 테스트로 그물만(물리 공유는 라벨 헬퍼 합의와 함께).

## 실측 기록(검증 에이전트)

- 실 master: 중복 app_user_id 고객 0건 · dealer 계정 0 · appStatus viewed 0행(draft 1·sent 7) — A-2/A-3/E-3의 행위 변경은 현 데이터에서 체감 0.
- 코퍼스 빌더 텍스트를 바꾸는 항목 없음 — **전 배치 백필 소급 불필요**(D는 전건 skip이 검증 수단).
