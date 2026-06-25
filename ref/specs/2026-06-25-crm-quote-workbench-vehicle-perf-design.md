# 견적 워크벤치 차량 로딩 perf (번들 엔드포인트 + 병렬화)

Date: 2026-06-25
Status: 설계 승인됨 (구현 대기)
관련: #103 차량 로딩 중 작성완료 데이터 손실 가드(선행), VehiclePicker, `/api/vehicles/*`

## 배경 / 문제

견적 워크벤치 **수정 진입** 시 차량 데이터 로딩이 느려, 로딩 완료까지 작성완료가 비활성화된다(#103 가드). 송실장 보고. prod에서 토큰으로 실측한 결과:

| 엔드포인트 | total | 서버 처리(Hyperdrive+쿼리, TTFB−TLS) |
|---|---|---|
| `/api/vehicles/brands` | 0.28~0.53s | ~0.18~0.43s |
| `/api/vehicles/models?brandId=` | 0.37~0.49s | ~0.27~0.39s |
| `/api/vehicles/trims?modelId=` | 0.32~0.39s | ~0.22~0.29s |
| **`/api/vehicles/trims/:id`(trimDetail)** | **0.65~0.80s** | **~0.55~0.70s** ← 최대 |

(connect~45ms+TLS~95ms는 curl이 매번 새 연결이라 발생 — 브라우저는 HTTP/2 연결 재사용이라 첫 요청만 해당.)

**근본 원인 (코드 + 측정):**
- VehiclePicker 수정 진입은 클라이언트가 **요청을 직렬·중복으로** 보낸다:
  `fetchTrimDetail(initialTrimId)` → `Promise.all([brands, models, trims])` → onChange → `applyTrimToPricing`이 **또** `fetchTrimDetail(trim.id)`.
  추정 누적 ≈ **1.7s** (trimDetail 0.65 + brands/models/trims 0.45 + 중복 trimDetail 0.65).
- prod는 Workers라 **요청마다 Hyperdrive origin 연결을 새로 생성**(소켓 재사용 불가) → 각 왕복이 0.2~0.55s로 무겁다.
- `getTrimDetail`은 서버에서 **5쿼리를 직렬 await**(trim+join → options → relations → colors → noOptions)해 단일 최대 병목(~0.65s).
- 그 무거운 trimDetail을 **2번 호출**(VehiclePicker + applyTrimToPricing) = 순수 낭비.

**측정이 배제한 대안:** Hyperdrive read 캐싱(C)은 ① 최대 병목 trimDetail이 trim마다 캐시 키가 달라 hit 어렵고 ② 견적 진입 빈도가 낮아(분~시간 간격) TTL miss 잦으며 ③ binding 분리·쓰기 무효화 인프라가 필요한 데다 mc-master(`/api/catalog` 읽기+쓰기)와 일원화도 안 됨. 따라서 **왕복 수 축소 + 쿼리 병렬화**가 정답.

## 목표

- 견적 워크벤치 수정 진입의 차량 로딩을 클라 1요청 + 서버 내부 병렬로 단축한다(예상 ~1.7s → ~0.6s).
- 인프라 변경·캐싱·stale 없이(항상 fresh), mc-master(`/api/catalog`)와 SSOT 읽기 경로를 건드리지 않는다.

## 범위

### In scope
- `getTrimDetail` 서버 쿼리 병렬화 (신규 모드 `/trims/:id`도 수혜).
- 번들 쿼리 `getWorkbenchVehicle(trimId)` + 라우트 `GET /api/vehicles/workbench?trimId=`.
- 프론트 `fetchWorkbenchVehicle` + VehiclePicker 수정 모드를 1요청으로.
- 중복 `fetchTrimDetail` 제거 (`VehicleSelection.trimDetail?` 동봉).

### Out of scope
- Hyperdrive read 캐싱(C)·cached binding 분리.
- 읽기 로직 `vehicles.ts`/`catalog-admin.ts` 통합(SSOT #3).
- 견적 프론트 캐시(catalog-cache 차용, #4).
- mc-master(`/api/catalog`) 경로 일체.
- 신규 모드의 요청 구조 변경(현행 유지; 병렬화 수혜만).

## 아키텍처

### 1. `src/db/queries/vehicles.ts`

**ⓐ `getTrimDetail` 병렬화** — 의존성(`optionRelations`는 `options.ids` 필요)만 남기고 병렬:
```
const [[trim], options, colors, [noOptions]] = await Promise.all([
  <trim+join select>, <options select>, <colors select>, <noOptions select>,
]);
if (!trim) return null;
const optionRelations = options.length ? await <relations select(optionIds)> : [];
return { ...trim, options, optionRelations, colors, noOptions: noOptions ?? null };
```
5직렬 → 2라운드. 반환 형태·null 처리 불변(동작 보존).

**ⓑ 번들 `getWorkbenchVehicle(trimId, executor)` 신규:**
```
const [trimDetail, brands] = await Promise.all([getTrimDetail(trimId, executor), getBrands(executor)]);
if (!trimDetail) return null;
const [models, trims] = await Promise.all([
  getModelsByBrand(trimDetail.brandId, executor),
  getTrimsByModel(trimDetail.modelId, executor),
]);
return { brands, models, trims, trimDetail };
```
`trimDetail.brandId`는 trim+join에서 이미 노출됨(기존 `getTrimDetail` 반환에 `brandId` 포함).

### 2. `src/routes/vehicles.ts`
`GET /api/vehicles/workbench?trimId=`:
- zod로 `trimId` 양의 정수 검증(기존 `/trims/:id` 패턴 재사용).
- `getWorkbenchVehicle(trimId, c.var.db)` → null이면 404, 아니면 200 json.
- 기존 `brands`/`models`/`trims`/`trims/:id` 라우트는 그대로(신규 모드·하위호환).

### 3. `client/src/lib/vehicles.ts`
```
export type WorkbenchVehicle = { brands: Brand[]; models: Model[]; trims: Trim[]; trimDetail: TrimDetail };
export function fetchWorkbenchVehicle(trimId: number): Promise<WorkbenchVehicle> {
  return getJson<WorkbenchVehicle>(`/api/vehicles/workbench?trimId=${trimId}`);
}
```

### 4. `client/src/components/VehiclePicker.tsx`
- `VehicleSelection` 타입에 `trimDetail?: TrimDetail` 추가.
- 수정 모드 마운트 effect(현재 `fetchTrimDetail` + `Promise.all([brands,models,trims])`)를 **`fetchWorkbenchVehicle(initialTrimId)` 1요청**으로 교체. 응답으로 brands/models/trims/brand/model/trim 복원.
- 수정 모드 onChange에 받은 `trimDetail`을 **동봉**: `onChange?.({ brand, model, trim, trimDetail })`.
- 신규 모드(`selectBrand`/`selectModel`/`selectTrim`)는 변경 없음 — trimDetail 동봉 안 함(applyTrimToPricing이 fetch).

### 5. `client/src/pages/CustomerDetailPage.tsx` — `applyTrimToPricing`
- `selection.trimDetail`이 있으면 그것을 사용(재fetch 생략), 없으면 기존대로 `fetchTrimDetail(trim.id)`.
```
const detail = selection.trimDetail ?? await fetchTrimDetail(trim.id);
```
나머지(prefill 적용, 가격 input 세팅)는 불변.

## 데이터 흐름 (수정 진입, 변경 후)

```
VehiclePicker mount(initialTrimId)
  → fetchWorkbenchVehicle(trimId)            [클라 1요청]
      서버: Promise.all(getTrimDetail‖getBrands) → Promise.all(getModels‖getTrims)
  → setBrands/Models/Trims/brand/model/trim
  → onChange({brand, model, trim, trimDetail})
  → applyTrimToPricing: selection.trimDetail 사용(재fetch 없음)
```
클라 왕복 4(+중복) → **1**. 서버 trimDetail 5직렬 → **2라운드**.

## 검증

- 서버 테스트(`vehicles.test.ts`): `/workbench?trimId=` 200(brands/models/trims/trimDetail 포함)·없는 id 404·`trimId` 누락 400. `getTrimDetail` 병렬화 후 반환 형태 동일(기존 테스트 통과).
- 프론트 테스트: `fetchWorkbenchVehicle` URL/반환(`vehicles.test.ts`), VehiclePicker 수정 모드가 `/api/vehicles/workbench` 1요청만 보냄(`VehiclePicker.test.tsx` 업데이트).
- `bun run typecheck` 0 · `bun run lint` 0 · `bun run build` OK · `bun run test:unit`/`test:server`.
- **prod before/after 실측**(토큰 재측정): 번들 1요청 시간 vs 기존 누적.

## 캐비엇

- **신규 모드는 여전히 다중 요청**(brand→model→trim 클릭마다). 이번 범위는 수정 진입(번들). 신규는 ⓐ 병렬화 수혜만.
- `VehicleSelection.trimDetail?`는 **수정 모드에서만** 채워진다 — 신규 모드 selection엔 없어 applyTrimToPricing이 fetch(의도).
- 캐싱 안 하므로 mc-master 차량 수정은 견적에 **즉시 반영**(stale 없음) — SSOT 유지.
- `getWorkbenchVehicle`은 `getTrimDetail`/`getBrands`/`getModelsByBrand`/`getTrimsByModel`를 **재사용**(읽기 로직 SSOT는 vehicles.ts 내부에서 단일).
