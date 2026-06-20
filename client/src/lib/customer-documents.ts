import { apiFetch } from "./api";
import { invalidateCustomerDetail } from "./customers";

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
export async function uploadDocument(cid: string, file: File, docType: string): Promise<UploadedDocument> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("docType", docType);
  const res = await apiFetch(`/api/customers/${cid}/documents`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`서류 업로드 실패: ${res.status}`);
  const data = (await res.json()) as UploadedDocument;
  invalidateCustomerDetail(cid);
  return data;
}

export async function updateDocumentTypeApi(cid: string, id: string, docType: string): Promise<void> {
  const res = await apiFetch(`/api/customers/${cid}/documents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docType }) });
  if (!res.ok) throw new Error(`서류 분류 수정 실패: ${res.status}`);
  invalidateCustomerDetail(cid);
}

export async function deleteDocumentApi(cid: string, id: string): Promise<void> {
  const res = await apiFetch(`/api/customers/${cid}/documents/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`서류 삭제 실패: ${res.status}`);
  invalidateCustomerDetail(cid);
}

export async function reorderDocumentsApi(cid: string, order: { id: string; sortOrder: number }[]): Promise<void> {
  const res = await apiFetch(`/api/customers/${cid}/documents/reorder`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order }) });
  if (!res.ok) throw new Error(`서류 순서 변경 실패: ${res.status}`);
  invalidateCustomerDetail(cid);
}

export async function getDocumentUrlApi(cid: string, id: string): Promise<{ url: string; fileMime: string | null }> {
  const res = await apiFetch(`/api/customers/${cid}/documents/${id}/url`);
  if (!res.ok) throw new Error(`서류 URL 발급 실패: ${res.status}`);
  return (await res.json()) as { url: string; fileMime: string | null };
}
