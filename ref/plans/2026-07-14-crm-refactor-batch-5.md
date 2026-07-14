# 0714 리팩토링 배치 5 — 감사 결과 · 실행 계획

Last updated: 2026-07-14 (유슨생 세션 `0714-partner-refactoring` — 착수)

**범위**: 오늘(2026-07-14) 머지된 **#238~#242**(5 PR). 핵심 = #241 계산엔진(파트너 API 연동, ~2,000줄 신규) + #242 앱 견적요청 컬러. 소규모 = #238 콘솔 테이블 SSOT · #239 앱 채팅 딥링크 · #240 수동 관리 상태 신규 표시.
**방법**: 4앵글 병렬 감사(계산엔진 순수 계층 / 계산엔진 UI·훅·CSS / 서버 릴레이+컬러 / 소규모 3PR+크로스커팅) → 후보 발굴 → 교차 검증. 기준선 typecheck 0·lint 0.

## 감사 총평
- **신규 [상]급 버그 없음.** 신성 규칙 전부 준수 확인: Workers `fetch` plain-call(지역변수 추출+`this===undefined` 회귀 테스트로 이중 방어) · Safari `select` onChange+onInput(신규 select 위반 0) · lease-rate `calculateRate` bit-identical 이식(루프 본체 텍스트 대조 일치) · zod 어휘 SSOT 단일성(서버 릴레이가 `SOLUTION_LENDERS/LEASE_TERMS/MILEAGES`에서 실제 파생, 손 복제 0).
- **A·B 교차 발견 1건**(percent→원 산술 중복) = 두 감사관 독립 확인 = CONFIRMED급.
- #239(앱 채팅 딥링크) 결함 없음. 기각 항목 재발 없음. 테스트 인프라 정합(신규 픽스처 접두사 registry 등록됨).

---

## PR 1 — 순수 계층 SSOT

### 1-A. percent→원 환산 코어 산술 3벌 중복 [중, CONFIRMED — A·B 교차]
- `quote-workbench-meta.ts:18-20` `discountLineWon`(percent 분기 `Math.round(basis*value/100)`, "함수 1벌로 잠근다"고 주석에 명시한 SSOT) ↔ `solution-quote.ts:127` `wonOf`(리터럴 재구현) ↔ `lease-rate.ts:93` `residualAmountOf`(리터럴 재구현). `useQuoteWorkbench.ts:981` `wonOfMode`는 이미 `discountLineWon` 재사용.
- >100 처리 3경로 제각각(null/null/0). 환산 기준·상한 변경 시 3곳 동시 수정 필요, 하나 놓치면 조회 입력↔화면 파생 드리프트.
- 순환 주의: `solution-quote ↔ quote-workbench-meta` 상호 import 존재 → 코어를 **`quote-pricing.ts`(순수 leaf, 셋 다 안전 import)** 에 `percentToWon(basis, pct)` 신설. `discountLineWon`/`wonOf`/`residualAmountOf` percent 분기가 공유. **파싱·상한(null/0)은 각 소비처가 각자 래핑**(코어 한 줄만 공유).
- 검증: 기존 `discountLineWon`/`wonOf`/`residualAmountOf` 값 불변(회귀 테스트 + TDD로 percentToWon 잠금).

### 1-B. `parsePercent`(관대) vs 순수 파서(엄격) 분기 [하, ADJUSTED — 단순 통일 불가]
- `useQuoteWorkbench.ts:259` `parsePercent`("4.5.5"→4.55, NaN→0, 관대) vs `wonOf`/`residualAmountOf`의 `Number(raw.replace(/[^\d.]/g,""))`(NaN→null, 엄격). 정상값 동일, 다중 소수점 오입력에서만 분기.
- **⚠️ 완전 단일 파서 통일은 부적절**: 세 소비처의 NaN 정책이 **상충** — 전송(`wonOf`/잔가)은 오입력 = fail-loud(null, 주석 120이 명시한 콤마 오입력 안전장치) / 파생(`wonOfMode`)·할인 행(`:430,443,461`)은 오입력 = 무음 0(할인 payload NaN 오염 방지). 하나로 묶으면 fail-loud 약화 또는 각 소비처에 NaN 가드 재추가 → 오히려 복잡(배치 4 "게이트 3규칙 추출 비권장 — 명시성이 실이익"과 같은 부류).
- **채택 방향**: percent **문자열 정규화**(digits+최초 소수점 흡수)만 SSOT 헬퍼로 뽑고, NaN→(null|0) **정책은 소비처별로 명시 유지**. 실이득이 정규화 공유뿐이면 이 항목만 보류하고 주석 박제도 가능(PR 1 구현 중 판단).

