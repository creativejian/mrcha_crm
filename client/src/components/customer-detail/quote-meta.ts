// 견적함 영역(9a)의 순수 표시 헬퍼 — 본체에서 이동(동작/로직 무변경).
// JSX를 반환하는 quoteSourceIcon은 QuoteList.tsx에 둔다(이 파일은 문자열/클래스만).
// appStatus "viewed" 분기는 dead 정리(0705 배치 D) — 아무 코드도 write하지 않고 실데이터 0,
// 열람 표시는 viewedBadgeOf(viewedAt read-through)가 담당한다. quoteAppSendLabel(byte-동일 복제)도 통합.

import { type QuoteItem } from "@/lib/quote-items";

// 행 상태 배지·액션 팝오버 발송 라벨 공용(과거 2벌이었으나 구현이 갈라진 적 없어 1벌화).
export function quoteAppStatusLabel(status: QuoteItem["appStatus"], quote?: QuoteItem) {
  if ((quote?.revision ?? 1) > 1 && status === "sent") return "수정 발송";
  if (status === "sent") return "발송 완료";
  return "발송 전";
}

// 파일 내 quoteStatusDetailParts에서만 사용 — export 불필요.
function quoteRevisionLabel(quote: QuoteItem) {
  if (!quote.revision || quote.revision <= 1) return null;
  return `수정 v${quote.revision}`;
}

export function quoteStatusDetailParts(quote: QuoteItem) {
  if ((quote.revision ?? 1) > 1 && quote.appStatus === "sent") {
    return {
      time: `${quoteRevisionLabel(quote) ?? "수정본"} · ${quote.revisedAt ?? quote.sentAt ?? "수정 시각 확인 전"}`,
      body: "재발송",
    };
  }
  if (quote.appStatus === "sent") {
    return {
      time: quote.sentAt ?? "발송 시각 확인 전",
      body: "앱 견적함으로 발송 완료",
    };
  }
  return null;
}

export function quoteDeleteConfirmTitle(quote: QuoteItem) {
  if (quote.appStatus === "sent") {
    return "발송된 견적 삭제";
  }
  return "발송 전 견적 삭제";
}

export function quoteDeleteConfirmMessage(quote: QuoteItem) {
  if (quote.appStatus === "sent") {
    return "고객 앱 견적함에 있는 견적도 함께 삭제됩니다.";
  }
  return "아직 고객 앱에 보내지 않은 견적입니다. 이 견적을 삭제합니다.";
}

export function quoteDecisionLabel(status: QuoteItem["decisionStatus"]) {
  if (status === "contracting") return "계약 진행";
  if (status === "confirmed") return "고객 확정";
  if (status === "considering") return "최종 고민중";
  return "확정 전";
}

export function quoteStockClass(status?: QuoteItem["stockStatus"]) {
  if (status === "재고있음") return " in-stock";
  if (status === "재고없음") return " no-stock";
  return " checking";
}
