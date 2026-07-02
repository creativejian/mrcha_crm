import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getCustomer, getCustomerAdvisorName, getCustomerAppUserId, listCustomers, updateCustomer, type CustomerWritePatch } from "../db/queries/customers";
import { listQuoteRequestsByUser } from "../db/queries/quote-requests";
import {
  addMemo, updateMemo, deleteMemo,
  addTask, updateTask, deleteTask,
  addSchedule, updateSchedule, deleteSchedule,
} from "../db/queries/customer-children";
import { addDocument, deleteDocument, getDocumentPath, nextSortOrder, reorderDocuments, updateDocument } from "../db/queries/customer-documents";
import { createQuote, deleteQuote, updateQuote, setQuoteFile, clearQuoteFile, getQuoteFilePath } from "../db/queries/customer-quotes";
import { validateLookupValue, validateStatusSelection } from "../lib/lookup-validate";
import { isAllowedMime, MAX_DOC_BYTES, safeFileName } from "../lib/document-validation";
import { createSignedUrl, removeObject, uploadObject, type StorageEnv } from "../lib/storage";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

export const customers = new Hono<{ Variables: DbVariables }>();

// 쓰기 가능 컬럼(전부 optional·문자열 nullable). 값 enum 검증 없음(추후 사이클).
export const customerWriteSchema = z.object({
  phone: z.string().nullable().optional(),
  residence: z.string().nullable().optional(),
  customerType: z.enum(["개인", "개인사업자", "법인사업자"]).nullable().optional(),
  customerTypeDetail: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  statusGroup: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  chance: z.string().nullable().optional(),
  advisorName: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  needModel: z.string().nullable().optional(),
  needTrim: z.string().nullable().optional(),
  needColors: z.string().nullable().optional(),
  needMethod: z.string().nullable().optional(),
  needTiming: z.string().nullable().optional(),
  needMemo: z.string().nullable().optional(),
  needContractTerm: z.string().nullable().optional(),
  needInitialCost: z.string().nullable().optional(),
  needAnnualMileage: z.string().nullable().optional(),
  needDeliveryMethod: z.string().nullable().optional(),
  needContractFocus: z.string().nullable().optional(),
  needCustomerNote: z.string().nullable().optional(),
  needReviewNote: z.string().nullable().optional(),
});

customers.get("/", async (c) => c.json(await listCustomers(c.var.db)));

customers.get("/:id", zValidator("param", z.object({ id: z.uuid() })), (c) =>
  run(c, () => getCustomer(c.req.valid("param").id, c.var.db), "고객을 찾을 수 없습니다."));

// 고객 상세 니즈 영역: 그 고객(app_user_id)의 앱 견적요청 목록. 수기 고객(app_user 없음)은 빈 배열.
customers.get("/:id/quote-requests", zValidator("param", z.object({ id: z.uuid() })), (c) =>
  run(
    c,
    async () => {
      const found = await getCustomerAppUserId(c.req.valid("param").id, c.var.db);
      if (!found) return null; // 고객 없음 → 404
      return found.appUserId ? listQuoteRequestsByUser(found.appUserId, c.var.db) : [];
    },
    "고객을 찾을 수 없습니다.",
  ),
);

