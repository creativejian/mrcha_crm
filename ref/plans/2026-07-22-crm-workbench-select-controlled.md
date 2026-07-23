# 워크벤치 select controlled 전환 (배치 13 `K1 안 ②c`) — 설계·이행 SSOT

**상태**: ✅ **이행 완료**(2026-07-23) · 검증 전량 green(typecheck 0 · lint 0 · unit **1071** · build · knip 0 · format) · 브랜치 `refactor/crm-workbench-select-controlled`
**출처**: `ref/plans/2026-07-22-crm-refactor-batch-13.md` 별건 — "구조적 정답이나 DOM 쓰기 6경로 전환 + 저장 payload 회귀 재검증이라 별건. Safari 제약상 `bindSelect` 필수."
**착수 동기**: 2026-07-22에 uncontrolled 함정을 **두 번** 밟았다 — 팝오버 리마운트 키 무효(`#327`), 초기화 DOM 잔존(`#327`). 거울 결함군(`#326`)도 같은 뿌리.

## 무엇이 바뀌나

| | 지금 (배치 13 PR1 = 안 ④) | ②c 이후 |
|---|---|---|
| 진실 | **카드 DOM select** | **`ManualCard` state** |
| `lenderByCard` | DOM 파생 거울(매 커밋 재동기화 effect) | **소멸** — `condition.lender`가 곧 진실 |
| 사용자 선택 | 이벤트 델리게이션으로만 포착 | `bindSelect` (onChange+onInput) |
| DOM 쓰기 6경로 | `select.value = …` | `setManualQuoteCards(…)` |

**범위 = 금융사·판매사 2개**(카드에 남은 마지막 uncontrolled). 약정거리는 `QuoteWorkbench.tsx:510`에서 **이미** `bindSelect` controlled라 선례가 레포 안에 있다.

## 설계 결정

### D1. 진실 이동
`ManualCard.lender` / `.dealerName`을 라이브 값으로 승격하고 두 select에 `bindSelect`(Safari 규칙 — controlled select는 onChange만 들으면 선택이 통째로 유실된다). 폼 컨테이너 델리게이션(`QuoteWorkbench.tsx:449-450`)은 **버블링이라 그대로 살아** `handleManualCardFieldEdit` 파생 재계산은 무영향.

### D2. `lenderSeed` 신설 — ②b 기각 사유를 피하는 핵심
배치 13이 안 ②b(`condition.lender` 라이브화)를 기각한 사유는 **"그 값이 구 어휘 표시 유지 option의 원천이라, 다른 금융사를 고르면 레거시 값이 목록에서 사라져 되돌아갈 수 없다"**(`QuoteWorkbench.tsx:501-503`)였다. 그래서 ②c는 **시드 시점 값을 별도 필드로 분리**하는 것이 전제다 — `lenderSeed`는 사용자 선택으로 바뀌지 않으므로 option이 항상 살아 있다.

**판매사는 seed 불필요**: 딜러 목록은 (금융사, 브랜드) fetch 산물이고, 목록 도착 **전**엔 option이 현재값 1개뿐이라 다른 선택 자체가 불가능하다. 도착 **후**엔 저장 딜러도 그 목록 안에 있다. 라이브 값 기준 "없으면 살린다" 규칙으로 충분.

### D3. `manualQuoteCardsRef` 미러 — 빠뜨리면 #163 잔상 재발
DOM 읽기는 **항상 최신**이었지만 state는 **클로저 캡처**다. `loadCardDealers`의 늦은 응답 가드(`:788` `liveLender`)와 `applySolutionResult`는 async 뒤에서 값을 읽으므로 stale을 본다. 레포에 이미 있는 `cardUiRef`(`:110-111`) 패턴을 그대로 적용한다. **이 항목이 이 전환의 유일한 신규 위험원**이다.

### D4. K1-c 신 정책 — 🟡 행위 변경 (유슨생 결정 2026-07-22)
구매방식을 전환해 현재 금융사가 그 상품 취급 목록(`solutionLenderOptions`)에서 빠질 때:

- **지금**: 브라우저가 change/input **발화 0으로** 조용히 "미선택"으로 되돌린다 → 상담사가 눈치채지 못한다. **그 조용함이 K1 결함군의 뿌리**였다.
- **바뀜**: 전환 effect가 "실제 렌더되는 option 집합"(현행 어휘 + `lenderSeed`) 밖 금융사를 `LENDER_UNSELECTED`로 되돌리고 **토스트 1회** + 딜러 정리. 톤은 기존 `applyGateFallback` 안내와 통일.
- **저장 카드는 제외** — 게이트가 저장 카드를 제외하는 것과 같은 이유(편집 불가 + 저장값 표시가 깨진다).
- → pending 등재 대상(사후 공유).

### D5. 삭제 목록
- `lenderByCard` state + 재동기화 `useLayoutEffect`(`:1266-1311`) — **배치 13 안 ④가 통째로 불필요해진다**(거울이 존재할 이유가 소멸)
- 그 effect 안의 `dealerOptionsByCard` stale 정리(`#326`) → 금융사 변경 경로가 단일화되므로 `resetCardDealer`로 일원화
- dealer select `key={dealer-${condition.dealerName}}` 리마운트 트릭(`:522`)
- DOM 쓰기 6경로: `:447`(복사 lender) · `:462`(복사 dealer) · `:797`(`resetCardDealer`) · `:1006`(`applySolutionResult`) · `:1527`(`resetQuoteWorkbench`) + 브라우저 암묵 리셋(D4)

