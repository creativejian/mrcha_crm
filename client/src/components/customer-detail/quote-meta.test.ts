import { describe, expect, it } from "vitest";

import { type QuoteItem } from "@/lib/quote-items";
import { quoteAppStatusLabel, quoteDeleteConfirmMessage, quoteDeleteConfirmTitle } from "./quote-meta";

// 견적 삭제 확인 문구는 **되돌릴 수 없는 조작을 막는 유일한 안전장치**다.
// 발송된 견적을 지우면 deleteQuote 훅이 public.advisor_quotes 행을 회수해
// 고객의 앱 견적함에서도 그 카드가 사라진다(발송 파이프라인 스펙 결정 7, 이미 배포됨).
// 회수된 카드는 되살릴 수 없고, 재발송하면 새 카드가 생겨 열람 여부·발송 시각을 잃는다.
//
// 그런데 이 문구를 잠그는 테스트가 없었다. 누가 문구를 지우거나 분기를 뒤집어도
// 타입도 테스트도 실패하지 않는다 — 리포지토리 경계를 넘는 결합이 조용히 깨지는 것과 같은 부류다.
// 여기서 세 분기를 못박는다.

function quote(overrides: Partial<QuoteItem> = {}): QuoteItem {
  return { id: "q1", appStatus: undefined, revision: 1, ...overrides } as QuoteItem;
}

describe("quoteDeleteConfirmTitle", () => {
  it("발송된 견적은 '발송된 견적 삭제'", () => {
    expect(quoteDeleteConfirmTitle(quote({ appStatus: "sent" }))).toBe("발송된 견적 삭제");
  });

  it("미발송 견적은 '발송 전 견적 삭제'", () => {
    expect(quoteDeleteConfirmTitle(quote({ appStatus: "draft" }))).toBe("발송 전 견적 삭제");
    expect(quoteDeleteConfirmTitle(quote({ appStatus: undefined }))).toBe("발송 전 견적 삭제");
  });
});

describe("quoteDeleteConfirmMessage", () => {
  const sent = quoteDeleteConfirmMessage(quote({ appStatus: "sent" }));

  it("발송된 견적: 고객 앱에서도 사라진다는 사실을 반드시 알린다", () => {
    expect(sent).toContain("고객 앱");
  });

  it("발송된 견적: 되돌릴 수 없다는 사실을 반드시 알린다", () => {
    // "함께 삭제됩니다"만 읽으면 '다시 발송하면 되겠지'로 오해할 수 있다.
    // 회수된 카드는 복구 불가이며 재발송은 새 카드다(열람 여부·발송 시각 소실).
    expect(sent).toContain("되돌릴 수 없");
  });

  it("발송된 견적: 다시 보내려면 새 견적을 발송해야 함을 안내한다", () => {
    expect(sent).toContain("새 견적");
  });

  it("미발송 견적: 앱에 아무것도 안 갔음을 알리고, 되돌릴 수 없다는 경고는 하지 않는다", () => {
    const draft = quoteDeleteConfirmMessage(quote({ appStatus: "draft" }));
    expect(draft).toContain("보내지 않은");
    expect(draft).not.toContain("되돌릴 수 없");
  });

  it("두 문구는 서로 다르다(분기가 살아 있다)", () => {
    expect(sent).not.toBe(quoteDeleteConfirmMessage(quote({ appStatus: "draft" })));
  });
});

// 삭제 확인창의 제목은 이 라벨과 같은 'sent' 판정을 쓴다 — 분기 기준이 갈라지면
// "발송 완료" 배지가 붙은 견적에 "발송 전 견적 삭제" 창이 뜬다.
describe("quoteAppStatusLabel ↔ 삭제 확인 분기 정합", () => {
  it("sent면 배지도 확인창도 '발송' 쪽", () => {
    expect(quoteAppStatusLabel("sent", quote({ appStatus: "sent" }))).toBe("발송 완료");
    expect(quoteDeleteConfirmTitle(quote({ appStatus: "sent" }))).toBe("발송된 견적 삭제");
  });

  it("재발송(revision>1)도 여전히 발송된 견적으로 취급", () => {
    const revised = quote({ appStatus: "sent", revision: 2 });
    expect(quoteAppStatusLabel("sent", revised)).toBe("수정 발송");
    expect(quoteDeleteConfirmTitle(revised)).toBe("발송된 견적 삭제");
    expect(quoteDeleteConfirmMessage(revised)).toContain("고객 앱");
  });
});
