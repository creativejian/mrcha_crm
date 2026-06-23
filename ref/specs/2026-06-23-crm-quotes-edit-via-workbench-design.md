# 견적 수정 워크벤치 일원화 (composer 폐기) — 설계

Date: 2026-06-23
Status: Draft (사용자 리뷰 대기)
Topic: #4 견적 — composer 모달 폐기, 견적 "수정"을 솔루션 워크벤치로 일원화

## 배경 / 목표

견적 입력 UI가 두 갈래로 중복돼 있다.

- **composer 모달** (`quoteComposerMode`, `kim-quote-builder-modal`): 차량을 자유텍스트로 입력하는 mock 수기폼. 견적 "작성(manual)"·"수정(edit)"·OCR 원본인식 진입을 담당. 미진단 상태의 왼쪽 잘림 레이아웃 버그도 있음.
- **솔루션 워크벤치** (`isQuoteSolutionWorkbenchOpen`, `kim-quote-solution-modal`): catalog 차량(`VehiclePicker`) + `computePricing` 실가격 + 옵션/색상/다중 시나리오를 다루는 실제 계산기. 신규 작성(INSERT)만 함.

이사님 결정: **composer를 폐기하고 견적 수정도 워크벤치로 일원화**한다. 목표는 (1) 견적 입력 UI 단일화, (2) 수정도 실제 catalog·계산엔진 기반으로, (3) composer 레이아웃 버그를 진단 없이 폐기로 종결.

수정 범위는 **차량 포함 전체 재편집**으로 합의(2026-06-23). 즉 수정 진입 시 차량까지 catalog에서 다시 고를 수 있어야 한다.

## 현재 구조와 핵심 제약

| 항목 | composer (edit) | 워크벤치 |
|------|-----------------|---------|
| 차량 | 자유텍스트 input (brand/model/trim) | `VehiclePicker` catalog 선택 (`trim_id`) |
| 가격 | 폼 텍스트 필드 일부 | DOM 입력(`readPricingInputs`) + `computePricing` |
| 색상/옵션 | 없음 | `ColorPicker`/`OptionPicker` (catalog FK) |
| 시나리오 | 단일 | 다중(1~3, 비교카드) |
| 저장 | PATCH(`updateQuote`, 텍스트+단일 시나리오만) | INSERT(`createQuote`, 전체 스냅샷) |

**제약 1 — 읽기 어댑터가 catalog FK를 버린다.** 백엔드 `getCustomer`는 이미 quotes 전체 컬럼을 노출하지만(`QuoteWithScenarios = Omit<quotes.$inferSelect, "filePath">`, `customers.ts:103` `select()`), 프론트 어댑터(`CustomerDetailQuote` 타입 + `toKimQuoteItem`)가 `trimId`/`exteriorColorId`/`interiorColorId`를 매핑하지 않고 버린다. 그래서 **워크벤치로 만든 견적조차 재진입 시 catalog 차량/색상을 복원할 데이터가 프론트까지 오지 않는다.**

**제약 2 — picker가 초기 선택 복원을 지원하지 않는다.**
- `VehiclePicker`: `onChange`만 받음. 내부 brand/model/trim state 자체관리. 견적엔 `trim_id`만 있고 brandId/modelId가 없어 **역추적 로드**가 필요. 단, `fetchTrimDetail(trimId)` 단건 API가 이미 존재.
- `OptionPicker`: `options`/`relations`/`onChange`. 초기 선택 prop 없음 → 추가 필요.
- `ColorPicker`: `colorType`/`colors`/`value`/`onChange`. **`value`를 받으므로 복원 쉬움**(색상 목록 로드 후 id 매칭).

**제약 3 — `updateQuote`가 스냅샷/다중 시나리오를 갱신하지 못한다.** `QuoteWritePatch`는 텍스트 헤더 + 단일 시나리오만. 전체 재편집을 저장하려면 가격/색상/옵션 스냅샷 + 다중 시나리오 교체를 PATCH로 받도록 확장해야 한다.

## 결정사항

1. **수정 범위 = 차량 포함 전체 재편집** (옵션 C).
2. **저장 경로 = 제자리 UPDATE.** 같은 견적 id/`quote_code` 유지, `revision++`, 발송 시 `sent_at` 갱신. 다중 시나리오는 delete + re-insert로 교체(`createQuote`의 insert 패턴 재사용). *재생성(삭제 후 새 견적)은 `quote_code`가 바뀌고 첨부 원본 파일 경로가 끊겨 채택하지 않음.*
3. **legacy 견적(`trim_id` 없는 composer/OCR 출신) 처리** = 수정 진입 시 차량/옵션/색상은 **비워서 열고** "차량을 선택하세요" 안내, 금융조건·메모는 기존 텍스트로 prefill. 차량 선택 후 정상 저장되면 catalog 견적으로 승격.
4. **OCR 원본인식 = 워크벤치 헤더로 일원화**(이미 존재). composer의 OCR 진입만 제거.

