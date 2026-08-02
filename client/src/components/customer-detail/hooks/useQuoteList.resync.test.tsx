import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeEvent } from "react";

import type { Customer } from "@/data/customers";
import { updateQuote as apiUpdateQuote, uploadQuoteOriginal } from "@/lib/customer-quotes";
import type { CustomerDetailData } from "@/lib/customers";
import type { QuoteItem } from "@/lib/quote-items";

import { useQuoteList } from "./useQuoteList";

vi.mock("@/lib/customer-quotes", () => ({
  updateQuote: vi.fn(async () => ({})),
  deleteQuote: vi.fn(async () => ({})),
  uploadQuoteOriginal: vi.fn(async () => ({})),
  deleteQuoteOriginal: vi.fn(async () => ({})),
  getQuoteOriginalUrl: vi.fn(async () => ""),
}));
vi.mock("@/lib/quote-requests", () => ({
  fetchAppQuoteRequestsCached: vi.fn(async () => []),
}));

const updateQuoteMock = vi.mocked(apiUpdateQuote);
const uploadQuoteOriginalMock = vi.mocked(uploadQuoteOriginal);

function makeDetail(quotes: unknown[]): CustomerDetailData {
  return { id: "d-1", quotes } as unknown as CustomerDetailData;
}

function serverQuote(id: string, over: Record<string, unknown> = {}) {
  return { id, quoteCode: `QT-${id}`, status: "고객 확인 전", appStatus: "sent", scenarios: [], ...over };
}

const customer = { id: "cust-1", name: "김민준", no: 1, customerId: "CU-0001" } as unknown as Customer;

function setup(initialQuotes: unknown[]) {
  const onToast = vi.fn();
  const markRecentUpdate = vi.fn();
  const reloadAppRequests = vi.fn();
  const hook = renderHook(
    ({ detail }: { detail: CustomerDetailData }) => useQuoteList({ detail, customer, onToast, markRecentUpdate, reloadAppRequests }),
    { initialProps: { detail: makeDetail(initialQuotes) } },
  );
  return { ...hook, onToast };
}

// 재동기화(07-31 타깃 렌즈 배치 "공통 뿌리" 이월): quotes가 detail.quotes를 초기값으로만 읽어,
// reloadDetail이 가져온 서버 진실이 목록에 영영 반영되지 않던 공백의 회귀 그물.
describe("detail.quotes 재동기화", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  it("detail.quotes 갱신이 목록에 반영된다(추가·삭제 포함 서버 목록이 진실)", () => {
    const { result, rerender } = setup([serverQuote("q-1")]);

    rerender({ detail: makeDetail([serverQuote("q-1"), serverQuote("q-2")]) });
    expect(result.current.quotes.map((quote) => quote.id)).toEqual(["q-1", "q-2"]);

    rerender({ detail: makeDetail([serverQuote("q-2")]) });
    expect(result.current.quotes.map((quote) => quote.id)).toEqual(["q-2"]);
  });

  it("낙관 쓰기 비행 중 도착한 스냅샷은 버린다 — 착지 후에도 늦게 적용해 되돌리지 않는다", async () => {
    let resolveUpdate!: () => void;
    updateQuoteMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = () => resolve();
        }) as ReturnType<typeof apiUpdateQuote>,
    );
    const preWrite = () => [serverQuote("q-1", { appStatus: "queued", status: "발송대기" })];
    const { result, rerender } = setup(preWrite());

    act(() => result.current.handlers.sendQuoteToApp("q-1"));
    expect(result.current.quotes[0].appStatus).toBe("sent");

    // 쓰기 전 상태의 스냅샷이 비행 중 도착 — 낙관 반영을 되돌리면 안 된다.
    rerender({ detail: makeDetail(preWrite()) });
    expect(result.current.quotes[0].appStatus).toBe("sent");

    await act(async () => {
      resolveUpdate();
    });
    // 착지 후에도 그 스냅샷은 폐기된 상태여야 한다(늦은 적용 = 동일한 되돌림).
    expect(result.current.quotes[0].appStatus).toBe("sent");

    // 다음 갱신(쓰기 후 진실)은 정상 반영된다 — q-2 등장으로 "드롭이 아니라 적용"을 판별.
    rerender({ detail: makeDetail([serverQuote("q-1", { appStatus: "sent", status: "고객 확인 전" }), serverQuote("q-2")]) });
    expect(result.current.quotes.map((quote) => quote.id)).toEqual(["q-1", "q-2"]);
    expect(result.current.quotes[0].appStatus).toBe("sent");
  });

  it("서버에 아직 없는 낙관 temp 카드(kim-)는 재동기화에서 보존된다", () => {
    const { result, rerender } = setup([serverQuote("q-1")]);

    act(() =>
      result.current.setQuotes((current) => [
        ...current,
        { id: "kim-temp-1", quoteCode: "QT-TEMP", title: "임시", status: "작성중", appStatus: "draft" } as QuoteItem,
      ]),
    );
    rerender({ detail: makeDetail([serverQuote("q-1"), serverQuote("q-2")]) });

    expect(result.current.quotes.map((quote) => quote.id)).toEqual(["q-1", "q-2", "kim-temp-1"]);
  });

  it("업로드 직후 로컬 파일 필드(objectUrl 미리보기)는 id가 같으면 보존된다", async () => {
    const { result, rerender } = setup([serverQuote("q-1")]);
    const file = new File(["x"], "a.pdf", { type: "application/pdf" });

    act(() => {
      result.current.handlers.attachQuoteFile({ target: { files: [file], value: "" } } as unknown as ChangeEvent<HTMLInputElement>, "q-1");
    });
    await waitFor(() => expect(uploadQuoteOriginalMock).toHaveBeenCalled());
    // 업로드 promise 착지까지 flush — 비행 중이면 아래 스냅샷이 드롭돼 "적용 시 보존"을 검증하지 못한다.
    await act(async () => {});

    // 파일 필드가 아직 없는 서버 스냅샷이 도착해도 로컬 미리보기를 잃지 않는다.
    // q-2 등장으로 "드롭이 아니라 적용"을 판별한다.
    rerender({ detail: makeDetail([serverQuote("q-1"), serverQuote("q-2")]) });
    expect(result.current.quotes.map((quote) => quote.id)).toEqual(["q-1", "q-2"]);
    const synced = result.current.quotes.find((quote) => quote.id === "q-1");
    expect(synced?.objectUrl).toBe("blob:mock");
    expect(synced?.fileName).toBe("a.pdf");
  });
});
