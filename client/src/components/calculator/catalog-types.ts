// 제프(dolim-solution) types/catalog.ts 이식(사용분: master 3-tier + 트림 옵션/컬러).
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md)
//
// CRM /api/vehicles 응답(@/lib/vehicles의 Brand·Model·Trim)을 이 모양으로 어댑트해 쓴다 —
// 필드별 매핑 표는 hooks/useMasterCatalog.ts 상단 주석 참조.
// 제프 원형 대비 제거한 필드(둘 다 CRM 미보유 + V2 트리 미소비 확인):
//   MasterBrand.displayNameEn · Master*.offeringCount · MasterModel.trimCount

export interface MasterBrand {
  id: number
  // ⚠️ CRM 어댑트: 값 = CRM brands.id (fetchModels(brandId) 키). master brand_code가 아니다 —
  //   CRM Brand.brandCode는 nullable이라 선택 키로 부적합. 픽커는 key/선택 식별자로만 소비.
  brandCode: number
  name: string
  isDomestic: boolean
  isPopular: boolean
  sortOrder: number
}

export interface MasterModel {
  id: number
  // ⚠️ CRM 어댑트: 값 = CRM models.id (fetchTrims(modelId) 키 — brandCode와 동일 사유).
  modelCode: number
  name: string
  category: string | null
  imageUrl: string | null
  // CRM 목록 API 미제공 — 항상 null(ModelPickerDialog formatPriceRangeKor가 null 시 표시 생략).
  minPrice: number | null
  maxPrice: number | null
}

export interface MasterTrim {
  // CRM 추가 필드: CRM trims.id — useTrimExtras(trimId)·fetchWorkbenchVehicle 키(제프는 mcCode 키).
  trimId: number
  // mcCode 없는 트림은 quotable=false + 렌더 key 전용 placeholder(`crm-trim-{id}`)로 채운다 —
  //   선택 불가(disabled)라 payload masterMcCode로 전송될 일 없음. 상세는 useMasterCatalog 매핑 표.
  mcCode: string
  name: string
  trimName: string | null
  canonicalName: string | null
  price: number
  modelYear: number | null
  fuelType: string | null
  displacementCc: number | null
  driveSystem: string | null
  bodyStyle: string | null
  status: string
  // 제프 의미 = 잔가 데이터 보유 여부(없으면 픽커에서 "잔가 데이터 없음" disabled).
  // CRM 어댑트 = mcCode 보유 여부 — mcCode 없으면 masterMcCode를 못 보내 계산 자체가 불가(가장 가까운 대응).
  quotable: boolean
}

// ---------------------------------------------------------------------------
// 트림별 옵션/색상 (제프 Mr.Cha mirror 타입 — CRM에선 fetchWorkbenchVehicle 응답을 분해해 채운다)
// ---------------------------------------------------------------------------

export interface TrimOption {
  id: number
  name: string
  price: number | null
}

export interface TrimOptionRelation {
  optionId: number
  relatedOptionId: number
  type: 'includes' | 'excludes'
}

export interface TrimColor {
  id: number
  name: string
  code: string | null
  hexValue: string | null
  sortOrder: number
}
