# 0715 리팩토링 배치 6 — 감사 결과 · 실행 계획

Last updated: 2026-07-15 (유슨생 세션 `0715-fresh-start` — 감사·적대 검증 완료, 착수 대기)

**범위**: 배치 5(#238~#242) 이후 미감사 구간 = **#248·#249·#250·#251** + 오늘 상담메모 버그픽스 `8b4a11b`. 커밋 `685acc8..8b4a11b`, 코드 ~15파일(+1055/-329). #243~#247은 배치 5의 검증된 실행 산물이라 제외.
**방법**: 4앵글 병렬 감사(A 콘솔 레이아웃 #249/#248 · B 지식베이스 서버 #251 · C 지식베이스 클라+대시보드 #251/#250 · D 크로스커팅·실측) → 후보 취합 → 적대 검증 2명(상세 실패 경로 / 필터·key·테스트) → CONFIRMED/ADJUSTED/REFUTED.
**기준선 실측(D)**: typecheck 0 · lint 0 · knip **delta 0**(신규 findings 0 — 기존 unused export 7·type 9는 배치 6 무관) · 마이그레이션 신설 없음 · select 위반 0 · 신성 규칙 5종 전부 통과 · 클라 43 테스트 pass.

## 감사 총평
- **상급 버그 없음. 중급 1건**(C#1 — 콘텐츠 미러 상세 열기 실패가 목록을 통째로 지움).
- 신성 규칙 전부 준수 확인: Safari select onChange+onInput(신규 select 0, #249는 오히려 native select 3벌 삭제) · 서버↔클라 순수 import 경계(클라 content.ts는 `./http`만·서버 타입 수동 미러) · Workers fetch plain-call(신규 `deps.fetchImpl` 0) · public read-only 계약(insights/knowledge_articles SELECT만, write 0) · admin 게이트 4계층 정합(App/Sidebar/Topbar `최고관리자` + 서버 `role!=="admin"` 403 fail-closed).
- #248(delivery 헤더 잘림)·#249(5-mode 콘솔 통일·contract 순서 swap) 정합성 **결함 없음** — 헤더↔바디 5 mode×2 role index 정합 수기 대조. #250(구 대시보드 삭제) orphan 0. 오늘 버그픽스 `8b4a11b` 정합.

---

## 실행 후보 (CONFIRMED/ADJUSTED) — PR 그룹 제안

### PR1 — 콘텐츠 미러(인사이트·지식베이스) 상세 열기 실패 처리 정합화 + 2페이지 공통화

가장 실질적인 묶음. C#1이 유일한 [중]이고, 나머지 콘텐츠 미러 [하]들이 같은 두 파일(`InsightsPage.tsx`·`KnowledgeBasePage.tsx`)에 몰려 있어 함께 고치는 게 자연스럽다.

#### C#1. 상세 fetch 실패가 성공 로드된 목록을 통째로 지움 [중, CONFIRMED — 적대 검증 반박 3종 전부 실패]
- `InsightsPage.tsx:22,28,33,67-73` · `KnowledgeBasePage.tsx`(동일 구조). `error` 단일 플래그를 목록 로드 실패와 상세 로드 실패가 **공유**하고, `setError(false)` 리셋 경로가 파일 어디에도 없다.
- 발현: 목록 정상 로드 후(items 채워짐·selected=null) 한 행 클릭 → 상세 `fetchInsight` reject(**비-2xx**: 네트워크 끊김/5xx/403) → `catch(setError(true))` → `selected`는 null 유지 → 렌더에서 `error` 분기(목록 자리)가 **정상 목록 테이블을 "불러오지 못했습니다"로 통째 대체** + 상세가 안 열려 "목록으로" 버튼도 없음 → **새로고침(리마운트) 전까지 복구 불가**.
- 수정: 상세 로드 실패는 목록 `error`와 분리(별도 `detailError` 또는 토스트), 목록 렌더 유지. 최소 `setSelected(null)` 시 `setError(false)` 동반.

#### B#1. 미존재 id가 404 아닌 200 null → 조용한 클릭 무반응 + 타입 거짓말 [하, ADJUSTED — 크래시 주장 REFUTE됨]
- `src/routes/content.ts:23,31`가 `run(c, () => getInsight(...))`에 notFoundMsg 미전달 → `shared.ts:53` `c.json(null)` = **200 null**. 클라 `fetchInsight: getJson<InsightDetail>`(content.ts:34)이 `res.ok` true라 throw 안 하고 `null`을 non-null 타입으로 반환.
- **감사관 B의 "런타임 크래시" 주장은 틀림**: `.then(setSelected)` → `setSelected(null)` → `if(selected)` 가드가 falsy를 막아 상세 렌더 미진입 = 크래시 아닌 **무반응**. 남는 실결함 = 타입 거짓말(`InsightDetail`이 실제 null 가능) + "왜 안 열리지" 혼란. C#1과 **HTTP 상태로 갈리는 상보 경로**(2xx null=무반응 / 비-2xx=목록 소실)라 같은 슬라이스에서.
- 수정: 라우트에 notFoundMsg 부여(→404) + 클라 반환 타입 `InsightDetail | null` 정직화 + `openDetail` null 가드(토스트).

#### C#5. 두 페이지 상태머신 중복 + formatDate 포맷 드리프트 [하, CONFIRMED]
- `items/loading/error/selected` 상태머신·fetch·목록↔상세 토글·`formatDate` 거의 그대로 중복. **formatDate 포맷 상이**: Insights `2026.07.15`(4자리) vs Knowledge `26.07.15`(2자리) — 의도/복붙 잔재 불명확 UI 드리프트.
- 수정: `useReadonlyContentList<T>` 훅 + `ContentDetailView` 공통 컴포넌트 추출, `formatDate` 공용 1벌(연도 자릿수 통일). C#1 실패 처리 수정을 한 곳에서. → C#6도 자연 해소.

#### C#6. InsightsPage 목록 행 `<tr onClick>` 키보드 접근 불가 [하, CONFIRMED]
- Insights는 `<tr onClick>`(role/tabindex 없음, 마우스 전용) vs Knowledge는 `<button>`(접근 가능). 같은 배치에서 두 미러 마크업이 갈림.
- 수정: 셀을 `<button>`으로 감싸거나 `role="button" tabIndex={0}`+onKeyDown. C#5 공통화로 자연 해소.

#### C#2. 상세 열기 시 로딩 피드백 없음 [하, CONFIRMED]
- 행 클릭 → fetch 시작~해소 전까지 selected=null이라 화면 무반응 → 재클릭·중복 요청 유발. `detailLoading` 상태로 스피너/딤. C#5 공통 훅에 흡수.

### PR2 — 고객 관리 mode 전환 필터 잔존 해소

#### A#3. mode 전환 시 chance/finalUpdate 필터 잔존·비-all mode 해제 UI 없음 [하, CONFIRMED — 4겹 실증]
- `CustomerManagementPage.tsx:186-187`이 chanceFilter/finalUpdateFilter를 **전 mode** 적용(modeFilter와 직교) + pill은 all mode(929-947)만 렌더 + `App.tsx:315` `key` 없이 mount(prop 변경, 리마운트 아님) + `[mode]` 리셋 effect 부재.
- 발현: all에서 "계약가능성=높음" 선택 → consulting 전환 → consulting 목록이 조용히 필터되나 해제 UI 없음 → "고객이 사라졌다" 혼동. all로 되돌아가 pill을 ""로 바꾸는 것 외 해제 경로 없음.
- **pre-existing**(#249 이전부터 로직 동일)이나 통일로 레이아웃이 같아져 비대칭이 더 부각. 수정: `useEffect([mode])`로 두 필터 리셋(단순) 또는 비-all에서도 active 필터 해제 pill 노출.

#### A#1. 뷰 select pill이 aria-expanded=true인데 popover 안 열림 [하, CONFIRMED — mock a11y wart]
- 비-all mode 뷰 select 3개(`viewAdvisor`/`viewConsultStatus`/`viewUrgent`, `items:[]`). 클릭 시 aria-expanded=true 되나 popover 렌더 조건 `open && allItems.length>0`이라 listbox 부재 = NOOP. 설계상 의도된 mock이지만 스크린리더에 "expanded, listbox"라 안내되나 실체 없음.
- 수정: 옵션 채우는 후속 전까지 mock pill을 `disabled`(또는 aria-expanded 미부여). A#3과 같은 파일이라 묶음. **저우선**.

### PR3 — content 라우트 테스트·게이트 커버리지 보강

#### B#3. content.test 조건부 커버리지 [하, ADJUSTED — "test5만 유효"는 과장]
- knowledge_articles 111행이라 test3(정렬)·test4(상세 content)는 **실제 잠금**. 단 ⓐinsights 계약(목록 메타-only·not-content·상세 content/thumbnail)은 insights 0행이면 `if(body.length>0)`/`if(list.length===0) return`으로 조용히 통과 ⓑknowledge 목록 content-제외는 어느 test도 안 봄.
- 수정: 조건부 early-return 제거하고 최소 1행 단정(0행이면 fail)하거나 stub Executor 단위테스트로 데이터 무관 잠금 + test3에 `not.toHaveProperty("content")` 추가.

#### B#6. dealer/manager 403 미검증 [하, CONFIRMED]
- 비-admin 거부는 staff 1케이스만. dealer·manager도 `role!=="admin"` 403이나 명시 잠금 없음 → manager를 "admin 유사"로 완화하는 미래 변경 못 잡음. 케이스 1~2개 추가.

### 정비/dead (선택 — 소형 묶음 또는 흡수)

#### A#2. `.customer-console-headbar` 하위 orphan CSS 4종 [하, CONFIRMED — pre-existing dead]
- `customer-console.css:276·297·306·313·317·328` — #249가 total-count/list-view-controls/view-select를 toolbar로 옮겨 headbar 스코프 규칙이 매칭 대상 상실(#249 이전부터 dead, #249는 CSS 0줄 미변경). 별도 dead-CSS 정리 슬라이스에서 계산값 불변 증명 첨부 제거.

#### C#4. `KNOWLEDGE_BLOCK_TO_SLUG` 프로덕션 미소비 자기참조 테스트 export [하, CONFIRMED]
- `knowledge-categories.ts:4-17` — 프로덕션 렌더 경로 0건(페이지는 `group.blockNumber`+`knowledgeCategoryLabel`만). 테스트가 자기 리터럴과만 대조(앱 Dart 원본 파리티 미검증). 제거 또는 진짜 앱 파리티 픽스처로 승격.

---

## 제품 결정 필요

#### B#2. 인사이트 목록이 draft(미발행) 포함 — status 필터 없음 [하, 추정]
- `src/db/queries/content.ts:36-48` `listInsights`에 `where(eq(status,'published'))` 없음. `insights.status`는 draft|published인데 CRM admin 목록에 앱 미발행 draft 노출. (knowledge는 "status 항상 published"라 무관.)
- **결정 대상**: admin이 draft를 봐야 하면 현행 유지(단 UI status 배지 구분), 발행분만이면 쿼리에 published 필터. → 유슨생/이사님 확인.

---

## 기록만 / 후속 리스크 (이번 배치 조치 불필요)

- **B#4** read 라우트도 원시 DB 에러 텍스트 500 노출 — **app-wide 패턴**(PR 신규 아님, #231 경계 표면). `run` 폴백 generic화는 전 라우트 별도 슬라이스.
- **B#5** 목록 쿼리 limit 없음 — 현재 규모 무해(knowledge 111행). 앱 콘텐츠 대량 증설 시 커서/limit.
- **D#1** `knowledge-categories.ts` 크로스레포(앱 Dart) 드리프트 가드 부재 — Dart가 타 레포라 레포 내 파리티 원리적 불가(Edge 복제본과 다름). graceful 폴백(`?? slug`)이라 실피해 = 오표기 수준. 주석에 "항상 동일" 경고 상존. 수동 동기화 명시.
- **D#2** insights/knowledge_articles read-전용 write-guard tripwire 부재 — 현재 write 경로 0(위험 0). profiles 대비 결과 경미(콘텐츠/임베딩 드리프트 vs 인증 승격)라 tripwire 과설계 소지. 후속 고려만.

---

## 🚫 기각 박제 (재제안 금지 — 반박 근거)

| 항목 | 기각 사유 |
|---|---|
| **C#3** KnowledgeBasePage `key={group.category}` 중복 key | **REFUTED** — `KNOWLEDGE_BLOCK_TO_SLUG`이 block 1~12 ↔ slug **엄격 1:1**(앱 KB v1 12장 계약). category=chapter slug이라 한 category의 모든 문서는 **같은 blockNumber 공유** → 서버 `asc(blockNumber)` 정렬 시 **항상 연속** → category당 그룹 정확히 1개 → key 유일. 흩어지려면 앱이 자기 12장 모델을 위반해야 함(재현 불가). belt-and-suspenders로 `key`에 blockNumber 병용은 권고 수준일 뿐 결함 아님. |
| **B#1 "런타임 크래시"** | **부분 REFUTE** — 200 null·타입 거짓말은 사실이나 `if(selected)` 가드가 `setSelected(null)`을 막아 크래시 아닌 무반응. 크래시로 오판한 심각도([하~중]→[하]) 하향. 타입 정직화·404화는 유효(B#1 항목 유지). |

---

## 실행 우선순위 (유슨생 판단 대상)
1. **PR1**(C#1[중]+B#1+C#5+C#6+C#2) — 콘텐츠 미러 실패 처리 + 2페이지 공통화. 유일한 [중] 포함, 실 사용자 영향.
2. **PR2**(A#3+A#1) — 고객 관리 mode 필터 잔존. 실 UX 혼동.
3. **PR3**(B#3+B#6) — content 테스트·게이트 보강.
4. 정비(A#2 dead CSS·C#4 무가치 export) — 선택.
5. B#2 draft 노출 — 제품 결정 선행.