## 슬라이스 (PR)

순서: PR1 → PR2a → PR2b → PR2c → PR3. 각 PR은 typecheck 0 · lint 0 · build OK · 관련 테스트 통과를 만족하고 단독 머지 가능해야 한다.

PR1은 작아서 한 슬라이스였지만, PR2(워크벤치 수정모드)는 조사 결과 백엔드/picker/통합이 각각 독립적이고 통합 prefill이 커서 **2026-06-23 PR2a/2b/2c로 재분할**했다.

| PR | 내용 | 상태 |
|----|------|------|
| PR1 | 읽기 어댑터 catalog FK 노출 | main 머지 완료 |
| PR2a | 백엔드 `updateQuote` 확장(스냅샷+시나리오 교체) + zod + 프론트 타입 + vehicles `getTrimDetail` ancestry 보강 | 예정 |
| PR2b | `VehiclePicker`/`OptionPicker` 초기선택 복원 prop | 예정 |
| PR2c-1 | 통합 — 수정 진입+차량/옵션/색상/가격 prefill+UPDATE 저장+재발송+legacy. **시나리오는 미전송→기존 보존**(편집 제외) | 예정 |
| PR2c-2 | 비교카드 controlled화(입력 불가 mock 입력화) + 시나리오 전체 복원/편집(저장 시 교체) | 예정 |
| PR3 | composer 완전 제거 | 예정 |

PR2c는 조사 결과 통합 prefill이 비결정적 타이밍 + 비교카드 절반이 입력 불가 mock이라, **2026-06-23 PR2c-1/2c-2로 재분할**. PR2a `updateQuote`가 `scenarios` 미전송 시 기존 시나리오를 보존하므로, PR2c-1은 시나리오를 건드리지 않아 손실이 없다(사용자가 고른 "시나리오 전체 복원"은 PR2c-2에서 실현).

### PR1 — 견적 읽기 어댑터에 catalog FK 노출

데이터 변화만, UI 변화 없음. prefill의 데이터 기반을 깐다.

- `client/src/lib/kim-quote.ts`
  - `CustomerDetailQuote`에 `trimId: number | null`, `exteriorColorId: number | null`, `interiorColorId: number | null` 추가. (`options`는 이미 있음.)
  - `KimQuoteItem`에 동일 FK 필드 추가.
  - `toKimQuoteItem` 매핑에 FK 통과 추가.
- 백엔드: `getCustomer`가 이미 전체 컬럼을 보내므로 쿼리 무변이 기본. **확인 필요**: `routes/customers.ts` 응답 직렬화가 FK/`options`(JSON)를 누락 없이 내보내는지 — 누락 시 그 지점만 보강.
- 검증: typecheck/lint, `test:server`(읽기 형태 유지), 필요 시 `toKimQuoteItem` 단위테스트 보강.

### PR2a — 백엔드 `updateQuote` 확장 + vehicles ancestry 보강

UI 변화 없음. PR2c의 저장/복원 데이터 경로를 깐다. 서버테스트로 검증.

**견적 UPDATE 확장 (`src/db/queries/customer-quotes.ts` + zod + 프론트 타입)**
- `QuoteHeaderPatch`(서버)에 가격/색상/옵션 스냅샷 컬럼 추가(`trimId`/`basePrice`/`optionTotal`/`options`/`finalDiscount`/`acquisitionTax`/`acquisitionTaxMode`/`bond`/`delivery`/`incidental`/`finalVehiclePrice`/`acquisitionCost`/`exteriorColorId`/`Name`/`Hex`/`interiorColorId`/`Name`/`Hex`). `headerSet`에 set 추가.
- `QuotePatch`에 `scenarios?: ScenarioInput[]` 추가. `updateQuote`가 `scenarios` 제공 시 해당 quote의 `quote_scenarios`를 delete 후 re-insert(`createQuote`의 시나리오 insert 로직을 공용 헬퍼로 추출해 재사용), primary = scenario_no 최소로 재계산. 미제공 시 기존 단수 `scenario` 갱신 경로 유지(하위호환). `bumpRevision`/`sent_at`은 기존 #4b 경로.
- 가드: `id AND customer_id`. `trimId`/`colorId`는 catalog 실존 id만. 라우트는 이미 `transaction`으로 `updateQuote` 호출 → 시나리오 교체도 tx 안.
- `routes/customers.ts` `quotePatchBody` zod를 `quoteCreateBody`처럼 스냅샷 + `scenarios: z.array(quoteScenarioBody).max(3).optional()`로 확장.
- `client/src/lib/customer-quotes.ts` `QuoteWritePatch`(프론트 타입) 동형 확장.

