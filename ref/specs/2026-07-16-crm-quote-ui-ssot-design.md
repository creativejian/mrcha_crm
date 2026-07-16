# 견적 조건 UI SSOT — 워크벤치 ↔ 계산기 물리 1벌화 (2026-07-16)

## 배경

- #263(픽커 다이얼로그 통일)·#264(기능 패리티 4건 — 할인 행·취득세 직접입력·기간 12·CM/AG)으로
  고객관리 견적 워크벤치와 전역 계산기(비교견적)의 공유 표면이 **기능 동일**해졌다.
- 이 슬라이스 = 유슨생 확정 "그 후, SSOT": 공유 표면(상단 패널 행·비교 카드 행)의 **마크업+CSS
  문법을 물리 1벌(공유 프리미티브)**로 통합한다.
- **선확정 설계 2건(유슨생 2026-07-16 밤, brief `235d7ae` 박제)**:
  1. 계산기 카드의 **리스/렌트 탭은 SSOT 무관** — 계산기 전용 축(productType 전환. 워크벤치는 같은
     축이 헤더 "구매방식" select 소관이라 카드 내부에 없음). 통합 시 계산기 전용 슬롯으로 잔류.
  2. **통합 디자인 기준 = 워크벤치** — 계산기 카드(제프 원형 flex·행별 폭 들쭉)를 워크벤치의 고정 칸
     그리드 문법(라벨 고정폭·세그먼트 칸·값 칸 — 전 행 좌우 정렬 통일)으로 맞춘다.

## 결정

### D1. 상태 아키텍처는 통합하지 않는다 — 공유는 표현 계층만

- 워크벤치 = **uncontrolled DOM**(`data-sc-field`/`data-pricing` 추출 계약 + jeff money 컨테이너
  핸들러 + 저장/수정 재진입/승격 prefill 생명주기) / 계산기 = **controlled state**(ScenarioState +
  payload 빌드 + fingerprint dirty 판정). 이 두 계약이 각 화면의 영속·계산 경로 전부를 지탱한다.
- 아키텍처 통일은 전면 재작성(저장 계약·스모크 전량 재검증) 리스크 대비 실익이 없다 — 배치 3의
  "명시성이 실이익" 선례. **바인딩은 각자 소유, 프리미티브는 `inputProps` 패스스루로 양쪽 수용**
  (React가 value/onChange ↔ defaultValue 존재 여부로 controlled/uncontrolled 판별 — 한 컴포넌트로
  둘 다 성립).

### D2. 공유 프리미티브 = `client/src/components/quote-fields/QuoteFields.tsx`

마크업은 **현행 워크벤치 JSX 전사**(클래스·구조·속성 그대로) — 워크벤치 DOM 불변이 증명 가능해야 한다.

| 프리미티브 | 산출 마크업 | 워크벤치 사용처 | 계산기 사용처 |
|---|---|---|---|
| `SegmentGroup` | `.kim-jeff-segment(.wide)` + `button(.active)` | 카드 세그먼트 전부·취득세·공채/탁송료/부대비용·할인 단위 | 좌동(기간/선수금/보증금/잔존가치/약정거리/자동차세/보조금 + 렌트 전용 4행 + 취득원가 토글) |
| `MoneyField` | `.kim-jeff-money-input(.is-fixed)` > `input{...inputProps}` + `em`(suffix) | 카드 금액·가격패널·할인 행 | 좌동(controlled props 패스) |
| `CondRow` | `label(.select-value/.before-emphasis/...)` > `span`+children (카드 행 문법) | 비교 카드 행 | 비교 카드 행 |
| `CondCombo` / `FeeCombo` | `.kim-manual-combo` / `.kim-manual-fee-combo` div | 보증금/선수금/잔존가치/약정거리/보조금 · CM/AG | 좌동 |
| `ValueSelect` | `.kim-manual-value-select(.is-fixed)` select{...selectProps} | 약정거리 select | 좌동 |
| `PickerTriggerRow` | `button.kim-jeff-picker-row` > `span`+`b(.muted)`+ChevronDown | WorkbenchVehiclePickers 트리거 6행 | 상단 차량/옵션/컬러 트리거 6행 |
| `FormRow` | `.kim-jeff-form-row(+행 클래스)` > `span`+children | 상단 취득세/공채/탁송료/부대비용 | 좌동 |
| `DiscountLineRow` | `.kim-jeff-form-row.kim-jeff-discount-row` 5칸(라벨/항목명 select 또는 placeholder/세그먼트/금액/추가·삭제 버튼) | 상단 할인 행 | 좌동 (항목명 select는 프리미티브가 bindSelect+`discountLabelOptions` 소유 — 어휘 SSOT 심화) |
| `PriceCell` | `.kim-jeff-price-cell` > `strong`+MoneyField | 가격 3셀 | 좌동 |
| `SummaryRow` | `.kim-jeff-summary-row(.emphasized/.no-divider)` > `span`+`b>span+em` | 최종 가격 4행 | 좌동 |

