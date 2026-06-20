# CRM 고객 서류 업로드(#3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 김민준(`CU-2605-0020`) 상세 drawer의 서류함을 메모리(objectURL)에서 Supabase private 버킷 영속 저장으로 전환한다(업로드·분류수정·순서·삭제·미리보기).

**Architecture:** 백엔드 경유 — Hono가 multipart로 파일을 받아 service_role 키로 Storage 업로드 + `crm.customer_documents` row 생성을 한 핸들러에서 처리. 미리보기/다운로드는 백엔드가 발급한 signed URL. 쓰기 #2(자식 CRUD)와 동일한 3계층 + Storage 래퍼. 김민준 전용 UI에만 실 연결.

**Tech Stack:** drizzle-orm pg-core(crm 스키마), Hono, @hono/zod-validator, @supabase/supabase-js(Storage), postgres-js, React 19, Vitest(프론트 단위), bun:test(서버), bun.

**Spec:** `ref/specs/2026-06-20-crm-customer-documents-design.md`

---

## File Structure

- **Create** `src/lib/document-validation.ts` — 순수 검증/정규화: `isAllowedMime`/`MAX_DOC_BYTES`/`safeFileName`. 단위테스트 대상.
- **Create** `src/lib/document-validation.test.ts` — 위 순수함수 단위테스트(bun:test).
- **Create** `src/lib/storage.ts` — service_role supabase 클라이언트 + `uploadObject`/`removeObject`/`createSignedUrl` + 버킷 상수. CF(`c.env`)/로컬(`process.env`) 키 해석.
- **Create** `src/db/queries/customer-documents.ts` — `addDocument`/`updateDocument`/`deleteDocument`/`getDocumentPath`/`reorderDocuments`/`nextSortOrder`.
- **Modify** `src/db/queries/customers.ts` — `getCustomer`의 documents를 명시 컬럼(`file_path` 제외) + `orderBy(sortOrder, createdAt)`. `CustomerDetail.documents` 타입 갱신.
- **Modify** `src/routes/customers.ts` — 서류 중첩 라우트 5개(POST multipart / PATCH docType / PATCH reorder / DELETE / GET url).
- **Modify** `src/routes/customers.test.ts` — 서류 라운드트립·검증거부 테스트(storage `mock.module`).
- **Create** `client/src/lib/customer-documents.ts` — 프론트 API 5종 + 캐시 무효화.
- **Modify** `client/src/lib/customers.ts` — `CustomerDetailDocument`에 `sortOrder`·`createdAt` 추가.
- **Modify** `client/src/pages/CustomerDetailPage.tsx` — `KimMinjunDetailContent` 서류 핸들러 DB 연결(낙관+롤백), 미리보기 signed URL, 업로드 허용형식 확장.
- **Modify** `.env.example` — `SUPABASE_SERVICE_ROLE_KEY` 키 이름 추가.

---

## Task 0: 사전 준비 (유슨생 액션 — 코드 아님)

> 이 태스크는 구현자가 실행할 수 없는 외부 작업이다. 시작 전 유슨생이 완료해야 백엔드 라우트가 동작한다. 미완료여도 Task 1~5의 코드 작성/단위·서버 테스트(storage 모킹)는 진행 가능 — 실제 업로드는 Task 6 수동 검증에서 필요.

- [ ] **버킷 생성**: master Supabase 프로젝트에 private 버킷 `customer-documents` 생성(Supabase MCP `apply_migration`로 `storage.buckets` insert, 또는 대시보드 Storage → New bucket → public 끄기). public 접근 차단.
- [ ] **service_role 키 등록(로컬)**: `.env.local`에 `SUPABASE_SERVICE_ROLE_KEY=<master 프로젝트 service_role 키>` 추가.
- [ ] **service_role 키 등록(CF)**: `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`(production+preview). 변경 후 재배포 필요.

---

## Task 1: 백엔드 검증 유틸 (순수, TDD)

**Files:**
- Create: `src/lib/document-validation.ts`
- Test: `src/lib/document-validation.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/document-validation.test.ts`:

