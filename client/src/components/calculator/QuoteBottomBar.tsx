// 제프(dolim-solution) components/quote-bottom-bar/QuoteBottomBar.tsx 이식.
// 변경 1: left-[220px](제프 사이드바 폭 기준) → left-0 — CRM은 전체화면 모달 안이라 사이드바 오프셋 없음(T4).
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md)
import { RotateCcw, FileText } from 'lucide-react'

export interface QuoteBottomBarProps {
  selectedCount: number
  onReset: () => void
  onCheckout: () => void
}

export function QuoteBottomBar({ selectedCount, onReset, onCheckout }: QuoteBottomBarProps) {
  const hasSelection = selectedCount > 0
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-8 py-3 flex items-center justify-end gap-3 z-[401]">
      <button
        onClick={onReset}
        className="flex items-center gap-2 px-4 py-2 text-[14px]/[20px] text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
        초기화
      </button>
      <button
        disabled={!hasSelection}
        onClick={hasSelection ? onCheckout : undefined}
        className={`flex items-center gap-2 px-5 py-2 text-[14px]/[20px] rounded-lg transition-colors ${
          hasSelection
            ? 'text-white bg-blue-500 hover:bg-blue-600 cursor-pointer'
            : 'text-gray-400 bg-gray-200 cursor-not-allowed'
        }`}
      >
        <FileText className="w-4 h-4" />
        견적서 보기
        {hasSelection && <span className="ml-1 text-xs">({selectedCount})</span>}
      </button>
    </div>
  )
}