- 어휘 공유 추가: 기간 세그먼트 옵션은 `SOLUTION_LEASE_TERMS` 파생 1벌(양쪽 리터럴 소거),
  취득세 4모드 라벨(일반/하이브리드 감면/전기차 감면/직접 입력) 상수 1벌.

### D3. 워크벤치 = 기준: 렌더 DOM 변경 0 (기계 증명)

- QuoteWorkbench.tsx(카드 행 + 상단 할인/취득원가/가격/최종가격)·WorkbenchVehiclePickers.tsx(트리거
  행)를 프리미티브로 교체하되 산출 DOM은 byte-동일.
- 증명 = 격리 스택에서 main 빌드 ↔ 브랜치 빌드의 `.kim-jeff-top-panel`·`.kim-manual-compare-grid`
  outerHTML 캡처 diff 0 (같은 고객·같은 견적 fixture).
- 워크벤치 CSS 변경 0.

### D4. 계산기 = 수렴: 공유 표면이 kim 문법을 통째로 채택 (시각 변경 의도됨)

- 본문 래퍼(`p-8 pb-24` div)에 **`kim-jeff-quote-body` 스코프 클래스 채택** — 토큰(--jeff-navy 등)과
  베이스 input/select 스타일이 이 조상 스코프에 걸려 있다(customer-detail-workbench.css:674).
  `--font-num`/`--brand-rgb`는 :root 토큰이라 계산기 안에서도 유효.
- 상단 패널: `kim-jeff-top-panel > kim-jeff-top-grid(섹션 3: 차량 선택/옵션·컬러/할인) +
  kim-jeff-price-grid + kim-jeff-cost-grid(cost-section + summary-section)` 구조 채택. 슬레이트 헤더
  → `kim-jeff-section h4`(네이비 바 — 시각적으로 같은 계열). 트리거 행 콘텐츠(브랜드 로고 img·모델
  썸네일·컬러 스와치)는 계산기 쪽이 더 풍부한 채로 유지(셸 문법만 공유).
- 비교 카드: `kim-manual-compare-grid > kim-manual-compare-card(header + kim-manual-compare-body)`
  채택 — 3장이 워크벤치처럼 2px 보더로 결합된 한 판. 카드 헤더(견적비교 N + 복사/재입력 버튼)는
  `.kim-manual-compare-card > header` 문법.
- Tailwind responsive(`md:grid-cols-3`) 소멸 — 워크벤치와 동일 고정 3열(데스크톱 CRM 전제, 워크벤치도
  고정).
- **계산기 폰트는 현행 유지**(모달 루트 제프 폰트 스택) — 수렴 대상은 레이아웃 문법. 숫자는 양쪽 다
  `--font-num`이라 동일.
