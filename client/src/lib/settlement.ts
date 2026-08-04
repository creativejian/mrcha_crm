// 정산 파생 계산(2026-08-04 이사님 확정) — 순수 함수만 둔다. 서버(`src/`)도 이 파일을 직접
// import한다(부작용 0 순수 클라 lib 경계 — AGENTS.md "서버→클라 순수 모듈 import 경계").
// 화면과 서버가 같은 산식을 쓰게 하려는 것이다: 마진이 두 곳에서 따로 계산되면 조용히 갈라진다.
// spec: ref/specs/2026-08-03-crm-delivery-revenue-design.md §6
import type { SettlementCost } from "@/data/customers";

/**
 * 비용 합계(원). **페이백도 그냥 더한다** — 고객에게 돌려준 돈이라 회사 마진을 줄이는 방향이
 * 맞다(이사님 확정). 부호를 뒤집어 빼면 마진이 실제보다 커져서 손실이 이익으로 보인다.
 */
export function sumSettlementCosts(costs: SettlementCost[]): number {
  return costs.reduce((sum, c) => sum + c.amount, 0);
}

/**
 * 마진(원) = 실입금액 − 비용합.
 * - `feeAmount`가 null이면 **null을 낸다**(0이 아니다) — 0으로 내면 "마진 0원"과 "아직 모른다"가
 *   화면에서 구분되지 않는다.
 * - 비용이 실입금액을 넘으면 **음수를 그대로 낸다**(0으로 깎지 않는다) — 역마진은 실제로 생길 수
 *   있는 상태이고, 숨기면 화면이 손실을 감춘다.
 */
export function settlementMargin(feeAmount: number | null, costs: SettlementCost[]): number | null {
  if (feeAmount == null) return null;
  return feeAmount - sumSettlementCosts(costs);
}
