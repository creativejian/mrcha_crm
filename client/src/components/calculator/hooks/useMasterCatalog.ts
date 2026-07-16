// 제프(dolim-solution) hooks/useMasterCatalog.ts 이식 — 상태기계·반환 계약(State/Actions·
// selectedBrand/Model/Trim·loadBrands/selectBrand/selectModel/selectTrim/reset)은 제프 원형 그대로,
// 데이터 소스만 CRM @/lib/vehicles(fetchBrands/fetchModels/fetchTrims — master catalog 직결)로 배선.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — 배선 교체 표)
//
// ── CRM → 제프 모양 어댑트 매핑 표 ──
// MasterBrand ← Brand:
//   id ← id · brandCode ← id(⚠️ master brand_code 아님 — CRM Brand.brandCode는 nullable이라 키로
//   부적합. fetchModels(brandId) 키이자 픽커 선택 식별자) · name ← name · isDomestic ← isDomestic ·
//   isPopular ← isPopular · sortOrder ← sortOrder ?? 0
// MasterModel ← Model:
//   id ← id · modelCode ← id(동일 사유 — fetchTrims(modelId) 키) · name ← name · category ← category ·
//   imageUrl ← imageUrl · minPrice/maxPrice ← null(CRM 목록 API 미제공 — 픽커는 null 시 표시 생략)
// MasterTrim ← Trim:
//   trimId ← id(CRM 추가 필드 — useTrimExtras·fetchWorkbenchVehicle 키. 제프는 mcCode 키였다) ·
//   mcCode ← mcCode ?? `crm-trim-{id}`(렌더 key 전용 placeholder — quotable=false로 선택 불가라
//   payload masterMcCode로 전송될 일 없음) · quotable ← mcCode != null(제프 의미 = 잔가 데이터 보유,
//   CRM 대응 = mcCode 없으면 계산 불가) · canonicalName/trimName 등 나머지 = 동명 passthrough
//
// 제프 원형과 달라진 점: lenderCode 파라미터 제거(제프 = lender별 offering 필터 카탈로그,
// CRM /api/vehicles는 필터 개념 없음. V2 페이지도 인자 없이 호출).
import { useCallback, useEffect, useState } from 'react'
import { fetchBrands, fetchModels, fetchTrims, type Brand, type Model, type Trim } from '@/lib/vehicles'
import type { MasterBrand, MasterModel, MasterTrim } from '../catalog-types'

const toMasterBrand = (b: Brand): MasterBrand => ({
  id: b.id,
  brandCode: b.id,
  name: b.name,
  isDomestic: b.isDomestic,
  isPopular: b.isPopular,
  sortOrder: b.sortOrder ?? 0,
})

const toMasterModel = (m: Model): MasterModel => ({
  id: m.id,
  modelCode: m.id,
  name: m.name,
  category: m.category,
  imageUrl: m.imageUrl,
  minPrice: null,
  maxPrice: null,
})

const toMasterTrim = (t: Trim): MasterTrim => ({
  trimId: t.id,
  mcCode: t.mcCode ?? `crm-trim-${t.id}`,
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

export interface MasterCatalogState {
  brands: MasterBrand[]
  models: MasterModel[]
  trims: MasterTrim[]
  selectedBrand: MasterBrand | null
  selectedModel: MasterModel | null
  selectedTrim: MasterTrim | null
  brandsLoading: boolean
  modelsLoading: boolean
  trimsLoading: boolean
  error: string | null
}

export interface MasterCatalogActions {
  loadBrands: () => Promise<void>
  selectBrand: (brandCode: number | null) => Promise<void>
  selectModel: (modelCode: number | null) => Promise<void>
  selectTrim: (mcCode: string | null) => void
  reset: () => void
}

export function useMasterCatalog(): MasterCatalogState & MasterCatalogActions {
  const [brands, setBrands] = useState<MasterBrand[]>([])
  const [models, setModels] = useState<MasterModel[]>([])
  const [trims, setTrims] = useState<MasterTrim[]>([])
  const [selectedBrand, setSelectedBrand] = useState<MasterBrand | null>(null)
  const [selectedModel, setSelectedModel] = useState<MasterModel | null>(null)
  const [selectedTrim, setSelectedTrim] = useState<MasterTrim | null>(null)
  const [brandsLoading, setBrandsLoading] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [trimsLoading, setTrimsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadBrands = useCallback(async () => {
    setBrandsLoading(true)
    setError(null)
    try {
      const data = await fetchBrands()
      setBrands(data.map(toMasterBrand))
    } catch (e) {
      setError(String(e))
    } finally {
      setBrandsLoading(false)
    }
  }, [])

  const selectBrand = useCallback(
    async (brandCode: number | null) => {
      setSelectedModel(null)
      setSelectedTrim(null)
      setModels([])
      setTrims([])
      if (brandCode == null) {
        setSelectedBrand(null)
        return
      }
      const brand = brands.find((b) => b.brandCode === brandCode) ?? null
      setSelectedBrand(brand)
      if (!brand) return
      setModelsLoading(true)
      setError(null)
      try {
        // CRM 배선: brandCode = CRM brands.id (어댑트 매핑 표 참조)
        const data = await fetchModels(brandCode)
        setModels(data.map(toMasterModel))
      } catch (e) {
        setError(String(e))
      } finally {
        setModelsLoading(false)
      }
    },
    [brands],
  )

  const selectModel = useCallback(
    async (modelCode: number | null) => {
      setSelectedTrim(null)
      setTrims([])
      if (modelCode == null || !selectedBrand) {
        setSelectedModel(null)
        return
      }
      const model = models.find((m) => m.modelCode === modelCode) ?? null
      setSelectedModel(model)
      if (!model) return
      setTrimsLoading(true)
      setError(null)
      try {
        // CRM 배선: modelCode = CRM models.id — 제프는 (brandCode, modelCode) 2키, CRM은 modelId 단일 키
        const data = await fetchTrims(modelCode)
        setTrims(data.map(toMasterTrim))
      } catch (e) {
        setError(String(e))
      } finally {
        setTrimsLoading(false)
      }
    },
    [models, selectedBrand],
  )

  const selectTrim = useCallback(
    (mcCode: string | null) => {
      if (mcCode == null) {
        setSelectedTrim(null)
        return
      }
      const trim = trims.find((t) => t.mcCode === mcCode) ?? null
      setSelectedTrim(trim)
    },
    [trims],
  )

  const reset = useCallback(() => {
    setSelectedBrand(null)
    setSelectedModel(null)
    setSelectedTrim(null)
    setModels([])
    setTrims([])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 브랜드 목록 1회 로드(제프 원형 미러) — loadBrands가 loading 플래그를 동기 세팅한다
    void loadBrands()
  }, [loadBrands])

  return {
    brands,
    models,
    trims,
    selectedBrand,
    selectedModel,
    selectedTrim,
    brandsLoading,
    modelsLoading,
    trimsLoading,
    error,
    loadBrands,
    selectBrand,
    selectModel,
    selectTrim,
    reset,
  }
}
