// 제프(dolim-solution) components/vehicle/ColorPickerDialog.tsx 1:1 이식 — UI/마크업/인터랙션 원형 유지.
// CRM 배선 = import 경로만: @/types/catalog → ../catalog-types.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — T3a)
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { TrimColor } from '../catalog-types'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  colors: TrimColor[]
  selectedId: number | null
  onApply: (id: number | null) => void
}

export function ColorPickerDialog({
  open,
  onClose,
  title,
  colors,
  selectedId,
  onApply,
}: Props) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 다이얼로그 닫힘 시 검색어 리셋(제프 원형 미러)
    if (!open) setQuery('')
  }, [open])

  const filtered = useMemo(() => {
    if (!query.trim()) return colors
    const q = query.toLowerCase()
    return colors.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q),
    )
  }, [colors, query])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-[1.5rem] border border-border shadow-[var(--shadow-elev-3)] w-full max-w-md"
        style={{ maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background px-5 py-4 border-b border-border flex items-center justify-between rounded-t-[1.5rem]">
          <h3 className="text-[0.95rem] font-semibold tracking-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground"
          >
            <X size={14} />
          </button>
        </div>

        {colors.length > 5 && (
          <div className="sticky top-[57px] z-10 bg-background px-4 pt-3 pb-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="색상 검색"
              className="form-input w-full text-[0.85rem]"
            />
          </div>
        )}

        <div className="px-4 pb-4 pt-2 flex flex-col gap-1.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[0.78rem] text-muted-foreground">
              {query ? '검색 결과가 없습니다' : '색상 데이터가 없습니다'}
            </div>
          ) : (
            filtered.map((c) => {
              const isSelected = c.id === selectedId
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onApply(isSelected ? null : c.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/[0.06]'
                      : 'border-border bg-card hover:bg-muted/40'
                  }`}
                >
                  <span
                    className="w-7 h-7 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: c.hexValue ?? '#E5E7EB' }}
                  />
                  <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-[0.88rem] font-medium tracking-tight truncate">{c.name}</span>
                    {c.code && (
                      <span className="text-[0.7rem] text-muted-foreground tracking-tight truncate mt-0.5">
                        {c.code}
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