```ts
import { test, expect } from "bun:test";

import { isAllowedMime, MAX_DOC_BYTES, safeFileName } from "./document-validation";

test("isAllowedMime: 이미지·PDF·오피스 허용, 그 외 거부", () => {
  expect(isAllowedMime("image/png")).toBe(true);
  expect(isAllowedMime("image/heic")).toBe(true);
  expect(isAllowedMime("application/pdf")).toBe(true);
  expect(isAllowedMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(true);
  expect(isAllowedMime("application/x-msdownload")).toBe(false);
  expect(isAllowedMime("")).toBe(false);
});

test("safeFileName: 경로·제어문자 제거, 한글 유지", () => {
  expect(safeFileName("운전면허증.png")).toBe("운전면허증.png");
  expect(safeFileName("../../etc/passwd")).toBe("passwd");
  expect(safeFileName("a b/c\\d.pdf")).toBe("d.pdf");
  expect(safeFileName(".hidden")).toBe("_hidden");
  expect(safeFileName("")).toBe("file");
});

test("MAX_DOC_BYTES = 20MB", () => {
  expect(MAX_DOC_BYTES).toBe(20 * 1024 * 1024);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/lib/document-validation.test.ts`
Expected: FAIL — "Cannot find module './document-validation'".

- [ ] **Step 3: 구현 작성**

`src/lib/document-validation.ts`:

```ts
// 고객 서류 업로드 검증/정규화(순수). 라우트와 단위테스트가 공유.
export const MAX_DOC_BYTES = 20 * 1024 * 1024; // 20MB

// 이미지 전체 + PDF + 오피스(신규/구형). 미리보기는 이미지·PDF만, 오피스는 다운로드.
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "application/vnd.ms-excel", // xls
  "application/msword", // doc
  "application/vnd.ms-powerpoint", // ppt
]);

export function isAllowedMime(mime: string): boolean {
  return mime.startsWith("image/") || ALLOWED_MIME.has(mime);
}

// 파일명에서 경로 구분자·앞쪽 점·공백류를 제거해 Storage 키에 안전한 basename으로.
// 표시는 원본 file_name을 쓰고, 경로에만 이 안전화본을 쓴다. 한글은 유지.
export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const cleaned = base
    .replace(/[\u0000-\u001f]+/g, "") // 제어문자 제거
    .replace(/\s+/g, "_") // 공백류 → _
    .replace(/^\.+/, "_") // 선행 점(.hidden) → _
    .slice(0, 120);
  return cleaned || "file";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test src/lib/document-validation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/document-validation.ts src/lib/document-validation.test.ts
git commit -m "feat(crm): 고객 서류 업로드 검증 유틸(MIME 화이트리스트·safeFileName)"
```

---

## Task 2: 백엔드 Storage 래퍼

**Files:**
- Create: `src/lib/storage.ts`

> 실제 Supabase Storage 호출이라 단위테스트하지 않는다(라우트 서버 테스트에서 `mock.module`로 스텁). 작성 후 typecheck로만 검증.

- [ ] **Step 1: 구현 작성**

`src/lib/storage.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const CUSTOMER_DOCS_BUCKET = "customer-documents";

// service_role 키는 백엔드 전용(프론트 노출 금지). CF는 c.env, 로컬/테스트는 process.env.
type StorageEnv = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string } | undefined;

function resolve(env: StorageEnv): { url: string; key: string } {
  const url = env?.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.");
  return { url, key };
}

function client(env: StorageEnv): SupabaseClient {
  const { url, key } = resolve(env);
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function uploadObject(env: StorageEnv, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await client(env).storage.from(CUSTOMER_DOCS_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`Storage 업로드 실패: ${error.message}`);
}

export async function removeObject(env: StorageEnv, path: string): Promise<void> {
  const { error } = await client(env).storage.from(CUSTOMER_DOCS_BUCKET).remove([path]);
  if (error) throw new Error(`Storage 삭제 실패: ${error.message}`);
}

export async function createSignedUrl(env: StorageEnv, path: string, expiresIn = 60): Promise<string> {
  const { data, error } = await client(env).storage.from(CUSTOMER_DOCS_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) throw new Error(`Storage signed URL 실패: ${error?.message ?? "데이터 없음"}`);
  return data.signedUrl;
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: `.env.example`에 키 이름 추가**

`.env.example`에 한 줄 추가(값 없이):

```
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 4: 커밋**

