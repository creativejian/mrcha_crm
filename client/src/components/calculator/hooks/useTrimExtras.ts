// 제프(dolim-solution) hooks/useTrimOptions.ts + useTrimColors.ts 통합 이식 — 반환 계약은 제프
// 두 훅의 원형({basic,tuning,relations,noOptions,…} / {exterior,interior,…})을 그대로 두 객체로 분리 유지,
// 데이터 소스만 CRM fetchWorkbenchVehicle(trimId) 1콜(옵션+컬러 동시 응답)로 배선.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — 배선 교체 표)
//
// 제프 원형과 달라진 점: 키가 mcCode(string) → trimId(number — CRM trims.id, plan 핀).
// trimId null이면 즉시 클리어(제프 mcCode null 동작 미러), 변경 시 직전 결과를 비우고 새 fetch.
//
// ── CRM WorkbenchVehicle.trimDetail → 제프 두 계약 분해 매핑 ──
// options.basic/tuning ← trimDetail.options를 type("basic"|"tuning")으로 분리, {id,name,price}만 투영
// options.relations    ← trimDetail.optionRelations {optionId,relatedOptionId,type} 투영(CRM 여분 id 제거)
// options.noOptions    ← trimDetail.noOptions != null (CRM = {note,checkedAt}|null, 제프 = boolean)
// colors.exterior/interior ← trimDetail.colors를 colorType으로 분리, {id,name,code,hexValue,sortOrder} 투영
import { useEffect, useState } from 'react'
import { HttpError } from '@/lib/http'
import { fetchWorkbenchVehicle } from '@/lib/vehicles'
import type { TrimColor, TrimOption, TrimOptionRelation } from '../catalog-types'

export interface UseTrimOptionsState {
  basic: TrimOption[]
  tuning: TrimOption[]
  noOptions: boolean
  relations: TrimOptionRelation[]
  loading: boolean
  error: string | null
  loaded: boolean   // 한 번이라도 fetch 시도가 끝났는지
}

export interface UseTrimColorsState {
  exterior: TrimColor[]
  interior: TrimColor[]
  loading: boolean
  error: string | null
  loaded: boolean
}

const EMPTY_OPTIONS: UseTrimOptionsState = {
  basic: [],
  tuning: [],
  noOptions: false,
  relations: [],
  loading: false,
  error: null,
  loaded: false,
}

const EMPTY_COLORS: UseTrimColorsState = {
  exterior: [],
  interior: [],
  loading: false,
  error: null,
  loaded: false,
}

export function useTrimExtras(trimId: number | null): {
  options: UseTrimOptionsState
  colors: UseTrimColorsState
} {
  const [options, setOptions] = useState<UseTrimOptionsState>(EMPTY_OPTIONS)
  const [colors, setColors] = useState<UseTrimColorsState>(EMPTY_COLORS)

  useEffect(() => {
    if (trimId == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 트림 해제/전환 시 직전 트림 결과 즉시 클리어(제프 mcCode null 동작 미러 — 잔상 방지)
      setOptions(EMPTY_OPTIONS)
      setColors(EMPTY_COLORS)
      return
    }
    let cancelled = false
    // 트림 전환 시 직전 트림 결과를 비우고 loading 진입(제프 미러)
    setOptions({ ...EMPTY_OPTIONS, loading: true })
    setColors({ ...EMPTY_COLORS, loading: true })
    fetchWorkbenchVehicle(trimId)
      .then((data) => {
        if (cancelled) return
        const detail = data.trimDetail
        setOptions({
          basic: detail.options
            .filter((o) => o.type === 'basic')
            .map(({ id, name, price }) => ({ id, name, price })),
          tuning: detail.options
            .filter((o) => o.type === 'tuning')
            .map(({ id, name, price }) => ({ id, name, price })),
          noOptions: detail.noOptions != null,
          relations: detail.optionRelations.map(({ optionId, relatedOptionId, type }) => ({
            optionId,
            relatedOptionId,
            type,
          })),
          loading: false,
          error: null,
          loaded: true,
        })
        setColors({
          exterior: detail.colors
            .filter((c) => c.colorType === 'exterior')
            .map(({ id, name, code, hexValue, sortOrder }) => ({ id, name, code, hexValue, sortOrder })),
          interior: detail.colors
            .filter((c) => c.colorType === 'interior')
            .map(({ id, name, code, hexValue, sortOrder }) => ({ id, name, code, hexValue, sortOrder })),
          loading: false,
          error: null,
          loaded: true,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // 404(트림 미존재)는 옵션/컬러 없음으로 간주 — 제프 msg.includes('404') 판별의 CRM형(HttpError.status).
        const isNotFound = err instanceof HttpError && err.status === 404
        const msg = err instanceof Error ? err.message : String(err)
        const error = isNotFound ? null : msg
        setOptions({ ...EMPTY_OPTIONS, error, loaded: true })
        setColors({ ...EMPTY_COLORS, error, loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [trimId])

  return { options, colors }
}