customers.patch(
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  zValidator("json", customerWriteSchema),
  async (c) => {
    const patch = c.req.valid("json");
    // 진행상태(1차/2차) 키가 올 때만 lookup 종속 검증. 그 외엔 추가 왕복 0.
    if (patch.statusGroup !== undefined || patch.status !== undefined) {
      const error = validateStatusSelection({ statusGroup: patch.statusGroup, status: patch.status });
      if (error) return c.json({ error }, 400);
    }
    // 계약 가능성(chance) 닫힌 집합 검증. chance 키가 올 때만 1쿼리.
    if (patch.chance !== undefined) {
      const error = validateLookupValue("chance", patch.chance);
      if (error) return c.json({ error }, 400);
    }
    // 유입 경로(source) 닫힌 집합 검증.
    if (patch.source !== undefined) {
      const error = validateLookupValue("source", patch.source);
      if (error) return c.json({ error }, 400);
    }
    // 담당자 배정(advisorName): 배정시각은 서버가 기록(클라 시각 신뢰 안 함).
    // 담당자가 실제로 바뀔 때만 스탬프 — 동일 담당자 재저장(팀만 변경 등)에 assigned_at을 리셋하면
    // 목록 '배정 후 N분' SLA가 왜곡된다. 해제(null)면 배정시각도 함께 비운다(미배정+배정시각 모순 방지).
    let finalPatch: CustomerWritePatch = patch;
    if (patch.advisorName !== undefined) {
      if (patch.advisorName === null) {
        finalPatch = { ...patch, assignedAt: null };
      } else {
        const current = await getCustomerAdvisorName(c.req.valid("param").id, c.var.db);
        if (!current) return c.json({ error: "고객을 찾을 수 없습니다." }, 404);
        if (current.advisorName !== patch.advisorName) finalPatch = { ...patch, assignedAt: new Date() };
      }
    }
    return run(c, () => updateCustomer(c.req.valid("param").id, finalPatch, c.var.db), "고객을 찾을 수 없습니다.");
  },
);

// ── 자식 컬렉션 CRUD (메모/할일/일정) ──────────────────────────────
const idParam = z.object({ id: z.uuid() });
const childParam = z.object({ id: z.uuid(), childId: z.uuid() });
const memoBody = z.object({ body: z.string().nullable().optional() });
const taskBody = z.object({ category: z.string().nullable().optional(), due: z.string().nullable().optional(), body: z.string().nullable().optional(), done: z.boolean().optional() });
const scheduleBody = z.object({ scheduledDate: z.string().nullable().optional(), scheduledTime: z.string().nullable().optional(), type: z.string().nullable().optional(), memo: z.string().nullable().optional(), done: z.boolean().optional() });
const quoteScenarioBody = z.object({
  scenarioNo: z.number().int().nullable().optional(),
  isSaved: z.boolean().optional(),
  purchaseMethod: z.enum(["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"]).nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  monthlyPayment: z.string().nullable().optional(),
  lender: z.string().nullable().optional(),
  depositMode: z.string().nullable().optional(),
  depositValue: z.string().nullable().optional(),
  downPaymentMode: z.string().nullable().optional(),
  downPaymentValue: z.string().nullable().optional(),
  residualMode: z.string().nullable().optional(),
  residualValue: z.string().nullable().optional(),
  mileageMode: z.string().nullable().optional(),
  mileageValue: z.string().nullable().optional(),
});
const quoteGuidanceSchema = z.object({
  deliveryComment: z.string(),
  stockNotice: z.string(),
  expectedDelivery: z.string(),
  customerRegion: z.string(),
  keyPoint: z.string(),
  recommendReason: z.string(),
  services: z.array(z.string()),
});
const quoteCreateBody = z.object({
  entryMode: z.enum(["manual", "solution", "original"]).nullable().optional(),
  status: z.string().nullable().optional(),
  quoteRound: z.string().nullable().optional(),
  stockStatus: z.enum(["재고있음", "재고없음", "재고확인중"]).nullable().optional(),
  brandName: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  trimName: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  sourceQuoteRequestId: z.uuid().nullable().optional(),
  guidance: quoteGuidanceSchema.nullable().optional(),
  // #4c-2 워크벤치 스냅샷(전부 optional, composer는 미전송)
  trimId: z.number().int().nullable().optional(),
  basePrice: z.string().nullable().optional(),
  optionTotal: z.string().nullable().optional(),
  options: z.array(z.object({ id: z.number().int(), name: z.string(), price: z.number().nullable() })).nullable().optional(),
  finalDiscount: z.string().nullable().optional(),
  acquisitionTax: z.string().nullable().optional(),
  acquisitionTaxMode: z.enum(["normal", "hybrid", "electric", "manual"]).nullable().optional(),
  bond: z.string().nullable().optional(),
  delivery: z.string().nullable().optional(),
  incidental: z.string().nullable().optional(),
  finalVehiclePrice: z.string().nullable().optional(),
  acquisitionCost: z.string().nullable().optional(),
  exteriorColorId: z.number().int().nullable().optional(),
  exteriorColorName: z.string().nullable().optional(),
  exteriorColorHex: z.string().nullable().optional(),
  interiorColorId: z.number().int().nullable().optional(),
  interiorColorName: z.string().nullable().optional(),
  interiorColorHex: z.string().nullable().optional(),
  scenario: quoteScenarioBody.optional(),
  scenarios: z.array(quoteScenarioBody).max(3).optional(),
});
const quotePatchBody = z.object({
  status: z.string().nullable().optional(),
  entryMode: z.enum(["manual", "solution", "original"]).nullable().optional(),
  quoteRound: z.string().nullable().optional(),
  stockStatus: z.enum(["재고있음", "재고없음", "재고확인중"]).nullable().optional(),
  brandName: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  trimName: z.string().nullable().optional(),
  appStatus: z.enum(["draft", "queued", "sent", "viewed"]).nullable().optional(),
  decisionStatus: z.enum(["none", "considering", "confirmed", "contracting"]).nullable().optional(),
  note: z.string().nullable().optional(),
  guidance: quoteGuidanceSchema.nullable().optional(),
  primaryScenarioId: z.uuid().nullable().optional(),
  bumpRevision: z.boolean().optional(),
  scenario: quoteScenarioBody.optional(),
  // PR2a: 워크벤치 수정용 스냅샷 + 다중 시나리오 교체
  trimId: z.number().int().nullable().optional(),
  basePrice: z.string().nullable().optional(),
  optionTotal: z.string().nullable().optional(),
  options: z.array(z.object({ id: z.number().int(), name: z.string(), price: z.number().nullable() })).nullable().optional(),
  finalDiscount: z.string().nullable().optional(),
  acquisitionTax: z.string().nullable().optional(),
  acquisitionTaxMode: z.enum(["normal", "hybrid", "electric", "manual"]).nullable().optional(),
  bond: z.string().nullable().optional(),
  delivery: z.string().nullable().optional(),
  incidental: z.string().nullable().optional(),
  finalVehiclePrice: z.string().nullable().optional(),
  acquisitionCost: z.string().nullable().optional(),
  exteriorColorId: z.number().int().nullable().optional(),
  exteriorColorName: z.string().nullable().optional(),
  exteriorColorHex: z.string().nullable().optional(),
  interiorColorId: z.number().int().nullable().optional(),
  interiorColorName: z.string().nullable().optional(),
  interiorColorHex: z.string().nullable().optional(),
  scenarios: z.array(quoteScenarioBody).max(3).optional(),
});

