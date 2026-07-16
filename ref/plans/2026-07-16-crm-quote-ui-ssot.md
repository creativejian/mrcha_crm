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

## 진행 상태 (전량 완료 — 2026-07-16 밤)

- [x] T1 `7cd0bd5`(+`fa11e09` 라벨 상수 quote-workbench-meta 이동 — react-refresh 규칙) — quote-fields/QuoteFields.tsx + 유닛 17.
- [x] T2 `3816164` — 워크벤치 교체. **프래그먼트 DOM 파리티 임시 하네스 8/8**(구 인라인 JSX ↔ 프리미티브, 같은 입력 → innerHTML 동일 — 커밋 안 함) 선행 증명. 이탈 1(문서화): 장식 토글 비활성 버튼 `class=""` 부여(시맨틱 동치 — diff 정규화로 흡수).
- [x] T3 `beab89e` — 계산기 비교 카드 kim 문법 전환.
- [x] T4 `604b451` — 계산기 상단 패널 kim 문법 전환 + kim-jeff-quote-body 스코프 + 브릿지 CSS.
- [x] T5 — typecheck 0·lint 0·unit **709**(692+17)·build·**knip 신규 0(main 워크트리 실측 대조 diff 0)**. 빌드 CSS diff: **unlayered 기존 규칙 변경 0**, 추가 = `.calculator-modal` 브릿지 3규칙(quote-body 패딩·비교 그리드 chrome·직속 세그먼트 min-width)뿐. 유틸 증감(−33/+8)은 전부 계산기 전용 클래스(Tailwind 소스 스캔 생성 — 제거 = 타 사용처 0의 구조적 증명).
- [x] T6 — 격리 스택(8799/5175) 스모크:
  1. **워크벤치 DOM 불변 기계 증명** = main↔브랜치 런타임 outerHTML(class="" 정규화) **diff 0** — `.kim-jeff-top-panel`(5,166B)·`.kim-manual-compare-grid`(18,247B), 김민준 CU-2605-0020 QT-2606-0001 수정 재진입(저장 카드 1 iM캐피탈·월 2,473,200 복원 포함 상태).
  2. 워크벤치 기능: 카드 2 기간 24 세그먼트·보증금 % 전환(is-fixed 해제·suffix % 전환)·조건 저장 → is-saved+수정 버튼 → 해제 — 전부 로컬 상태, 서버 쓰기 0(잔재 0).
  3. **계산기 실계산 baseline 정확 일치**: 현대 쏘나타 26년형 1.6 프리미엄(기본가 시드 29,370,000 동일) 기본 조건 조회 → **BNK캐피탈 월 390,500원·6.88%·잔존 16,153,000(55.0%)·총 39,583,000 = main과 byte-동일**.
  4. 패리티 4건 재확인: 할인 행 추가(어휘 3종)→최종 할인 1,000,000 파생+dirty 전환→삭제 0 복귀 / 취득세 자동 1,869,000 readOnly→직접 입력 편집→일반 복귀 자동 재계산 / 기간 12~60 / CM 1.5%→440,550원 미리보기(is-fixed).
  5. 렌트 탭(계산기 전용 축) 정상 — 렌트 4행 노출·세그먼트 클리핑 0(리스 26·렌트 29 세그먼트 전수). **스모크 중 발견·수정 1건**: `.kim-manual-compare-body label > .kim-jeff-segment:not(.wide){width:40%}`(워크벤치 짧은 어휘 전제)가 계산기 긴 어휘("리스료에 포함"·"금융사 특판")를 클리핑 → 계산기 스코프 `min-width:max-content` 브릿지(짧은 어휘 40% 유지 = 워크벤치 look 보존).
  6. 그리드 정렬 실측(Image #12 방향): 카드 라벨 폭 **80px 단일**·값 칸 우측 엣지 **단일값** — 전 행 좌우 정렬 통일.
- [x] T7 — PR #265