**vehicles `getTrimDetail` ancestry 보강 (`src/db/queries/vehicles.ts` + 타입)**
- `getTrimDetail`이 `modelId`만 주므로(`brandId`/이름 없음) VehiclePicker 복원이 불가 → catalog 조인으로 `brandId`/`brandName`/`modelName`을 응답에 추가. 라우트(`/api/vehicles/trims/:id`)는 결과를 그대로 반환하므로 무변.
- `client/src/lib/vehicles.ts` `TrimDetail`에 `brandId: number`/`brandName: string`/`modelName: string` 추가.

- 검증: typecheck/lint, `test:server`(updateQuote 확장 라운드트립·시나리오 교체·404/가드, vehicles ancestry), build.

### PR2b — picker 초기선택 복원 prop

워크벤치 신규 작성에도 무해(초기값 없으면 기존 동작). PR2c가 소비.

- `ColorPicker`: 변화 없음 — `value`에 복원 색상 주입(PR2c에서 trimDetail.colors id 매칭).
- `OptionPicker`: 초기 선택 prop(`initialSelectedIds?: number[]`) 추가 → `useState(() => new Set(initialSelectedIds))`. 부모가 같은 trim에선 `key`로 재마운트 안 하므로 prefill은 진입 시 1회. 마운트 effect-setState 회피 위해 부모가 `selectedWorkbenchOptionIds`를 별도 prefill(가격 계산용).
- `VehiclePicker`: 초기 선택 prop(`initialTrimId?: number`) 추가. 마운트 effect에서 `initialTrimId` 있으면 `fetchTrimDetail`(PR2a 확장본: brandId/brandName/modelName 포함)로 brand/model/trim 선택 상태를 복원하고 `onChange`로 상위에 전달.
- 검증: typecheck/lint, 단위/수동.

### PR2c-1 — 통합(수정 진입 + 차량/옵션/색상/가격 prefill + UPDATE 저장)

PR2a/2b 위에 통합. 시나리오는 건드리지 않아(미전송→기존 보존) 손실이 없다.

- **editPrefill state 신설**: 수정 진입 시 `detail.quotes.find(id)`(CustomerDetailQuote, 가격 스냅샷·colorId·options 보유)로 `{ optionIds, exteriorColorId, interiorColorId, pricing{base/option/discount/acquisitionTax/bond/delivery/incidental} }` 구성.
- "견적 수정" 진입(현 line ~4536 `setQuoteComposerMode("edit")`)을 워크벤치 edit 진입으로 교체: `editingQuoteId` + `editPrefill` + 구매방식/작성방식 세팅 + 워크벤치 열기.
- 차량: `VehiclePicker`에 `initialTrimId={openQuoteAction.trimId}`(PR1) + `key={editingQuoteId ?? "new"}`로 복원. 복원 시 `onChange`→`applyTrimToPricing` 트리거.
- `applyTrimToPricing` 확장: `editPrefill` 있으면 옵션 리셋 대신 `setSelectedWorkbenchOptionIds(editPrefill.optionIds)`, 색상은 `trimDetail.colors`에서 id 매칭해 `setExteriorColor/Interior`, 가격 DOM을 `editPrefill.pricing`으로 set, 적용 후 `setEditPrefill(null)`(다음 차량 변경은 정상 리셋).
- `OptionPicker`: `initialSelectedIds={selectedWorkbenchOptionIds}`(PR2b) — trimDetail.id key 재마운트 시 그 값으로 복원. `ColorPicker`는 `value`(기존).
- `saveQuoteFromWorkbench`: `editingQuoteId` 있으면 INSERT 대신 `apiUpdateQuote`(스냅샷+헤더+`bumpRevision`+`appStatus:"sent"` 재발송, **scenarios 미전송**) + 낙관 갱신 + 롤백 + 워크벤치/editing/editPrefill 클리어. 없으면 기존 INSERT.
- legacy(`trimId` null): `initialTrimId` undefined → 차량 빈 채로 열림. 저장은 기존 `guardQuoteDraftOutput`로 가드.
- 워크벤치 헤더 카피/버튼이 edit일 때 "수정 후 재발송" 맥락으로 분기.
- 검증: typecheck/lint/build + `test:unit`/`test:server`(회귀). **prefill 타이밍은 비결정적이라 단위테스트로 통합 검증 어려움 → 브라우저 실측(카카오 세션, 배포본) 필수**: 차량/옵션/색상/가격 복원→수정→재발송→새로고침 유지, 시나리오 보존, legacy 견적(차량 빈→선택→저장).

