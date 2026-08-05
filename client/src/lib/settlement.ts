// 정산 파생 계산(2026-08-04 이사님 확정) — 순수 함수만 둔다. 서버(`src/`)도 이 파일을 직접
// import한다(부작용 0 순수 클라 lib 경계 — AGENTS.md "서버→클라 순수 모듈 import 경계").
// 화면과 서버가 같은 산식을 쓰게 하려는 것이다: 마진이 두 곳에서 따로 계산되면 조용히 갈라진다.
// spec: ref/specs/2026-08-03-crm-delivery-revenue-design.md §6
import type { SettlementCost, SettlementCostKind } from "@/data/customers";

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

/**
 * 목록 셀용 금액 표기(2026-08-05 정산 목록 컬럼). `null`이면 **"—"** — 0원과 "모른다"를 구분한다
 * (팝오버 마진 표기와 같은 규칙). 단위는 붙이지 않는다: 목록은 열 머리에 이미 의미가 있고,
 * 좁은 칸에 "원"까지 넣으면 자릿수가 밀린다.
 */
export function formatSettlementAmount(amount: number | null): string {
  return amount == null ? "—" : amount.toLocaleString("ko-KR");
}

/** 화면에서 편집 중인 비용 행 — 금액이 **문자열**인 것이 차이다(입력 중 콤마·빈 칸 허용). */
export type SettlementCostDraft = { kind: SettlementCostKind; label: string | null; amountText: string };

export type ResolveCostsResult = { kind: "ok"; costs: SettlementCost[] } | { kind: "invalid"; reason: string };

/**
 * 편집 중인 비용 행들을 저장 body로 바꾼다. 서버 zod가 최종 게이트지만 여기서 걸러야 사용자가
 * 즉시 사유를 본다(400 응답의 일반 문구보다 정확하다).
 * - **빈 금액 행은 버린다** — "추가"만 누르고 안 채운 행을 0원으로 저장하면 정산 화면에 0원 항목이 쌓인다.
 * - **고정 항목의 라벨은 버린다** — 직접입력으로 이름을 쓰다가 종류를 바꾼 흔적이 남으면 서버가 400을 낸다.
 * - 직접입력인데 이름이 비면 거부 — 나중에 "이 15만원이 뭐였지"가 된다.
 */
export function resolveSettlementCosts(drafts: SettlementCostDraft[]): ResolveCostsResult {
  const costs: SettlementCost[] = [];
  for (const d of drafts) {
    const raw = d.amountText.trim().replace(/,/g, "");
    if (!raw) continue; // 빈 행은 저장 대상이 아니다
    if (!/^\d+$/.test(raw)) return { kind: "invalid", reason: "비용은 숫자만 입력해 주세요." };
    const amount = Number(raw);
    if (!Number.isSafeInteger(amount)) return { kind: "invalid", reason: "비용 금액이 너무 큽니다." };
    const label = d.kind === "직접입력" ? (d.label?.trim() ?? "") : "";
    if (d.kind === "직접입력" && !label) return { kind: "invalid", reason: "직접입력은 항목명을 적어 주세요." };
    costs.push({ kind: d.kind, label: d.kind === "직접입력" ? label : null, amount });
  }
  return { kind: "ok", costs };
}

/**
 * 마진 표시 문자열. 실입금액이 비었거나 아직 숫자가 아니면(입력 중) **"—"**를 낸다 —
 * 0원으로 보여주면 "마진 0원"과 "아직 모른다"가 화면에서 구분되지 않는다.
 * 비용 행에 오류가 있어도 "—"다: 계산할 수 없는 상태를 숫자로 단정하지 않는다.
 */
export function formatSettlementMargin(feeText: string, drafts: SettlementCostDraft[]): string {
  const raw = feeText.trim().replace(/,/g, "");
  if (!raw || !/^\d+$/.test(raw)) return "—";
  const resolved = resolveSettlementCosts(drafts);
  if (resolved.kind !== "ok") return "—";
  const margin = settlementMargin(Number(raw), resolved.costs);
  return margin == null ? "—" : `${margin.toLocaleString("ko-KR")}원`;
}