### D6. 저장 payload — 접촉면 최소화
`extractWorkbenchScenarios`(`:1133-1168`)에서 **lender·dealer 2개만** state 읽기로 바꾸고, 나머지 input의 `data-sc-field` DOM 추출 계약은 **무접촉**. 배치 13이 안 ③(`cardUi` 승격)을 기각한 사유가 "저장 payload 계약까지 건드려 blast radius만 크다"였으므로 그 선을 넘지 않는다.

## 회귀 그물 (각각 변이로 RED 실증)

1. 사용자 선택 → `extractWorkbenchScenarios` payload 반영 = **라이브 증명**
2. 구매방식 전환 → 미취급 금융사 리셋 + 토스트 (D4 신 정책)
3. **구 어휘 → 타사 선택 → 다시 구 어휘로 복귀 가능** (D2 = ②b 기각 사유 회피 증명)
4. 조건 복사 → 금융사·딜러 state 복사
5. 랭킹 모달 행 선택 → 금융사 반영 + 딜러 리셋
6. 초기화 → 금융사 미선택 (DOM 쓰기 없이)
7. `onInput` 단독 발화 → 선택 반영 (Safari 함정)

**기존 자산 동반 점검**: `QuoteWorkbench.gate.test.tsx` 7종(거울 생명주기 — 거울이 사라지므로 단언 대상 재조준 필요) · `useQuoteWorkbench.residue.test.tsx` 6블록(솔루션 반영·딜러 리셋·조건 복사가 select 조작 전제).

## 진행 방식

- 브랜치 `refactor/crm-workbench-select-controlled` · **단일 PR**(금융사·판매사가 복사·리셋·랭킹모달 경로를 공유해, 나누면 "진실이 두 곳"인 중간 상태가 더 위험하다).
- 커밋은 단계별로 끊는다: ①그물 선행 → ②controlled 전환 → ③거울·effect 삭제 → ④K1-c 정책.
- 검증: `typecheck` 0 · `lint` 0(`--max-warnings 0`) · `test:unit` · `build`. **실화면 1회**(magiclink 절차) — 금융사 선택·구매방식 전환·복사·초기화.

## 진행 상태

- [x] 설계 확정(2026-07-22) — 범위·K1-c 정책·PR 분할 유슨생 결정
- [x] controlled 전환 + `lenderSeed`(D2) + `manualQuoteCardsRef`·`savedManualQuoteConditionIdsRef`(D3)
- [x] 거울(`lenderByCard`) + 재동기화 `useLayoutEffect` + `sameStringMap` 삭제 · dealer `key` 트릭 삭제
- [x] K1-c 신 정책(D4) — 구매방식 전환 effect가 미취급 금융사 리셋 + 토스트 + 딜러 정리
- [x] 회귀 그물 + 기존 테스트 재조준 (gate 10 · residue 29)
- [x] **변이 3종 RED 실증**: A(legacy option을 seed→lender로 되돌림) → ②b 되돌아오기 테스트 RED · B(D4 드롭 비활성) → D4 테스트 RED · C(lender bindSelect→onChange only) → Safari onInput 테스트 RED. 각각 복원 후 전량 green 재확인.
- [x] 검증: typecheck 0 · lint 0 · unit 1071(+3) · build · knip 0 · format green
- [x] 🟡 K1-c 행위 변경 pending 등재(항목 27 — 이사님 사후 공유는 대기)
- [x] **실 Safari 눈확인 통과(2026-07-23, 유슨생 · prod `crm.mrcha.app`)** — 금융사·판매사 선택 유지 + K1-c 토스트 전부 정상. **이 축은 자동화가 원리적으로 못 본다**(Playwright webkit·jsdom 모두 Safari의 input→복원→change 순서를 재현 못 함 — `safari-select-oninput-required`). 즉 controlled 전환의 **유일한 미검증 리스크가 사람 눈으로 닫혔다**. ⚠️ 앞으로 이 워크벤치에 controlled select를 새로 추가하면 **같은 실 Safari 확인을 1회 반복**할 것(유닛·CI로는 대체 불가).

## 이행 요약 (실제 변경)

- **`quote-workbench-meta.ts`**: `ManualCard.lenderSeed` 신설 + emptyCards 3장 시드.
- **`useQuoteWorkbench.ts`**: `lenderByCard`·재동기화 effect·`sameStringMap` 삭제. `manualQuoteCardsRef`/`savedManualQuoteConditionIdsRef` 신설. `setManualLender`/`setManualDealer` 신설(구 `syncDealerOnLenderChange`·`resetCardDealer` 대체). `copyManualQuoteCondition`·`applySolutionResult`·브랜드 도착 effect·`resetQuoteWorkbench`·`extractWorkbenchScenarios`를 state 기반으로. `loadCardDealers` 늦은 응답 가드를 DOM→ref로. D4 정리 effect 추가. `buildManualCardsFromScenarios`에 seed.
- **`QuoteWorkbench.tsx`**: 금융사·판매사 select를 `bindSelect` controlled로. legacy option 원천을 `lenderSeed`로. `gateLender = condition.lender`. dealer `key` 트릭·`defaultValue` 제거.
- **queryCardSolution·handleSolutionQueryClick·buildCardSolutionArgs는 DOM 읽기 유지**(클릭 핸들러 컨텍스트 — controlled DOM이 state를 미러). 저장 payload는 lender·dealer 2축만 state, 나머지 uncontrolled input의 `data-sc-field` 추출 계약은 무접촉(D6).