customers.post("/:id/memos", zValidator("param", idParam), zValidator("json", memoBody), async (c) =>
  c.json(await addMemo(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/memos/:childId", zValidator("param", childParam), zValidator("json", memoBody), (c) => {
  const p = c.req.valid("param");
  return run(c, () => updateMemo(p.id, p.childId, c.req.valid("json"), c.var.db), "메모를 찾을 수 없습니다.");
});
customers.delete("/:id/memos/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, () => deleteMemo(p.id, p.childId, c.var.db), "메모를 찾을 수 없습니다.");
});

customers.post("/:id/tasks", zValidator("param", idParam), zValidator("json", taskBody), async (c) => {
  const body = c.req.valid("json");
  if (body.category !== undefined) {
    const error = validateLookupValue("task_category", body.category);
    if (error) return c.json({ error }, 400);
  }
  return c.json(await addTask(c.req.valid("param").id, body, c.var.db), 201);
});
customers.patch("/:id/tasks/:childId", zValidator("param", childParam), zValidator("json", taskBody), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.category !== undefined) {
    const error = validateLookupValue("task_category", body.category);
    if (error) return c.json({ error }, 400);
  }
  return run(c, () => updateTask(p.id, p.childId, body, c.var.db), "할 일을 찾을 수 없습니다.");
});
customers.delete("/:id/tasks/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, () => deleteTask(p.id, p.childId, c.var.db), "할 일을 찾을 수 없습니다.");
});