### PR2c-2 — 비교카드 controlled화 + 시나리오 전체 복원/편집

PR2c-1 위에. 사용자가 고른 "시나리오 전체 복원"을 실현.

- 비교카드(`kimManualQuoteConditionCards` 정적 + 절반 입력 불가 mock: 기간/자동차세/보조금/계산결과)를 controlled로 입력화.
- 수정 진입 시 `editingQuote.scenarios`를 round→카드(scenarioNo)로 매핑해 전체 prefill + `savedManualQuoteConditionIds`/mode state 복원.
- `saveQuoteFromWorkbench` UPDATE에 `scenarios` 포함(전체 교체).
- 검증: typecheck/lint/build, 브라우저(다중 시나리오 복원→편집→교체 저장→새로고침 유지).

### PR3 — composer 완전 제거

PR2가 수정을 완전 대체한 뒤 제거.

- composer 모달 JSX(현 4699–4856), `quoteComposerMode` 상태/타입, `saveQuote`의 composer 분기, manual/OCR composer 진입(현 line 2531 `recognizeQuoteOriginalForComposer`의 composer 오픈), composer 전용 드롭존/헬퍼/상태(`quoteEntryMode` 등 composer 전용분) 제거.
- OCR 원본인식은 워크벤치 헤더 경로 유지.
- 스크롤 잠금(`kim-detail-overlay-open`) effect의 `quoteComposerMode !== null` 조건 제거(나머지 오버레이 조건 유지).
- 관련 CSS(`kim-quote-builder-modal` 등 composer 전용) 정리.
- 검증: typecheck(죽은 참조 0)/lint/build, 견적 작성·수정·OCR 회귀 확인.

## 엣지케이스

- **legacy 견적 수정**: 차량 미복원 상태 저장 방지 — 차량 미선택 시 저장 가드(`guardQuoteDraftOutput` 계열 재사용).
- **시나리오 교체**: 수정 시 시나리오 수가 줄거나 늘 수 있음 → delete 후 신규 insert가 단순·안전. 기존 `primary_scenario_id`는 재계산.
- **재발송 멱등**: 수정 저장이 항상 발송은 아닐 수 있음 — 기존 #4b의 "수정 후 발송" 의미를 유지(저장=재발송). 초안 저장 분리가 필요하면 별도 결정.
- **임시 id(`kim-`) 가드**: 아직 서버에 없는 낙관 견적 수정은 API 생략(기존 패턴 유지).
- **첨부 원본**: 제자리 UPDATE라 `quotes.file_*` 경로 보존(#4d). 재생성 안 하므로 안전.

## 리스크

- **VehiclePicker 역추적**이 PR2 최대 난점. `fetchTrimDetail`의 반환에 brand/model 정보가 충분치 않으면 vehicles API 보강이 따라온다(범위 증가 가능).
- 워크벤치는 uncontrolled DOM 추출 + controlled state 혼합이라 prefill 일관성에 주의(가격 DOM은 defaultValue + key 리셋, 시나리오 카드는 mode state + DOM 값).
- `updateQuote` 시나리오 교체가 동시성/부분실패에 노출 — 트랜잭션으로 묶는다.

## 캐비엇 / 불변식 (기존 유지)

- 쓰기 성공 시 `invalidateCustomerDetail(customerId)` 필수(상세 캐시 불변식).
- `db:push` 금지, 스키마 변경은 `db:generate`→`db:migrate` `schemaFilter:["crm"]`만. **본 작업은 컬럼 추가 없음**(기존 `trim_id`/색상 FK/스냅샷 컬럼 재사용) → 마이그레이션 0 예상.
- 전화번호·skip-ci 등 기존 규약 유지.

## 검증 전략

- 각 PR: `bun run typecheck` 0 · `bun run lint` 0 · `bun run build` OK.
- 백엔드 변경 PR: `bun run test:server`(`updateQuote` 확장 라운드트립·시나리오 교체·404/가드).
- 프론트 로직: `toKimQuoteItem` 매핑·picker 복원 헬퍼 단위테스트.
- 브라우저 실측(카카오 세션, 배포본): 워크벤치 수정 진입→catalog 차량/옵션/색상/다중 시나리오 복원→수정→재발송→새로고침 유지. legacy 견적 수정(차량 빈 채 열림→선택→저장).
