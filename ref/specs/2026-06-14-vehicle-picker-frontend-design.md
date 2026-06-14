# 차량 선택 프론트 연결 (VehiclePicker) 설계

작성일: 2026-06-14
상태: 승인됨 (구현 계획 대기)

## 배경 / 목적

차량 조회 API(`/api/vehicles`)는 완성됐다(PR #10). 하지만 견적 workbench(Jeff body)의 차량 선택은 여전히 **하드코딩 버튼**(제조사 "벤츠" / 모델 "Maybach S-Class" / 트림 "S 500 4M Long", 클릭 동작 없음)이다. 이걸 실제 카탈로그에서 선택하는 드롭다운으로 연결한다.

- 클라이언트에 데이터 페칭 인프라가 0이므로, 이 작업이 **첫 fetch 패턴**도 확립한다.
- 대상은 김민준 drawer(`CU-2605-0020`)의 새 견적 workbench(Jeff body)뿐. 다른 화면·기존 견적 작성 폼은 불변.

## 범위

**포함**
- 데이터 페칭 레이어(순수 fetch): `/api/vehicles/brands`, `models?brandId=`, `trims?modelId=`
- `VehiclePicker` 컴포넌트: 브랜드 → 모델 → 트림 3단계 계층 드롭다운
- Jeff body 하드코딩 picker(`CustomerDetailPage.tsx` 4828-4830)를 `VehiclePicker`로 교체
- 로딩/에러 표시

**비범위 (다음 단계)**
- 선택한 차량으로 **가격/옵션/색상 자동 반영**(picker → 견적 가격 계산 연동) — `onChange` 훅 포인트만 남김
- 옵션/색상 드롭다운(🎨 섹션), 검색, 견적 저장 연동
- 데이터 페칭 라이브러리(react-query 등) 도입 — 순수 fetch 유지(YAGNI)

## 아키텍처

순수 fetch 기반. 페칭 라이브러리 없음. 컴포넌트는 독립 단위로 분리해 단독 테스트 가능하게 한다.

## ① 데이터 레이어 — `client/src/lib/vehicles.ts`

`/api/vehicles/*`를 호출하는 함수 + 응답 타입(서버 화이트리스트와 일치).

```ts
export type Brand = { id: number; name: string; logoUrl: string | null; isDomestic: boolean; isPopular: boolean; sortOrder: number | null; brandCode: number | null };
export type Model = { id: number; brandId: number; name: string; imageUrl: string | null; category: string | null; status: string; sortOrder: number | null; modelCode: number | null };
export type Trim = { id: number; modelId: number; name: string; trimName: string | null; canonicalName: string | null; price: number; fuelType: string | null; displacementCc: number | null; modelYear: number | null; driveSystem: string | null; transmissionType: string | null; bodyStyle: string | null; seatingCapacity: number | null; status: string; sortOrder: number | null };

export async function fetchBrands(): Promise<Brand[]>;
export async function fetchModels(brandId: number): Promise<Model[]>;
export async function fetchTrims(modelId: number): Promise<Trim[]>;
```

- Vite proxy(`/api` → 8788) 경유. 응답 비정상(`!res.ok`)이면 throw → 컴포넌트가 에러 상태로 처리.

## ② `VehiclePicker` — `client/src/components/VehiclePicker.tsx`

- 기존 `kim-jeff-picker-row` 스타일 유지(제조사/모델/트림 버튼 + `ChevronDown`).
- 버튼 클릭 → 목록 드롭다운(컴포넌트 내부 상태로 open 토글, 바깥 클릭/Esc로 닫힘).
- 계층 연동: 브랜드 선택 → 모델 로드(`fetchModels`) → 모델 선택 → 트림 로드(`fetchTrims`). 상위가 바뀌면 하위 선택/목록 초기화.
- 내부 상태: `brand/model/trim`(선택 객체) + 각 목록 + per-단계 로딩/에러.
- props: `onChange?(selection: { brand?: Brand; model?: Model; trim?: Trim })` — 향후 가격/옵션 연동 훅 포인트.
- 브랜드 목록은 마운트 시 1회 로드. 모델/트림은 상위 선택 시 lazy 로드.
- 미선택 상태: 버튼에 "선택" placeholder(기존 `muted` 스타일 활용). 하위는 상위 선택 전 비활성.

## ③ 연결 — `CustomerDetailPage.tsx`

- Jeff body의 하드코딩 picker 3버튼(4828-4830)을 `<VehiclePicker onChange={...} />`로 교체. 다른 영역(옵션/컬러/할인/가격)은 이번에 손대지 않음.

## ④ 로딩 / 에러

- 목록 로딩 중: 드롭다운에 "불러오는 중…".
- fetch 실패: 드롭다운에 "불러오기 실패" + 재시도 가능(버튼 다시 열기). 단계별 격리(브랜드 실패가 전체를 막지 않음).

## ⑤ 테스트 — vitest + jsdom

- `vehicles.ts`: 전역 `fetch` mock으로 `fetchBrands/fetchModels/fetchTrims` URL·파싱·에러 throw 검증.
- `VehiclePicker`: fetch mock으로 렌더 → 브랜드 드롭다운 열기 → 선택 → 모델 로드되는 흐름, 로딩/에러 표시 검증.

## 영향 파일

- 신규: `client/src/lib/vehicles.ts`, `client/src/components/VehiclePicker.tsx`, 각 테스트
- 수정: `client/src/pages/CustomerDetailPage.tsx`(picker 교체), `client/src/index.css`(드롭다운 스타일, 필요 시)

## 다음 단계 (이 spec 이후)

1. picker 선택값 → 견적 가격/옵션/색상 자동 반영
2. 옵션/색상 드롭다운(🎨 섹션) 연결
3. 견적 저장 시 선택한 `trimId` 저장 (CRM 자체 스키마 quotes 작업과 연계)