```bash
git add src/lib/storage.ts .env.example
git commit -m "feat(crm): Storage 래퍼(service_role 업로드/삭제/signed URL) + env 키"
```

---

## Task 3: 백엔드 서류 쿼리 + getCustomer 정렬

**Files:**
- Create: `src/db/queries/customer-documents.ts`
- Modify: `src/db/queries/customers.ts`

- [ ] **Step 1: 쿼리 파일 작성**

`src/db/queries/customer-documents.ts`:

```ts
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
  v: { title?: string | null; docType?: string | null; fileName?: string | null; fileSize?: number | null; fileMime?: string | null; filePath: string; sortOrder?: number | null },
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

export async function updateDocument(customerId: string, id: string, patch: { docType?: string | null }, ex: Executor = getDefaultDb()): Promise<{ id: string } | null> {
  const [row] = await ex
    .update(customerDocuments)
    .set(patch)
    .where(and(eq(customerDocuments.id, id), eq(customerDocuments.customerId, customerId)))
    .returning({ id: customerDocuments.id });
  return row ?? null;
}

// 삭제 후 Storage remove에 file_path가 필요해 함께 반환.
export async function deleteDocument(customerId: string, id: string, ex: Executor = getDefaultDb()): Promise<{ id: string; filePath: string | null } | null> {
  const [row] = await ex
    .delete(customerDocuments)
    .where(and(eq(customerDocuments.id, id), eq(customerDocuments.customerId, customerId)))
    .returning({ id: customerDocuments.id, filePath: customerDocuments.filePath });
  return row ?? null;
}

// signed URL 발급용 — 경로/타입만.
export async function getDocumentPath(customerId: string, id: string, ex: Executor = getDefaultDb()): Promise<{ filePath: string | null; fileMime: string | null } | null> {
  const [row] = await ex
    .select({ filePath: customerDocuments.filePath, fileMime: customerDocuments.fileMime })
    .from(customerDocuments)
    .where(and(eq(customerDocuments.id, id), eq(customerDocuments.customerId, customerId)));
  return row ?? null;
}

// 재정렬: 각 row sort_order 갱신(customer_id 가드). 저빈도라 단건 루프.
export async function reorderDocuments(customerId: string, order: { id: string; sortOrder: number }[], ex: Executor = getDefaultDb()): Promise<void> {
  for (const o of order) {
    await ex
      .update(customerDocuments)
      .set({ sortOrder: o.sortOrder })
      .where(and(eq(customerDocuments.id, o.id), eq(customerDocuments.customerId, customerId)));
  }
}
```

- [ ] **Step 2: `getCustomer` documents 정렬 + file_path 비노출**

`src/db/queries/customers.ts` 수정.

상단 import에 `asc` 추가(기존 `desc, eq, getTableColumns, sql` 줄):

```ts
import { asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
```

`CustomerDetail` 타입의 documents 줄을 교체(현재 `documents: (typeof customerDocuments.$inferSelect)[];`):

```ts
  documents: Omit<typeof customerDocuments.$inferSelect, "filePath">[];
```

`getCustomer` 안의 documents select 줄(현재 `executor.select().from(customerDocuments).where(eq(customerDocuments.customerId, id)),`)을 교체:

```ts
    executor
      .select({
        id: customerDocuments.id,
        customerId: customerDocuments.customerId,
        title: customerDocuments.title,
        docType: customerDocuments.docType,
        fileName: customerDocuments.fileName,
        fileSize: customerDocuments.fileSize,
        fileMime: customerDocuments.fileMime,
        sortOrder: customerDocuments.sortOrder,
        createdAt: customerDocuments.createdAt,
      })
      .from(customerDocuments)
      .where(eq(customerDocuments.customerId, id))
      .orderBy(asc(customerDocuments.sortOrder), asc(customerDocuments.createdAt)),
```

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: 커밋**

