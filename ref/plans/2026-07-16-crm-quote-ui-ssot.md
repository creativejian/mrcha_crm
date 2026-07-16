# 견적 조건 UI SSOT 실행 계획 (2026-07-16)

spec(결정 SSOT): `ref/specs/2026-07-16-crm-quote-ui-ssot-design.md`
브랜치: `feat/crm-quote-ui-ssot`

## 태스크

### T1 — 공유 프리미티브 신설
- `client/src/components/quote-fields/QuoteFields.tsx` + `QuoteFields.test.tsx`
- SegmentGroup / MoneyField / CondRow / CondCombo / FeeCombo / ValueSelect / PickerTriggerRow /
  FormRow / DiscountLineRow / PriceCell / SummaryRow + `LEASE_TERM_SEGMENT_OPTIONS`(SOLUTION_LEASE_TERMS
  파생) + `ACQUISITION_TAX_MODE_LABELS`.
- 마크업 = 현행 워크벤치 JSX 전사(클래스·속성·구조 그대로). 테스트 = 프리미티브별 산출 DOM
  (클래스·data-속성·suffix·active·is-fixed 분기) 잠금.
- 검증: typecheck·lint·test:unit.

### T2 — 워크벤치 교체 (DOM 불변)
- `QuoteWorkbench.tsx`: 비교 카드 행 9종 + 상단 할인/취득세/공채·탁송료·부대비용/가격 3셀/최종 가격
  4행 → 프리미티브. 워크벤치 전용부(금융사 select·월납입 행·결과 4필드·저장 버튼)는 잔류.
- `WorkbenchVehiclePickers.tsx`: 트리거 행 6개(`button.kim-jeff-picker-row` 인라인) → PickerTriggerRow.
- data-* 속성·aria-label·defaultValue·disabled/readOnly·클래스 분기 전부 보존(추출 계약).
- 검증: typecheck·lint·test:unit(기존 워크벤치 테스트 불변)·build. DOM 불변 증명은 T6.

### T3 — 계산기 비교 카드 kim 문법 전환
- `ConditionCards.tsx`: 카드 셸 → `kim-manual-compare-card`(header strong + 복사/재입력 버튼),
  body → `kim-manual-compare-body` + CondRow/SegmentGroup/CondCombo/FeeCombo/ValueSelect/MoneyField.
  로컬 프리미티브(Row/Segmented/ValueInput/ReadonlyAmount) 폐기.
- 리스/렌트 탭·렌트 4행·조회 버튼/정렬/결과 = 전용 슬롯(스펙 D5). 상태/파생/fingerprint 무접촉.
- 검증: typecheck·lint·build.

### T4 — 계산기 상단 패널 kim 문법 전환
- `TopSelectionCards.tsx`: `kim-jeff-top-panel/top-grid/section(h4)` 구조 + PickerTriggerRow(6행) +
  DiscountLineRow + PriceCell(3) + FormRow(취득세/공채/탁송료/부대비용) + SummaryRow(4). 로컬
  프리미티브(SegmentedToggle/NumberInput/PriceCell/SummaryCell/PickerRow) 폐기. 다이얼로그 배선 불변.
- `CalculatorModal.tsx`: 본문 래퍼에 `kim-jeff-quote-body` 채택.
- `calculator.css` 브릿지(.calculator-modal 스코프): 본문 패딩 오버라이드·비교 그리드 외곽 chrome·
  트리거 행 img·전용 슬롯 여백.
- 검증: typecheck·lint·test:unit·build·knip.

### T5 — 정리 + 전체 검증
- dead 코드/CSS 잔재 0 확인(knip·계산기 구 프리미티브), 4종 + build.
- 빌드 CSS diff: 추가분 `.calculator-modal` 스코프 신규 규칙뿐.

### T6 — 격리 스택 스모크 (사용자 dev 5173/8788 불가침)
1. **워크벤치 DOM 불변**: main 빌드 ↔ 브랜치 빌드, 같은 고객·같은 견적으로 워크벤치 열어
   `.kim-jeff-top-panel`·`.kim-manual-compare-grid` outerHTML diff 0.
2. 워크벤치 기능: 수정 재진입 복원 + 카드 저장 1회.
3. 계산기: BNK 실계산 월납입 = main baseline 일치 · 패리티 4건 재확인 · 정렬 스크린샷.
4. 잔재 0 원복.

### T7 — PR (squash, [skip ci] 금지)

## 진행 상태

- [ ] T1
- [ ] T2
- [ ] T3
- [ ] T4
- [ ] T5
- [ ] T6
- [ ] T7
