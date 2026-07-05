// 견적의 "대표 시나리오" 선택 규칙 SSOT — primary_scenario_id 일치 우선, 없으면 첫 요소(호출부가
// scenario_no asc 정렬을 보장해야 한다), 빈 목록이면 null. 발송 payload 조립(customer-quotes)·
// 증분 임베딩 로더(embed-sources)·백필 스크립트가 공유한다 — 규칙 변경 시 세 소비처가 자동 추종.
export function pickPrimaryScenario<T extends { id: string }>(
  scenarios: T[],
  primaryScenarioId: string | null,
): T | null {
  return scenarios.find((s) => s.id === primaryScenarioId) ?? scenarios[0] ?? null;
}
