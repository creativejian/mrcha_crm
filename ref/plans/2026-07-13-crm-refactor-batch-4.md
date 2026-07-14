# 0713 리팩토링 배치 4 — 감사 결과 · 실행 계획

Last updated: 2026-07-13 (유슨생 세션 `0713-fresh-start` — **✅ 전량 이행 완료·6PR 머지(#229~#234)**)

**범위**: 배치 3(#203~#210) 이후 머지된 **#211~#228 + main 직접 커밋**(`c31d112..HEAD`, 106파일, +13,339/-395).
**방법**: 5앵글 병렬 감사(서버 라우트·게이트 / AI 힌트·업무 AI / 클라 로직·페이지 / CSS·스타일 / 크로스커팅·테스트 인프라) → 후보 ~30건 → 4개 적대 검증관이 전건 반박 시도 → **CONFIRMED 21 · ADJUSTED 7 · REFUTED 2**.

## ✅ 이행 상태 (2026-07-13 전량 머지)

| PR | 대상 절 | 비고 |
|---|---|---|
| #229 | 우선 1(클라 manage 수명 1-A/B/C + selectManage markRecentUpdate) | **이중 소스 제거**(override 상태 폐기 → row 낙관 갱신, `lib/customer-workflow.ts` 순수 코어 TDD 10). **격리 스택 브라우저 스모크 통과**: 수동 지정→동일 스탬프(t) 실측→실활동 직후 배지 즉시 파생 복귀(구 코드는 F5까지 잔존)→F5 일관→UI 삭제 원복·잔재 0 |
| #230 | 우선 2(tripwire 사각 3곳·consultations report-only·2-C 전부) | 변이 검증 실관찰. 머지 당일 스모크 원복에서 **감사 잔재 스캔이 실전 첫 작동**(CU-2607-0001 감사 행 검출→`--clean`) |
| #231 | 우선 3-B(partial unique index — 마이그 0030 실 DB 적용)·3-C(가드 SSOT)·K8·K9·픽스처 정비 | 🔴 보너스 발견: **drizzle 0.44+ 래핑으로 dbErrorMessage 매핑 전체(트림/FK/CHECK)가 원문 노출로 퇴화해 있던 잠복 결함** — collectErrorText(cause 체인)로 수정+종단 테스트 |
| #232 | 우선 4(CSS 팝오버 3벌 공용화 + dead 6건) | 계산값 전수 증명(2,835키 불변) — `tools/verify-css-key-maps.sh` 신설 |
| #233 | 소형 위생(Storage 배열 1왕복·등록 폼 Enter·K1·K2·L5·L6) | Storage는 Promise.all이 아니라 **배열 API 1왕복**이 정답(검증관 교정) |
| #234 | 3-A(deleteSelected stale 클로저 race) | 서버 리로드 통일(create/advisor/delete 3벌 사후 처리 비대칭 해소) |

- **🔵 이사님 확인**: B1(수동 상태의 AI 리포트 멤버십)은 `ref/director-pending-confirmations.md` **항목 8**로 이관(K10·K3 병기).
- **미이행(의도적 스킵)**: loadAiHintSource 병렬화(백그라운드+Gemini 지배라 실익 미미 — 검증관 하향) · K7 onCustomerListChanged 타입 통일(실해 없음 — 실패는 전역 배너 폴백으로 표면화됨을 검증관이 확인).
- 최종 main 통합 검증: typecheck 0 · lint 0 · unit 554 · server 518 · build · 잔재 0.

---

## 🔴 우선 1 — 수동 관리 상태 클라 상태 수명 클러스터 (#228 잔여, CONFIRMED ×3)

한 뿌리(클라 `manageStatusOverrides`의 수명 관리 부재)에서 나온 3건. **한 PR로 묶는 게 자연스럽다.**

### 1-A. `manageStatusOverrides` 불멸 [상]
- `client/src/App.tsx:273` — setter는 추가형 spread 1곳뿐, 삭제·리셋·재구축 경로 **0**(grep 전수). `reloadCustomers`(App.tsx:123-139)는 `chanceOverrides`만 fresh 재구축.
- `client/src/lib/manage-status.ts:67` `override ?? effectiveManageStatus` — override가 **만료 판정을 무조건 우회**. 소비처 3곳(목록 필터·행 렌더·상세 카드) 전부.
- 발현: 수동 설정 → 이후 실활동(서버 만료) → 리로드가 와도 override가 이겨 **F5 전까지 구 수동 상태 강제**. #227/#228이 없앤 배지↔AI 모순이 클라 레이어에서 재발.
- 수정: PATCH **성공 시** 해당 override 삭제 + 대상 row의 `manageStatus`/`manageStatusAt`(+`lastActivityAt`)을 낙관 갱신 → `effectiveManageStatus`가 세션 내 만료까지 SSOT로 판정. (in-flight 중 리로드 race 때문에 "reloadCustomers에서 재구축"보다 "성공 시 삭제"가 안전.)

### 1-B. PATCH 실패 catch에서 override 롤백 누락 [중]
- `App.tsx:285-291` catch = `setCustomers`·`setChanceOverrides`·토스트만. `prevManageStatusOverrides` **캡처 자체가 없음**(:250-252). manageStatus-only 변경도 :281에서 patch에 실려 실제 PATCH 발생.
- 발현: 실패 토스트가 뜨는데 배지·필터·상세는 저장된 것처럼 표시(1-A와 결합해 F5까지).
- 수정: prev 캡처 + catch 복원(기존 패턴 대칭, 2줄).

### 1-C. 워크플로우 PATCH 성공 시 row 갱신·리로드 부재 [중]
- `App.tsx:258-264`는 statusGroup/status/date("방금 전")만 갱신. `updateCustomer(...).catch(...)` — **`.then` 리로드가 없다**(updateCustomerWorkflow는 성공 경로 무동작). 서버는 모든 PATCH에 `updatedAt` bump(customers.ts:77)로 기존 영속 수동 상태를 즉시 만료시키는데, 클라 row는 옛 `lastActivityAt`으로 계속 유효 판정 — 서버(AI 도구)↔클라 배지 모순.
- 수정: 성공 시 row `lastActivityAt` 낙관 갱신(1-A 수정과 동일 지점).

### 1-부수 [하]
- `useCustomerWorkflow.ts:288-293` — `selectManage`만 `markRecentUpdate` 미호출(selectChance/StageGroup/StageStatus는 호출) → 상세 헤더 "방금 전 …" 무반응. 1줄.
- 테스트 갭: `updateCustomerWorkflow`의 manageStatus patch 구성·롤백을 잠그는 테스트 0 — 이 PR에서 함께 잠금.

---

## 🔴 우선 2 — 잔재 tripwire 사각 (테스트 인프라, CONFIRMED)

### 2-A. 승격 경로 픽스처 실채번+미등록 이름 3곳 [상]
- `src/db/queries/consultations.test.ts:134` "김상담" · `src/routes/consultations.test.ts:83` "박라우트" · `src/routes/customers.embed.test.ts:228-272`(**실 profile의 fullName**으로 실채번 고객 생성 + 실 profile에 app_user_id 연결).
- 셋 다 정리는 finally의 db.delete뿐 — 프로세스 강제 종료 시 잔재. 코드는 실채번(`CU-\d{4}-\d{4}`, 접두사 registry 밖)·이름은 registry 밖이라 **스캔·`--clean` 모두 미검출**. CU-EMBRT 사고(07-09)와 같은 발생 모드인데 **사후 검출 불가**라 질이 더 나쁘다.
- 검증관 추가 확인(악화 요인): embed 잔재는 실 profile에 `app_user_id`가 연결된 채 남아 그 유저의 향후 승격이 **유령 고객으로 dedupe**되고(`quote-requests.ts:322-325`), `public.quote_requests` 픽스처 행도 잔존 가능.
- 수정: ① "김상담"·"박라우트" → `TEST_CUSTOMER_NAMES` 등록(실고객 동명 오삭제 방지를 위해 더 구별되는 이름으로 rename 후 등록 권장) ② embed 승격 테스트는 생성 직후 등록된 픽스처 이름으로 즉시 UPDATE(무방비 창을 문장 2개 사이로 축소).

### 2-B. `public.consultations` 픽스처 잔재 스캔 부재 [중, ADJUSTED]
- `fixture-residue.ts:36-57` 스캔은 4종(crm.customers·crm.quotes·고아 임베딩·고아 앱 카드)뿐. ai-hint 계열 2파일이 **원미래(2126)** 상담을 실 INSERT(assistant-tools.test.ts는 T0 기반 — 2126은 2/3 파일).
- 실노출 경로(검증관 정정): "CRM 상담 목록"은 스텁이라 미도달 — 실제는 ⓐ고객 상세 문의 카드 최상단 ⓑ업무 AI `customer_consultations` 도구 ⓒ**AI 힌트 재료 영구 점유**(loadAiHintSource가 "최신 문의"를 뽑으므로 2126 잔재가 실 문의를 영구히 이긴다).
- 수정: 스캔에 report-only 절 추가(원미래 행 + 픽스처 이름 매칭). public은 앱 소유 — `--clean`은 보고만(#214 고아 앱 카드 선례와 정합, 스캔 SELECT는 이미 public.advisor_quotes 선례 있음).

### 2-C. tripwire 소형 강화 [하, 전건 CONFIRMED]
- **L1** `profiles-write-guard.test.ts:36` 정규식이 `db.update(pub.profiles)`·별칭 import 미검출(3룰 전부 미매칭 손검증) + `SCAN_ROOTS`에 루트 `functions/`·`scripts/` 부재(현재 참조 0 실측). → 정규식 `\(\s*(?:\w+\.)?profiles\s*[,)]` + ROOTS 2개 추가 + 탐지기 테스트 케이스 추가.
- **L3** `customer_deletions` 감사 잔재: `check-test-residue.ts:22-25`가 잔재 0이면 조기 exit라 **clean은 지울 줄 아는데 scan이 못 봐 --clean 도달 불가**. → scan에 대칭 절 추가.
- **L2** fixture-codes 계약 스캔이 "비 .test.ts 시드 헬퍼" 리팩토링에 뚫림(텍스트 판정·import 미추적). 글롭 `src/**/*.ts` 확장은 **오탐 없음 실측** — 주석 박제보다 기계 잠금 권장.
- **L4** `--clean`의 crm.quotes 직접 DELETE는 deleteQuote 임베딩 정리 우회 — 현재는 전 픽스처 견적이 픽스처 고객 소속이라 실피해 0(실측), **실고객 소속 픽스처 견적이 생기면** 스테일 quote 임베딩 영구 잔존(embeddings FK는 customers CASCADE뿐 — psql 실측). 주석 박제.

---

## 🟡 우선 3 — 서버·클라 정합 (개별 PR 후보)

### 3-A. `deleteSelected` stale 스냅샷 전체 교체 [중, CONFIRMED]
- `CustomerManagementPage.tsx:158-162` `updateCustomers`의 `next(customers)`는 **렌더 클로저**(functional setState 아님) → `App.tsx:336` `onCustomersChange={setCustomers}`로 전체 배열 교체. `:482` await(건별 순차 DELETE, 수 초) 사이 다른 행 변경이 화면에서 되돌아감(서버 저장은 유지 — 화면만 구값). `:489` setSelected도 같은 stale 클로저.
- 수정: 삭제 후 `onCustomerListChanged` 리로드로 통일(성공분만 선택 해제 유지) — create=리로드·advisor=리로드·delete=로컬필터로 갈라진 3벌 사후 처리 비대칭도 함께 해소.

### 3-B. `app_user_id` partial UNIQUE index [중, ADJUSTED — 동반 조건 2]
- 진단 전부 실측 일치: link 가드 SELECT·UPDATE가 **트랜잭션 없는 autocommit**(routes/quote-requests.ts:41·consultations.ts:50) = TOCTOU. createCustomerFrom* dedupe도 READ COMMITTED 팬텀 미차단. `crm.customers` 인덱스는 pkey+customer_code뿐, 중복 현재 0행. UI 배타는 같은 세션 같은 행만(`AppRequestsPage.tsx:149-152`) — 두 상담사 경합 못 막음.
- 수정: `CREATE UNIQUE INDEX ... ON crm.customers(app_user_id) WHERE app_user_id IS NOT NULL`(drizzle 0.45.2 partial index 지원 확인). **동반 필수**: ① `shared.ts:11`이 모든 23505를 catalog 문구("같은 모델에 동일한 트림명…")로 오매핑 — 매핑 정비 없이 인덱스만 넣으면 경합 시 오도 문구 ② `anyProfileId` 픽스처 3파일(customers.send·customer-quotes.send·customers.ai-hint) — 무정렬 limit(1)이 linked profile(실측 2/16)을 뽑으면 일시 중복으로 간헐 실패 → `anyUnlinkedProfileId` 패턴으로 선행 정비.

### 3-C. link/승격 가드 SSOT [중, CONFIRMED]
- 정/역방향 가드+문구가 `queries/quote-requests.ts:283-295` ↔ `queries/consultations.ts:131-144` **byte 동일 축자 복제**, 래퍼 6줄도 routes 2곳 복제. 파리티 테스트 0 — 한쪽만 바뀌면 #225 안내 UX가 경로별로 갈린다.
- 게이트 3규칙 기각 논리(명시성) 부적용 — 이건 보안 불변식+**사용자 노출 문구**라 SSOT가 맞다(검증관 판단).
- 수정: 가드 코어만 `assertAppUserLinkable(ex, userId, customerId)` 추출(함수 전체 통합은 불가 — consultations는 `!req.userId` 가드·phone 보강 상이). 래퍼는 promotion-embeds.ts로(순환 없음 실측). 3-B와 같은 PR이 자연스러움.

---

## 🟡 우선 4 — CSS (계산값 증명 필수, #207 선례)

### 4-A. 헤드바 팝오버 3종 선언 블록 3벌 복제 [중, CONFIRMED — 기계 diff 실증]
- `customer-console.css` :812-825 = :1015-1028 byte-identical, :906-918은 width 1줄만 상이. strong/p/버튼 베이스/disabled/primary-action/notice/label/select/focus 링 전부 2~3벌 동일. ~110-120줄 공용화 여지.
- 주의(검증관): ① p 블록 결합자 상이(`> p` vs 후손) — 콤마 그룹서 각자 보존 ② primary-action은 2벌·bulk-delete는 `button.danger` 변형 — 그룹 대상 아님 ③ **`tools/verify-dead-css.sh` 방식 빌드 산출 계산값 증명 후 머지**.

### 4-B. dead CSS 6건 [하, 전건 CONFIRMED — 제거 리스크 0]
| 대상 | 위치 | 근거 |
|---|---|---|
| `@keyframes final-update-popover-in` | customer-list.css:1027 | animation 참조 0(도입 시점부터 dead) |
| `.brand-logo-accent` | layout-sidebar.css:66-68 | img 로고 전환 후 잔재, fill은 img에 무의미 |
| `.global-metrics` 콤마 조각 2곳 | layout-sidebar.css:424·431 | TSX 사용 이력 자체가 없음. **블록 통삭제 금지**(형제 live) |
| `.lucide-menu-icon` | layout-sidebar.css:176-180 | Menu import 0 + lucide 1.23.0에 `-icon` 접미 클래스 부재(node_modules 실측, 이중 확인) |
| `.primary-register-btn:hover svg color` no-op | customer-console.css:494-496 | 베이스(:488-492)가 이미 #fff — **베이스의 `transition: color`도 동반 dead**(검증관 추가 발견) |
| `handoff-op-card` 훅 클래스 | HandoffOperationPage.tsx 6곳 | CSS 정의가 한 번도 없었음(도입 커밋부터) — 토큰 제거 또는 "훅 전용" 주석 |

---

## 🔵 이사님 확인 후보 (코드 버그 아님 — 제품 결정)

1. **[B1] 수동 비'정상' 상태 고객이 설정 직후 ~7일간 AI 리포트(stale/delivery) 누락** — 현상 실재(PATCH가 updated_at bump → days=0 → 버킷 게이트 탈락, 배지는 즉시 표시). 단 "리포트 = 무활동 7일+" 정의가 도구 선언(assistant-tools.ts:47)·주석(:123)에 명문 — **멤버십 불일치를 수용할지, 유효 수동 비정상은 days 무관 포함할지** 판단 필요. 결정되면 테스트 갭(유효 수동+days<7 케이스 0건 — 픽스처 m>a는 API 도달 불가 조합)도 함께 잠금.
2. **[K10] 관리성 쓰기(일괄 담당자 변경 #216·link)도 updated_at bump로 유효 수동 상태를 일괄 조용히 만료** — 메커니즘은 커밋에 문서화됐으나 "일괄 배정 한 번에 스누즈 N건 소거" 함의는 미명시. 인지용 보고.
3. **[K3] 수동 상태 해제(파생 복귀) UI 부재** — 서버 null 클리어 계약은 열려 있는데 발신처 0. 단 아무 PATCH가 사실상 해제 효과(updated_at bump)라 실익 낮음 — 팝오버에 "자동(파생)으로 되돌리기" 옵션 넣을지.

---

## ⚪ 소형 정비 모음 (하 — 위생 PR 1개로 묶기 후보)

| 항목 | 위치 | 판정 | 내용 |
|---|---|---|---|
| 등록 팝오버 form 아님 | CustomerManagementPage.tsx:1052-1093 | CONFIRMED | Enter 제출 불가 — `<form onSubmit>` 전환(StatusWorkflow 선례) |
| 삭제 가드 주석 과대 서술 | customer-delete.ts:21-22 | CONFIRMED | 창을 닫는 주체는 tx 배치가 아니라 quotes 행 잠금 직렬화+deleteQuote 회수. 교정 문안 검증관4 보고서에 확보 |
| POST /customers 채번 경합 | routes/customers.ts:91-108 | CONFIRMED | run() 미사용 → generic 500. 23505 매핑 정비(3-B)와 함께 처리 |
| Storage 고아 정리 직렬 루프 | routes/customers.ts:130 | ADJUSTED | 정답은 Promise.all이 아니라 supabase-js **배열 `.remove(paths[])` 1왕복**(storage.ts:32가 배열 API를 단건 포장 중) + per-path 로그 관측성 유지 |
| handleCreate HttpError 폐기 | AppRequestsPage.tsx:36-38 | ADJUSTED | 비대칭 사실이나 create엔 409류 사유 부재 — 실익 최하 |
| handleLink 성공 시 목록 리로드 없음 | AppRequestsPage.tsx:47-50 | CONFIRMED | 실 소비처는 ChatPage.tsx:43 appUserId 매칭(감사가 지목한 hover 게이트는 source 기반이라 무관 — 정정) |
| onCustomerListChanged 타입 3벌 | 3개 페이지 prop | ADJUSTED | "조용히 버림" 아님(전역 배너 폴백) — 차이는 맥락화 여부. 타입 통일만 저비용 |
| loadAiHintSource 직렬 5왕복 | ai-hint-sources.ts:30-76 | ADJUSTED | 2단계 병렬화 가능(consultation은 row.appUserId 의존)이나 백그라운드+Gemini 지배라 실익 미미 — 최하 |
| 게이트 주석 "2벌"→"3벌" 정정 | ai-hint-on-write.ts:54 | CONFIRMED | push-notify까지 3벌(논리 동치 실증) — 규칙 변경 시 push 누락 유도. 추출은 여전히 비권장(기각 존중) |
| AGENTS.md "crm 8테이블" | AGENTS.md | CONFIRMED | 실측 13테이블 — 현재형 서술만 갱신("drizzle/0000 8테이블"은 역사 서술로 정확) |
| 테스트 갭: AI 힌트 훅 배선 통합 4/16 | routes 테스트 | 감사 보고 | 견적 PATCH·승격 1경로 배선 통합 테스트 추가 후보 |

---

## 🚫 기각 (재제안 금지 — 반박 근거)

| 후보 | 반박 근거 |
|---|---|
| 신규·상담접수+유효 수동 상태 "영구 미노출 모순"(B2) | **클라 목록 배지도 같은 조건에서 공백**(manage-status.ts:45 null 반환 + CustomerFinalUpdateCell의 `info && status` 렌더 조건) — 서버가 클라 규칙을 미러(assistant-tools.ts:123 주석 명시). 모순 자체가 없음 |
| ⤷ **B2 기각 번복(2026-07-14, 유슨생 승인 — 예외적으로 재제안 수용)** | 기각 근거 "클라도 공백"은 **배지 셀만 본 불완전 전제**였다 — 같은 화면의 관리 상태 **필터**(CustomerManagementPage:183, status만 매칭)와 상세 **드로어 카드**(resolveManageStatus)는 신규·상담접수에서도 수동값을 인정해 필터에 걸린 행의 배지가 공백인 화면 내 모순이 실존 + 유슨생이 실사용에서 버그로 리포트(수동 지정 자체가 상담사 액션 — "액션 전 공백" 근거의 자기모순). → 유효 수동은 신규·상담접수에도 배지 표시·리포트 포함(수동 없는 파생 공백은 불변). 이행 PR #240 |
| `deriveFinalUpdateInfo` label 로컬 tz → KST 고정(K6) | atIso가 항상 세팅되고 소비처는 atIso 우선(customer-table.ts:174) — 판정 무영향. label은 표시 전용이고 **로컬 시각 표시가 표준 UX** — KST 고정이 오히려 해외 사용자에게 역효과. 실사용자 전원 국내 |

---

## 검증 예산 (착수 시)

- 클라 PR: `bun run typecheck`·`bun run lint`·`bun run test:unit`·`bun run build`.
- 서버/테스트 인프라 PR: + `bun run test:server`(npm 스크립트 프리픽스 필수 — 직접 `bun test <파일>` 금지).
- 3-B(UNIQUE index): 마이그는 `db:generate → db:migrate`(schemaFilter crm), 적용 전 psql로 중복 0 재확인(변하는 사실은 실측).
- 4-A(CSS): 빌드 산출 계산값 대조(verify-dead-css.sh 방식) 없이 머지 금지.
- 1클러스터(클라 manage): 격리 스택 브라우저 스모크(수동 설정→실활동→만료 반영·실패 롤백) 권장.
