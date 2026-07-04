import { useEffect, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent } from "react";

import { type Customer } from "@/data/customers";
import { deleteDocumentApi, getDocumentUrlApi, reorderDocumentsApi, updateDocumentTypeApi, uploadDocument } from "@/lib/customer-documents";
import { type CustomerDetailData } from "@/lib/customers";
import { classifyDocumentWithAI } from "@/lib/document-classify";
import type { MergeSource } from "@/lib/document-merge";
import { isDocumentFileDrag, documentFileKind, nowMs } from "@/lib/detail-utils";
import { type DocumentItem } from "@/components/customer-detail/types";

type UseCustomerDocumentsArgs = {
  detail: CustomerDetailData; // 초기 documents 매핑 + 서류 API의 customerId(detail.id) 소스
  customer: Customer; // 병합 PDF 파일명(customer.name) — 원본 동작 보존
  onToast: (message: string) => void;
  markRecentUpdate: (section: string) => void; // 부모 소유 recentUpdate 갱신(헤더가 사용) — 콜백 주입
};

export function useCustomerDocuments({ detail, customer, onToast, markRecentUpdate }: UseCustomerDocumentsArgs) {
  const [documents, setDocuments] = useState<DocumentItem[]>(() =>
    detail.documents.map((d) => ({
      id: d.id,
      // 분류의 진실원본은 doc_type(분류 변경 PATCH가 갱신). 레거시 title 컬럼은 제거됨.
      title: d.docType ?? "",
      status: "분류완료",
      fileName: d.fileName ?? undefined,
      fileSize: d.fileSize ?? undefined,
      mimeType: d.fileMime ?? undefined,
    })),
  );
  const [isDocumentDragActive, setIsDocumentDragActive] = useState(false);
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);
  const [documentDropTargetId, setDocumentDropTargetId] = useState<string | null>(null);
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null);
  const [previewDocumentUrl, setPreviewDocumentUrl] = useState<string | null>(null);
  const [previewDownloadUrl, setPreviewDownloadUrl] = useState<string | null>(null);
  // 미리보기 이미지 로딩 완료 여부는 "로드된 URL"로 추적(파생) — URL이 바뀌면 자동으로 false가 되고
  // 무관한 리렌더로 effect가 재실행돼도 영향이 없다(objectUrl 미리보기가 false에 갇히던 버그 방지).
  const [loadedPreviewUrl, setLoadedPreviewUrl] = useState<string | null>(null);
  const [confirmingDocumentDeleteId, setConfirmingDocumentDeleteId] = useState<string | null>(null);
  const [isMergingDocuments, setIsMergingDocuments] = useState(false);

  const documentDeleteRef = useRef<HTMLDivElement>(null);
  const documentBodyRef = useRef<HTMLDivElement>(null);
  // '분류 중…' 임시 행의 사용자 액션은 비동기 분류→업로드 파이프라인과 경합한다.
  // - manualDocTypesRef: temp 행에서 사용자가 고른 분류. AI 결과가 덮어쓰지 않고, 업로드/사후 PATCH가 이 값을 쓴다.
  // - removedTempIdsRef: 파이프라인 완료 전 삭제된 temp 행. 업로드를 취소하거나(분류 중) 보상 삭제한다(업로드 중).
  const manualDocTypesRef = useRef(new Map<string, string>());
  const removedTempIdsRef = useRef(new Set<string>());

  const receivedDocumentCount = documents.length;
  const previewDocument = documents.find((documentItem) => documentItem.id === previewDocumentId) ?? null;
  // 미리보기 URL(이미지면 썸네일). 업로드 직후 objectUrl 우선. null이면 아직 발급 중(로딩).
  const activePreviewDocumentUrl = previewDocument ? previewDocument.objectUrl ?? previewDocumentUrl : null;
  // 현재 보여줄 URL이 실제로 로드 완료됐는지(파생). URL이 바뀌면 자동 false.
  const previewImageLoaded = activePreviewDocumentUrl !== null && loadedPreviewUrl === activePreviewDocumentUrl;
  // 다운로드는 항상 원본. objectUrl(업로드 직후 원본) 우선, 없으면 서버 원본 downloadUrl.
  const activeDownloadUrl = previewDocument ? previewDocument.objectUrl ?? previewDownloadUrl ?? previewDocumentUrl : null;

  // 서버 저장 파일은 signed URL을 비동기 발급한다(미리보기=썸네일/원본, 다운로드=원본).
  useEffect(() => {
    if (!previewDocumentId || (previewDocument?.objectUrl)) return () => { setPreviewDocumentUrl(null); setPreviewDownloadUrl(null); };
    let cancelled = false;
    getDocumentUrlApi(detail.id, previewDocumentId)
      .then((r) => {
        if (!cancelled) { setPreviewDocumentUrl(r.url); setPreviewDownloadUrl(r.downloadUrl); }
      })
      .catch(() => onToast("미리보기 URL 발급에 실패했습니다."));
    return () => {
      cancelled = true;
      setPreviewDocumentUrl(null);
      setPreviewDownloadUrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewDocumentId 변경 시에만 재실행, previewDocument는 파생값이라 dep 제외
  }, [previewDocumentId, detail.id, onToast]);

  useEffect(() => {
    if (!confirmingDocumentDeleteId) return;

    function closeDocumentDelete(event: PointerEvent) {
      if (documentDeleteRef.current?.contains(event.target as Node)) return;
      setConfirmingDocumentDeleteId(null);
    }

    function closeDocumentDeleteByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConfirmingDocumentDeleteId(null);
    }

    document.addEventListener("pointerdown", closeDocumentDelete, true);
    document.addEventListener("keydown", closeDocumentDeleteByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeDocumentDelete, true);
      document.removeEventListener("keydown", closeDocumentDeleteByKeyboard);
    };
  }, [confirmingDocumentDeleteId]);

  async function addDocumentFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => {
      const lower = file.name.toLowerCase();
      return file.type.startsWith("image/") || file.type === "application/pdf" || lower.endsWith(".pdf");
    });
    if (files.length === 0) {
      onToast("이미지·PDF만 등록할 수 있습니다.");
      return;
    }
    setConfirmingDocumentDeleteId(null);
    markRecentUpdate("서류함");

    // 파일별 병렬 처리 — classifyDocumentWithAI·uploadDocument 모두 아래에서 파일별로 catch되므로
    // 한 파일 실패가 다른 파일을 abort시키지 않는다(그래서 Promise.all로 충분, allSettled 불필요).
    await Promise.all(
      files.map(async (file, index) => {
        // index를 tempId에 포함 — 병렬이라 nowMs()가 동일하고 같은 크기 파일이면 충돌하므로.
        const tempId = `kim-document-${nowMs()}-${index}-${Math.round(file.size)}`;
        const objectUrl = URL.createObjectURL(file);
        const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
        const optimistic: DocumentItem = {
          id: tempId,
          title: "",
          status: "분류 중…",
          fileName: file.name,
          fileSize: file.size,
          mimeType,
          objectUrl,
          file,
        };
        setDocuments((current) => [...current, optimistic]);

        // vision 분류(실패·unknown이면 lib이 파일명 regex로 폴백 → 항상 유효한 22종).
        const classified = await classifyDocumentWithAI(file);
        if (removedTempIdsRef.current.has(tempId)) {
          // 분류 대기 중 삭제됨 — 업로드 자체를 취소(유령 문서 방지).
          removedTempIdsRef.current.delete(tempId);
          manualDocTypesRef.current.delete(tempId);
          return;
        }
        const manualDocType = manualDocTypesRef.current.get(tempId);
        const docType = manualDocType ?? classified.docType;
        if (manualDocType === undefined) {
          // 폴백(regex) 분류를 'AI분류'로 표기하면 AI 경로 장애가 은폐된다 — 기존 '자동인식' 배지로 구분.
          setDocuments((current) =>
            current.map((d) => (d.id === tempId ? { ...d, title: classified.docType, status: classified.source === "ai" ? "AI분류" : "자동인식" } : d)),
          );
        }

        try {
          const saved = await uploadDocument(detail.id, file, docType);
          if (removedTempIdsRef.current.has(tempId)) {
            // 업로드 진행 중 삭제됨 — 이미 저장된 서버 행을 보상 삭제.
            removedTempIdsRef.current.delete(tempId);
            manualDocTypesRef.current.delete(tempId);
            void deleteDocumentApi(detail.id, saved.id).catch(() => onToast("삭제 저장에 실패했습니다."));
            return;
          }
          // 업로드 진행 중 수동 분류가 바뀌었으면(temp id라 PATCH가 생략됨) 서버 값을 맞춘다.
          const lateManualDocType = manualDocTypesRef.current.get(tempId);
          if (lateManualDocType !== undefined && lateManualDocType !== docType) {
            void updateDocumentTypeApi(detail.id, saved.id, lateManualDocType).catch(() => onToast("분류 저장에 실패했습니다."));
          }
          manualDocTypesRef.current.delete(tempId);
          setDocuments((current) => current.map((d) => (d.id === tempId ? { ...d, id: saved.id, file: undefined } : d)));
        } catch {
          manualDocTypesRef.current.delete(tempId);
          removedTempIdsRef.current.delete(tempId);
          setDocuments((current) => current.filter((d) => d.id !== tempId));
          URL.revokeObjectURL(objectUrl);
          onToast(`${file.name} 업로드에 실패했습니다.`);
        }
      }),
    );
  }

  function addDocumentFilesFromInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addDocumentFiles(event.target.files);
    event.target.value = "";
  }

  function addDocumentFilesFromDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDocumentDragActive(false);
    addDocumentFiles(event.dataTransfer.files);
  }

  function updateDocumentType(id: string, title: string) {
    setDocuments((current) => current.map((documentItem) => (documentItem.id === id ? { ...documentItem, title, status: "수동분류" } : documentItem)));
    markRecentUpdate("서류함");
    if (id.startsWith("kim-")) {
      manualDocTypesRef.current.set(id, title); // 파이프라인이 이 값을 우선 사용(AI 결과가 덮어쓰지 않음)
    } else {
      void updateDocumentTypeApi(detail.id, id, title).catch(() => onToast("분류 저장에 실패했습니다."));
    }
  }

  function clearDocumentRowDrag() {
    setDraggedDocumentId(null);
    setDocumentDropTargetId(null);
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.classList.contains("kim-doc-drag-handle")) {
      activeElement.blur();
    }
  }

  function startDocumentRowDrag(event: ReactDragEvent<HTMLElement>, id: string) {
    setDraggedDocumentId(id);
    setDocumentDropTargetId(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-kim-document-id", id);
  }

  function moveDocumentToTarget(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const sourceIndex = documents.findIndex((documentItem) => documentItem.id === sourceId);
    const targetIndex = documents.findIndex((documentItem) => documentItem.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const nextDocuments = [...documents];
    const [target] = nextDocuments.splice(sourceIndex, 1);
    nextDocuments.splice(targetIndex, 0, target);
    setDocuments(nextDocuments);
    markRecentUpdate("서류함");
    // 서버 저장 항목만 추린 뒤 연속 index로 재채번(업로드 중 임시 항목을 제외한 자리로 sortOrder를 맞춘다).
    const order = nextDocuments.filter((documentItem) => !documentItem.id.startsWith("kim-")).map((documentItem, index) => ({ id: documentItem.id, sortOrder: index }));
    if (order.length > 0) void reorderDocumentsApi(detail.id, order).catch(() => onToast("순서 저장에 실패했습니다."));
  }

  function dragDocumentRowOver(event: ReactDragEvent<HTMLElement>, targetId: string) {
    if (!draggedDocumentId || draggedDocumentId === targetId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDocumentDropTargetId(targetId);
  }

  function dragDocumentRowLeave(event: ReactDragEvent<HTMLElement>, targetId: string) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    if (documentDropTargetId === targetId) setDocumentDropTargetId(null);
  }

  function dropDocumentRow(event: ReactDragEvent<HTMLElement>, targetId: string) {
    const sourceId = event.dataTransfer.getData("application/x-kim-document-id") || draggedDocumentId;
    if (!sourceId) return;
    event.preventDefault();
    event.stopPropagation();
    moveDocumentToTarget(sourceId, targetId);
    clearDocumentRowDrag();
  }

  function cardDragEnter(event: ReactDragEvent<HTMLElement>) {
    if (!isDocumentFileDrag(event)) return;
    event.preventDefault();
    setIsDocumentDragActive(true);
  }

  function cardDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (!isDocumentFileDrag(event)) return;
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDocumentDragActive(false);
  }

  function cardDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!isDocumentFileDrag(event)) return;
    event.preventDefault();
  }

  function cardDrop(event: ReactDragEvent<HTMLElement>) {
    if (!isDocumentFileDrag(event)) return;
    addDocumentFilesFromDrop(event);
  }

  function deleteDocument(id: string) {
    const targetDocument = documents.find((documentItem) => documentItem.id === id);
    if (targetDocument?.objectUrl) URL.revokeObjectURL(targetDocument.objectUrl);
    setDocuments((current) => current.filter((documentItem) => documentItem.id !== id));
    setPreviewDocumentId((current) => (current === id ? null : current));
    setConfirmingDocumentDeleteId(null);
    markRecentUpdate("서류함");
    onToast("서류 항목을 삭제했습니다.");
    if (id.startsWith("kim-")) {
      removedTempIdsRef.current.add(id); // 진행 중 파이프라인이 업로드를 취소/보상 삭제하도록 표시
    } else {
      void deleteDocumentApi(detail.id, id).catch(() => onToast("삭제 저장에 실패했습니다."));
    }
  }

  // 다운로드는 signed URL(또는 업로드 직후 objectUrl)을 blob으로 받아 같은 출처에서 내려받는다.
  // signed URL의 Content-Disposition은 supabase가 한글 파일명을 이중 인코딩해 깨지므로,
  // blob + a.download로 원본 파일명(한글 포함)을 그대로 보존한다.
  async function downloadDocument(url: string, fileName: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      onToast("다운로드에 실패했습니다.");
    }
  }

  // 서류함의 이미지/PDF를 표시 순서대로 하나의 PDF로 병합해 내려받는다(금융사에 한 번에 제출).
  // 소스 바이트: 업로드 직후(메모리 File) 우선, 없으면 저장본의 원본 signed URL(downloadUrl)을 fetch.
  async function downloadDocumentsMergedPdf() {
    if (isMergingDocuments) return;
    if (documents.length === 0) {
      onToast("내보낼 서류가 없습니다.");
      return;
    }
    setIsMergingDocuments(true);
    try {
      // 문서별 signed URL 발급+다운로드는 서로 독립 — 병렬로 받는다(10건 직렬 5~10초 → ~1초).
      // Promise.all은 입력 순서를 보존하므로 병합 순서 = 서류함 표시 순서 그대로다.
      const fetched = await Promise.all(
        documents.map(async (documentItem): Promise<MergeSource | null> => {
          const kind = documentFileKind(documentItem.mimeType, documentItem.fileName);
          if (kind !== "이미지" && kind !== "PDF") return null;
          let blob: Blob | null = null;
          if (documentItem.file) {
            blob = documentItem.file;
          } else if (!documentItem.id.startsWith("kim-")) {
            try {
              const { downloadUrl } = await getDocumentUrlApi(detail.id, documentItem.id);
              const res = await fetch(downloadUrl);
              if (res.ok) blob = await res.blob();
            } catch {
              blob = null;
            }
          }
          return blob ? { kind: kind === "PDF" ? "pdf" : "image", blob } : null;
        }),
      );
      const sources = fetched.filter((source): source is MergeSource => source !== null);
      if (sources.length === 0) {
        onToast("병합할 수 있는 이미지·PDF 서류가 없습니다.");
        return;
      }
      // pdf-lib는 무겁다 — 병합 시점에만 동적 로드(초기 번들에서 분리).
      const { mergeDocumentsToPdf } = await import("@/lib/document-merge");
      const { bytes, merged, skipped } = await mergeDocumentsToPdf(sources);
      if (merged === 0) {
        onToast("서류 병합에 실패했습니다.");
        return;
      }
      const pdfBlob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(pdfBlob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${customer.name}-서류.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      markRecentUpdate("서류함");
      onToast(skipped > 0 ? `서류 ${merged}건을 PDF로 병합했습니다(${skipped}건 제외).` : `서류 ${merged}건을 하나의 PDF로 병합했습니다.`);
    } catch {
      onToast("서류 병합에 실패했습니다.");
    } finally {
      setIsMergingDocuments(false);
    }
  }

  // 부모 onEditorOpenChange OR용: 미리보기 또는 삭제확인 중 하나라도 열려 있으면 true(원본 그대로 — drag state 제외).
  const editorOpen = previewDocumentId !== null || confirmingDocumentDeleteId !== null;
  // 부모 detailOverlayOpen 파생용: 미리보기가 열려 있으면 배경 스크롤 잠금(원본 previewDocumentId 항과 동치).
  const overlayOpen = previewDocumentId !== null;

  return {
    documents,
    count: receivedDocumentCount, // 카운트 배지
    dragActive: isDocumentDragActive,
    draggedId: draggedDocumentId,
    dropTargetId: documentDropTargetId,
    preview: {
      id: previewDocumentId,
      url: activePreviewDocumentUrl,
      downloadUrl: activeDownloadUrl,
      imageLoaded: previewImageLoaded,
      document: previewDocument,
    },
    confirmingDeleteId: confirmingDocumentDeleteId,
    isMerging: isMergingDocuments,
    editorOpen,
    overlayOpen,
    refs: { bodyRef: documentBodyRef, deleteRef: documentDeleteRef },
    handlers: {
      addFromInput: addDocumentFilesFromInput,
      updateType: updateDocumentType,
      clearRowDrag: clearDocumentRowDrag,
      startRowDrag: startDocumentRowDrag,
      rowDragOver: dragDocumentRowOver,
      rowDragLeave: dragDocumentRowLeave,
      dropRow: dropDocumentRow,
      cardDragEnter,
      cardDragLeave,
      cardDragOver,
      cardDrop,
      requestDelete: (id: string) => setConfirmingDocumentDeleteId((current) => (current === id ? null : id)),
      cancelDelete: () => setConfirmingDocumentDeleteId(null),
      confirmDelete: deleteDocument,
      openPreview: (id: string) => setPreviewDocumentId(id),
      closePreview: () => setPreviewDocumentId(null),
      download: downloadDocument,
      mergePdf: downloadDocumentsMergedPdf,
      onImageLoad: (url: string) => setLoadedPreviewUrl(url),
    },
  };
}
