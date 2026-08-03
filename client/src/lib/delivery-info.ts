import type { ContractingQuoteSummary, CustomerDeliveryInfo, CustomerSettlement } from "@/data/customers";
import { dedupedModelTrim } from "@/lib/app-card-labels";
import { normalizeDateText } from "@/lib/datetime-text";

// ── 출고 정보 팝오버 순수 계층(2026-07-20 출고 2단계 spec §5.1·§5.3) — 전부 순수 함수 ──

/** 견적에서 프리필될 수 있는 필드(soft pipe 대상) — 나머지는 항상 수기 입력이다. */
export type SeedableDeliveryField = "contractVehicle" | "lender";

export type DeliveryInfoDraft = {
  contractVehicle: string;
  contractDate: string;
  lender: string;
  deliveredDate: string;
  deliveryMemo: string;
  /** 프리필이 참조한 계약 진행 견적 id(soft pipe provenance) — 시드 미적용이면 기존 저장값 승계. */
  sourceQuoteId: string | null;
  /**
   * 이번 시드에서 **견적으로 채운** 필드. UI가 "견적에서 가져옴" 힌트를 띄우는 근거다.
   * 저장 본문에는 들어가지 않는다(resolveDeliveryInfoSubmit이 무시) — 순수 표시용 메타.
   * 사용자가 그 칸을 고치면 호출부가 목록에서 빼야 한다(힌트가 남으면 거짓말이 된다).
   */
  seededFields: readonly SeedableDeliveryField[];
};

// 프리필 시드(spec §5.3): 저장값이 비어 있는 필드만 contracting 견적에서 채운다(수기 우선).
// sourceQuoteId = 프리필이 하나라도 적용됐으면 그 견적 id, 아니면 기존 저장값(없으면 null).
// DB 자동 변경 경로 아님 — 저장 버튼을 눌러야만 영속(결합 없음 원칙과 정합).
export function seedDeliveryInfoDraft(
  existing: CustomerDeliveryInfo | null,
  quote: ContractingQuoteSummary | null,
): DeliveryInfoDraft {
  const vehicleSeed = quote ? [quote.brandName, dedupedModelTrim(quote.modelName, quote.trimName)].filter(Boolean).join(" ") : "";
  const seedVehicle = !existing?.contractVehicle && vehicleSeed ? vehicleSeed : null;
  const seedLender = !existing?.lender && quote?.lender ? quote.lender : null;
  const seededFields: SeedableDeliveryField[] = [];
  if (seedVehicle) seededFields.push("contractVehicle");
  if (seedLender) seededFields.push("lender");
  return {
    contractVehicle: existing?.contractVehicle ?? seedVehicle ?? "",
    contractDate: existing?.contractDate ?? "",
    lender: existing?.lender ?? seedLender ?? "",
    deliveredDate: existing?.deliveredDate ?? "",
    deliveryMemo: existing?.deliveryMemo ?? "",
    sourceQuoteId: seedVehicle || seedLender ? quote!.id : (existing?.sourceQuoteId ?? null),
    seededFields,
  };
}

export type DeliveryInfoSubmit = { kind: "save"; body: CustomerDeliveryInfo } | { kind: "invalid"; reason: string };

