# 견적 워크벤치 수정 진입 prefetch + 스켈레톤

Date: 2026-06-25
Status: 설계 승인됨 (구현 대기)
관련: #104 차량 로딩 perf(번들+병렬화, 선행), `fetchWorkbenchVehicle`, VehiclePicker

## 배경 / 문제

#104로 수정 진입 차량 로딩이 클라 4요청 → 1요청(`/api/vehicles/workbench`)으로 줄어 ~1.7s → ~0.6s가 됐다. 하지만 ~0.6s 동안 차량 선택/옵션/컬러 카드가 빈 화면이라 체감이 남는다(송실장 보고). 실측상 ~0.6s의 대부분은 `trimDetail`(~0.45s)이고, 이는 **CF 엣지 ↔ Supabase origin 왕복 × 쿼리**가 베이스라인이라 실제 시간을 0에 가깝게 줄이는 건 물리적 한계가 있다.

→ 실제 시간을 더 깎는 대신 **"기다림" 자체를 숨긴다**: 견적함에서 수정 진입 전에 미리 받아두고(prefetch), 캐시 miss 시엔 빈 화면 대신 스켈레톤을 보인다.

## 목표

- 견적 수정 진입 시 차량 데이터를 **미리 받아둬(hover prefetch) 클릭 시 즉시** 열리게 한다(체감 ~0s).
- prefetch가 안 된 경우(바로 클릭/진행 중)엔 빈 화면 대신 **스켈레톤**으로 체감을 개선한다.
- 인프라/서버 변경 없이(프론트만), catalog 정확성(stale)을 짧은 TTL로 방어한다.

## 범위

### In scope
- 프론트 prefetch 캐시(`trimId → WorkbenchVehicle`, TTL + inflight dedupe).
- 견적 행 hover → prefetch 트리거.
- VehiclePicker 수정 모드가 캐시 경유 fetch.
- VehiclePicker 로딩 중 차량+옵션+컬러 카드 스켈레톤.

### Out of scope
- 신규 작성 모드(brands만이라 빠름 — prefetch 불필요).
- Hyperdrive read 캐싱·쿼리 통합(#104에서 배제, origin 왕복 한계).
- mc-master(`/api/catalog`) 일체.
- 서버/엔드포인트 변경(이미 #104의 `/workbench` 사용).

## 아키텍처

### 1. prefetch 캐시 — `client/src/lib/vehicles-cache.ts` (신규)
`trimId` 단일 키 캐시. mc-master `catalog-cache.ts`의 제네릭 `makeCache`는 다중 키/SWR/이미지 워밍까지 다뤄 과하므로, 견적 prefetch에 맞는 **가벼운 단일 키 캐시**를 둔다:

```ts
type Entry = { data: WorkbenchVehicle; ts: number };
const cache = new Map<number, Entry>();
const inflight = new Map<number, Promise<WorkbenchVehicle>>();
const TTL_MS = 60_000;

// 캐시 hit(신선)면 즉시, miss/만료면 fetch+저장. 동시 호출은 inflight로 1요청 공유.
export function fetchWorkbenchVehicleCached(trimId: number): Promise<WorkbenchVehicle>
// 백그라운드 워밍(결과 버림, 에러 무시). hover가 호출.
export function prefetchWorkbenchVehicle(trimId: number): void
```
- `fetchWorkbenchVehicleCached`: cache hit & `now - ts < TTL` → `Promise.resolve(data)`. 아니면 inflight 있으면 그것, 없으면 `fetchWorkbenchVehicle(trimId)` 호출 → 성공 시 cache 저장 + inflight 제거. 실패 시 inflight만 제거(throw).
- `prefetchWorkbenchVehicle`: `void fetchWorkbenchVehicleCached(trimId).catch(() => {})` (조용히 워밍).
- 의존: `fetchWorkbenchVehicle`/`WorkbenchVehicle`(`./vehicles`).

### 2. trigger — 견적 행 hover (`CustomerDetailPage.tsx`)
견적 행(`kim-quote-row`, ~4201)에 `onMouseEnter={() => { if (quote.trimId) prefetchWorkbenchVehicle(quote.trimId); }}`. trimId 없는 견적(차량 미선택)은 스킵. 행 클릭/드롭 등 기존 핸들러와 독립(추가만).

### 3. VehiclePicker 캐시 경유
수정 모드 마운트 effect의 `fetchWorkbenchVehicle(initialTrimId)` → `fetchWorkbenchVehicleCached(initialTrimId)`로 교체(import만 변경, 흐름 동일). hover로 미리 받았으면 캐시 hit → 네트워크 0 즉시 복원. 신규 모드는 변경 없음.

### 4. 스켈레톤 — VehiclePicker `loading` 중
VehiclePicker는 이미 `loading: Level | null` state를 가진다(수정 모드 마운트 시 `"brand"`로 시작). 차량 선택(제조사/모델/트림) row와, trimDetail 의존 영역(옵션/외장/내장 컬러)이 로딩 중 골격(`kim-vehicle-skeleton` 류)을 보이도록 한다.
- VehiclePicker: 수정 모드 초기 로딩(brands 미도착) 시 picker row를 스켈레톤 표시.
- 옵션/컬러: `trimDetail` 미도착(워크벤치의 `trimDetail` state가 null)일 때 OptionPicker/ColorPicker 자리에 스켈레톤. 캐시 hit면 거의 즉시 채워져 안 보인다.
- CSS는 기존 톤(연회색 박스, 약한 shimmer 또는 정적)으로 `index.css`에 추가.

### 무효화 / 정확성
- catalog(brands/models/trims/trimDetail)는 **견적 저장과 무관**(quotes 컬럼만 변경)이라 견적 쓰기 경로의 무효화는 불필요.
- catalog 자체는 mc-master(`/api/catalog`)에서만 바뀐다. 프론트 캐시는 **TTL 60s + 새로고침 리셋**이라, 같은 세션에서 mc-master 가격 수정 직후 견적을 열지 않는 한 stale 위험은 작다. (#104의 서버 번들도 어차피 매번 fresh read이므로, 프론트 60s만 추가 노출.)

## 검증

- 단위테스트(`vehicles-cache.test.ts`): cache hit(2번째 호출 fetch 안 함)·TTL 만료 후 재fetch·inflight dedupe(동시 2호출 1 fetch)·`prefetchWorkbenchVehicle`가 캐시를 채움.
- VehiclePicker 테스트: 수정 모드가 `fetchWorkbenchVehicleCached` 경유(여전히 `/api/vehicles/workbench` 1요청)·캐시 hit 시 네트워크 0(선 prefetch 후 마운트).
- 스켈레톤: 로딩 중 골격 렌더(렌더 테스트 또는 수동).
- `typecheck`/`lint`/`build`/`test:unit`.
- **prod 재실측**: 견적 행 hover 후 수정 진입 → 차량 카드 즉시(네트워크 0), miss 시 스켈레톤.

## 캐비엇

- TTL 60s 동안 mc-master 가격 수정이 견적 prefetch에 반영 안 될 수 있음(catalog 자주 안 바뀜 + 새로고침 리셋으로 허용). 가격 정확성이 더 중요해지면 TTL 단축 or 수정 진입만 강제 fresh 옵션.
- prefetch는 hover마다 trigger되지만 inflight+TTL로 중복 1요청. 견적 행 수 적어(~6) 부하 미미.
- 신규 작성 모드는 이 캐시를 쓰지 않는다(brands 직접, trimDetail은 selectTrim 후 fetchTrimDetail 폴백 — #104 그대로).
