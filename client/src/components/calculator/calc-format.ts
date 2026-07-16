// 제프(dolim-solution) lib/residual.ts 이식(사용분: roundUpToNearestHundred).
// (spec: ref/specs/2026-07-16-crm-calculator-modal-design.md)
// 잔가 매트릭스/미리보기 계열(previewMaximumResidualRate 등)은 계산기 모달이 안 쓰므로 미이식.

// 제프 서버 대응물 = dolim-solution src/domain/shared/calc-utils.ts 의 roundUp(value, -2).
// 화면 월납입금 100원 올림 표시 규칙 — CRM `solution-ranking.ts` solutionMonthlyDisplay(운용리스 분기)와
// 같은 산술(Math.ceil(x/100)*100)이다. 파트너 응답 표시 규칙이 바뀌면 두 곳을 함께 볼 것.
export function roundUpToNearestHundred(value: number): number {
  return Math.ceil(Number(value || 0) / 100) * 100
}
