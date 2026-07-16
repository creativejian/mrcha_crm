# 견적 워크벤치 차량/옵션/컬러 선택 → 계산기 픽커 다이얼로그 방식 통일

작성: 2026-07-16 (유슨생 지시, 세션 0716-fable5-again에서 실측·정리 — **다른 세션 실행용 핸드오프**)

## 목적 (유슨생 확정)

계산기 모달(#262)의 **픽커 다이얼로그 방식**(행 클릭 → 브랜드 로고·차량 이미지·검색이 있는
다이얼로그)을 **견적 워크벤치**(고객 상세 새 견적 작성)의 차량 선택·옵션/컬러에도 적용한다.
**기존 드롭다운 방식은 폐기. 컴포넌트는 SSOT(물리 1벌)** — 계산기와 워크벤치가 같은 다이얼로그를 쓴다.

## 현황 실측 (2026-07-16, 이 세션에서 검증한 사실)

### 교체 대상 (워크벤치 현행 — 전부 커스텀 드롭다운, 네이티브 select 아님)
| 컴포넌트 | 위치 | 계약 |
|---|---|---|
| `VehiclePicker`(180줄) | `client/src/components/VehiclePicker.tsx` | props `{initialTrimId?, onChange?(VehicleSelection)}` · `VehicleSelection={brand?,model?,trim?,trimDetail?}`(lib/vehicles 타입) · 인라인 드롭다운(kim-vehicle-picker-menu) |
| `OptionPicker`(108줄) | `client/src/components/OptionPicker.tsx` | `{options, relations, initialSelectedIds, onChange}` — 소비처 `QuoteWorkbench.tsx:358`(applyOptionTotal) |
| `ColorPicker`(59줄) | `client/src/components/ColorPicker.tsx` | `{colorType, colors, value, onChange}` — 외장/내장 2회 사용(:359-360) |

- **소비처**: `QuoteWorkbench.tsx:346`(VehiclePicker, `key={editingQuoteId ?? "new"}` 리마운트 패턴) — 소비처가 워크벤치뿐인지 grep 후 확정(뿐이면 3컴포넌트 폐기+CSS dead 정리)
- **수정 재진입 복원**: `initialTrimId` → `fetchWorkbenchVehicleCached(trimId)`가 brands/models/trims 목록+`trimDetail.brandId/modelId` ancestry를 한 번에 복원(VehiclePicker.tsx:37-56). **이 메커니즘은 유지 필수**
- **⚠️ `initialTrimId`는 이중 소스**(QuoteWorkbench.tsx:346): `editingQuoteId ? openQuoteActionTrimId() : quoteRequestPrefill?.trimId` — **수정 재진입과 앱 견적요청 승격 프리필이 같은 prop 하나를 탄다.** ancestry 복원을 구현하면 승격도 자동 커버되지만, **검증은 두 경로 각각**(T5 ②·③이 분리돼 있는 이유). 옵션/컬러 프리필은 픽커 내부가 아니라 훅 레벨 시딩(useQuoteWorkbench.ts:592-597·619 — qrPrefill 분기)이라 D2 무접촉 원칙이면 자동 보존
- **onChange 의미론**(VehiclePicker.tsx:96 주석): 드롭다운 직접 선택은 trimDetail 미동봉 → 소비자(applyTrimToPricing)가 fetchTrimDetail 폴백. 번들 동봉은 수정 진입 마운트 경로만
- **옵션/컬러 상태 계약**(useQuoteWorkbench.ts): `selectedWorkbenchOptionIds`·`exteriorColor/interiorColor(TrimColor)`·견적요청 prefill `{trimId, optionIds, exteriorColorId, interiorColorId}`(:114) · 저장 스냅샷 = quotes의 `options[]`/`optionTotal`/색상명(:228-229, customer-quotes.ts) — **서버 zod·저장 계약 무변경**
- 할인 항목명 select(:380, bindSelect)는 **별개** — 이 슬라이스 무관, 잔존

### 이식 소스 (계산기 — #262에서 이식 완료된 것)
- 다이얼로그 5종: `client/src/components/calculator/vehicle/{Brand,Model,Trim,Option,Color}PickerDialog.tsx`(계 899줄, props-driven·자기완결)
- 데이터 훅: `calculator/hooks/useMasterCatalog.ts`(CRM `/api/vehicles` 배선, 제프 모양 어댑트 — `MasterTrim.trimId` 보유)·`useTrimExtras.ts`(fetchWorkbench 1콜 → options/colors)
- 타입: `calculator/catalog-types.ts`(MasterBrand/MasterModel/MasterTrim·TrimOption/TrimOptionRelation/TrimColor)
- 에셋: `client/public/brand-logos/` 33종(공용 위치 — 추가 작업 0)