```bash
git add src/db/queries/customer-documents.ts src/db/queries/customers.ts
git commit -m "feat(crm): 서류 쿼리(add/update/delete/path/reorder) + 상세 정렬·file_path 비노출"
```

---

## Task 4: 백엔드 라우트 + 서버 테스트

**Files:**
- Modify: `src/routes/customers.ts`
- Modify: `src/routes/customers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/routes/customers.test.ts` 최상단(첫 `import` 위)에 storage 모킹 추가:

```ts
import { mock } from "bun:test";

mock.module("../lib/storage", () => ({
  CUSTOMER_DOCS_BUCKET: "customer-documents",
  uploadObject: async () => {},
  removeObject: async () => {},
  createSignedUrl: async () => "https://example.test/signed-url",
}));
```

파일 끝에 테스트 추가:

```ts
test("서류: 업로드→signedUrl→docType PATCH→reorder→삭제 라운드트립", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const cid = list[0].id;

  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "운전면허증.png", { type: "image/png" }));
  fd.append("docType", "면허증");
  const up = await app.request(`/api/customers/${cid}/documents`, { method: "POST", headers: auth, body: fd });
  expect(up.status).toBe(201);
  const doc = (await up.json()) as { id: string; docType: string; fileName: string; sortOrder: number };
  expect(doc.docType).toBe("면허증");
  expect(doc.fileName).toBe("운전면허증.png");

  const urlRes = await app.request(`/api/customers/${cid}/documents/${doc.id}/url`, { headers: auth });
  expect(urlRes.status).toBe(200);
  expect((await urlRes.json()).url).toContain("https://");

  const h = { ...auth, "Content-Type": "application/json" };
  const patched = await app.request(`/api/customers/${cid}/documents/${doc.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ docType: "사업자등록증" }) });
  expect(patched.status).toBe(200);

  const reordered = await app.request(`/api/customers/${cid}/documents/reorder`, { method: "PATCH", headers: h, body: JSON.stringify({ order: [{ id: doc.id, sortOrder: 0 }] }) });
  expect(reordered.status).toBe(200);

  const removed = await app.request(`/api/customers/${cid}/documents/${doc.id}`, { method: "DELETE", headers: auth });
  expect(removed.status).toBe(200);
});

test("서류: 허용 안 되는 MIME → 415", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1])], "evil.exe", { type: "application/x-msdownload" }));
  const res = await app.request(`/api/customers/${list[0].id}/documents`, { method: "POST", headers: auth, body: fd });
  expect(res.status).toBe(415);
});

test("서류: 파일 없음 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}/documents`, { method: "POST", headers: auth, body: new FormData() });
  expect(res.status).toBe(400);
});

