import { apiFetch } from "./api";
import { getJson, sendVoid } from "./http";
import { invalidateCustomerDetail } from "./customers";
import { createImageThumbnail } from "./image-thumbnail";

// 서버 POST 응답(업로드 성공 시 새 row 메타). file_path는 비노출.
export type UploadedDocument = {
  id: string;
  docType: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileMime: string | null;
  sortOrder: number | null;
  createdAt: string | null;
};

// 업로드는 multipart라 Content-Type을 직접 지정하지 않는다(브라우저가 boundary 포함). 쓰기라 재시도 비대상.
// multipart라 lib/http(JSON 전용) 대신 apiFetch 직접 사용.
export async function uploadDocument(cid: string, file: File, docType: string): Promise<UploadedDocument> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("docType", docType);
  // 이미지면 미리보기용 JPEG 썸네일을 브라우저에서 구워 함께 올린다(가볍고 Safari가 확실히 렌더).
  // 실패(디코딩 불가 등)하면 thumb 없이 진행 — 미리보기는 원본으로 폴백한다.
  if (file.type.startsWith("image/")) {
    const thumb = await createImageThumbnail(file);
    if (thumb) fd.append("thumb", thumb);
  }
  const res = await apiFetch(`/api/customers/${cid}/documents`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`서류 업로드 실패: ${res.status}`);
  const data = (await res.json()) as UploadedDocument;
  invalidateCustomerDetail(cid);
  return data;
}

export async function updateDocumentTypeApi(cid: string, id: string, docType: string): Promise<void> {
  await sendVoid(`/api/customers/${cid}/documents/${id}`, "PATCH", { docType });
  invalidateCustomerDetail(cid);
}

export async function deleteDocumentApi(cid: string, id: string): Promise<void> {
  await sendVoid(`/api/customers/${cid}/documents/${id}`, "DELETE");
  invalidateCustomerDetail(cid);
}

export async function reorderDocumentsApi(cid: string, order: { id: string; sortOrder: number }[]): Promise<void> {
  await sendVoid(`/api/customers/${cid}/documents/reorder`, "PATCH", { order });
  invalidateCustomerDetail(cid);
}

// url=미리보기(이미지면 썸네일), downloadUrl=원본(다운로드용).
export async function getDocumentUrlApi(cid: string, id: string): Promise<{ url: string; downloadUrl: string; fileMime: string | null }> {
  return getJson(`/api/customers/${cid}/documents/${id}/url`);
}