customers.post("/:id/schedules", zValidator("param", idParam), zValidator("json", scheduleBody), async (c) => {
  const body = c.req.valid("json");
  if (body.type !== undefined) {
    const error = validateLookupValue("schedule_type", body.type);
    if (error) return c.json({ error }, 400);
  }
  return c.json(await addSchedule(c.req.valid("param").id, body, c.var.db), 201);
});
customers.patch("/:id/schedules/:childId", zValidator("param", childParam), zValidator("json", scheduleBody), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.type !== undefined) {
    const error = validateLookupValue("schedule_type", body.type);
    if (error) return c.json({ error }, 400);
  }
  return run(c, () => updateSchedule(p.id, p.childId, body, c.var.db), "일정을 찾을 수 없습니다.");
});
customers.delete("/:id/schedules/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, () => deleteSchedule(p.id, p.childId, c.var.db), "일정을 찾을 수 없습니다.");
});

// ── 견적 생성(composer 견적 작성 → quote + 대표 시나리오 INSERT) ──────
customers.post("/:id/quotes", zValidator("param", idParam), zValidator("json", quoteCreateBody), async (c) => {
  const id = c.req.valid("param").id;
  const body = c.req.valid("json");
  const row = await c.var.db.transaction((tx) => createQuote(id, body, tx));
  return c.json(row, 201);
});

// ── 견적 쓰기(기존 견적 메타/시나리오 수정·삭제·상태 토글) ──────────
customers.patch("/:id/quotes/:childId", zValidator("param", childParam), zValidator("json", quotePatchBody), (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  return run(c, () => c.var.db.transaction((tx) => updateQuote(p.id, p.childId, body, tx)), "견적을 찾을 수 없습니다.");
});
customers.delete("/:id/quotes/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, () => deleteQuote(p.id, p.childId, c.var.db), "견적을 찾을 수 없습니다.");
});

// ── 견적 원본 파일(#4d — 견적함 행 드롭, 이미지/PDF Storage 영속) ──────
customers.post("/:id/quotes/:childId/original", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "파일이 필요합니다." }, 400);
  if (!isAllowedMime(file.type)) return c.json({ error: "허용되지 않는 파일 형식입니다." }, 415);
  if (file.size > MAX_DOC_BYTES) return c.json({ error: "파일이 너무 큽니다(최대 20MB)." }, 413);

  const env = c.env as StorageEnv;
  const objectId = crypto.randomUUID();
  const path = `${p.id}/quotes/${p.childId}-${objectId}-${safeFileName(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await uploadObject(env, path, bytes, file.type || "application/octet-stream");
  try {
    const result = await setQuoteFile(p.id, p.childId, { fileName: file.name, fileSize: file.size, fileMime: file.type || null, filePath: path }, c.var.db);
    if (!result) {
      await removeObject(env, path).catch(() => undefined); // 견적 없음 → 업로드 객체 보상 삭제
      return c.json({ error: "견적을 찾을 수 없습니다." }, 404);
    }
    if (result.previousFilePath) await removeObject(env, result.previousFilePath).catch(() => undefined); // 교체 시 이전 객체 삭제
    return c.json({ fileName: file.name, fileSize: file.size, fileMime: file.type || null }, 201);
  } catch (e) {
    await removeObject(env, path).catch(() => undefined);
    throw e;
  }
});

customers.delete("/:id/quotes/:childId/original", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const result = await clearQuoteFile(p.id, p.childId, c.var.db);
  if (!result) return c.json({ error: "견적을 찾을 수 없습니다." }, 404);
  const env = c.env as StorageEnv;
  if (result.previousFilePath) await removeObject(env, result.previousFilePath).catch((err) => console.error("Storage remove 실패(고아 객체):", err));
  return c.json({ id: p.childId });
});

customers.get("/:id/quotes/:childId/original/url", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await getQuoteFilePath(p.id, p.childId, c.var.db);
  if (!row?.filePath) return c.json({ error: "견적 원본을 찾을 수 없습니다." }, 404);
  const env = c.env as StorageEnv;
  const url = await createSignedUrl(env, row.filePath, 60); // 견적 원본은 썸네일 없음 → url=downloadUrl
  return c.json({ url, downloadUrl: url, fileMime: row.fileMime });
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
  if (docType !== null) {
    const error = validateLookupValue("doc_type", docType);
    if (error) return c.json({ error }, 400);
  }

  const env = c.env as StorageEnv;
  const objectId = crypto.randomUUID();
  const path = `${customerId}/${objectId}-${safeFileName(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await uploadObject(env, path, bytes, file.type || "application/octet-stream");

  // 미리보기용 썸네일: 클라가 canvas로 구운 JPEG(있으면). 별도 객체로 저장하고 thumb_path에 기록한다.
  // 미리보기를 이 JPEG로 내보내면 가볍고 모든 브라우저(특히 Safari)가 렌더한다(render/image WebP 변환 폐기).
  const thumb = body["thumb"];
  let thumbPath: string | null = null;
  if (thumb instanceof File && thumb.type.startsWith("image/") && thumb.size > 0 && thumb.size <= MAX_DOC_BYTES) {
    thumbPath = `${customerId}/${objectId}-thumb.jpg`;
    await uploadObject(env, thumbPath, new Uint8Array(await thumb.arrayBuffer()), "image/jpeg");
  }

  try {
    const sortOrder = await nextSortOrder(customerId, c.var.db);
    const row = await addDocument(
      customerId,
      { docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, filePath: path, thumbPath, sortOrder },
      c.var.db,
    );
    return c.json({ id: row.id, docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, sortOrder, createdAt: row.createdAt }, 201);
  } catch (e) {
    await removeObject(env, path).catch(() => undefined); // 보상 삭제
    if (thumbPath) await removeObject(env, thumbPath).catch(() => undefined);
    throw e;
  }
});

