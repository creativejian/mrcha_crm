import { Download, Eye, File, FileText, FileUp, FolderOpen, GripVertical, Image, Paperclip, Trash2, X } from "lucide-react";

import { DOC_TYPE_OPTIONS } from "@/data/customers";
import { formatKimFileSize, kimDocumentFileKind } from "@/lib/kim-detail-utils";

import type { useCustomerDocuments } from "./hooks/useCustomerDocuments";

type CustomerDocumentsProps = ReturnType<typeof useCustomerDocuments>;

function kimDocumentFileIcon(kind: string) {
  if (kind === "이미지") return <Image size={13} strokeWidth={2.25} />;
  if (kind === "PDF") return <FileText size={13} strokeWidth={2.25} />;
  return <File size={13} strokeWidth={2.25} />;
}

export function CustomerDocuments({
  documents,
  count,
  dragActive,
  draggedId,
  dropTargetId,
  preview,
  confirmingDeleteId,
  isMerging,
  refs,
  handlers,
}: CustomerDocumentsProps) {
  const { bodyRef, deleteRef } = refs;
  const { url: activePreviewDocumentUrl, downloadUrl: activeDownloadUrl, imageLoaded: previewImageLoaded, document: previewDocument } = preview;

  return (
    <>
      <article
        className={`detail-section kim-mvp-card kim-doc-card${dragActive ? " is-drop-active" : ""}`}
        onDragEnter={handlers.cardDragEnter}
        onDragLeave={handlers.cardDragLeave}
        onDragOver={handlers.cardDragOver}
        onDrop={handlers.cardDrop}
      >
        <div className="kim-mvp-card-head">
          <div className="kim-mvp-title-row">
            <i aria-hidden="true" className="kim-mvp-title-icon"><FolderOpen size={14} strokeWidth={2.2} /></i>
            <h3>서류함</h3>
            <span>{count}개</span>
            <em>자동 분류 파일 캐비닛</em>
          </div>
          <div className="kim-doc-head-actions">
            <label aria-label="서류 파일 첨부" className="kim-mvp-add-circle kim-doc-upload-trigger">
              <Paperclip size={13} strokeWidth={2.4} />
              <input accept="image/*,.pdf,application/pdf" multiple onChange={handlers.addFromInput} type="file" />
            </label>
            <button
              aria-label="서류 PDF 병합 다운로드"
              className="kim-mvp-add-circle"
              disabled={isMerging || documents.length === 0}
              onClick={handlers.mergePdf}
              title="이미지·PDF 서류를 하나의 PDF로 병합해 다운로드"
              type="button"
            ><Download size={13} strokeWidth={2.4} /></button>
          </div>
        </div>
        <div className="kim-mvp-card-body" ref={bodyRef}>
          <div className="kim-doc-list">
            {documents.length === 0 ? (
              <div className="kim-doc-empty">
                <strong>등록된 서류가 없습니다.</strong>
                <p>면허증, 등본, 소득서류, 계약서류, 등록서류 등 이미지, PDF 파일을 올리면 자동으로 인식됩니다.</p>
              </div>
            ) : documents.map((doc, index) => {
              const shouldOpenDocumentDeleteAbove = index > 0 && index === documents.length - 1;
              const fileKind = kimDocumentFileKind(doc.mimeType, doc.fileName);
              return (
              <div
                className={`kim-doc-row${draggedId === doc.id ? " is-dragging" : ""}${dropTargetId === doc.id ? " is-drop-target" : ""}`}
                key={doc.id}
                onDragEnd={handlers.clearRowDrag}
                onDragLeave={(event) => handlers.rowDragLeave(event, doc.id)}
                onDragOver={(event) => handlers.rowDragOver(event, doc.id)}
                onDrop={(event) => handlers.dropRow(event, doc.id)}
              >
                <span aria-label={`${fileKind} 파일`} className={`kim-doc-kind-badge kind-${fileKind === "이미지" ? "image" : fileKind === "PDF" ? "pdf" : "file"}`} title={`${fileKind} 파일`}>
                  {kimDocumentFileIcon(fileKind)}
                </span>
                <div>
                  <select className="kim-doc-type-native-select" aria-label={`${doc.fileName} 문서 종류 변경`} value={doc.title} onChange={(event) => handlers.updateType(doc.id, event.target.value)}>
                    {DOC_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <p>{doc.status} · {doc.fileName} · {formatKimFileSize(doc.fileSize)}</p>
                </div>
                <div className="kim-doc-row-actions">
                  <span
                    aria-label={`${doc.title} 순서 이동`}
                    className="kim-doc-drag-handle"
                    draggable
                    onDragStart={(event) => handlers.startRowDrag(event, doc.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <GripVertical size={13} strokeWidth={2.2} />
                  </span>
                  <button aria-label={`${doc.title} 미리보기`} onClick={() => handlers.openPreview(doc.id)} type="button">
                    <Eye size={13} strokeWidth={2.3} />
                  </button>
                  <button
                    aria-label="서류 항목 삭제"
                    className="delete"
                    onClick={() => handlers.requestDelete(doc.id)}
                    type="button"
                  >
                    <Trash2 size={13} strokeWidth={2.3} />
                  </button>
                </div>
                {confirmingDeleteId === doc.id ? (
                  <div className={`kim-check-confirm-popover delete${shouldOpenDocumentDeleteAbove ? " is-above" : ""}`} ref={deleteRef} role="dialog" aria-label="서류 항목 삭제 확인">
                    <p>해당 서류를 삭제하시겠습니까?</p>
                    <div>
                      <button type="button" onClick={handlers.cancelDelete}>아니요</button>
                      <button className="danger" type="button" onClick={() => handlers.confirmDelete(doc.id)}>삭제</button>
                    </div>
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>
        </div>
        <div className="kim-file-drop-overlay kim-doc-drop-overlay" aria-hidden="true">
          <FileUp size={30} strokeWidth={1.9} />
          <strong>고객 서류 첨부</strong>
          <span>이미지와 PDF를 인식해 자동 분류합니다</span>
        </div>
      </article>
      {previewDocument ? (
        <div className="kim-document-preview-backdrop" role="dialog" aria-label={`${previewDocument.title} 미리보기`} onClick={handlers.closePreview}>
          <div className="kim-document-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="kim-document-preview-head">
              <div>
                <strong>{previewDocument.title}</strong>
                <span>{previewDocument.fileName} · {formatKimFileSize(previewDocument.fileSize)}</span>
              </div>
              <div className="kim-document-preview-head-actions">
                {/* 닫기처럼 항상 렌더 — URL 발급 전엔 disabled로(이전엔 URL 준비 후에야 버튼이 떠 뒤늦게 나타났다). */}
                <button aria-label="원본 다운로드" disabled={!activeDownloadUrl} onClick={() => { if (activeDownloadUrl) handlers.download(activeDownloadUrl, previewDocument.fileName ?? "document"); }} type="button"><Download size={15} strokeWidth={2.3} /></button>
                <button aria-label="서류 미리보기 닫기" onClick={handlers.closePreview} type="button"><X size={15} strokeWidth={2.4} /></button>
              </div>
            </div>
            <div className="kim-document-preview-body">
              {!activePreviewDocumentUrl ? (
                <div className="kim-document-preview-loading" role="status">불러오는 중…</div>
              ) : previewDocument.mimeType?.startsWith("image/") ? (
                <>
                  {!previewImageLoaded ? <div className="kim-document-preview-loading" role="status">불러오는 중…</div> : null}
                  <img alt={previewDocument.title} src={activePreviewDocumentUrl} onLoad={() => handlers.onImageLoad(activePreviewDocumentUrl)} style={previewImageLoaded ? undefined : { display: "none" }} />
                </>
              ) : kimDocumentFileKind(previewDocument.mimeType, previewDocument.fileName) === "PDF" ? (
                <iframe src={activePreviewDocumentUrl} title={previewDocument.title} />
              ) : (
                <div className="kim-document-preview-fallback">
                  <p>이 형식은 미리보기를 지원하지 않습니다.</p>
                  <button className="kim-doc-preview-download-link" onClick={() => handlers.download(activeDownloadUrl ?? activePreviewDocumentUrl, previewDocument.fileName ?? "document")} type="button">원본 다운로드</button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
