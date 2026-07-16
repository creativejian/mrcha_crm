# 전역 계산기 모달 (값어림 계산 이식) — 설계

Last updated: 2026-07-16 (유슨생 세션 0716)

## 목적

Topbar 계산기 아이콘(현재 onClick 없는 mock, `Topbar.tsx` `calculator-btn`)을 실동작화 —
클릭 시 **전체화면 모달**로 파트너(제프 dolim-solution)의 **값어림 계산(비교견적 V2)** 페이지를
띄워 고객 무관 독립 계산을 지원한다. 유슨생 지시·이사님 방향(제프 사이트 "값어림 계산" 메뉴와 동일 화면).

## 원본 (이식 소스 — 전부 `/Users/tobedoit/Documents/TypeScript/dolim-solution`)

- 페이지: `client/src/pages/QuoteRevolutionV2.tsx`(407) — "V2 · 이사님 디자인 검수 페이지" = 디자인 확정본
- `client/src/components/redesign/TopSelectionCards.tsx`(614) · `ConditionCards.tsx`(783) · `types.ts`(56)
- `client/src/components/vehicle/{Brand,Model,Trim,Option,Color}PickerDialog.tsx`(계 899)
- `client/src/components/results/QuoteResultRow.tsx`(124) · `sortQuotes.ts`(LENDER_META만)
- `client/src/components/quote-bottom-bar/QuoteBottomBar.tsx`(35)
- 훅: `useMasterCatalog`(151) · `useMultiQuote`(117) · `useTrimOptions`(75) · `useTrimColors`(60)
- 타입/유틸: `types/quote.ts` · `types/catalog.ts` · `lib/residual.ts`(formatKrw·roundUpToNearestHundred)
- 에셋: `client/public/brand-logos/*.png` 33종(140KB) → CRM `client/public/brand-logos/` 복사 완료

## 핵심 사실 (실측 — 2026-07-16)

1. **외부 calculate = 내부와 같은 핸들러·같은 스키마**: 제프 `src/app.ts` `computeCalculateQuoteResponse`를
   `/api/quotes/calculate`(내부)와 `/api/external/quotes/calculate`(외부)가 공유. 입력 = `shared/contracts/quote.schema.ts`
   `calculateQuoteSchema` — V2가 보내는 전 필드(취득원가 오버라이드 4종·CM/AG 수수료·releaseMethod/maintenanceGrade·
   affiliateType 등)를 외부 API가 이미 수용. **제프 측 변경 불필요.**
2. **좁은 것은 CRM 릴레이 zod뿐**: `src/routes/solution.ts` `solutionCalcBody`가 zod strip이라 미정의 필드는
   업스트림에 전달되지 않는다 → **릴레이 zod 확장이 필수**(전부 optional 추가라 기존 워크벤치 경로 하위호환).
3. **CRM 카탈로그가 원천**: 제프 useMasterCatalog는 자기 DB(sync 사본)를 읽지만 CRM은 master `catalog` 직결 —
   `/api/vehicles/brands·models·trims` + `/api/vehicles/workbench?trimId=`(옵션+컬러+mcCode 한 방, `lib/vehicles.ts`).
4. **스택 호환**: 양쪽 다 Tailwind(CRM v4 활성)·shadcn 계열·`@/` alias — UI 클래스 거의 그대로 이식 가능.