test("서류: 없는 childId signedUrl → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}/documents/00000000-0000-0000-0000-000000000000/url`, { headers: auth });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: FAIL — 서류 라우트 미존재(404/405).

- [ ] **Step 3: 라우트 구현**

`src/routes/customers.ts` import 블록에 추가:

```ts
import { addDocument, deleteDocument, getDocumentPath, nextSortOrder, reorderDocuments, updateDocument } from "../db/queries/customer-documents";
import { isAllowedMime, MAX_DOC_BYTES, safeFileName } from "../lib/document-validation";
import { createSignedUrl, removeObject, uploadObject } from "../lib/storage";
```

파일 끝(일정 라우트 아래)에 서류 라우트 추가. **reorder(정적)를 :childId(동적)보다 먼저 등록**:

```ts
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
  await uploadObject(c.env, path, bytes, file.type || "application/octet-stream");
  try {
    const sortOrder = await nextSortOrder(customerId, c.var.db);
    const row = await addDocument(
      customerId,
      { title: docType, docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, filePath: path, sortOrder },
      c.var.db,
    );
    return c.json({ id: row.id, docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, sortOrder, createdAt: row.createdAt }, 201);
  } catch (e) {
    await removeObject(c.env, path).catch(() => undefined); // 보상 삭제
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
  if (row.filePath) await removeObject(c.env, row.filePath).catch((err) => console.error("Storage remove 실패(고아 객체):", err));
  return c.json({ id: row.id });
});

customers.get("/:id/documents/:childId/url", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await getDocumentPath(p.id, p.childId, c.var.db);
  if (!row?.filePath) return c.json({ error: "서류를 찾을 수 없습니다." }, 404);
  const url = await createSignedUrl(c.env, row.filePath, 60);
  return c.json({ url, fileMime: row.fileMime });
});
```

> 참고: `c.env`는 Hono 기본 타입이 unknown이라 `uploadObject(c.env, ...)`는 storage의 `StorageEnv`로 자동 호환된다(구조적 타이핑). 테스트(app.request)는 `c.env`가 undefined이고 storage가 모킹돼 사용되지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: PASS (기존 + 신규 4 테스트).

- [ ] **Step 5: lint + 커밋**

Run: `bun run lint`
Expected: 0 problems.

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 서류 라우트(업로드 multipart·docType·reorder·삭제·signed URL) + 서버 테스트"
```

---

## Task 5: 프론트 lib (API + 타입)

**Files:**
- Create: `client/src/lib/customer-documents.ts`
- Modify: `client/src/lib/customers.ts`

- [ ] **Step 1: `CustomerDetailDocument` 타입 확장**

`client/src/lib/customers.ts`의 `CustomerDetailDocument`(현재 한 줄)을 교체:

```ts
export type CustomerDetailDocument = { id: string; title: string | null; docType: string | null; fileName: string | null; fileSize: number | null; fileMime: string | null; sortOrder: number | null; createdAt: string | null };
```

- [ ] **Step 2: 프론트 API 모듈 작성**

`client/src/lib/customer-documents.ts`:

```ts
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
```

- [ ] **Step 3: typecheck + 커밋**

Run: `bun run typecheck`
Expected: 0 errors.

```bash
git add client/src/lib/customer-documents.ts client/src/lib/customers.ts
git commit -m "feat(crm): 프론트 서류 API(업로드/분류/순서/삭제/URL) + 상세 타입 sortOrder"
```

---

## Task 6: 프론트 UI 연결 (KimMinjunDetailContent — 수동 검증)

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx`

> 거대 컴포넌트(6000줄)라 코드 관례상 수동/스크린샷 검증. 아래 변경 지점을 정확히 적용한다. `detail.id`가 customer uuid(업로드 키).

- [ ] **Step 1: import 추가**

`CustomerDetailPage.tsx` 상단 import 블록(다른 `@/lib/...` import 근처)에 추가:

```ts
import { deleteDocumentApi, getDocumentUrlApi, reorderDocumentsApi, updateDocumentTypeApi, uploadDocument } from "@/lib/customer-documents";
```

- [ ] **Step 2: 미리보기 signed URL 상태 추가**

`const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null);`(1467행 부근) 아래에 추가:

```ts
  const [previewDocumentUrl, setPreviewDocumentUrl] = useState<string | null>(null);
```

`const previewDocument = documents.find(...)`(1500행 부근) 아래에 effect 추가(미리보기 열릴 때 objectUrl 우선, 없으면 signed URL):

```ts
  useEffect(() => {
    if (!previewDocument) {
      setPreviewDocumentUrl(null);
      return;
    }
    if (previewDocument.objectUrl) {
      setPreviewDocumentUrl(previewDocument.objectUrl);
      return;
    }
    let cancelled = false;
    getDocumentUrlApi(detail.id, previewDocument.id)
      .then((r) => {
        if (!cancelled) setPreviewDocumentUrl(r.url);
      })
      .catch(() => onToast("미리보기 URL 발급에 실패했습니다."));
    return () => {
      cancelled = true;
    };
  }, [previewDocument, detail.id, onToast]);
```

- [ ] **Step 3: 업로드 허용형식 확장 + DB 업로드(낙관+롤백)**

`addDocumentFiles`(2933행)를 교체:

```ts
  async function addDocumentFiles(fileList: FileList | File[]) {
    const officeExt = [".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt"];
    const files = Array.from(fileList).filter((file) => {
      const lower = file.name.toLowerCase();
      return file.type.startsWith("image/") || file.type === "application/pdf" || lower.endsWith(".pdf") || officeExt.some((ext) => lower.endsWith(ext));
    });
    if (files.length === 0) {
      onToast("이미지·PDF·오피스 문서만 등록할 수 있습니다.");
      return;
    }
    setConfirmingDocumentDeleteId(null);
    markRecentUpdate("서류함");
    for (const file of files) {
      const tempId = `kim-document-${nowMs()}-${Math.round(file.size)}`;
      const docType = classifyKimDocumentFile(file.name);
      const objectUrl = URL.createObjectURL(file);
      const optimistic: KimDocumentItem = {
        id: tempId,
        title: docType,
        status: "자동인식",
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
        objectUrl,
        file,
      };
      setDocuments((current) => [...current, optimistic]);
      try {
        const saved = await uploadDocument(detail.id, file, docType);
        setDocuments((current) => current.map((d) => (d.id === tempId ? { ...d, id: saved.id, file: undefined } : d)));
      } catch {
        setDocuments((current) => current.filter((d) => d.id !== tempId));
        URL.revokeObjectURL(objectUrl);
        onToast(`${file.name} 업로드에 실패했습니다.`);
      }
    }
  }
```

> 임시 id(`kim-document-*`)는 업로드 응답 전 상태. objectUrl은 교체 후에도 유지해 즉시 미리보기를 살리고, 메모리의 `file`만 해제한다.

- [ ] **Step 4: 분류수정·삭제·순서변경 DB 연결**

`updateDocumentType`(2966행)을 교체:

```ts
  function updateDocumentType(id: string, title: string) {
    setDocuments((current) => current.map((documentItem) => (documentItem.id === id ? { ...documentItem, title, status: "수동분류" } : documentItem)));
    markRecentUpdate("서류함");
    if (!id.startsWith("kim-")) void updateDocumentTypeApi(detail.id, id, title).catch(() => onToast("분류 저장에 실패했습니다."));
  }
```

`moveDocumentToTarget`(2993행)을 교체(클로저 `documents`로 새 순서 계산 후 reorder):

```ts
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
    const order = nextDocuments.map((documentItem, index) => ({ id: documentItem.id, sortOrder: index })).filter((o) => !o.id.startsWith("kim-"));
    if (order.length > 0) void reorderDocumentsApi(detail.id, order).catch(() => onToast("순서 저장에 실패했습니다."));
  }
```

`deleteDocument`(3024행)을 교체:

```ts
  function deleteDocument(id: string) {
    const targetDocument = documents.find((documentItem) => documentItem.id === id);
    if (targetDocument?.objectUrl) URL.revokeObjectURL(targetDocument.objectUrl);
    setDocuments((current) => current.filter((documentItem) => documentItem.id !== id));
    setPreviewDocumentId((current) => (current === id ? null : current));
    setConfirmingDocumentDeleteId(null);
    markRecentUpdate("서류함");
    onToast("서류 항목을 삭제했습니다.");
    if (!id.startsWith("kim-")) void deleteDocumentApi(detail.id, id).catch(() => onToast("삭제 저장에 실패했습니다."));
  }
```

- [ ] **Step 5: 미리보기 렌더를 signed URL로 + 업로드 input accept 확장**

업로드 input(5641행 부근) `accept`를 확장:

```tsx
                <input accept="image/*,.pdf,application/pdf,.xlsx,.xls,.docx,.doc,.pptx,.ppt" multiple onChange={addDocumentFilesFromInput} type="file" />
```

미리보기 렌더(5790~5793행 부근)에서 `previewDocument.objectUrl`을 `previewDocumentUrl`로 교체:

```tsx
              {previewDocumentUrl && previewDocument.mimeType?.startsWith("image/") ? (
                <img alt={previewDocument.title} src={previewDocumentUrl} />
              ) : previewDocumentUrl && kimDocumentFileKind(previewDocument.mimeType, previewDocument.fileName) === "PDF" ? (
                <iframe src={previewDocumentUrl} title={previewDocument.title} />
```

> 이후(else 분기) 오피스/그 외 형식은 기존대로 미리보기 불가 안내를 유지하되, `previewDocumentUrl`이 있으면 다운로드 링크(`<a href={previewDocumentUrl} download>`)를 노출하도록 해당 else 블록을 조정한다(기존 마크업에 맞춰 수동). 미리보기 불가 형식도 signed URL로 다운로드 가능해야 한다.

- [ ] **Step 6: 검증**

Run: `bun run typecheck`
Expected: 0 errors.

Run: `bun run lint`
Expected: 0 problems. (effect 의존성 경고가 새로 생기면 의존 배열을 맞추거나 기존 패턴대로 `eslint-disable-next-line react-hooks/exhaustive-deps -- <사유>` 처리.)

Run: `bun run build`
Expected: success.

- [ ] **Step 7: 커밋**

```bash
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 김민준 서류함 DB 연결(업로드/분류/순서/삭제·signed URL 미리보기)"
```

---

## Task 7: 최종 검증 + 수동 확인 + brief 갱신

**Files:**
- Modify: `ref/active-session-brief.md`

- [ ] **Step 1: 전체 검증 4종**

```bash
bun run typecheck
bun run lint
bun run test:unit
bun test --env-file=.env.local
bun run build
```

Expected: typecheck 0 · lint 0 · test:unit 통과(기존+0 신규는 프론트 단위 없음) · test:server 통과(기존 39 + 신규 4 = 43) · build success.

- [ ] **Step 2: 수동 확인(Task 0 완료 + 로그인 세션 필요)**

로그인 후 `bun run dev`(또는 배포본)에서 김민준 상세 → 서류함:
1. 이미지/PDF/엑셀 드롭 → 자동분류·목록 추가, **새로고침 후에도 유지**.
2. 분류 변경 → 새로고침 후 유지.
3. 순서 드래그 → 새로고침 후 유지.
4. 미리보기(이미지·PDF) signed URL 렌더, 오피스는 다운로드.
5. 삭제 → 새로고침 후에도 사라짐. Supabase Storage 버킷에서 객체도 제거 확인.

- [ ] **Step 3: brief 갱신**

`ref/active-session-brief.md`의 "완료" 최상단에 #3 서류 완료 항목 추가, "Current Focus"·"Next"에서 #3을 완료로 이동(다음 = enum/lookup 또는 견적). "Caveats"에 서류 규약 추가:
- service_role 키는 백엔드 전용·CF secret. 변경 후 재배포.
- private 버킷 `customer-documents` + signed URL(60s)만 노출.
- 서류 쓰기도 `invalidateCustomerDetail` 호출(캐시 불변식).

커밋 메시지에 skip-ci 마커 토큰 **금지**(squash 전파 사고 방지).

```bash
git add ref/active-session-brief.md
git commit -m "docs: active-session-brief 갱신 — #3 서류 업로드 완료"
```

- [ ] **Step 4: PR**

```bash
git push -u origin feat/crm-customer-documents
gh pr create --title "feat(crm): 고객 서류 업로드(#3) — 백엔드 경유 Supabase Storage" --body "..."
```

PR 본문/커밋에 skip-ci 마커 금지. squash 머지 → 브랜치 삭제.

---

## Self-Review 메모

- **Spec 커버리지**: 버킷·경로(Task 0,4) · service_role(Task 0,2) · Storage 래퍼(Task 2) · 쿼리(Task 3) · getCustomer 정렬·file_path 비노출(Task 3) · 라우트 5종(Task 4) · 검증/거부(Task 1,4) · 프론트 lib(Task 5) · UI 연결·미리보기 signed URL·자동분류 유지(Task 6) · invalidate(Task 5 lib) · 검증·수동(Task 7). 모두 매핑됨.
- **타입 일관성**: 프론트 lib 함수명은 컴포넌트 내 동명 함수(`updateDocumentType`/`deleteDocument`)와 충돌 피하려 `*Api` 접미사(`updateDocumentTypeApi`/`deleteDocumentApi`/`reorderDocumentsApi`/`getDocumentUrlApi`). 업로드는 `uploadDocument`(충돌 없음). 백엔드 쿼리는 접미사 없음(`updateDocument`/`deleteDocument`).
- **YAGNI**: OCR·PDF 병합·다른 고객 서류함·enum 정리 제외. docType은 text 유지.
