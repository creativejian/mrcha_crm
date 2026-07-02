import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeEvent } from "react";

import type { Customer } from "@/data/customers";
import { deleteDocumentApi, getDocumentUrlApi, updateDocumentTypeApi, uploadDocument } from "@/lib/customer-documents";
import { mergeDocumentsToPdf } from "@/lib/document-merge";
import type { CustomerDetailData } from "@/lib/customers";
import { classifyDocumentWithAI, type DocumentClassification } from "@/lib/document-classify";

import { useCustomerDocuments } from "./useCustomerDocuments";

vi.mock("@/lib/document-classify", () => ({ classifyDocumentWithAI: vi.fn() }));
vi.mock("@/lib/customer-documents", () => ({
  uploadDocument: vi.fn(),
  updateDocumentTypeApi: vi.fn(async () => ({})),
  deleteDocumentApi: vi.fn(async () => ({})),
  getDocumentUrlApi: vi.fn(async () => ({ url: "u", downloadUrl: "d" })),
  reorderDocumentsApi: vi.fn(async () => ({})),
}));
vi.mock("@/lib/document-merge", () => ({
  mergeDocumentsToPdf: vi.fn(async (sources: { kind: string }[]) => ({ bytes: new Uint8Array([1]), merged: sources.length, skipped: 0 })),
}));

const classify = vi.mocked(classifyDocumentWithAI);
const upload = vi.mocked(uploadDocument);
const patchType = vi.mocked(updateDocumentTypeApi);
const deleteApi = vi.mocked(deleteDocumentApi);
const getUrl = vi.mocked(getDocumentUrlApi);

const detail = { id: "cust-1", documents: [] } as unknown as CustomerDetailData;
const customer = { name: "김민준" } as Customer;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup() {
  return renderHook(() => useCustomerDocuments({ detail, customer, onToast: vi.fn(), markRecentUpdate: vi.fn() }));
}

function pdfFile(name = "서류.pdf") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
}

async function addFile(result: ReturnType<typeof setup>["result"], file: File) {
  await act(async () => {
    result.current.handlers.addFromInput({ target: { files: [file], value: "" } } as unknown as ChangeEvent<HTMLInputElement>);
  });
}

