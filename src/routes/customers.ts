import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getCustomer, listCustomers, updateCustomer } from "../db/queries/customers";
import {
  addMemo, updateMemo, deleteMemo,
  addTask, updateTask, deleteTask,
  addSchedule, updateSchedule, deleteSchedule,
} from "../db/queries/customer-children";
import { addDocument, deleteDocument, getDocumentPath, nextSortOrder, reorderDocuments, updateDocument } from "../db/queries/customer-documents";
import { isAllowedMime, MAX_DOC_BYTES, safeFileName } from "../lib/document-validation";
import { createSignedUrl, removeObject, uploadObject } from "../lib/storage";
import type { DbVariables } from "../middleware/db";

export const customers = new Hono<{ Variables: DbVariables }>();

// 쓰기 가능 컬럼(전부 optional·문자열 nullable). 값 enum 검증 없음(추후 사이클).
export const customerWriteSchema = z.object({
  phone: z.string().nullable().optional(),
  residence: z.string().nullable().optional(),
  customerType: z.string().nullable().optional(),
  customerTypeDetail: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  statusGroup: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  chance: z.string().nullable().optional(),
  needModel: z.string().nullable().optional(),
  needTrim: z.string().nullable().optional(),
  needColors: z.string().nullable().optional(),
  needMethod: z.string().nullable().optional(),
  needTiming: z.string().nullable().optional(),
  needMemo: z.string().nullable().optional(),
});

customers.get("/", async (c) => c.json(await listCustomers(c.var.db)));

customers.get("/:id", zValidator("param", z.object({ id: z.uuid() })), async (c) => {
  const row = await getCustomer(c.req.valid("param").id, c.var.db);
  return row ? c.json(row) : c.json({ error: "고객을 찾을 수 없습니다." }, 404);
});

customers.patch(
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  zValidator("json", customerWriteSchema),
  async (c) => {
    const row = await updateCustomer(c.req.valid("param").id, c.req.valid("json"), c.var.db);
    return row ? c.json(row) : c.json({ error: "고객을 찾을 수 없습니다." }, 404);
  },
);

// ── 자식 컬렉션 CRUD (메모/할일/일정) ──────────────────────────────
const idParam = z.object({ id: z.uuid() });
const childParam = z.object({ id: z.uuid(), childId: z.uuid() });
const memoBody = z.object({ body: z.string().nullable().optional() });
const taskBody = z.object({ category: z.string().nullable().optional(), due: z.string().nullable().optional(), body: z.string().nullable().optional(), done: z.boolean().optional() });
const scheduleBody = z.object({ scheduledDate: z.string().nullable().optional(), scheduledTime: z.string().nullable().optional(), type: z.string().nullable().optional(), memo: z.string().nullable().optional(), done: z.boolean().optional() });

customers.post("/:id/memos", zValidator("param", idParam), zValidator("json", memoBody), async (c) =>
  c.json(await addMemo(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/memos/:childId", zValidator("param", childParam), zValidator("json", memoBody), async (c) => {
  const p = c.req.valid("param");
  const row = await updateMemo(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "메모를 찾을 수 없습니다." }, 404);
});
customers.delete("/:id/memos/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteMemo(p.id, p.childId, c.var.db);
  return row ? c.json(row) : c.json({ error: "메모를 찾을 수 없습니다." }, 404);
});

customers.post("/:id/tasks", zValidator("param", idParam), zValidator("json", taskBody), async (c) =>
  c.json(await addTask(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/tasks/:childId", zValidator("param", childParam), zValidator("json", taskBody), async (c) => {
  const p = c.req.valid("param");
  const row = await updateTask(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "할 일을 찾을 수 없습니다." }, 404);
});
customers.delete("/:id/tasks/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteTask(p.id, p.childId, c.var.db);
  return row ? c.json(row) : c.json({ error: "할 일을 찾을 수 없습니다." }, 404);
});

customers.post("/:id/schedules", zValidator("param", idParam), zValidator("json", scheduleBody), async (c) =>
  c.json(await addSchedule(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/schedules/:childId", zValidator("param", childParam), zValidator("json", scheduleBody), async (c) => {
  const p = c.req.valid("param");
  const row = await updateSchedule(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "일정을 찾을 수 없습니다." }, 404);
});
customers.delete("/:id/schedules/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteSchedule(p.id, p.childId, c.var.db);
  return row ? c.json(row) : c.json({ error: "일정을 찾을 수 없습니다." }, 404);
});

// ── 서류함 (업로드/분류/순서/삭제/미리보기 URL) ──────────────────
customers.post("/:id/documents", zValidator("param", idParam), async (c) => {
  const customerId = c.req.valid("param").id;
  const body = await c.req.parseBody();
  const file = body["file"];
  const docType = typeof body["docType"] === "string" ? body["docType"] : null;
  if (!(file instanceof File)) return c.json({ error: "파일이 필요합니다." }, 400);
  if (!isAllowedMime(file.type)) return c.json({ error: "허용되지 않는 파일 형식입니다." }, 415);
  if (file.size > MAX_DOC_BYTES) return c.json({ error: "파일이 너무 큽니다(최대 20MB)." }, 413);

  const objectId = crypto.randomUUID();
  const path = `${customerId}/${objectId}-${safeFileName(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await uploadObject(c.env as { SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string } | undefined, path, bytes, file.type || "application/octet-stream");
  try {
    const sortOrder = await nextSortOrder(customerId, c.var.db);
    const row = await addDocument(
      customerId,
      { title: docType, docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, filePath: path, sortOrder },
      c.var.db,
    );
    return c.json({ id: row.id, title: docType, docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, sortOrder, createdAt: row.createdAt }, 201);
  } catch (e) {
    await removeObject(c.env as { SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string } | undefined, path).catch(() => undefined); // 보상 삭제
    throw e;
  }
});

customers.patch("/:id/documents/reorder", zValidator("param", idParam), zValidator("json", z.object({ order: z.array(z.object({ id: z.uuid(), sortOrder: z.number().int() })) })), async (c) => {
  await reorderDocuments(c.req.valid("param").id, c.req.valid("json").order, c.var.db);
  return c.json({ ok: true });
});

customers.patch("/:id/documents/:childId", zValidator("param", childParam), zValidator("json", z.object({ docType: z.string().nullable().optional() })), async (c) => {
  const p = c.req.valid("param");
  const row = await updateDocument(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "서류를 찾을 수 없습니다." }, 404);
});

customers.delete("/:id/documents/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteDocument(p.id, p.childId, c.var.db);
  if (!row) return c.json({ error: "서류를 찾을 수 없습니다." }, 404);
  if (row.filePath) await removeObject(c.env as { SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string } | undefined, row.filePath).catch((err) => console.error("Storage remove 실패(고아 객체):", err));
  return c.json({ id: row.id });
});

customers.get("/:id/documents/:childId/url", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await getDocumentPath(p.id, p.childId, c.var.db);
  if (!row?.filePath) return c.json({ error: "서류를 찾을 수 없습니다." }, 404);
  const url = await createSignedUrl(c.env as { SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string } | undefined, row.filePath, 60);
  return c.json({ url, fileMime: row.fileMime });
});
