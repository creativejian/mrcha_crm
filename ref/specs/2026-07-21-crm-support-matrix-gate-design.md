# CRM 견적 워크벤치 — 미지원 기간·약정거리 UI 게이트 설계

작성 2026-07-21 · 상태: 계약 확정(제프 회신 수락) · 구현 대기 API 있음

## 1. 배경

제프 PR #73·#76·#78로 미지원 약정거리·리스기간이 **미취급 throw**로 정리됐다(값 날조 제거). CRM은 그 400 문구(`미취급` 포함)를 이미 3경로에서 처리한다.

| 경로 | 현재 동작 | 변경 |
|---|---|---|
| 랭킹 모달(금융사 미선택 전사 조회) | 미취급 사 조용히 제외 | 없음 |
| 계산기 모달(전사 병렬) | 미취급 사 숨김 | 없음 |
| 워크벤치 개별 조회 | 토스트로 사유 표면화 | **이 문서** |

문제는 워크벤치가 **상담사가 금융사·기간·약정거리를 직접 고르는 화면**이라, 미지원 조합을 고를 수 있고 **조회 버튼을 눌러야** 알게 된다는 점이다. 고르기 전에 막으려면 CRM이 사별 지원집합을 알아야 한다.

**이 슬라이스는 UX 개선이다. 정합성 방어선이 아니다** — 진짜 방어선은 제프 엔진의 throw이고, 이 게이트가 없거나 실패해도 잘못된 값은 나가지 않는다. 이 성격이 아래 fail-open 결정의 근거다.

## 2. 데이터 소스 — 제프 `support-matrix` API

요청 문서 `ref/2026-07-21-jeff-support-matrix-request.md` → 제프 **회신에서 계약 그대로 수락**(2026-07-21).

```
GET /api/external/quotes/support-matrix     X-API-Key 게이트, 파라미터 없음

200 { ok: true, matrix: [{ lenderCode, productType, leaseTermMonths, annualMileageKm }] }
```

- **`null` = 미확정**(게이트 미착수) / **`[]` = 전부 미지원**. 의미가 정반대이므로 혼동 금지.
- 행 순서는 제프 SSOT 순서로 고정되나 **순서에 의존하지 않는다** — `(lenderCode, productType)`로 조회(제프 권고).
- 에러 body = 기존 external 계약 `{ ok:false, errorCode, error }`.

### 첫 응답 구성 (제프 회신 확정)

| lenderCode | productType | leaseTermMonths | annualMileageKm |
|---|---|---|---|
| mg-capital | operating_lease | [36,48,60] | [10000,20000,30000] |
| bnk-capital | operating_lease | [12,24,36,48,60] | [10000,15000,20000,30000,40000] |
| woori-card | operating_lease | [12,24,36,48,60] | [10000,20000,25000,30000,40000] |
| meritz-capital | operating_lease | [12,24,36,48,60] | 워크북 파생(아래 ⚠️) |
| shinhan-card | operating_lease | [12,24,36,48,60] | [10000,20000,30000,40000] |
| kdbc / im / nh | operating_lease | null | null |
| mg / meritz / im | long_term_rental | null | null |

⚠️ **200이어도 항목별로 `null`이 올 수 있다(fail-soft).** 제프는 자기 DB 문제에도 500이 아니라 **200 + 영향받는 항목만 `null` 강등**을 준다(CRM fail-open과 맞물리도록 의도). 따라서 **"200 = 전부 확정"으로 가정하지 않고 금융사×축마다 독립 판정**한다 — 기간은 확정인데 약정거리만 강등된 혼합 응답이 정상 경로다.

2026-07-21 시점 그 예가 메리츠 `annualMileageKm`(워크북 DB 파생)이지만, **어느 사가 파생인지는 제프 내부 사정이라 CRM은 열거하지 않는다** — 파생 사가 늘어도 우리 코드는 안 바뀌어야 한다. 같은 금융사의 지원집합이 응답마다 달라질 수 있다는 뜻이라 캐시를 영구 보관하지 않는다(D5 근거).

### 실제 게이트 효과 (기대치 — 오해 방지용 박제)

**기간 게이트가 실제로 걸리는 금융사는 MG 하나뿐**이다(나머지 4사는 5개 기간 전부 지원). 약정거리는 5사가 전부 달라 체감이 크다. "12개월이 안 막힌다"는 관찰은 MG 외 금융사에서는 **정상**이다.

## 3. 결정 사항

