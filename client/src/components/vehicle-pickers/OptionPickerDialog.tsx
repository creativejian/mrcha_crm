// 제프(dolim-solution) components/vehicle/OptionPickerDialog.tsx 이식 — UI/마크업/인터랙션 원형 유지.
// CRM 배선 = import 경로: @/types/catalog → ./catalog-types. 공용 위치(계산기·워크벤치 SSOT — plan: ref/plans/2026-07-16-crm-workbench-picker-dialog-unify.md).
// CRM 확장 2건(원형 대비 의도적 이탈):
//   ①로컬 시딩 = 닫힘→열림 전이 1회 — 열려 있는 동안 부모 재렌더(selectedIds identity 변경)가
//     로컬 편집을 되덮지 않는다(워크벤치는 input 버블만으로 부모가 재렌더되는 DOM 구조).
//   ②enforceIncludes opt-in — 켤 때 includes 상대 자동 ON(단방향·한 단계, lib/option-selection
//     resolveSelection). 워크벤치만 true — 계산기는 제프 원형 미강제(기본 false).
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — T3a)
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { resolveSelection } from '@/lib/option-selection'
import type { TrimOption, TrimOptionRelation } from './catalog-types'

interface Props {
  open: boolean
  onClose: () => void
  basic: TrimOption[]
  tuning: TrimOption[]
  relations: TrimOptionRelation[]
  selectedIds: Set<number>
  onApply: (ids: Set<number>) => void
  trimDisplayName: string
  // 켤 때 includes 상대 자동 ON(구 워크벤치 OptionPicker 계약 — 스펙 2026-06-15). 기본 false = 제프 원형.
  enforceIncludes?: boolean
}

const fmtKrw = (n: number | null) =>
  n == null ? '─' : `+${n.toLocaleString('ko-KR')}원`