## 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | 다이얼로그 5종+catalog-types를 **공용 위치로 물리 이동**(예: `client/src/components/vehicle-pickers/` — 기존 `VehiclePicker.tsx`와 혼동 없는 이름), calculator·워크벤치 양쪽 import | SSOT(유슨생 확정). 복제 금지 |
| D2 | 워크벤치 데이터는 **기존 상태 계약 유지** — 다이얼로그를 워크벤치 상태에 배선(어댑트)하고, applyTrimToPricing·저장 스냅샷·prefill 경로 불변 | 저장/발송 파이프라인(psql 대조 이력 있는 정밀 영역) 무접촉 |
| D3 | 스타일 스코프는 **공용 클래스 도입**(아래 함정 1·2) — `.calculator-modal` 전용이던 토큰·가드를 공용 스코프로 확장 | 워크벤치 컨텍스트에서 다이얼로그가 깨지지 않게 |
| D4 | 교체 후 구 컴포넌트 3종(VehiclePicker·OptionPicker·ColorPicker) 폐기 + `kim-vehicle-picker-*` 등 dead CSS 정리(계산값 증명 관례 — #167/#258 방식) | 이중 소스 금지 |

## 🔴 함정 (이 세션에서 실사고로 배운 것 — 반드시 먼저 읽을 것)

1. **unlayered 전역 CSS는 Tailwind `@layer utilities`를 특이성 무관하게 항상 이긴다.**
   theme.css `button,input,select{font:inherit}`와 dashboard.css `.grid{gap:14px}`는 현재
   `:where(:not(.calculator-modal *))` 가드로 계산기만 제외돼 있다. **워크벤치에서 다이얼로그를
   열면 가드 밖 = 컨트롤 폰트 16px 거대화·grid gap 주입이 그대로 재발한다**(계산기에서 실측된
   그 사고). → 가드를 공용 스코프로 확장: `:not(:is(.calculator-modal, .jeff-ui) *)` 식.
   신규 클래스라 기존 화면 계산값 불변은 자명하나 검증은 할 것.
2. **`.calculator-modal` 스코프 토큰 의존**: 다이얼로그가 쓰는 `form-input`·`--shadow-elev-3`·
   `--accent`/`--accent-shadcn`(파랑)·`animate-fade-up`·rem 15/16 배율(`--spacing`·`--text-*`·
   `--container-md`)이 전부 calculator.css의 `.calculator-modal` 스코프에 있다. 공용 스코프
   클래스(예: `.jeff-ui`)를 다이얼로그 루트(또는 워크벤치 래퍼)에 부여하고 calculator.css
   셀렉터를 `:is(.calculator-modal, .jeff-ui)`로 확장할 것. rem 배율도 스코프에 동봉해야
   계산기와 동일 렌더(다이얼로그 폭 420px 등).
3. **다이얼로그 열림 스크롤 잠금**: 계산기에서는 `.calculator-modal:has(.fixed.inset-0.z-50)`로
   모달 스크롤러를 잠근다. 워크벤치 컨텍스트에서는 잠글 스크롤러가 다르다(문서 body 또는
   워크벤치 모달) — 동일 UX(배경 휠 체이닝 차단) 확보 방법을 실측으로 결정.
4. **onChange 의미론 유지**: 다이얼로그 선택 → `VehicleSelection` 변환 시 trimDetail 미동봉
   (소비자 fetchTrimDetail 폴백)·수정 진입 마운트만 동봉이라는 현행 계약을 지킬 것 —
   applyTrimToPricing이 이 전제로 짜여 있다.
5. **수정 재진입 ancestry 복원**: useMasterCatalog는 fresh 시작 — `initialTrimId` 복원을 위해
   훅에 시딩 액션을 추가하거나(fetchWorkbenchVehicleCached 재사용) 워크벤치 래퍼에서 시딩.
   `key={editingQuoteId ?? "new"}` 리마운트 패턴과의 상호작용 확인.
6. **견적요청 승격 prefill**: `quoteRequestPrefill{trimId, optionIds, exteriorColorId,
   interiorColorId}` 경로(useQuoteWorkbench.ts:114·:592-597·:619)가 새 UI에서도 동작해야 한다
   (승격 → 카드1 시드 흐름, #158).
7. **MasterTrim.quotable 게이트**: 계산기 다이얼로그는 mcCode 없는 트림을 선택 불가 처리한다.
   워크벤치는 mcCode 없어도 수기 견적이 가능해야 할 수 있음(솔루션 조회만 mcCode 필수) —
   **quotable 의미가 두 컨텍스트에서 다르다**. 워크벤치용은 선택 허용+솔루션 조회 시점 게이트가
   맞는지 판단(현행 VehiclePicker는 게이트 없음 — 행위 보존이 기본).
8. **Safari select 규칙**: 소멸하는 네이티브 select 없음(전부 커스텀 드롭다운) — 신규 코드에
   controlled select를 만들면 bindSelect 필수(기존 규칙).
9. dead CSS 정리는 **계산값 증명 첨부**(빌드 CSS 시뮬레이션 byte-diff — #258 방식이 최신 선례).

## 태스크 (제안 — 작업 세션이 조정 가능)

- **T1**: 다이얼로그 5종+catalog-types 공용 위치 이동 + calculator import 갱신(행위 무변경 — 계산기 회귀 스모크로 잠금)
- **T2**: 스타일 스코프 공용화(함정 1·2·3) — 가드 확장·토큰 스코프 클래스·기존 화면 계산값 불변 증명
- **T3**: 워크벤치 배선 교체 — 차량 3행·옵션·외장/내장을 다이얼로그 트리거로, 상태 계약 불변(D2). 수정 재진입·prefill 복원(함정 5·6)
- **T4**: 구 컴포넌트 3종 폐기 + dead CSS 정리(D4·함정 9) — 소비처 전수 grep 선행
- **T5**: 검증 — typecheck/lint/unit/build/knip + **격리 스택 스모크**: ①신규 견적(픽커 선택→저장→psql 대조) ②수정 재진입 복원(차량 ancestry·옵션·컬러) ③견적요청 승격 prefill ④계산기 모달 회귀(이동 후 동일 렌더) ⑤**워크벤치 컨텍스트 다이얼로그 스타일 실측**(폰트 12px·gap — 함정 1 재발 검사, WebKit 포함 권장)

## 열린 판단 (작업 세션 재량)

- 공용 폴더·스코프 클래스 이름
- 트리거 행 마크업: 기존 `kim-jeff-picker-row` 유지(시각 최소 변화) vs 계산기 PickerRow 이식(완전 동일화) — 워크벤치 카드 시각이 이미 제프 미러라 어느 쪽도 무방
- useMasterCatalog 시딩 방식(훅 확장 vs 래퍼 시딩)