describe("useCustomerDocuments — AI 분류 파이프라인 경합", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom엔 createObjectURL이 없다.
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  it("분류 중 사용자가 수동 분류하면 AI 결과가 덮어쓰지 않고 업로드도 수동 분류로 간다", async () => {
    const classification = deferred<DocumentClassification>();
    classify.mockReturnValue(classification.promise);
    upload.mockResolvedValue({ id: "srv-1" } as Awaited<ReturnType<typeof uploadDocument>>);
    const { result } = setup();
    const file = pdfFile();
    await addFile(result, file);
    expect(result.current.documents[0].status).toBe("분류 중…");
    const tempId = result.current.documents[0].id;

    act(() => result.current.handlers.updateType(tempId, "면허증"));
    await act(async () => classification.resolve({ docType: "기타서류", source: "ai" }));

    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledWith("cust-1", file, "면허증");
    await waitFor(() => expect(result.current.documents[0].id).toBe("srv-1"));
    expect(result.current.documents[0].title).toBe("면허증");
    expect(result.current.documents[0].status).toBe("수동분류");
    expect(patchType).not.toHaveBeenCalled(); // 업로드가 이미 수동 분류로 저장 — 추가 PATCH 불필요
  });

  it("분류 중 행을 삭제하면 업로드 자체가 취소된다(유령 문서 방지)", async () => {
    const classification = deferred<DocumentClassification>();
    classify.mockReturnValue(classification.promise);
    const { result } = setup();
    await addFile(result, pdfFile());
    const tempId = result.current.documents[0].id;

    act(() => result.current.handlers.confirmDelete(tempId));
    expect(result.current.documents).toHaveLength(0);
    await act(async () => classification.resolve({ docType: "기타서류", source: "ai" }));

    await new Promise((r) => setTimeout(r, 0));
    expect(upload).not.toHaveBeenCalled();
  });

  it("업로드 중 행을 삭제하면 서버 저장본을 보상 삭제한다", async () => {
    classify.mockResolvedValue({ docType: "기타서류", source: "ai" });
    const uploading = deferred<Awaited<ReturnType<typeof uploadDocument>>>();
    upload.mockReturnValue(uploading.promise);
    const { result } = setup();
    await addFile(result, pdfFile());
    await waitFor(() => expect(upload).toHaveBeenCalled());
    const tempId = result.current.documents[0].id;

    act(() => result.current.handlers.confirmDelete(tempId));
    await act(async () => uploading.resolve({ id: "srv-ghost" } as Awaited<ReturnType<typeof uploadDocument>>));

    await waitFor(() => expect(deleteApi).toHaveBeenCalledWith("cust-1", "srv-ghost"));
    expect(result.current.documents).toHaveLength(0);
  });

  it("파일명 regex 폴백 분류는 'AI분류'가 아니라 '자동인식' 배지를 단다", async () => {
    classify.mockResolvedValue({ docType: "기타서류", source: "fallback" });
    upload.mockResolvedValue({ id: "srv-2" } as Awaited<ReturnType<typeof uploadDocument>>);
    const { result } = setup();
    await addFile(result, pdfFile());

    await waitFor(() => expect(result.current.documents[0]?.status).toBe("자동인식"));
  });

  it("AI 분류 성공 경로: 'AI분류' 배지 + AI docType으로 업로드", async () => {
    classify.mockResolvedValue({ docType: "사업자등록증", source: "ai" });
    upload.mockResolvedValue({ id: "srv-3" } as Awaited<ReturnType<typeof uploadDocument>>);
    const { result } = setup();
    const file = pdfFile("사업자등록증.pdf");
    await addFile(result, file);

    await waitFor(() => expect(result.current.documents[0]?.id).toBe("srv-3"));
    expect(result.current.documents[0].status).toBe("AI분류");
    expect(upload).toHaveBeenCalledWith("cust-1", file, "사업자등록증");
  });

  it("병합 다운로드: 문서별 URL 발급·다운로드를 병렬로 수행하고 표시 순서를 보존한다", async () => {
    const detailWithDocs = {
      id: "cust-1",
      documents: [
        { id: "d1", docType: "면허증", fileName: "a.png", fileSize: 10, fileMime: "image/png" },
        { id: "d2", docType: "기타서류", fileName: "b.pdf", fileSize: 10, fileMime: "application/pdf" },
      ],
    } as unknown as CustomerDetailData;
    type UrlResult = Awaited<ReturnType<typeof getDocumentUrlApi>>;
    const urlDeferred = { d1: deferred<UrlResult>(), d2: deferred<UrlResult>() };
    getUrl.mockImplementation((_cid: string, docId: string) => urlDeferred[docId as "d1" | "d2"].promise);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["x"]) })));
    const { result } = renderHook(() => useCustomerDocuments({ detail: detailWithDocs, customer, onToast: vi.fn(), markRecentUpdate: vi.fn() }));

    let merging!: Promise<void>;
    act(() => {
      merging = result.current.handlers.mergePdf();
    });
    // 병렬이면 어느 URL도 resolve되기 전에 두 문서의 발급 요청이 이미 나가 있어야 한다(직렬이면 d1 대기 중 1회뿐).
    await waitFor(() => expect(getUrl).toHaveBeenCalledTimes(2));

    // 역순 resolve로도 병합 순서는 표시 순서(d1 이미지 → d2 PDF)를 유지한다.
    urlDeferred.d2.resolve({ url: "u2", downloadUrl: "dl2", fileMime: "application/pdf" });
    urlDeferred.d1.resolve({ url: "u1", downloadUrl: "dl1", fileMime: "image/png" });
    await act(async () => merging);

    const sources = vi.mocked(mergeDocumentsToPdf).mock.calls[0][0];
    expect(sources.map((s) => s.kind)).toEqual(["image", "pdf"]);
    vi.unstubAllGlobals();
  });

  it("업로드 중 수동 분류를 바꾸면 저장 완료 후 서버 분류를 PATCH로 맞춘다", async () => {
    classify.mockResolvedValue({ docType: "기타서류", source: "ai" });
    const uploading = deferred<Awaited<ReturnType<typeof uploadDocument>>>();
    upload.mockReturnValue(uploading.promise);
    const { result } = setup();
    await addFile(result, pdfFile());
    await waitFor(() => expect(upload).toHaveBeenCalledWith("cust-1", expect.any(File), "기타서류"));
    const tempId = result.current.documents[0].id;

    act(() => result.current.handlers.updateType(tempId, "면허증"));
    await act(async () => uploading.resolve({ id: "srv-4" } as Awaited<ReturnType<typeof uploadDocument>>));

    await waitFor(() => expect(patchType).toHaveBeenCalledWith("cust-1", "srv-4", "면허증"));
    expect(result.current.documents[0].title).toBe("면허증");
    expect(result.current.documents[0].status).toBe("수동분류");
  });
});