- 브릿지 CSS는 `calculator.css`에 **`.calculator-modal` 스코프로만** 추가(워크벤치 계산값 불변):
  본문 패딩 유지(`.calculator-modal .kim-jeff-quote-body{padding:32px 32px 96px}` — unlayered kim
  16px가 Tailwind 유틸을 layer 무관하게 이기므로 명시 오버라이드 필수, #262 교훈의 역방향),
  비교 그리드 외곽 chrome(보더/라운드/그림자 — 워크벤치는 `.kim-app-quote-form` 셸이 담당),
  트리거 행 img 정렬, 조회 버튼/결과 영역 여백.

### D5. 화면 전용 슬롯 (불변)

- **계산기 전용**: 리스/렌트 탭(선확정 1 — 카드 body 상단 잔류, 현행 look), 렌트 전용 4행(출고방식/
  정비/운전연령/대물한도 — **행 문법은 공유 CondRow+SegmentGroup 차용**, 존재 자체는 계산기 전용),
  견적 조회 버튼/정렬 드롭다운/결과 리스트(QuoteResultRow)/하단 바/페이지 헤더/notice.
- **워크벤치 전용**: 카드 저장 lifecycle(is-saved/수정/N번 조건 저장), 금융사 select, 월 납입금 행+
  계산기 버튼, 결과 4필드(kim-manual-result-grid), 앱카드/추가 안내/발송.

### D6. 행위 변경 0 (양쪽)

- 계산기: 상태·파생·payload·fingerprint·캐스케이드 로직 무접촉 — 렌더 계층만 교체. 같은 입력 →
  같은 payload(BNK 실계산 월납입 baseline 일치로 스모크 증명).
- 워크벤치: DOM 불변이므로 자동 성립.
- 워크벤치 상단 공채/탁송료/부대비용 토글은 **현행 장식(무핸들러) 유지** — 같은 SegmentGroup에
  계산기만 onChange를 전달한다(실동작화는 별도 제품 결정 — 이 슬라이스에서 하지 않음).
- 미시 이탈 1건(의도): 계산기 약정거리 select는 기본 모드에서도 활성(현행 행위) — 워크벤치의
  `is-fixed+disabled`와 달리 is-fixed 미적용. 행위 보존이 우선.

### D7. 기각 (재제안 금지 아님 — 이번 범위 밖 근거)

- **상단 패널/카드 전체를 단일 공유 컴포넌트(바인딩 어댑터 주입)로**: 필드 ~20개 바인딩 어댑터 +
  픽커 2계보(useMasterCatalog/mcCode ↔ WorkbenchVehiclePicker/trimId·initialTrimId 복원) 추상화가
  필요 — 행 세트·순서도 화면별로 달라(보증금↔선수금 순서 반대, 전용 행 인터리브) 슬롯 API가 프리미티브
  조합보다 복잡해진다. 행/컨트롤 프리미티브가 드리프트 차단(문법·어휘 1벌)을 동일하게 달성.
- **워크벤치 공채/탁송료/부대비용 토글 실동작화**: 취득원가 계산·저장 의미 변경 = 행위 변경. 별도 슬라이스.

## 검증 계획

1. `typecheck`/`lint` 0 · `test:unit`(프리미티브 신설분 포함) · `build` · knip 신규 0.
2. **워크벤치 DOM 불변 기계 증명**: 격리 스택에서 main↔브랜치 `.kim-jeff-top-panel`·
   `.kim-manual-compare-grid` outerHTML diff 0.
3. 빌드 CSS diff: 추가분이 `.calculator-modal` 스코프 신규 규칙뿐(기존 규칙 불변).
4. 계산기 스모크: 차량 선택→BNK 실계산(월납입 main baseline 일치)·할인 행 추가·취득세 직접입력·
   CM/AG 미리보기·기간 12·행 그리드 정렬 스크린샷(Image #12 방향 실증).
5. 워크벤치 스모크: 수정 재진입 복원 + 카드 저장 1회(추출 계약 생존 확인 — DOM 불변이므로 대표 1).
