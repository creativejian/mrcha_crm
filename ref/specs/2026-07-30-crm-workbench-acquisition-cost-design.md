# 워크벤치 취득원가 실동작화 — 토글·조회·앱 송출 일괄 (2026-07-30)

## 배경 / 문제

워크벤치의 취득원가 설정(취득세·공채·탁송료·부대비용)은 UI만 있고 두 겹으로 미적용이었다:

1. **공채/탁송료/부대비용 포함·불포함 토글 = 장식**(무핸들러 하드코딩 — spec 2026-07-16 quote-ui-ssot **D6**가
   "실동작화는 별도 제품 결정"으로 명시 보류한 상태).
2. **솔루션 조회 payload에 취득원가 4종 미동봉** — `buildSolutionQuoteInput`은 base+option·할인만 보냈고,
   릴레이 zod 확장 17필드(2026-07-16 계산기 모달 스펙 §릴레이 zod 확장)는 계산기 전용이었다.

결과: 취득원가 금액은 **표시·저장·앱카드 라벨**까지만 흘러가고 **월 납입금 계산(파트너 엔진)에는 무반영** —
같은 조건에서 계산기와 워크벤치의 월납입금이 어긋나고, 그 어긋난 값이 앱으로 발송된다.

## 결정 (유슨생 2026-07-30)

- 포함/불포함 **플래그 컬럼을 crm.quotes에 추가**한다(불포함=0원 규약 기각 — 금액 보존).
- **앱 견적 송출 payload에도 포함/불포함이 드러나야** 한다.
- 토글 실동작화 + **조회 반영까지 한 번에** 간다(분할 기각).

## 설계

### D1. DB — 마이그 0045 (additive, 기본값 = 현행 장식 표기)

`crm.quotes` += `bond_included boolean NOT NULL DEFAULT true` · `delivery_included boolean NOT NULL DEFAULT false`
· `incidental_included boolean NOT NULL DEFAULT false`.

기본값이 현행 장식 토글 표기(공채 포함·탁송 불포함·부대 불포함) = `computePricing` 구 정적 분류와 동일이라
**기존 행의 표시·산출 의미가 불변**이다(백필 불필요). prod 구코드는 새 컬럼을 몰라도 무해(additive).

### D2. 계산 SSOT — `computePricing` 동적 분류

`PricingInputs` += 플래그 3종. `registrationCost = 취득세 + 포함 항목 합` / `otherCost = 불포함 항목 합`
/ `acquisitionCost = finalVehiclePrice + registrationCost`. 기본 플래그 입력 시 구 공식과 산출 동일(회귀 그물).
서버 발송 조립기(`app-card-payload.ts`)의 자체 복제 산식(`tax + bond`)도 같은 flag 구동으로 정렬한다.

### D3. 조회 — `buildSolutionQuoteInput` 계산기 payload 미러

`BuildArgs.pricing` += 취득세·플래그 3쌍(금액+included). 전송은 `buildScenarioPayload`(계산기) 정확 미러:

- `includePublicBondCost`/`includeDeliveryFeeAmount`/`includeMiscFeeAmount` = 플래그 **상시 전송**,
  금액(`publicBondCost` 등)은 **포함일 때만** 동봉(불포함이면 undefined — 계산기와 동일).
- 취득세: **금액 > 0일 때만** `acquisitionTaxMode: "amount"` + `acquisitionTaxAmountOverride` 동봉.
  0이면 미전송 = 엔진 자동 계산(0 override는 엔진 자동 계산을 0으로 덮어 월납입 과소 — 가드 필수).
  **자동 공식도 도입**(같은 날 유슨생 실기 지적 "계산기는 자동인데 워크벤치는 안 따라온다"):
  계산기 `autoAcquisitionTax`(build-payload 순수 계층)를 물리 공유해 `recomputePricing` 수렴점에서
  파생한다 — 차량 선택·가격 수정·프리필 전 경로 커버, 직접 입력 모드·차량가 0은 덮지 않음(계산기 미러).
- 랭킹 모달은 같은 빌더(`buildCardSolutionBaseArgs`) 공유라 동반 반영. 릴레이 서버는 무변경
  (zod가 이미 수용 — 계산기용 확장).

### D4. 앱 송출 — 라벨 접미(구조 불변)

payload 필드 추가 없이 기존 `bondLabel`/`deliveryFeeLabel`/`incidentalLabel` **값에 포함/불포함 접미**:
`"100,000 · 포함"` / `"100,000 · 불포함(고객 부담)"` (`costItemLabelOf`, app-card-labels SSOT —
carTaxLabel의 기존 포함/불포함 어휘 재사용). 앱 렌더러는 라벨 문자열을 그대로 그리므로 **앱 팀 무변경**.
`registrationCostLabel`/`acquisitionCostLabel`은 D2 동적 산식을 따라 자동 반영.

업무 AI 견적 청크(assistant-corpus)는 취득원가 라벨을 쓰지 않음을 실측 확인 — **백필 소급 없음**.

### D5. 저장/복원

- 서버: 생성·수정 zod += boolean 3종(optional), insert/patch 매핑, 상세 응답 매핑.
- 클라: 훅 state 3종(기본 D1과 동일) + 토글 onSelect(명시 플래그로 즉시 재계산 — stale closure 회피),
  저장 payload·수정 재진입 복원(구 견적 null → 기본값), 앱카드 모델 입력 += 플래그.

## 범위 밖 (의도)

- 계산기 쪽 변경 0. 파트너 릴레이 변경 0.
- 기존 발송 견적 소급 재계산 없음(다음 조회/발송부터 반영).

## 검증

- 단위: quote-pricing 동적 분류(기본 플래그 = 구 산출 동일 케이스 포함) · solution-quote payload 계약
  (플래그 상시·금액 조건부·취득세 0 가드) · 앱카드 라벨/파리티.
- 서버: 견적 저장 플래그 roundtrip(실 DB — db-bound registry 등재 확인), 발송 payload 라벨.
- 실기: 워크벤치 토글 → 조회 → 월납입 변화 + 계산기 동일 입력 대조(Chromium magiclink 스모크).