## 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | 진입 = Topbar 계산기 아이콘 → 전체화면 모달(fixed inset). 닫기 = 헤더 X + Esc만, **backdrop 클릭 닫기 없음** | 입력 유실 방지. dealerMode disabled 유지(기존) |
| D2 | **판매사(BNK 딜러) 입력 v1 숨김** — dealerType 토글·딜러 select 미이식, `bnkDealerName` 미전송(비제휴 계산 고정) | `/api/catalog/bnk-dealers`는 제프 내부 전용(외부 노출 없음). 필요 시 후속에 제프 협의 |
| D3 | 금융사 어휘·미취급 판별·표시명 = CRM SSOT 재사용(`solution-quote.ts` SOLUTION_LENDERS·`solution-ranking.ts` isLenderNotAvailableMessage). 제프 fetchLenders(내부 API) 미이식 | 어휘 이중화 금지(기존 원칙) |
| D4 | 파일 배치 = `client/src/components/calculator/` 전용 폴더(hooks 포함). 훅 반환 계약은 제프 원형 유지 → 컴포넌트 이식이 기계적 | 기능 응집·기존 lib 오염 방지 |
| D5 | 모달은 `React.lazy` 코드 스플리팅(~3.5k줄 — 상시 번들 제외) | 번들 크기. pdf-lib 동적 import 선례 |
| D6 | "견적서 보기" = 제프 미러("준비 중" 안내 — 제프도 alert 준비중). 견적 선택(최대 3) 로직 유지 | 원형 충실 |
| D7 | 모달 닫으면 상태 소실(v1) — unmount. 재열기 = 초기 상태 | 단순성 우선. 유지 요구 나오면 후속 |
| D8 | UI = 제프 V2 1:1(Tailwind 클래스 유지), **데이터 배선만 교체**. CRM 전역 CSS(button 등 17k줄)와의 충돌은 모달 루트 스코프에서 실측 보정 | 디자인 재논의 불필요(이사님 검수본) |

## 배선 교체 표 (제프 → CRM)

| 제프 | CRM |
|---|---|
| `fetchMasterBrands/Models/Trims`(자기 DB) | `@/lib/vehicles` `fetchBrands/fetchModels/fetchTrims` |
| `fetchTrimOptions/fetchTrimColors`(mcCode 키) | `@/lib/vehicles` `fetchWorkbench(trimId)` 1콜(옵션+컬러 동시) |
| `calculateQuote` → 내부 `/api/quotes/calculate` | `sendJson("/api/solution/calculate", ...)`(기존 릴레이, 응답 `{ok, quote}` 패스스루 동일) |
| `fetchLenders` | `SOLUTION_LENDERS`(solution-quote.ts) — 렌트 게이트는 `solutionLenderOptions` |
| `NOT_AVAILABLE_PATTERNS`(useMultiQuote) | `isLenderNotAvailableMessage`(solution-ranking.ts) |
| `fetchBnkDealers` | ❌ v1 미이식(D2) |
| `LENDER_META`(sortQuotes) | 계산기 로컬 상수로 이식하되 코드·표시명은 SOLUTION_LENDERS에서 파생 |

## 릴레이 zod 확장 (src/routes/solution.ts — 전부 optional·하위호환)

V2 `buildPayload`가 보내는 필드 중 현재 zod에 없는 것(제프 `calculateQuoteSchema` 타입 미러):
`affiliateType` · `directModelEntry` · `releaseMethod("dealer"|"special")` · `maintenanceGrade("basic"|"vip")` ·
`selectedResidualRateOverride` · `acquisitionTaxMode` · `acquisitionTaxAmountOverride` · `includePublicBondCost` ·
`publicBondCost` · `includeDeliveryFeeAmount` · `deliveryFeeAmount` · `includeMiscFeeAmount` · `miscFeeAmount` ·
`cmFeeRate` · `agFeeRate` · `insuranceYearlyAmount` · `lossDamageAmount`.
`client/src/lib/solution-quote.ts` `SolutionQuoteInput` 타입도 동반 확장(컴파일 파리티 `_parityCheck` 유지).

## 알려진 리스크

- **CRM 전역 CSS 충돌**(D8): 전역 `button:disabled` 물빠짐 등 — 브라우저 스모크에서 실측 보정.
- **controlled `<select>`**: 이식 중 네이티브 select가 있으면 반드시 `@/lib/select-bind` `bindSelect`(Safari 규칙).
- 제프 `AnnualMileage`·`LeaseTerm` 리터럴 집합이 CRM `SOLUTION_MILEAGES`·`SOLUTION_LEASE_TERMS`와 일치하는지 이식 시 대조.

## 검증

typecheck 0 · lint 0 · unit(신규 훅·zod 확장 테스트) · build + **격리 스택 브라우저 스모크**
(모달 오픈 → 차량 선택 → 견적 조회 실계산(파트너 prod) → 3사 이상 결과 행 → 초기화 → Esc 닫기).