### 1-C. `solutionSnapshotsFromScenarios` raw-null 통과 사각 [하]
- `quote-workbench-meta.ts:179` 게이트가 `solutionLenderCode == null || solutionCalculatedAt == null`만 봄. `lenderCode`+`calculatedAt`은 있고 `solutionRaw`만 null인 반쪽 행이 스냅샷으로 통과 → `residualDisplayFromSnapshot`→`parseSolutionQuoteResult(null)`→null→"-" → max 잔가 재시드가 바로 이 함수가 막으려던 소실을 재현. 4컬럼 동시 기록이라 정상 경로 미발생·테스트 미커버.
- 수정: 게이트에 `s.solutionRaw != null` 추가(TDD).

---

## PR 2 — 계산엔진 정합성·테스트

### 2-A. 레거시 견적 재진입 시 결과 4필드 무가드 재파생·재발송 [중, CONFIRMED 메커니즘 — 🔵 제품 판단 선행]
- `useQuoteWorkbench.ts:962-1003` `deriveAndFillCardResults`가 `for (const card of manualQuoteCards)`로 **저장 카드 게이트 없이 전체 순회**, 결과 4필드 DOM `.value`를 파생값으로 덮음(`:998-1001`). effect(`:1020-1025`, deps에 `manualQuoteCards`)에서 `openEditQuote` 재진입 시 발화. 재발송 시 `extractWorkbenchScenarios`가 덮인 DOM을 읽음.
- 발현: solution 도입(오늘) 이전 견적(0704~0713, 결과 4필드 = 수기 입력, 특히 금리 = 표면금리)을 재진입하면 화면 금리가 실질 IRR로 점프하고, **재발송 시 저장 레코드의 `interestRate`/`totalReturn`/`totalTakeover`가 조용히 변경**.
- 🔵 **제품 판단 필요**: 스펙 개정 1 R3이 "결과 4필드 = 읽기 전용 파생"을 확정 → 재파생이 의도된 정규화일 수 있으나, **레거시 견적 재발송 시 금리 의미가 표면→실질 IRR로 바뀌는 것**(고객에게 다른 숫자)은 명시적으로 다뤄지지 않음. 결정 후 게이트(저장 카드 제외) 또는 "재발송 = 재산정" 명시 + **회귀 테스트로 동작 잠금**.

### 2-B. 릴레이 바디 스톨 504 분기 무테스트 [중, 확신 높음 — 테스트갭]
- `src/routes/solution.ts:88-96` — "헤더는 8초 내 도착, 바디 스트리밍 중 정지 → `upstream.json()`이 abort로 reject"(라인 91 `controller.signal.aborted` → 504) 경로가 어느 테스트로도 미실행. 기존 AbortError 테스트(`solution.test.ts:189`)는 `fetchImpl`이 직접 던져 바깥 catch(:116)만 탐. 저자가 주석(83-85)으로 경고한 회귀를 못 막음.
- 수정: `fetchImpl` resolve 후 `.json()`이 reject하고 signal aborted인 mock 추가(504 단언).

### 2-C. in-flight 조회 중 residual 모드 stale 클로저 [하]
- `useQuoteWorkbench.ts:790-821` `applySolutionResult`가 호출 시점 렌더의 `cardUi` 클로저 캡처 → 조회 in-flight 중 잔가 모드 max↔percent 변경 시 `cardUiOf(cardUi, condId).residualMode` stale → 옛 모드 기준 residual 세팅. 모드 세그먼트는 `disabled={isConditionSaved}`뿐(로딩 중 미비활성).
- 수정: 로딩 중 카드 모드 세그먼트 disabled 또는 응답 시점 최신 모드 ref 재조회. (조회 ~1s로 확률 낮음)

