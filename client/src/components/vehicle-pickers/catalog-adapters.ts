// CRM /api/vehicles 응답(@/lib/vehicles의 Brand·Model·Trim) → 픽커 다이얼로그 모양(Master*) 어댑터.
// 원래 calculator/hooks/useMasterCatalog.ts 내부 함수였던 것을 공용 위치로 추출(계산기·워크벤치 SSOT —
// plan: ref/plans/2026-07-16-crm-workbench-picker-dialog-unify.md). 매핑 근거 표는 catalog-types.ts 주석 참조.
//
// ⚠️ quotable 의미는 컨텍스트별로 다르다(plan 함정 7): 계산기 = mcCode 없으면 솔루션 계산 불가라
// 선택 자체를 막는다(toMasterTrim 그대로). 워크벤치 = mcCode 없어도 수기 견적 가능(현행 행위 보존)이라
// 소비처에서 `{ ...toMasterTrim(t), quotable: true }`로 오버라이드한다.
import type { Brand, Model, Trim } from '@/lib/vehicles'
import type { MasterBrand, MasterModel, MasterTrim } from './catalog-types'

export const toMasterBrand = (b: Brand): MasterBrand => ({
  id: b.id,
  brandCode: b.id,
  name: b.name,
  isDomestic: b.isDomestic,
  isPopular: b.isPopular,
  sortOrder: b.sortOrder ?? 0,
})

export const toMasterModel = (m: Model): MasterModel => ({
  id: m.id,
  modelCode: m.id,
  name: m.name,
  category: m.category,
  imageUrl: m.imageUrl,
  minPrice: null,
  maxPrice: null,
})

// mcCode 없는 트림은 렌더 key 전용 placeholder를 채운다 — 워크벤치 역매핑(trimByMcCodeKey)과 짝.
export const trimMcCodeKey = (t: Trim): string => t.mcCode ?? `crm-trim-${t.id}`

export const toMasterTrim = (t: Trim): MasterTrim => ({
  trimId: t.id,
  mcCode: trimMcCodeKey(t),
  name: t.name,
  trimName: t.trimName,
  canonicalName: t.canonicalName,
  price: t.price,
  modelYear: t.modelYear,
  fuelType: t.fuelType,
  displacementCc: t.displacementCc,
  driveSystem: t.driveSystem,
  bodyStyle: t.bodyStyle,
  status: t.status,
  quotable: t.mcCode != null,
})
