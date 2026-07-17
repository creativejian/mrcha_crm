// 제프(dolim-solution) components/vehicle/ModelPickerDialog.tsx 1:1 이식 — UI/마크업/인터랙션 원형 유지.
// CRM 배선 = import 경로만: @/types/catalog → ./catalog-types. 공용 위치(계산기·워크벤치 SSOT — plan: ref/plans/2026-07-16-crm-workbench-picker-dialog-unify.md).
// ⚠️ CRM에서 MasterModel.minPrice/maxPrice는 항상 null(목록 API 미제공 — T2 useMasterCatalog 어댑트 실측):
//   formatPriceRangeKor가 null 시 null을 반환해 가격 범위 표시는 조용히 생략된다(카테고리만 노출).
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — T3a)
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { MasterModel } from './catalog-types'

function formatPriceRangeKor(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null
  const f = (v: number) => {
    const eok = Math.floor(v / 100_000_000)
    const man = Math.floor((v % 100_000_000) / 10_000)
    if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString('ko-KR')}만원`
    if (eok > 0) return `${eok}억원`
    return `${man.toLocaleString('ko-KR')}만원`
  }
  if (min != null && max != null && min !== max) return `${f(min)} ~ ${f(max)}`
  if (min != null) return f(min)
  if (max != null) return f(max)
  return null
}

interface ModelPickerDialogProps {
  open: boolean
  models: MasterModel[]
  selectedModelCode: number | null
  loading: boolean
  brandName: string | null
  onSelect: (modelCode: number) => void
  onClose: () => void
  // 목록 로드 실패(CRM 확장 — "데이터 없음"과 구분되는 빈 상태 문구). 기본 false = 제프 원형.
  errored?: boolean
}

export function ModelPickerDialog({
  open,
  models,
  selectedModelCode,
  loading,
  brandName,
  onSelect,
  onClose,
  errored = false,
}: ModelPickerDialogProps) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 다이얼로그 닫힘 시 검색어 리셋(제프 원형 미러)
    if (!open) setQuery('')
  }, [open])

  const filtered = useMemo(() => {
    if (!query.trim()) return models
    return models.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
  }, [models, query])

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
          <h3 className="text-[0.95rem] font-semibold tracking-tight">
            {brandName ? `${brandName} · 모델 선택` : '모델 선택'}
          </h3>
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
            placeholder="모델 검색"
            className="form-input w-full text-[0.85rem]"
          />
        </div>

        <div className="overflow-y-auto px-4 pb-4 flex flex-col gap-1.5">
          {loading && (
            <div className="py-8 text-center text-[0.78rem] text-muted-foreground">불러오는 중…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="py-8 text-center text-[0.78rem] text-muted-foreground">
              {errored ? '불러오지 못했습니다' : query ? '검색 결과가 없습니다' : '모델이 없습니다'}
            </div>
          )}
          {!loading &&
            filtered.map((m) => {
              const range = formatPriceRangeKor(m.minPrice, m.maxPrice)
              const isSelected = m.modelCode === selectedModelCode
              return (
                <button
                  key={m.modelCode}
                  type="button"
                  onClick={() => onSelect(m.modelCode)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/[0.06]'
                      : 'border-border bg-card hover:bg-muted/40'
                  }`}
                >
                  <div className="w-16 h-10 rounded-md bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
                    {m.imageUrl ? (
                      <img
                        src={m.imageUrl}
                        alt={m.name}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-[0.6rem] text-muted-foreground">차량</span>
                    )}
                  </div>
                  <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-[0.88rem] font-medium tracking-tight truncate">{m.name}</span>
                    <span className="text-[0.7rem] text-muted-foreground tracking-tight truncate">
                      {[m.category, range].filter(Boolean).join(' · ') || ' '}
                    </span>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </button>
              )
            })}
        </div>
      </div>
    </div>
  )
}
