# 차량 선택 → 견적 가격 반영 (1단계: 가격 패널 연동) 설계

작성일: 2026-06-15
상태: 승인됨 (구현 계획 대기)

## 배경 / 목적

`VehiclePicker`로 제조사→모델→트림 선택은 연결됐다(PR #11). 하지만 선택값이 부모로 올라가지 않고(`CustomerDetailPage.tsx:4829`의 `<VehiclePicker />`는 `onChange` 미연결), 견적 workbench(Jeff body)의 가격 패널은 여전히 **전부 하드코딩 mock**이다(기본가 `243,000,000`, 할인 `6,500,000`, 취득세, 최종 차량가/취득원가 등 정적 `defaultValue`).

이 작업은 트림 선택을 가격 패널에 연결해, **선택한 트림의 실제 가격/할인이 견적 합산에 살아 반영**되게 한다. 이는 이전 VehiclePicker spec의 "다음 단계 1번"에 해당한다.

- 백엔드 `getTrimDetail`(`/api/vehicles/trims/:id`)은 이미 완성: `price`, 할인 3종(`financialDiscountAmount`/`partnerDiscountAmount`/`cashDiscountAmount`), 옵션(+price), 옵션관계, 색상까지 반환. **신규 백엔드 작업 없음.**
- 대상은 김민준 drawer(`CU-2605-0020`)의 새 견적 workbench(Jeff body)뿐. 다른 화면·기존 견적 폼은 불변.

## 결정사항 (확정)

- **범위**: 가격 패널 연동까지. (옵션·컬러 "선택 인터랙션"은 2단계)
- **계산 깊이**: 합산만 자동(사칙연산). 취득세 공식 자동계산은 2단계.
- **편집 정책**: 트림 선택으로 자동 채우되, 딜러가 손으로 고치면 그 값으로 **합산 즉시 재계산**.
- **DB**: 변경 0. catalog는 read-only 거울이고 이번 작업은 SELECT(`getTrimDetail`)만. 견적 저장(quotes)은 별도 작업. 워크벤치 입력값은 전부 프론트 상태.

## 범위

**포함**
- 데이터 레이어에 `fetchTrimDetail` + `TrimDetail` 타입 추가
- 순수 계산 레이어 `client/src/lib/quote-pricing.ts` 신설 (파싱/포맷/합산) + 단위테스트
- `VehiclePicker`에 `onChange` 연결 → 트림 선택 시 `fetchTrimDetail` 호출
- 가격 패널 입력 자동 채움: **기본가 ← `trim.price`**, **할인 ← `financialDiscountAmount`**(없으면 0), **옵션 ← 0**
- 입력 변경/자동채움 시 합산 4개(최종차량가/등록비용/기타비용/취득원가) 자동 재계산
- 트림 변경 시 draft dirty 표시(`markQuoteDraftChanged`)

**비범위 (다음 단계)**
- 옵션 선택 UI(basic/tuning, includes/excludes) → 옵션 금액 합산
- 외장/내장 컬러 선택
- 구매방식별 할인 매핑(financial/partner/cash 구분) — 1단계는 `financialDiscountAmount` 단일
- 취득세 공식 자동계산(차량가 × 세율, 감면)
- 포함/불포함 segment 토글 동작(등록비용↔기타비용 재분류) — 1단계는 현재 정적 분류 고정
- 가격 패널 컴포넌트 추출 — 2단계에서 옵션·컬러와 함께
- quotes 스키마 저장 연계

## 아키텍처 (A안)

기존 Jeff money input UX가 **명령형 DOM 조작 기반**(`target.value = ...` + `preventDefault()`로 React 우회, `CustomerDetailPage.tsx:1431~1489`)이므로, 가격 패널 입력을 controlled로 바꾸면 정면 충돌한다. 따라서:

- **입력 input**(기본가/옵션/할인/취득세/공채/탁송/부대비용): **uncontrolled 유지**. 트림 선택 시 명령형으로 `.value` 채움(Jeff UX와 동일 패러다임). 회귀 위험 최소.
- **합산 표시**(최종차량가/등록비용/기타비용/취득원가): 입력이 아닌 읽기전용 표시이므로 **React state로 파생**. money UX와 충돌 없음.
- **계산식**: 순수 함수 lib로 분리 → 테스트 가능, `CustomerDetailPage` 비대화 방지.

(대안 B "전체 controlled 전환"은 money UX 재작성 필요로 회귀 위험·범위 초과. 대안 C "컴포넌트 추출"은 draft 상태/핸들러 결합으로 비용 큼 → 둘 다 2단계로.)

## ① 데이터 레이어 — `client/src/lib/vehicles.ts`

`getTrimDetail` 반환과 일치하는 `TrimDetail` 타입 + fetch 함수 추가. (1단계는 `price`/`financialDiscountAmount`만 쓰지만, 타입은 옵션·색상까지 전체 정의해 2단계 재사용.)

```ts
export type TrimOption = { id: number; type: "basic" | "tuning"; name: string; price: number | null };
export type TrimOptionRelation = { id: number; optionId: number; relatedOptionId: number; type: "includes" | "excludes" };
export type TrimColor = { id: number; colorType: "exterior" | "interior"; name: string; code: string | null; hexValue: string | null; sortOrder: number };
export type TrimDetail = Trim & {
  specs: unknown;
  financialDiscountAmount: number | null;
  partnerDiscountAmount: number | null;
  cashDiscountAmount: number | null;
  options: TrimOption[];
  optionRelations: TrimOptionRelation[];
  colors: TrimColor[];
  noOptions: { note: string | null; checkedAt: string } | null;
};

export async function fetchTrimDetail(trimId: number): Promise<TrimDetail>; // GET /api/vehicles/trims/:trimId
```

## ② 계산 레이어 — `client/src/lib/quote-pricing.ts` (신규, 순수 함수)

```ts
export function parseMoney(value: string): number;   // "243,000,000원" → 243000000, 빈값/NaN → 0
export function formatMoney(value: number): string;  // 243000000 → "243,000,000"

export type PricingInputs = {
  basePrice: number; optionPrice: number; discount: number;
  acquisitionTax: number; bond: number; delivery: number; incidental: number;
};
export type PricingResult = {
  finalVehiclePrice: number;  // 최종 차량가(계산서 발행금액)
  registrationCost: number;   // 등록비용(취득원가 포함)
  otherCost: number;          // 기타비용(취득원가 불포함, 고객 부담)
  acquisitionCost: number;    // 취득원가
};
export function computePricing(inputs: PricingInputs): PricingResult;
```

합산 공식 (현재 mock 정적 분류 기준: 취득세·공채=등록비용 포함, 탁송·부대=기타비용):

- `finalVehiclePrice = basePrice + optionPrice − discount`
- `registrationCost  = acquisitionTax + bond`
- `otherCost         = delivery + incidental`
- `acquisitionCost   = finalVehiclePrice + registrationCost`  (기타비용은 취득원가 불포함)

검산(현 mock): `243,000,000 + 0 − 6,500,000 = 236,500,000`, 등록 `13,531,000`, 취득원가 `250,031,000` — 화면값과 일치.

## ③ 연결 — `CustomerDetailPage.tsx`

- 가격 패널 입력 input 7개에 식별자 부여: `data-pricing="base|option|discount|acquisitionTax|bond|delivery|incidental"`. 명령형 읽기/쓰기에 사용.
- `<VehiclePicker onChange={...} />`로 연결. 트림이 선택되면 `fetchTrimDetail(trim.id)` 호출 → 응답으로 `base`/`discount`/`option` input의 `.value`를 명령형 set(포맷 적용) → 합산 재계산 → draft dirty.
- 입력 변경 감지: 가격 패널 컨테이너의 입력 이벤트에서 `data-pricing` input 7개 값을 읽어 `computePricing` → summary 4개 state 갱신. summary `<span>`은 state로 표시.
- 취득세·공채·탁송·부대비용 input과 포함/불포함 segment는 **현행 유지**(segment 토글 동작은 비범위, 분류는 정적 상수).
- 로딩/에러: `fetchTrimDetail` 진행 중 기존 값 유지, 완료 시 교체. 실패 시 콘솔 경고 + 입력 미변경(견적 흐름 막지 않음).

## ④ 트림 → 입력 매핑 요약

| 입력 | 소스 | 비고 |
|------|------|------|
| 기본 가격 | `trim.price` | 필수, bigint number |
| 할인 금액 | `financialDiscountAmount` | null이면 0. 구매방식별 매핑은 2단계 |
| 옵션 금액 | `0` | 옵션 선택 UI는 2단계 |
| 취득세/공채/탁송/부대 | 미변경 | 입력값 그대로 합산 |

## ⑤ 테스트 — vitest + jsdom

- `quote-pricing.test.ts`(신규): `parseMoney`/`formatMoney` 경계값(콤마/원/빈값/NaN), `computePricing` 현 mock 시나리오 및 할인·취득세 변동 케이스 검증.
- `vehicles.test.ts`: `fetchTrimDetail` URL·파싱·에러 throw 검증 추가.
- 워크벤치 통합 동작은 무거우므로 수동 스크린샷 1회로 확인(트림 선택 → 합산 변동).

## 영향 파일

- 신규: `client/src/lib/quote-pricing.ts`, `client/src/lib/quote-pricing.test.ts`
- 수정: `client/src/lib/vehicles.ts`(+`vehicles.test.ts`), `client/src/pages/CustomerDetailPage.tsx`(연결), 필요 시 `client/src/index.css`

## 검증

- `bun run typecheck`, `bun run lint` 0 problems
- `bun run test:unit`(quote-pricing/vehicles)
- 필요 시 워크벤치 스크린샷 1회

## 다음 단계 (이 spec 이후)

1. 옵션 선택 UI(basic/tuning, includes/excludes) → 옵션 금액 합산
2. 외장/내장 컬러 선택
3. 구매방식별 할인 매핑(financial/partner/cash)
4. 취득세 공식 자동계산 + segment 토글 재분류
5. 가격 패널 컴포넌트 추출(C안)
6. 견적 저장 시 `trimId`/가격 스냅샷 저장 (CRM quotes 스키마 작업과 연계)