export function OptionPickerDialog({
  open,
  onClose,
  basic,
  tuning,
  relations,
  selectedIds,
  onApply,
  trimDisplayName,
  enforceIncludes = false,
}: Props) {
  const [local, setLocal] = useState<Set<number>>(new Set())
  const wasOpenRef = useRef(false)

  useEffect(() => {
    // 닫힘→열림 전이에서만 부모 선택값을 로컬 편집 상태로 시드(제프 원형 "열림 시점 시드" 의미론 — 취소 시 부모 불변).
    // 열려 있는 동안 selectedIds identity가 바뀌어도(부모 재렌더) 로컬 편집을 되덮지 않는다.
    if (open && !wasOpenRef.current) setLocal(new Set(selectedIds))
    wasOpenRef.current = open
  }, [open, selectedIds])

  // 선택된 옵션과 excludes 관계인 옵션들을 비활성화.
  const disabledIds = useMemo(() => {
    const out = new Set<number>()
    for (const s of local) {
      for (const r of relations) {
        if (r.type !== 'excludes') continue
        if (r.optionId === s) out.add(r.relatedOptionId)
        else if (r.relatedOptionId === s) out.add(r.optionId)
      }
    }
    return out
  }, [local, relations])

  // 옵션이 어떤 옵션 때문에 excludes 인지 추적 (tooltip 표시용).
  const blockerNameById = useMemo(() => {
    const all = [...basic, ...tuning]
    const byId = new Map(all.map((o) => [o.id, o.name] as const))
    const out = new Map<number, string>()
    for (const s of local) {
      for (const r of relations) {
        if (r.type !== 'excludes') continue
        const other = r.optionId === s ? r.relatedOptionId : r.relatedOptionId === s ? r.optionId : null
        if (other != null && !out.has(other)) {
          out.set(other, byId.get(s) ?? '')
        }
      }
    }
    return out
  }, [local, relations, basic, tuning])

  // includes 관계 — UI 캡션용 (옵션 → 함께 포함되는 옵션명 목록).
  const includesById = useMemo(() => {
    const all = [...basic, ...tuning]
    const byId = new Map(all.map((o) => [o.id, o.name] as const))
    const out = new Map<number, string[]>()
    for (const r of relations) {
      if (r.type !== 'includes') continue
      const list = out.get(r.optionId) ?? []
      const name = byId.get(r.relatedOptionId)
      if (name) list.push(name)
      out.set(r.optionId, list)
    }
    return out
  }, [relations, basic, tuning])

  const total = useMemo(() => {
    let sum = 0
    for (const o of [...basic, ...tuning]) {
      if (local.has(o.id)) sum += o.price ?? 0
    }
    return sum
  }, [local, basic, tuning])

  const toggle = (id: number) => {
    if (disabledIds.has(id) && !local.has(id)) return
    if (enforceIncludes) {
      // 켤 때 includes 상대 자동 ON(끌 때 연쇄 해제 없음 — resolveSelection off = 단순 삭제).
      // 자동 ON된 옵션의 excludes 상대는 disabledIds가 local 파생이라 함께 비활성화된다.
      setLocal(resolveSelection(relations, local, id, !local.has(id)))
      return
    }
    const next = new Set(local)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setLocal(next)
  }

  if (!open) return null

  const renderSection = (label: string, list: TrimOption[]) => (
    <div className="mb-6 last:mb-0">
      <h4 className="text-[13px] font-semibold text-gray-700 mb-2">
        {label} <span className="text-gray-400 font-normal">({list.length}개)</span>
      </h4>
      {list.length === 0 ? (
        <p className="text-[12px] text-gray-400 px-2">없음</p>
      ) : (
        <ul className="space-y-1">
          {list.map((o) => {
            const disabled = disabledIds.has(o.id) && !local.has(o.id)
            const checked = local.has(o.id)
            const blocker = blockerNameById.get(o.id)
            const includes = includesById.get(o.id) ?? []
            return (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(o.id)}
                  title={disabled && blocker ? `${blocker}와(과) 함께 선택할 수 없습니다` : undefined}
                  className={[
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-[13px] transition',
                    disabled
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-gray-50 cursor-pointer',
                    checked ? 'bg-blue-50' : '',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={checked}
                    disabled={disabled}
                    className="h-4 w-4 accent-blue-600"
                  />
                  <span className="flex-1 truncate">{o.name}</span>
                  <span className="font-mono tabular-nums text-gray-700">{fmtKrw(o.price)}</span>
                </button>
                {includes.length > 0 && (
                  <p className="ml-10 text-[11px] text-gray-400 mt-0.5">↳ {includes.join(', ')} 포함</p>
                )}
                {disabled && blocker && (
                  <p className="ml-10 text-[11px] text-amber-600 mt-0.5">↳ {blocker}와(과) 함께 선택 불가</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  const isEmpty = basic.length === 0 && tuning.length === 0

  return (
    <div
      /* jeff-ui = 공용 스코프 루트(calculator.css) — 워크벤치 등 계산기 밖 컨텍스트에서도 토큰·가드 성립 */
      className="jeff-ui fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div>
            <h3 className="text-[14px] font-semibold text-gray-900">옵션 선택</h3>
            <p className="text-[12px] text-gray-500 truncate max-w-[380px]">{trimDisplayName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isEmpty ? (
            <p className="text-[13px] text-gray-500 text-center py-10">이 차량은 추가 옵션이 없습니다.</p>
          ) : (
            <>
              {renderSection('기본 옵션', basic)}
              {renderSection('튜닝 옵션', tuning)}
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
          <p className="text-[13px] text-gray-700">
            선택 합계: <span className="font-mono tabular-nums font-semibold">{total.toLocaleString('ko-KR')}원</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-[13px] text-gray-600 hover:bg-gray-100 rounded-md"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(local)
                onClose()
              }}
              className="px-4 py-1.5 text-[13px] bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              적용
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
