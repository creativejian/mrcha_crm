// 제프(dolim-solution) components/vehicle/TrimPickerDialog.tsx 1:1 이식 — UI/마크업/인터랙션 원형 유지.
// CRM 배선 = import 경로만: @/types/catalog → ./catalog-types. 공용 위치(계산기·워크벤치 SSOT — plan: ref/plans/2026-07-16-crm-workbench-picker-dialog-unify.md).
// CRM에서 mcCode 없는 트림은 T2 어댑트가 placeholder(`crm-trim-{id}`) + quotable=false로 채운다 —
//   여기 disabled 처리("잔가 데이터 없음" 배지)가 그대로 선택을 막아 placeholder가 payload로 새지 않는다.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — T3a)
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { MasterTrim } from './catalog-types'

function formatPriceKor(v: number): string {
  if (!v || v <= 0) return ''
  const eok = Math.floor(v / 100_000_000)
  const man = Math.floor((v % 100_000_000) / 10_000)
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString('ko-KR')}만원`
  if (eok > 0) return `${eok}억원`
  return `${man.toLocaleString('ko-KR')}만원`
}

// Domestic master trim names follow "{group} - {trim}" — e.g.
// "26년형 가솔린 1.6 하이브리드 - 모던 라이트". Split on the first " - " and use
// the prefix as the accordion group header, the suffix as the trim row label.
function splitNameOnDash(raw: string): { group: string; trim: string } {
  const idx = raw.indexOf(' - ')
  if (idx === -1) return { group: raw.trim(), trim: raw.trim() }
  return {
    group: raw.slice(0, idx).trim(),
    trim: raw.slice(idx + 3).trim(),
  }
}

function buildGroupKey(trim: MasterTrim): {
  key: string
  label: string
  sortIndex: number
} {
  const source = trim.canonicalName ?? trim.name
  const { group } = splitNameOnDash(source)
  return {
    key: group,
    label: group,
    sortIndex: -(trim.modelYear ?? 0),
  }
}

interface TrimPickerDialogProps {
  open: boolean
  trims: MasterTrim[]
  selectedMcCode: string | null
  loading: boolean
  brandName?: string | null
  modelName: string | null
  accordion?: boolean
  onSelect: (mcCode: string) => void
  onClose: () => void
  // 목록 로드 실패(CRM 확장 — "데이터 없음"과 구분되는 빈 상태 문구). 기본 false = 제프 원형.
  errored?: boolean
}

export function TrimPickerDialog({
  open,
  trims,
  selectedMcCode,
  loading,
  brandName,
  modelName,
  accordion = false,
  onSelect,
  onClose,
  errored = false,
}: TrimPickerDialogProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 다이얼로그 닫힘 시 검색어·아코디언 펼침 상태 리셋(제프 원형 미러)
      setQuery('')
      setExpanded(new Set())
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!query.trim()) return trims
    const q = query.toLowerCase()
    return trims.filter((t) => {
      const label = (t.trimName ?? t.name).toLowerCase()
      return label.includes(q)
    })
  }, [trims, query])

  const groups = useMemo(() => {
    if (!accordion) return []
    const map = new Map<
      string,
      { label: string; sortIndex: number; firstSeen: number; trims: MasterTrim[] }
    >()
    filtered.forEach((t, idx) => {
      const g = buildGroupKey(t)
      if (!map.has(g.key)) {
        map.set(g.key, {
          label: g.label,
          sortIndex: g.sortIndex,
          firstSeen: idx,
          trims: [],
        })
      }
      map.get(g.key)!.trims.push(t)
    })
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => {
        if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex
        return a.firstSeen - b.firstSeen
      })
  }, [accordion, filtered])

  // When the user types a search query, auto-expand all groups so matches
  // are visible. When the query is cleared, collapse back to the user's
  // manual state by resetting to empty.
  useEffect(() => {
    if (!accordion) return
    if (query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 검색어 입력 시 전 그룹 자동 펼침(제프 원형 미러 — 매치 가시화)
      setExpanded(new Set(groups.map((g) => g.key)))
    }
  }, [accordion, query, groups])

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!open) return null

  const renderTrimRow = (t: MasterTrim) => {
    const source = t.canonicalName ?? t.name
    const dashSuffix = accordion ? splitNameOnDash(source).trim : null
    const label = dashSuffix && dashSuffix.length > 0
      ? dashSuffix
      : (t.trimName ?? source.slice(0, 60))
    const isSelected = t.mcCode === selectedMcCode
    const disabled = !t.quotable
    const meta = [
      t.modelYear ? `${t.modelYear}년형` : null,
      t.fuelType ?? null,
      t.driveSystem ?? null,
      t.price > 0 ? formatPriceKor(t.price) : null,
    ].filter(Boolean).join(' · ')
    return (
      <button
        key={t.mcCode}
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) onSelect(t.mcCode) }}
        className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
          disabled
            ? 'border-border bg-muted/20 opacity-60 cursor-not-allowed'
            : isSelected
            ? 'border-accent bg-accent/[0.06]'
            : 'border-border bg-card hover:bg-muted/40'
        }`}
      >
        <div className="flex-1 flex flex-col min-w-0">
          <span className="text-[0.88rem] font-medium tracking-tight truncate">{label}</span>
          {(brandName || modelName) && (
            <span className="text-[0.7rem] text-muted-foreground tracking-tight truncate mt-0.5">
              {[brandName, modelName].filter(Boolean).join(' ')}
            </span>
          )}
          {meta && (
            <span className="text-[0.7rem] text-muted-foreground tracking-tight truncate mt-0.5">{meta}</span>
          )}
        </div>
        {disabled ? (
          <span className="text-[0.62rem] font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200/70 shrink-0">
            잔가 데이터 없음
          </span>
        ) : !accordion ? (
          <ChevronRight size={14} className="text-muted-foreground shrink-0 mt-1" />
        ) : null}
      </button>
    )
  }

  return (
    <div
      /* jeff-ui = 공용 스코프 루트(calculator.css) — 워크벤치 등 계산기 밖 컨텍스트에서도 토큰·가드 성립 */
      className="jeff-ui fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-[1.5rem] border border-border shadow-[var(--shadow-elev-3)] w-full max-w-md"
        style={{ maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background px-5 py-4 border-b border-border flex items-center justify-between rounded-t-[1.5rem]">
          <h3 className="text-[0.95rem] font-semibold tracking-tight">
            {modelName ? `${modelName} · 트림 선택` : '트림 선택'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="sticky top-[57px] z-10 bg-background px-4 pt-3 pb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="트림 검색"
            className="form-input w-full text-[0.85rem]"
          />
        </div>

        <div className="px-4 pb-4 flex flex-col gap-1.5">
          {loading && (
            <div className="py-8 text-center text-[0.78rem] text-muted-foreground">불러오는 중…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="py-8 text-center text-[0.78rem] text-muted-foreground">
              {errored ? '불러오지 못했습니다' : query ? '검색 결과가 없습니다' : '트림이 없습니다'}
            </div>
          )}

          {!loading && accordion && filtered.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border bg-card">
              {groups.map((g) => {
                const opened = expanded.has(g.key)
                return (
                  <div key={g.key}>
                    <button
                      type="button"
                      onClick={() => toggle(g.key)}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-[0.88rem] font-semibold tracking-tight text-foreground truncate">
                          {g.label}
                        </span>
                        <span className="text-[0.68rem] text-muted-foreground tracking-tight mt-0.5">
                          {g.trims.length}개 트림
                        </span>
                      </div>
                      <ChevronDown
                        size={15}
                        className={`text-muted-foreground shrink-0 transition-transform ${opened ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {opened && (
                      <div className="bg-muted/15 px-2.5 py-2 flex flex-col gap-1.5">
                        {g.trims.map(renderTrimRow)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!loading && !accordion && filtered.map(renderTrimRow)}
        </div>
      </div>
    </div>
  )
}
