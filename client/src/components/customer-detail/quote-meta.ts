// 견적함 영역(9a)의 순수 표시 헬퍼 — 본체에서 이동(동작/로직 무변경).
// JSX를 반환하는 kimQuoteSourceIcon은 QuoteList.tsx에 둔다(이 파일은 문자열/클래스만).

import { type KimQuoteItem } from "@/lib/kim-quote";

// kimQuoteAppStatusLabel(행 상태 배지)·kimQuoteAppSendLabel(액션 팝오버 발송 라벨)은
// 현재 구현이 동일하지만 의미(상태 표시 / 발송 표시)가 달라 분기 여지를 위해 분리 유지한다.
export function kimQuoteAppStatusLabel(status: KimQuoteItem["appStatus"], quote?: KimQuoteItem) {
  if ((quote?.revision ?? 1) > 1 && status === "viewed") return "수정 열람";
  if ((quote?.revision ?? 1) > 1 && status === "sent") return "수정 발송";
  if (status === "viewed") return "고객 열람";
  if (status === "sent") return "발송 완료";
  return "발송 전";
}

export function kimQuoteAppSendLabel(status: KimQuoteItem["appStatus"], quote?: KimQuoteItem) {
  if ((quote?.revision ?? 1) > 1 && status === "viewed") return "수정 열람";
  if ((quote?.revision ?? 1) > 1 && status === "sent") return "수정 발송";
  if (status === "viewed") return "고객 열람";
  if (status === "sent") return "발송 완료";
  return "발송 전";
}

// 파일 내 kimQuoteStatusDetailParts에서만 사용 — export 불필요.
function kimQuoteRevisionLabel(quote: KimQuoteItem) {
  if (!quote.revision || quote.revision <= 1) return null;
  return `수정 v${quote.revision}`;
}

export function kimQuoteStatusDetailParts(quote: KimQuoteItem) {
  if ((quote.revision ?? 1) > 1 && (quote.appStatus === "sent" || quote.appStatus === "viewed")) {
    return {
      time: `${kimQuoteRevisionLabel(quote) ?? "수정본"} · ${quote.revisedAt ?? quote.sentAt ?? "수정 시각 확인 전"}`,
      body: quote.appStatus === "viewed" ? "수정 견적 열람 완료" : "재발송",
    };
  }
  if (quote.appStatus === "viewed") {
    return {
      time: quote.viewedAt ?? "열람 시각 확인 전",
      body: "고객이 견적 열람 완료",
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

export function kimQuoteDeleteConfirmTitle(quote: KimQuoteItem) {
  if (quote.appStatus === "sent" || quote.appStatus === "viewed") {
    return "발송된 견적 삭제";
  }
  return "발송 전 견적 삭제";
}

export function kimQuoteDeleteConfirmMessage(quote: KimQuoteItem) {
  if (quote.appStatus === "sent" || quote.appStatus === "viewed") {
    return "고객 앱 견적함에 있는 견적도 함께 삭제됩니다.";
  }
  return "아직 고객 앱에 보내지 않은 견적입니다. 이 견적을 삭제합니다.";
}

export function kimQuoteDecisionLabel(status: KimQuoteItem["decisionStatus"]) {
  if (status === "contracting") return "계약 진행";
  if (status === "confirmed") return "고객 확정";
  if (status === "considering") return "최종 고민중";
  return "확정 전";
}

export function kimQuoteStockClass(status?: KimQuoteItem["stockStatus"]) {
  if (status === "재고있음") return " in-stock";
  if (status === "재고없음") return " no-stock";
  return " checking";
}