// 제출 해석: 빈 문자열 → null(값 지우기), 텍스트 trim, 날짜는 유연 정규화(datetime-text — DateTextField 규약).
export function resolveDeliveryInfoSubmit(draft: DeliveryInfoDraft): DeliveryInfoSubmit {
  const dateOrInvalid = (raw: string, label: string): { ok: true; value: string | null } | { ok: false; reason: string } => {
    if (!raw.trim()) return { ok: true, value: null };
    const normalized = normalizeDateText(raw);
    if (!normalized) return { ok: false, reason: `${label}은 2026-07-20처럼 년-월-일 형식으로 입력해 주세요.` };
    return { ok: true, value: normalized };
  };
  const contract = dateOrInvalid(draft.contractDate, "계약일");
  if (!contract.ok) return { kind: "invalid", reason: contract.reason };
  const delivered = dateOrInvalid(draft.deliveredDate, "출고 실측일");
  if (!delivered.ok) return { kind: "invalid", reason: delivered.reason };
  const textOrNull = (v: string) => (v.trim() ? v.trim() : null);
  return {
    kind: "save",
    body: {
      contractVehicle: textOrNull(draft.contractVehicle),
      contractDate: contract.value,
      lender: textOrNull(draft.lender),
      deliveredDate: delivered.value,
      deliveryMemo: textOrNull(draft.deliveryMemo),
      // provenance는 §5.3 자체 규칙("수기 수정해도 유지·시드 없으면 기존값 승계")을 따른다 — "빈 폼
      // 저장 = 전 필드 null"의 '전 필드'는 표시 5필드 기준(배치 11 A#8 각주: 5필드 null + sourceQuoteId
      // 비null 행은 의도된 상태. 표시 소비처 0·FK SET NULL·재시드 자연 갱신이라 실해 0).
      sourceQuoteId: draft.sourceQuoteId,
    },
  };
}

// ── 정산 제출 해석(admin 전용 축, 2026-08-03) ──────────────────────────────
// 출고 정보와 분리한 이유는 저장 경로가 다르기 때문이다(별도 라우트·별도 권한). 여기서 검증해도
// **서버가 최종 게이트**다 — zod가 음수·형식을 다시 막는다.
export type SettlementSubmit = { kind: "save"; body: CustomerSettlement } | { kind: "invalid"; reason: string };

export function resolveSettlementSubmit(settledAtText: string, feeText: string): SettlementSubmit {
  // 콤마는 입력 편의라 지운다("1,180,000"). 마이너스는 정규식이 막는다 — 입금액에 음수는 없다.
  const raw = feeText.trim().replace(/,/g, "");
  let feeAmount: number | null = null;
  if (raw) {
    if (!/^\d+$/.test(raw)) return { kind: "invalid", reason: "실입금액은 숫자만 입력해 주세요." };
    feeAmount = Number(raw);
    if (!Number.isSafeInteger(feeAmount)) return { kind: "invalid", reason: "실입금액이 너무 큽니다." };
  }
  const dateRaw = settledAtText.trim();
  if (!dateRaw) return { kind: "save", body: { settledAt: null, feeAmount } };
  const settledAt = normalizeDateText(dateRaw);
  if (!settledAt) return { kind: "invalid", reason: "입금일은 2026-09-10처럼 년-월-일 형식으로 입력해 주세요." };
  return { kind: "save", body: { settledAt, feeAmount } };
}

export type DeliveryInfoSummary = { contractLine: string | null; deliveredLine: string | null; fallback: string | null };

function monthDay(date: string | null): string | null {
  if (!date) return null;
  const [, m, d] = date.split("-").map(Number);
  return m && d ? `${m}/${d}` : null;
}

// 셀 요약(spec §5.1): 계약 줄 "계약 M/D · 금융사"(있는 값만 조합) + 실측 줄 "출고 M/D".
// 전부 비면 null(셀 = "+ 미입력"), 줄 구성 값은 없는데 다른 필드(차량/메모)만 있으면 "입력됨" 폴백(정직 표시).
export function deliveryInfoSummary(info: CustomerDeliveryInfo | null | undefined): DeliveryInfoSummary | null {
  if (!info) return null;
  if (!info.contractVehicle && !info.contractDate && !info.lender && !info.deliveredDate && !info.deliveryMemo) return null;
  const contractDay = monthDay(info.contractDate);
  const contractLine = [contractDay ? `계약 ${contractDay}` : null, info.lender].filter(Boolean).join(" · ") || null;
  const deliveredDay = monthDay(info.deliveredDate);
  const deliveredLine = deliveredDay ? `출고 ${deliveredDay}` : null;
  return { contractLine, deliveredLine, fallback: contractLine || deliveredLine ? null : "입력됨" };
}
