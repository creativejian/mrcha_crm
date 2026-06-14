# 차량 카탈로그 조회 API 설계

작성일: 2026-06-14
상태: 승인됨 (구현 계획 대기)

## 배경 / 목적

차량 거울 데이터(`catalog` schema, 7테이블 ~29k행)는 import 완료됐고 `src/db/catalog.ts` 타입 + `src/db/client.ts` 연결까지 됐다(PR #9). 이제 이 데이터를 앱에서 **조회**하는 read API를 만든다.

- 목적: 견적 workbench의 차량 선택(브랜드 → 모델 → 트림 → 옵션/색상) 백엔드 기반.
- CRM 자체 스키마(고객/상담/견적) 작업 전에, 이미 넣은 차량을 쓸 수 있게 하는 1차 단계.

## 범위

**포함**
- 차량 조회 API (Hono 라우트 + 쿼리 함수 레이어)
- brands / models / trims 계층 조회
- trim 상세 = trim + 옵션(`trim_options`) + 색상(`colors`) + 옵션관계(`trim_option_relations`) + no-options(`trim_no_options`)

**비범위 (이번에 하지 않음)**
- 쓰기(차량은 read-only 거울 — master = Mr.Cha Supabase)
- 프론트 연결 (견적 workbench mock 교체는 다음 단계)
- PostgREST sync 스크립트 (별도)
- CRM 자체 스키마(customers/consultations/quotes)

## 접근 방식

**계층별 REST** 채택. 견적 workbench가 단계별로 선택하므로 드롭다운 단계 로딩에 맞고, 페이로드가 작다. (대안: 전체 트리 한 방 = 1,669 trims+옵션/색상이라 비대 / trims 목록 inline = 목록 비대 → 둘 다 기각)

## 엔드포인트

```
GET /api/vehicles/brands              → 브랜드 목록
GET /api/vehicles/models?brandId=     → 해당 브랜드 모델 목록
GET /api/vehicles/trims?modelId=      → 해당 모델 트림 목록 (기본정보)
GET /api/vehicles/trims/:trimId       → 트림 상세 (옵션/색상/관계 포함)
```

### 응답 화이트리스트 (견적에 필요한 컬럼만)

- **brands**: id, name, logoUrl, isDomestic, isPopular, sortOrder, brandCode
- **models**: id, brandId, name, imageUrl, category, status, sortOrder, modelCode
- **trims (목록)**: id, modelId, name, trimName, canonicalName, price, fuelType, displacementCc, modelYear, driveSystem, transmissionType, bodyStyle, seatingCapacity, status, sortOrder
- **trims/:trimId (상세)**: 위 트림 필드 + `specs`(jsonb) + 할인 필드(financialDiscountAmount/partnerDiscountAmount/cashDiscountAmount) + 아래 중첩:
  - options: `trim_options` [{ id, type, name, price }]
  - optionRelations: `trim_option_relations` [{ id, optionId, relatedOptionId, type }]
  - noOptions: `trim_no_options` [{ note, checkedAt }] (있으면)
  - colors: `colors` [{ id, colorType, name, code, hexValue, sortOrder }]

## 레이어 분리

- **`src/db/queries/vehicles.ts`** — 쿼리 함수. `catalog.ts` 타입 사용.
  - `getBrands()`
  - `getModelsByBrand(brandId)`
  - `getTrimsByModel(modelId)`
  - `getTrimDetail(trimId)` → trim + options + colors + relations + noOptions
  - 공통: `deleted_at IS NULL` 필터(거울 soft-delete 제외), `sort_order` 정렬, 화이트리스트 select.
- **`src/routes/vehicles.ts`** — Hono 라우터. `@hono/zod-validator`로 쿼리/파라미터 검증 후 쿼리 함수 호출, JSON 응답.
- **`src/app.ts`** — `app.route("/api/vehicles", vehiclesRouter)` 연결 (현재 `/api/health`만 있음).

## 데이터 규칙

- 모든 조회는 `deleted_at IS NULL` (master에서 삭제된 항목 제외).
- 정렬은 각 테이블의 `sort_order` (brands/models/trims/colors).
- status 필터(판매중/단종 등)는 이번 범위에서 강제하지 않음 — 전체 status 반환, 필요 시 후속에서 쿼리 파라미터로 추가.
- catalog는 read-only. 이 API는 SELECT만 수행.

## 검증 / 에러 처리

- `brandId` / `modelId` / `trimId`는 양의 정수(bigint) — zod로 검증, 실패 시 400.
- 목록 조회에서 결과 없음 → 빈 배열 `[]` (200).
- `GET /api/vehicles/trims/:trimId`에서 트림 없음 → 404.

## 테스트

- `bun:test` (server) — 쿼리 함수 + 라우트.
- 실제 catalog 데이터 통합 검증 1~2개: 예) `getBrands()` 33개, 특정 모델의 트림 목록, 특정 트림 상세에 옵션/색상 포함.
- `bun run typecheck` / `bun run lint` / `bun run build` 통과.

## 영향 파일

- 신규: `src/db/queries/vehicles.ts`, `src/routes/vehicles.ts`, 테스트 파일
- 수정: `src/app.ts` (라우트 연결)

## 다음 단계 (이 spec 이후)

1. 프론트 견적 workbench 차량 선택을 이 API로 연결
2. PostgREST sync 스크립트
3. CRM 자체 스키마(고객/상담/견적, quotes가 `catalog.trims` FK 참조)