customers.patch("/:id/documents/reorder", zValidator("param", idParam), zValidator("json", z.object({ order: z.array(z.object({ id: z.uuid(), sortOrder: z.number().int() })) })), async (c) => {
  await reorderDocuments(c.req.valid("param").id, c.req.valid("json").order, c.var.db);
  return c.json({ ok: true });
});

customers.patch("/:id/documents/:childId", zValidator("param", childParam), zValidator("json", z.object({ docType: z.string().nullable().optional() })), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.docType !== undefined) {
    const error = validateLookupValue("doc_type", body.docType);
    if (error) return c.json({ error }, 400);
  }
  return run(c, () => updateDocument(p.id, p.childId, body, c.var.db), "서류를 찾을 수 없습니다.");
});

customers.delete("/:id/documents/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteDocument(p.id, p.childId, c.var.db);
  if (!row) return c.json({ error: "서류를 찾을 수 없습니다." }, 404);
  const env = c.env as StorageEnv;
  if (row.filePath) await removeObject(env, row.filePath).catch((err) => console.error("Storage remove 실패(고아 객체):", err));
  if (row.thumbPath) await removeObject(env, row.thumbPath).catch((err) => console.error("Storage thumb remove 실패(고아 객체):", err));
  return c.json({ id: row.id });
});

customers.get("/:id/documents/:childId/url", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await getDocumentPath(p.id, p.childId, c.var.db);
  if (!row?.filePath) return c.json({ error: "서류를 찾을 수 없습니다." }, 404);
  const env = c.env as StorageEnv;
  // 미리보기: 이미지는 업로드 시 구운 JPEG 썸네일(thumb_path)로 — 가볍고 모든 브라우저(특히 Safari)가 렌더한다.
  // 썸네일 없는 옛 문서/비이미지는 원본으로 폴백. (render/image 변환은 Accept 협상으로 WebP를 내보내
  // Safari가 미리보기를 못 띄우는 회귀가 있어 폐기했다 — 2026-06-21.) 다운로드는 항상 원본.
  const isImage = (row.fileMime ?? "").startsWith("image/");
  const previewPath = isImage && row.thumbPath ? row.thumbPath : row.filePath;
  const url = await createSignedUrl(env, previewPath, 60);
  const downloadUrl = previewPath === row.filePath ? url : await createSignedUrl(env, row.filePath, 60);
  return c.json({ url, downloadUrl, fileMime: row.fileMime });
});