| # | 결정 | 근거 |
|---|---|---|
| D1 | **적용 대상 = 워크벤치만** | 계산기 모달은 전사 병렬 조회라 **기준 금융사가 없어 게이트가 원리적으로 불가**. 지금도 미취급 사가 결과에서 조용히 빠진다. |
| D2 | 기간 = `disabled`, 약정거리 = **option 제거** | 유슨생 결정. 미지원은 아예 못 고르게. |
| D3 | 충돌 시 **기본값 폴백**(60개월 / 20,000km) + 토스트 1회 | 막아버리면 그 값이 선택된 채로 남을 수 없다. **20,000km·60개월은 5사 전부 지원**(실측)이라 어느 금융사로 바꿔도 성립. 조용히 바꾸지 않도록 토스트 동반. |
| D4 | **fail-open** — API 실패·`null`·금융사 미선택은 전량 노출 | 게이트는 UX 개선이지 방어선이 아니다(§1). 파트너 API 장애로 견적 작성이 멈추면 안 된다. |
| D5 | 캐시 = 세션 단위(새로고침 시 갱신) | `staff.ts` 선례. 매트릭스가 1KB 미만이라 무겁지 않고, 항목별 강등(§2 ⚠️)이 런타임 유동이라 영구 보관은 부적절. |
| D6 | 금융사 select의 **uncontrolled 계약 유지** | 값의 진실은 계속 DOM(`data-sc-field="lender"`). 게이트용 state는 별도로 추적한다. |

### 기각 (재제안 금지)

- **CRM에 매트릭스 하드코딩** — 워크북이 바뀌면 CRM만 조용히 틀려진다. 제프 drift 테스트는 CRM 복제본을 못 지킨다.
- **`disabled` 대신 표식만** — 유슨생이 "선택 안 되게" 명시 결정.
- **충돌 시 선택 유지** — D2와 모순(못 고르게 한 값이 선택돼 있는 상태).
- **계산기 모달 게이트** — D1 근거(기준 금융사 부재).

## 4. 구조

```
client/src/lib/support-matrix.ts        순수 + fetch/캐시 — 조회·판정 SSOT
        ↕
src/routes/solution.ts  GET /support-matrix   릴레이(기존 dealers 미러)
        ↕
제프 external /api/external/quotes/support-matrix
```

### 4.1 서버 릴레이 (`src/routes/solution.ts`)

기존 `GET /dealers` 릴레이를 **그대로 미러**한다 — env·인증·타임아웃·에러 매핑·`origin` 파생 전부 동일 계약.

