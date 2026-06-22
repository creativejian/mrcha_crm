# crm 견적 시나리오 비교 표시 + 대표 전환 #4c-3b 설계

작성일: 2026-06-22
상태: **design 확정. 구현(plan)은 새 세션에서.**
성격: 견적 도메인(#4) 세째 사이클의 **세번째 슬라이스 둘째 조각(#4c-3b)**. #4c-3a가 시나리오 N건 저장 + `KimQuoteItem.scenarios` 배열 노출까지 했고, 이 조각은 **견적함에서 1~3 시나리오 비교 표시(펼침) + 대표(primary) 전환 UI**.
연계: `2026-06-22-crm-quotes-multi-scenario-design.md`(#4c-3a, scenarios 저장/읽기), `2026-06-21-crm-quotes-write-design.md`(#4b updateQuote/PATCH).

## 배경 / 현황

- #4c-3a 머지(`053cfec`)로 **`KimQuoteItem.scenarios: CustomerDetailScenario[]`가 노출**됨(입력 가능 필드: 금융사·보증금·선수금·잔존·약정거리·월납입 mode+value). `CustomerDetailScenario`도 그 컬럼 보유.
- 견적함 행(`CustomerDetailPage.tsx` 약 4200~4216)은 **대표 시나리오 1건만** 표시(`toKimQuoteItem` 평탄화: financeType/term/monthlyPayment/lender). scenarios 배열은 노출됐지만 UI에서 미사용.
- 서버 `updateQuote`(`src/db/queries/customer-quotes.ts`)는 헤더(`headerSet`) + 대표 시나리오 1건 갱신. **`primary_scenario_id` 변경 경로 없음**(`QuoteHeaderPatch`·`headerSet`에 없음). 프론트 `QuoteWritePatch`에도 없음.
- 대표 시나리오 resolve는 `pickPrimaryScenario`(kim-quote.ts): `primaryScenarioId` 일치 → 없으면 scenario_no 최소.

## 범위

- **범위 안**: 견적함에서 `scenarios.length >= 2`일 때 펼침 비교 UI + 대표 전환(`primary_scenario_id` PATCH). 1건이면 현행 대표 표시 유지.
- **범위 밖**: 입력 불가 mock 필드(기간/자동차세/보조금/계산결과) 입력화·표시(저장 안 됐으니 표시도 없음), 계산엔진, copy 버튼, #4d 원본 파일.

## 표시 설계 — 펼침(아코디언)

- 견적 행에 **`scenarios.length >= 2`일 때만** "비교 N ▾" 버튼 노출(위치: meta-primary 줄 우측 또는 행 우측 액션 근처 — 구현 시 기존 톤에 맞춤).
- `expandedQuoteId` state(`string | null`)로 토글 — 한 번에 한 견적만 펼침.
- 펼치면 행 하단에 시나리오 카드 목록(scenario_no 오름차순). 각 카드:
  - `[scenario_no]` 배지 + 금융사 · 월납입(`formatMoney`/원) · 보증금(mode 표기: "30%" 또는 "1,000만원" 또는 "없음") 등 **저장된 입력 가능 필드만**(선수금/잔존/약정거리는 값 있으면).
  - **대표 = ★ 배지**(읽기 전용), 나머지 = **"대표로" 버튼**.
- 톤: 기존 견적함 라인/칩 문법(`kim-quote-*`) 재사용, drawer 컴팩트 폭 고려. 상시 노출 아님(필요할 때만 펼침) — 프로젝트의 "조밀 + 펼침" 패턴.

## 대표 전환 설계

- **`KimQuoteItem`에 `primaryScenarioId?: string` 추가** — 어느 카드가 ★인지 판정. `toKimQuoteItem`이 `q.primaryScenarioId` 매핑.
- **서버**: `QuoteHeaderPatch`에 `primaryScenarioId?: string | null` 추가. `updateQuote`에서 **그 id가 해당 quote의 scenario 목록에 있을 때만 set**(검증 — 타 quote/없는 id면 무시). updateQuote는 이미 scenarios를 조회(`scs`)하므로 그 목록으로 검증 가능. `headerSet`에 무조건 넣지 말고 검증 후 별도 처리.
- **프론트**: `QuoteWritePatch`에 `primaryScenarioId?: string | null` 추가. 견적함 "대표로" 클릭 핸들러:
  - 낙관: 해당 KimQuoteItem의 `primaryScenarioId`를 새 시나리오 id로 + **대표 평탄화 필드(financeType/term/monthlyPayment/lender)를 새 대표 시나리오 값으로 갱신**(견적 행 대표 요약 줄 즉시 반영).
  - `updateQuote(cid, quoteId, { primaryScenarioId })` PATCH + 실패 시 롤백(이전 primaryScenarioId/평탄화 복원).
  - 임시 id(`kim-`) 견적은 가드(저장 전 전환 불가).

## 계층 변경

### 1. `src/db/queries/customer-quotes.ts`
- `QuoteHeaderPatch`에 `primaryScenarioId?: string | null`. `updateQuote`: scenarios 조회 결과(`scs`)에 그 id가 있으면 `quotes.primaryScenarioId` set(없으면 무시). (헤더 update와 함께 또는 직후 별도 update.)

### 2. `src/routes/customers.ts`
- `quotePatchBody` zod에 `primaryScenarioId: z.string().uuid().nullable().optional()` 추가.

### 3. `client/src/lib/customer-quotes.ts`
- `QuoteWritePatch`에 `primaryScenarioId?: string | null`.

### 4. `client/src/lib/kim-quote.ts`
- `KimQuoteItem`에 `primaryScenarioId?: string`. `toKimQuoteItem`이 `q.primaryScenarioId ?? undefined` 매핑.

### 5. `client/src/pages/CustomerDetailPage.tsx`
- `expandedQuoteId` state + 견적함 행 "비교 N ▾" 버튼(scenarios>=2) + 펼침 카드 목록 렌더.
- "대표로" 핸들러(낙관 + `updateQuote` PATCH + 롤백). 대표 평탄화 갱신 헬퍼(scenarios에서 새 primary 찾아 financeType/term/monthly/lender 재계산 — `kim-quote.ts`의 `formatTerm`/`formatMonthly` 재사용 가능하면 export).
- `client/src/index.css`에 펼침 카드 스타일.

## 검증

- `typecheck` 0 · `lint` 0
- `test:server`: `PATCH /:id/quotes/:childId`에 `primaryScenarioId`(같은 quote scenario) → getCustomer에서 `primaryScenarioId` 반영 + 대표 평탄화 변경 확인. **타 quote scenario id → 무시(primary 불변)**.
- `test:unit`: `toKimQuoteItem`이 `primaryScenarioId` 노출 + `pickPrimaryScenario`가 새 primary 반영.
- 표시/펼침/전환 동작은 **#4c 일괄 브라우저 검증**(인증 세션).

## 미결 / 다음

- #4c 완료 후 **브라우저 일괄 검증**(#4c-1·#4c-2·#4c-3a·#4c-3b): 워크벤치 차량/가격/색상 + 비교카드 N 시나리오 저장 + 견적함 펼침 비교 + 대표 전환 새로고침 유지.
- 입력 불가 mock 필드 입력화 + 계산엔진(dolim 솔루션).
- #4d 원본 파일 영속.
