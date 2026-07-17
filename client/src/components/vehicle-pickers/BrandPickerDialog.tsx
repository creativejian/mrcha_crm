// 제프(dolim-solution) components/vehicle/BrandPickerDialog.tsx 1:1 이식 — UI/마크업/인터랙션 원형 유지.
// CRM 배선 = import 경로만: @/types/catalog → ./catalog-types. 공용 위치(계산기·워크벤치 SSOT — plan: ref/plans/2026-07-16-crm-workbench-picker-dialog-unify.md). 로고는 /brand-logos/*.png(33종 복사 완료 — T0).
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — T3a)
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { MasterBrand } from './catalog-types'

// master.brands.name (Korean) → logo file name in public/brand-logos/
const LOGO_BY_NAME: Record<string, string> = {
  '현대': 'hyundai',
  '기아': 'kia',
  '제네시스': 'genesis',
  'KGM': 'kgm',
  '르노코리아': 'renault',
  '쉐보레': 'chevrolet',
  'BMW': 'bmw',
  '벤츠': 'benz',
  '아우디': 'audi',
  '볼보': 'volvo',
  '렉서스': 'lexus',
  '토요타': 'toyota',
  '혼다': 'honda',
  '테슬라': 'tesla',
  'BYD': 'byd',
  '폴스타': 'polestar',
  '미니': 'mini',
  '폭스바겐': 'volkswagen',
  '포르쉐': 'porsche',
  '랜드로버': 'landrover',
  '지프': 'jeep',
  '포드': 'ford',
  '링컨': 'lincoln',
  '캐딜락': 'cadillac',
  'GMC': 'gmc',
  '푸조': 'peugeot',
  '마세라티': 'maserati',
  '벤틀리': 'bentley',
  '롤스로이스': 'rolls-royce',
  '페라리': 'ferrari',
  '람보르기니': 'lamborghini',
  '맥라렌': 'mclaren',
  '애스턴마틴': 'astonmartin',
}

// eslint-disable-next-line react-refresh/only-export-components -- 제프 원형 유지: brandLogoUrl은 TopSelectionCards가 함께 소비(HMR 전용 경고, 빌드/런타임 무관)
export function brandLogoUrl(name: string): string | null {
  const slug = LOGO_BY_NAME[name]
  return slug ? `/brand-logos/${slug}.png` : null
}

interface BrandPickerDialogProps {
  open: boolean
  brands: MasterBrand[]
  selectedBrandCode: number | null
  onSelect: (brandCode: number) => void
  onClose: () => void
  // 목록 로드 실패(CRM 확장 — "데이터 없음"과 구분되는 빈 상태 문구). 기본 false = 제프 원형.
  errored?: boolean
}

export function BrandPickerDialog({
  open,
  brands,
  selectedBrandCode,
  onSelect,
  onClose,
  errored = false,
}: BrandPickerDialogProps) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 다이얼로그 닫힘 시 검색어 리셋(제프 원형 미러)
    if (!open) setQuery('')
  }, [open])

  // Backend returns every brand with at least one matched offering, sorted
  // by master.sort_order ASC. We split into 국산차 (is_domestic=true) and
  // 수입차 (is_domestic=false). 인기 수입차 sub-grouping is intentionally
  // dropped — single foreign-brand list ordered by sort_order.
  const groups = useMemo(() => {
    const filtered = query.trim()
      ? brands.filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
      : brands
    return {
      domestic: filtered.filter((b) => b.isDomestic),
      foreign: filtered.filter((b) => !b.isDomestic),
    }
  }, [brands, query])

  if (!open) return null

  return (
    <div
      /* jeff-ui = 공용 스코프 루트(calculator.css) — 워크벤치 등 계산기 밖 컨텍스트에서도 토큰·가드 성립 */
      className="jeff-ui fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-[1.5rem] border border-border shadow-[var(--shadow-elev-3)] w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-[0.95rem] font-semibold tracking-tight">브랜드 선택</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색"
            className="form-input w-full text-[0.85rem]"
          />
        </div>

        <div className="overflow-y-auto px-4 pb-4 flex flex-col gap-4">
          {groups.domestic.length === 0 && groups.foreign.length === 0 && (
            <div className="py-8 text-center text-[0.78rem] text-muted-foreground">
              {errored ? '불러오지 못했습니다' : '검색 결과가 없습니다'}
            </div>
          )}
          {groups.domestic.length > 0 && (
            <BrandGroup
              label="국산차"
              brands={groups.domestic}
              selectedBrandCode={selectedBrandCode}
              onSelect={onSelect}
            />
          )}
          {groups.foreign.length > 0 && (
            <BrandGroup
              label="수입차"
              brands={groups.foreign}
              selectedBrandCode={selectedBrandCode}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function BrandGroup({
  label,
  brands,
  selectedBrandCode,
  onSelect,
}: {
  label: string
  brands: MasterBrand[]
  selectedBrandCode: number | null
  onSelect: (brandCode: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[0.7rem] font-medium uppercase tracking-[0.06em] text-muted-foreground/80">
        {label}
      </div>
      <div className="flex flex-col gap-1.5">
        {brands.map((b) => {
          const logo = brandLogoUrl(b.name)
          const isSelected = b.brandCode === selectedBrandCode
          return (
            <button
              key={b.brandCode}
              type="button"
              onClick={() => onSelect(b.brandCode)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                isSelected
                  ? 'border-accent bg-accent/[0.06]'
                  : 'border-border bg-card hover:bg-muted/40'
              }`}
            >
              <div className="w-8 h-8 rounded-md bg-muted/60 flex items-center justify-center overflow-hidden shrink-0">
                {logo ? (
                  <img src={logo} alt={b.name} className="w-7 h-7 object-contain" loading="lazy" />
                ) : (
                  <span className="text-[0.65rem] text-muted-foreground">{b.name.slice(0, 2)}</span>
                )}
              </div>
              <span className="text-[0.88rem] font-medium tracking-tight flex-1">{b.name}</span>
              <ChevronRight size={14} className="text-muted-foreground" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