### 2-D. 랭킹 모달 null-base 사유 없는 무결과 [하]
- `SolutionLenderRankingModal.tsx:60-79` — `buildBaseArgs(condId)` null 시 전 금융사가 `doneCount`만 소진, `failureNote` null → empty state가 사유 없이 "조회 결과가 없습니다"만(fail-loud 취지 반). 사전 프로브가 대부분 막지만 프로브~마운트 레이스 시 조용한 무결과.
- 수정: base null이면 모달 미개방 또는 empty state에 "카드 조건을 읽지 못했습니다" 사유.

---

## PR 3 — manage-status

### 3-A. "신규·상담접수 제외" 규칙 파리티 미잠금 [중, 확신 높음 — 테스트갭]
- `manage-status.ts:45`(`statusGroup==="신규" && status==="상담접수"` → null) ↔ `assistant-tools.ts:140`(같은 조건을 filter에 리터럴). #240 정합성 핵심 전제("목록 배지·필터·드로어가 수동 인정 → 리포트만 빼면 배지↔리포트 모순")가 이 미러에 의존. `manage-status-parity.test.ts`는 버킷·일수·스누즈만 잠그고 이 제외 규칙은 미커버 = 저장소가 방어해온 드리프트 클래스의 유일한 사각.
- 수정: 클라/서버 양측 assert하는 파리티 테스트 추가(또는 `client/src/data/`에 "액션 전 상태" 공유 상수 — 서버 import 가능 경계).

### 3-B. `manualUpdateInfo` ↔ `deriveFinalUpdateInfo` 라벨·일수 산술 복제 [하]
- `manage-status.ts:63-77` vs `41-57` — `p()` 패딩, `${월}월 ${일}일 ${HH}:${MM}` 포맷(`customer-table.operationDateValue` regex가 파싱하는 load-bearing 계약), `Math.max(0, kstDayIndex(now)-kstDayIndex(at))` 각각 재작성. 차이는 guard·`action`뿐. 포맷 어긋나면 응답 SLA 파싱 조용히 파손인데 이중 관리.
- 수정: `buildFinalUpdateInfo(at, action, now)` 파일 내 헬퍼로 label·days·atIso 조립 1벌화.

### 3-C. 셀이 `manualUpdateInfo(customer)` 재계산 [하]
- `CustomerManagementRow.tsx:413` — `resolveUpdateBadge`가 이미 `effectiveManageStatus`(manual)로 status를 냈는데 셀이 `manualUpdateInfo(customer)`로 다시 계산. info↔status가 두 지점에서 `customer`를 각각 읽어 우연히 일치.
- 수정: `resolveUpdateBadge` 반환에 manual 팝오버용 info 포함(합성) → 셀은 그 값만 렌더.

---

## PR 4 — CSS·타입

### 4-A. #238 `.console-table` SSOT 불완전 [하, 확신 높음 — 설계]
- `controls.css:99-112` `.console-table`은 background/color/border-bottom만 오버라이드. padding·font-size·font-weight(780)·white-space·text-align은 전부 **스코프 없는 전역 `th,td`/`th`/`td`**(`customer-list.css:55-77`) 누수에 의존(원래 견적요청 테이블에 회색 헤더 물들이던 그 누수). "SSOT"라는 이름이 실제 단일 소스가 아님. 누군가 전역 `th,td`를 `.customer-table`로 스코프하면 앱 견적요청 테이블이 padding/font 통째로 잃음.
- 수정: 전역 `th,td`를 `.customer-table`/`.console-table`로 스코프하고 padding/font를 공용 `.console-table`에 흡수(진짜 SSOT화). **계산값 증명 필수**(`tools/verify-dead-css.sh` 방식).

### 4-B. #238 `table-scroll`+`console-table-scroll` overflow 무력화 [하]
- `controls.css:86` `.table-scroll { overflow-x: auto }` vs `:96` `.console-table-scroll { overflow: hidden }`(후자 승) → `overflow-x: hidden`. radius 클리핑엔 정당하나 `table-scroll` 스크롤 의미 사망(좁은 뷰포트에서 고정폭 넘침 시 스크롤 대신 클리핑). 소비처 `AppRequestsPage.tsx:116`·`CustomerManagementPage.tsx:1122`.
- 수정: 콘솔 래퍼에서 `table-scroll` 제거(불필요) 또는 `overflow-x: auto`+radius 병행 재검토.