- `PARTNER_QUOTE_API_URL`에서 `origin`만 파생해 경로 조립(dealers와 동일 방식)
- `X-API-Key`는 서버에만 존재(클라 노출 금지)
- ⚠️ **`fetchImpl`은 지역 변수 plain call** — Workers `Illegal invocation` 가드(AGENTS.md·PR #202)
- 파라미터 없음 → zod 게이트 불필요

### 4.2 클라 조회·캐시 (`client/src/lib/support-matrix.ts`)

```ts
type LenderSupport = { leaseTermMonths: number[] | null; annualMileageKm: number[] | null };

fetchSupportMatrix(): Promise<Map<string, LenderSupport>>   // 세션 캐시 + inflight dedupe
useSupportMatrix(): Map<string, LenderSupport>              // staff.ts useStaffDirectory 미러
```

- Map 키 = `` `${lenderCode}::${productType}` `` (순서 비의존 — 제프 권고)
- **방어 파싱**: 배열이 아니고 `null`도 아닌 값, 숫자 아닌 원소는 미확정(`null`)으로 강등. 파트너 스키마 드리프트가 게이트를 잘못 켜는 것보다 안 켜는 게 안전(D4와 같은 방향).
- 실패 = 빈 Map 반환(throw 아님) + `console.warn` 1줄. 호출부는 실패를 구분할 필요가 없다(전부 fail-open).

### 4.3 순수 판정 (같은 파일)

```ts
supportedTermsFor(matrix, lenderLabel, productType): number[] | null   // null = 게이트 없음
supportedMileagesFor(matrix, lenderLabel, productType): number[] | null
resolveGateFallback(current, supported, fallback): number | null      // 폴백 필요하면 값, 아니면 null
```

- 금융사는 화면이 **라벨**(`"MG캐피탈"`)을 쥐고 있으므로 `SOLUTION_LENDERS`로 코드 변환. 미지원 라벨(CRM 수기 어휘·구 어휘 저장값)은 `null` = 게이트 없음.
- 약정거리는 표시 문자열(`"20,000km / 년"`)과 숫자를 오가야 한다 — `solution-quote.ts`의 기존 왕복 규칙을 재사용한다(신규 파서 금지).

### 4.4 워크벤치 배선 (`useQuoteWorkbench.ts` / `QuoteWorkbench.tsx`)

**신규 state 1개**: `lenderByCard: Record<string, string>` — 카드별 현재 선택 금융사 라벨.

게이트 렌더에 금융사가 필요한데 지금은 DOM에만 있다. **이벤트 배선은 신설하지 않는다** — `syncDealerOnLenderChange`(`:781`)가 이미 델리게이션으로 금융사 select의 `change`+`input`을 병행 수신하므로(Safari 함정 기해결 경로), 그 함수 안에서 함께 갱신한다.

동기화가 필요한 지점(딜러 state와 동일 생명주기):
- 금융사 변경 → 갱신 + 충돌 폴백 판정
- 조건 복사(`copyManualQuoteCondition`) → 대상 카드에 복사
- `clearCardUiState` → 초기화
- 수정 진입(`openEditQuote`) → 시나리오 lender로 시드

**UI 적용**

기간 세그먼트에는 **공유 프리미티브 확장이 선행된다.** `SegmentGroup`(`quote-fields/QuoteFields.tsx`)은 현재 **그룹 단위 `disabled`만** 받고, `SegmentOption = { value, label }`에 옵션 단위 개념이 없다.

```ts
// 확장 (순수 additive)
export type SegmentOption<T> = { value: T; label: string; disabled?: boolean };
// 렌더:  disabled={disabled || option.disabled}
```

⚠️ **이 프리미티브는 워크벤치·계산기가 물리 공유한다(#265 SSOT).** 따라서:
- 확장은 **반드시 additive**여야 한다 — `option.disabled`를 안 넘기는 기존 호출부(계산기 전량 + 워크벤치 나머지 행)는 `undefined || false`로 **행위·DOM 무변경**.
- #265가 잠근 "워크벤치 DOM 기준" 계약도 유지된다 — 게이트가 없는 상태(fail-open·미확정·금융사 미선택 = 실사용 대부분)에서는 `disabled` 속성이 아예 붙지 않는다. DOM이 바뀌는 건 **실제로 미지원 옵션이 있을 때뿐**이고, 그건 의도된 변경이다.
- 계산기 모달은 이 필드를 넘기지 않는다(D1).

- 약정거리: `manualMileageOptions`를 지원집합으로 필터(select option 제거).

**⚠️ 저장된 카드(`isConditionSaved`)는 게이트에서 명시적으로 제외한다.** "이미 disabled라 무관"이 아니다 — option을 제거하면 **저장된 값이 목록에 없어 표시가 빈칸으로 깨진다**(과거 MG+25,000km 견적을 열었을 때). 저장된 카드는 과거 견적의 진실을 그대로 보여야 하고, 어차피 편집 불가라 게이트의 목적(잘못 고르는 것 방지)이 없다.

**⚠️ 현재 선택값은 필터에서 항상 살린다.** 편집 가능한 카드라도 마운트·수정 진입 시점에는 폴백을 돌리지 않으므로(아래), 선택값이 목록에서 사라지면 표시가 깨진다.

### 폴백 시점 (D3 정밀화)

**폴백은 금융사 변경 시에만 실행한다.** 마운트·수정 진입에서는 실행하지 않는다.

- 사용자가 금융사를 바꾸는 정상 흐름에서는 항상 지원값이 선택된 상태가 된다.
- 수정 진입 시 과거의 미지원 조합은 **그대로 보인다** — 그 견적이 실제로 그렇게 저장됐다는 사실이 정직하고, 사용자가 열자마자 값이 바뀌는 게 더 나쁘다(D3의 "조용히 바꾸지 않는다"와 같은 근거).
- 기간이 미지원인 채 선택돼 있으면 그 버튼은 `disabled`이면서 `active`다. 정보로는 정확하다("이 값은 이 금융사로 못 쓴다").

**폴백**: 금융사 변경 직후 현재 값이 미지원이면 기본값으로 이동 + 토스트. 기간·거리 각각 판정하되 **토스트는 카드당 1회로 합친다**(둘 다 튕기면 문구 하나에 병기).

## 5. 테스트

| 대상 | 방식 |
|---|---|
| 순수 판정 3함수 | 유닛 TDD — 지원/미지원/`null`/빈 배열/미지원 라벨/코드 변환 |
| 방어 파싱 | 유닛 — 배열 아님·숫자 아님·필드 누락 → `null` 강등 |
| 릴레이 | 서버 테스트 — 200 패스스루·업스트림 4xx/5xx 매핑·env 미설정 503·타임아웃 |
| `SegmentGroup` additive | 유닛 — `option.disabled` 미전달 시 기존과 동일(속성 부재)·전달 시 해당 버튼만 비활성. **공유 프리미티브라 계산기 회귀 방지선** |
| 게이트 렌더 | 워크벤치 유닛 — 목 매트릭스 주입 후 MG 선택 시 12·24 disabled, 마일리지 옵션 3개 |
| 폴백 | 유닛 — 24개월+MG → 60개월 이동·토스트 1회 |
| fail-open | 유닛 — 빈 Map·`null`이면 전량 노출 |

**브라우저 스모크는 제프 배포 전까지 제한적이다.** 실 API가 없으므로 ①fail-open 경로(게이트 없음 = 현행과 동일)는 실화면 확인 가능 ②게이트 경로는 목 응답 주입으로 확인. 제프 배포 후 실 API 스모크를 별도로 1회 수행한다.

## 6. 범위 밖

- 계산기 모달(D1)
- 산은·iM·농협·장기렌트 게이트 — 제프 `null`이라 자동으로 대상 아님. 제프 Phase B 완료 시 **응답만 바뀌어 자동 확장**(CRM 코드 변경 0).
- 잔존가치·보증금 등 다른 축 — 제프에 지원집합 개념 자체가 없다.
- 미취급 조회 결과 처리 — 이미 동작(§1).
