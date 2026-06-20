import { and, eq, max } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { customerDocuments } from "../schema";

type Created = { id: string; createdAt: Date };

// 업로드 시 끝에 추가할 sort_order(최댓값+1, 없으면 0).
export async function nextSortOrder(customerId: string, ex: Executor = getDefaultDb()): Promise<number> {
  const [row] = await ex
    .select({ m: max(customerDocuments.sortOrder) })
    .from(customerDocuments)
    .where(eq(customerDocuments.customerId, customerId));
  return (row?.m ?? -1) + 1;
}

export async function addDocument(
  customerId: string,
  v: {
    title?: string | null;
    docType?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
    fileMime?: string | null;
    filePath: string;
    sortOrder?: number | null;
  },
  ex: Executor = getDefaultDb(),
): Promise<Created> {
  const [row] = await ex
    .insert(customerDocuments)
    .values({
      customerId,
      title: v.title ?? null,
      docType: v.docType ?? null,
      fileName: v.fileName ?? null,
      fileSize: v.fileSize ?? null,
      fileMime: v.fileMime ?? null,
      filePath: v.filePath,
      sortOrder: v.sortOrder ?? null,
    })
    .returning({ id: customerDocuments.id, createdAt: customerDocuments.createdAt });
  return row;
}

export async function updateDocument(
  customerId: string,
  id: string,
  patch: { docType?: string | null },
  ex: Executor = getDefaultDb(),
): Promise<{ id: string } | null> {
  const [row] = await ex
    .update(customerDocuments)
    .set(patch)
    .where(and(eq(customerDocuments.id, id), eq(customerDocuments.customerId, customerId)))
    .returning({ id: customerDocuments.id });
  return row ?? null;
}

// 삭제 후 Storage remove에 file_path가 필요해 함께 반환.
export async function deleteDocument(
  customerId: string,
  id: string,
  ex: Executor = getDefaultDb(),
): Promise<{ id: string; filePath: string | null } | null> {
  const [row] = await ex
    .delete(customerDocuments)
    .where(and(eq(customerDocuments.id, id), eq(customerDocuments.customerId, customerId)))
    .returning({ id: customerDocuments.id, filePath: customerDocuments.filePath });
  return row ?? null;
}

// signed URL 발급용 — 경로/타입만.
export async function getDocumentPath(
  customerId: string,
  id: string,
  ex: Executor = getDefaultDb(),
): Promise<{ filePath: string | null; fileMime: string | null } | null> {
  const [row] = await ex
    .select({ filePath: customerDocuments.filePath, fileMime: customerDocuments.fileMime })
    .from(customerDocuments)
    .where(and(eq(customerDocuments.id, id), eq(customerDocuments.customerId, customerId)));
  return row ?? null;
}

// 재정렬: 각 row sort_order 갱신(customer_id 가드). 저빈도라 단건 루프.
export async function reorderDocuments(
  customerId: string,
  order: { id: string; sortOrder: number }[],
  ex: Executor = getDefaultDb(),
): Promise<void> {
  for (const o of order) {
    await ex
      .update(customerDocuments)
      .set({ sortOrder: o.sortOrder })
      .where(and(eq(customerDocuments.id, o.id), eq(customerDocuments.customerId, customerId)));
  }
}