### 4-C. 서버·클라 `AppQuoteRequestRow` 이중 정의 [중]
- `src/db/queries/quote-requests.ts:12` ↔ `client/src/lib/quote-requests.ts:7` — ~25필드(이번 컬러 7필드 포함) 손 각각 선언. 컬러 PR이 lockstep 수정해 위험 재확인. 한쪽만 변경 시 컴파일러 미검출·조용한 드리프트(undefined).
- 수정: 서버 타입을 순수 모듈로 추출해 클라 재사용(경계 규칙 허용 범위 확인) 또는 타입 파리티 테스트로 잠금.

### 4-D. base `solution-lender-dialog` width dead [하, 의심]
- `customer-detail-cards.css:116` base `width: min(420px…)` vs `:168` `.is-ranking { width: min(520px…) }`. 컴포넌트는 항상 `is-ranking`(`SolutionLenderRankingModal.tsx:44`) → base width 한 줄만 dead(나머지 radius/overflow/bg/shadow는 live). **계산값 대조 후 확정.**

---

## 🔵 제품 판단 필요 (이사님/유슨생 결정)
1. **[2-A] 레거시 견적 재발송 시 금리 의미 변경**(표면 → 실질 IRR) — 재파생이 의도된 정규화인지, 저장 카드는 게이트로 보존할지. 최소 회귀 테스트로 동작 잠금 필수.
2. **[C 하급] 릴레이 `200+{ok:false}` 소프트실패 사유 유실** — `solution.ts:107` 성공 경로가 `{ok:false, error}`도 200 패스스루 → 클라 파서 null → 일반 문구. 파트너가 4xx만 쓰면 미도달(현재 위험 낮음). 릴레이에서 `body.ok===false`→400 매핑할지.
3. **[C 하급] 컬러 프리필 mode 게이팅 무검증** — `quote-requests.ts:263` SELECT가 `color_preference_mode` 조건 없이 컬러 id 반환(앱 RPC CASE 신뢰). CRM측 `mode==="selected"` 게이트 추가할지.
4. **[C 하급] `colorLabel` 승격 인박스 미노출** — NeedsDashboard 카드만 렌더, AppRequestsPage 미사용. 인박스에도 노출할지(설계 결정 가능성 높음).

---

## 🚫 기각 / 의도 확정 (재제안 금지)
| 후보 | 근거 |
|---|---|
| 랭킹 "금리 순" 우리카드 유효금리 vs 그 외 표면금리 혼합 | 제프 `sortQuotes`/스펙 §271 충실 미러 — 의도 확정 |
| 금리 = 실질 IRR(표면금리 아님) | 스펙 개정 1 박제 — 의도 확정 |
| 파생 4필드 읽기 전용 | 스펙 개정 1 R3 — 확정 |
| onChange+onInput 이중 바인딩 | Safari 신성 규칙 — 제거 금지 |
| `workbookImport` "필수" 표기 | 파서가 의도적으로 관대(코드가 옳음) — **스펙 §91 문구만 stale, 정정 후보**(코드 무변경) |
| `manualUpdateInfo` local tz getter | 채택 표준(로컬 표시·atIso 우선)과 정합 — days만 KST. 올바름 |
| lease-rate "500벡터" 미커버 | residue 테스트가 2번째 실벡터(23.16%)로 종단 잠금 + 검증된 bit-identical 복사본 — 회귀 위험 제한적 |

---

## 검증 예산
- 클라 PR: `bun run typecheck`·`bun run lint`·`bun run test:unit`·`bun run build`.
- 서버 PR(2-B): + `bun run test:server`(npm 스크립트 프리픽스 필수 — 직접 `bun test <파일>` 금지).
- 4-A/4-D(CSS): 빌드 산출 계산값 대조(verify-dead-css.sh 방식) 없이 머지 금지.
- 2-A: 제품 결정 후 회귀 테스트 + (여력) 격리 스택 브라우저 스모크(레거시 견적 재진입→재발송 값 확인).

## PR 분할·순서
- PR 1(순수 계층) → PR 2(계산엔진) 순차 — 둘 다 `useQuoteWorkbench.ts` 편집(981 vs 962, 충돌). PR 1 머지 후 PR 2 rebase.
- PR 3(manage-status)·PR 4(CSS·타입)는 PR 1/2와 파일 독립 — 병렬 가능.
- 스택 PR 주의: 선행 PR `--delete-branch` 머지 시 후속 자동 close — 각 PR main 기반 독립 브랜치, 순차 머지+rebase.
