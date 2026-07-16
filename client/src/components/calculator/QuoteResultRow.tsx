// 제프(dolim-solution) components/results/QuoteResultRow.tsx 1:1 이식 —
// LENDER_META·SupportedLenderCode import만 ./lender-meta(CRM 어휘 SSOT 파생)로 교체.
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md — 배선 교체 표)
import { AlertTriangle } from 'lucide-react'
import { LENDER_META, type SupportedLenderCode } from './lender-meta'

export interface QuoteResultRowProps {
  rank: number
  lenderCode: SupportedLenderCode
  monthlyPayment: number
  interestRate: number
  residualAmount: number
  residualPercent: number
  totalCost: number
  warnings: string[]
  isSelected: boolean
  isLowestMonthly: boolean
  isLowestRate: boolean
  isHighestResidual: boolean
  isLowestTotal: boolean
  priceDifference: number
  onClick: () => void
}

export function QuoteResultRow(props: QuoteResultRowProps) {
  const {
    rank,
    lenderCode,
    monthlyPayment,
    interestRate,
    residualAmount,
    residualPercent,
    totalCost,
    warnings,
    isSelected,
    isLowestMonthly,
    isLowestRate,
    isHighestResidual,
    isLowestTotal,
    priceDifference,
    onClick,
  } = props

  const meta = LENDER_META[lenderCode]
  const badges: Array<{ label: string; color: string }> = []
  if (isLowestMonthly) badges.push({ label: '최저 월납입', color: 'bg-red-100 text-red-600' })
  if (isLowestRate) badges.push({ label: '최저 금리', color: 'bg-green-100 text-green-600' })
  if (isHighestResidual) badges.push({ label: '최대 잔존가치', color: 'bg-gray-200 text-gray-600' })
  if (isLowestTotal) badges.push({ label: '최저 총 비용', color: 'bg-green-100 text-green-600' })

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onClick()
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      className={`relative p-3 rounded cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 ${
        isSelected ? 'bg-blue-50 shadow-lg' : 'bg-white shadow-md hover:shadow-lg hover:-translate-y-1'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold flex-shrink-0 ${
              isSelected ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'
            }`}
          >
            {rank}
          </span>
          {badges.map((badge, idx) => (
            <span key={idx} className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${badge.color}`}>
              {badge.label}
            </span>
          ))}
        </div>
        {priceDifference > 0 && (
          <div className="text-[11px] text-red-500 font-medium">+{priceDifference.toLocaleString()}</div>
        )}
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <img src={meta.logo} alt={meta.name} className="w-8 h-8 object-contain flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-900">{meta.name}</span>
          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-medium rounded">
            {interestRate.toFixed(2)}%
          </span>
          {warnings.length > 0 && (
            <span title={warnings.join('\n')} className="text-amber-500 cursor-help">
              <AlertTriangle className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
        <div className="text-right">
          <span className="inline-flex items-center">
            <span className="text-lg font-bold text-gray-900 font-mono tabular-nums">
              {monthlyPayment.toLocaleString()}
            </span>
            <span className="text-xs text-gray-500 ml-1">원</span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        <div>
          <span>잔존가치 </span>
          <span className="text-gray-700 font-medium font-mono tabular-nums">
            {residualAmount.toLocaleString()}원 ({residualPercent.toFixed(1)}%)
          </span>
        </div>
        <span className="text-gray-300">|</span>
        <div>
          <span>총 비용 </span>
          <span className="text-gray-700 font-medium font-mono tabular-nums">
            {totalCost.toLocaleString()}원
          </span>
        </div>
      </div>
    </div>
  )
}
