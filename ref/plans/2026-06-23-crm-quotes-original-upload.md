# 견적 원본 업로드 #4d Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 김민준 견적함 행에 이미지/PDF 원본을 드롭하면 Supabase Storage에 업로드하고 `quotes.file_*` 컬럼에 영속(미리보기·다운로드·교체·삭제)한다 — 현재 메모리(objectUrl)만이라 새로고침 시 소실되던 것을.

**Architecture:** 서류 #3 Storage 인프라(`storage.ts`·private 버킷·secret key·signed URL·`document-validation`)를 그대로 재사용한다. `quotes.file_*` 4컬럼은 이미 존재 → **마이그레이션 없음**. 백엔드는 query 헬퍼 3(`setQuoteFile`/`clearQuoteFile`/`getQuoteFilePath`) + 라우트 3(`POST`/`DELETE`/`GET …/original[/url]`), 읽기 경로는 `file_path` 비노출 + `toKimQuoteItem` 매핑, 프론트는 lib 3 + `attachQuoteFileToQuote` 낙관·업로드·롤백 + 미리보기 signed URL.

**Tech Stack:** TypeScript 6.0.3, Hono + drizzle-orm(서버), React(프론트), zod, Supabase Storage(secret key 백엔드), vitest/bun(테스트).

---

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `client/src/lib/kim-quote.ts` | 견적 읽기 어댑터 | `CustomerDetailQuote.file*` + `toKimQuoteItem` 매핑 |
| `client/src/lib/kim-quote.test.ts` | 단위 테스트 | `file_*` 매핑 케이스 |
| `src/db/queries/customers.ts` | getCustomer | `QuoteWithScenarios`에서 `file_path` 비노출(타입+런타임) |
| `src/db/queries/customer-quotes.ts` | 견적 query | `setQuoteFile`/`clearQuoteFile`/`getQuoteFilePath` |
| `src/routes/customers.ts` | 견적 원본 라우트 | `POST`/`DELETE`/`GET …/original[/url]` |
| `src/routes/customers.test.ts` | 서버 테스트 | 업로드·삭제·url·415·404 |
| `client/src/lib/customer-quotes.ts` | 프론트 lib | `uploadQuoteOriginal`/`deleteQuoteOriginal`/`getQuoteOriginalUrl` |
| `client/src/pages/CustomerDetailPage.tsx` | 견적함 UI | `attachQuoteFileToQuote` 재작성 + 미리보기 signed + 삭제 |

---

## Task 1: 읽기 어댑터 — `toKimQuoteItem`이 `file_*` 매핑 (TDD)

**Files:**
- Modify: `client/src/lib/kim-quote.ts` (`CustomerDetailQuote` 타입 46~63, `toKimQuoteItem` 146~180)
- Test: `client/src/lib/kim-quote.test.ts` (`makeQuote` 기본값 7~45, 새 케이스)

- [ ] **Step 1: 단위 테스트 작성**

`client/src/lib/kim-quote.test.ts`의 `makeQuote`(7~45줄) 기본값에 `file_*` 3필드를 추가한다. `revision: 0,`(24줄) 아래에 삽입:

```ts
    revision: 0,
    fileName: null,
    fileSize: null,
    fileMime: null,
    primaryScenarioId: "s1",
```

(주의: 기존 `primaryScenarioId: "s1",` 줄을 위 블록으로 교체 — 중복 금지.)

그리고 파일 끝(마지막 `});` 아래)에 추가:

```ts
describe("toKimQuoteItem 견적 원본 file_* 매핑 (#4d)", () => {
  it("file_* 있으면 fileName/fileSize/mimeType 매핑", () => {
    const k = toKimQuoteItem(makeQuote({ fileName: "원본견적.pdf", fileSize: 12345, fileMime: "application/pdf" }), NOW);
    expect(k.fileName).toBe("원본견적.pdf");
    expect(k.fileSize).toBe(12345);
    expect(k.mimeType).toBe("application/pdf");
  });
  it("file_* 없으면 undefined", () => {
    const k = toKimQuoteItem(makeQuote(), NOW);
    expect(k.fileName).toBeUndefined();
    expect(k.fileSize).toBeUndefined();
    expect(k.mimeType).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts`
Expected: FAIL — 타입에 `fileName/fileSize/fileMime`가 없어 `makeQuote` 기본값에서 타입 에러, `k.fileName`이 undefined(매핑 없음).

- [ ] **Step 3: `CustomerDetailQuote`에 `file_*` 추가**

`client/src/lib/kim-quote.ts`의 `CustomerDetailQuote`(46~63줄), `isSaved: boolean;` 위에 추가. 정확히는 `mileageValue: string | null;`(61줄) 다음 줄:

```ts
  mileageValue: string | null;
  // #4d 견적 원본(file_path는 서버 비노출, 미리보기는 signed URL)
  fileName: string | null;
  fileSize: number | null;
  fileMime: string | null;
  isSaved: boolean;
```

> 잠깐 — `CustomerDetailQuote`는 시나리오 타입이 아니라 **quote** 타입이다. 위 줄 번호를 재확인하라: `file_*`는 `CustomerDetailQuote`(65~99줄, quote)에 넣어야 하며 `CustomerDetailScenario`(46~63, 시나리오)가 아니다. `CustomerDetailQuote`의 `scenarios: CustomerDetailScenario[];`(98줄) 위에 추가:

```ts
  interiorColorName: string | null;
  interiorColorHex: string | null;
  // #4d 견적 원본(file_path는 서버 비노출, 미리보기는 signed URL)
  fileName: string | null;
  fileSize: number | null;
  fileMime: string | null;
  scenarios: CustomerDetailScenario[];
```

- [ ] **Step 4: `toKimQuoteItem`이 매핑**

`client/src/lib/kim-quote.ts`의 `toKimQuoteItem`, `primaryScenarioId: q.primaryScenarioId ?? undefined,` 위에 추가:

```ts
    fileName: q.fileName ?? undefined,
    fileSize: q.fileSize ?? undefined,
    mimeType: q.fileMime ?? undefined,
    primaryScenarioId: q.primaryScenarioId ?? undefined,
```

- [ ] **Step 5: 테스트 실행 → 통과 + 회귀 없음**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts`
Expected: 새 케이스 PASS, 기존 toKimQuoteItem 테스트 전부 PASS.

- [ ] **Step 6: typecheck/lint → 커밋**

```bash
bun run typecheck && bun run lint
git add client/src/lib/kim-quote.ts client/src/lib/kim-quote.test.ts
git commit -m "feat(crm): 견적 원본 file_* 읽기 매핑 #4d"
```
Expected: typecheck 0, lint 0.

---

## Task 2: 서버 — query 헬퍼 3 + 라우트 3 + `file_path` 비노출 (TDD)

**Files:**
- Modify: `src/db/queries/customer-quotes.ts` (헬퍼 추가, import)
- Modify: `src/db/queries/customers.ts` (`QuoteWithScenarios` 66~68, map 116)
- Modify: `src/routes/customers.ts` (라우트 추가, import)
- Test: `src/routes/customers.test.ts` (새 test 2건)

- [ ] **Step 1: 실패하는 서버 테스트 작성**

`src/routes/customers.test.ts`의 마지막 견적 test(`견적 쓰기: PATCH primaryScenarioId …`) 블록 **아래**에 추가. (`mock.module`·`quotes`·`getDefaultDb`·`eq`·`makeTestAuth`·`createApp`·`seedThrowawayQuote` 모두 이미 존재.)

```ts
test("견적 원본 #4d: POST 업로드 → getCustomer file_* 반영(file_path 비노출), url 발급, DELETE 제거", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const quoteId = await seedThrowawayQuote(cid);
  try {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "원본견적.pdf", { type: "application/pdf" }));
    const up = await app.request(`/api/customers/${cid}/quotes/${quoteId}/original`, { method: "POST", headers: auth, body: fd });
    expect(up.status).toBe(201);
    expect(((await up.json()) as { fileName: string }).fileName).toBe("원본견적.pdf");

    const detail = (await (await app.request(`/api/customers/${cid}`, { headers: auth })).json()) as {
      quotes: Array<{ id: string; fileName: string | null; fileMime: string | null; filePath?: string }>;
    };
    const q = detail.quotes.find((x) => x.id === quoteId)!;
    expect(q.fileName).toBe("원본견적.pdf");
    expect(q.fileMime).toBe("application/pdf");
    expect("filePath" in q).toBe(false); // file_path 비노출

    const urlRes = await app.request(`/api/customers/${cid}/quotes/${quoteId}/original/url`, { headers: auth });
    expect(urlRes.status).toBe(200);
    expect(((await urlRes.json()) as { url: string }).url).toContain("https://example.test/");

    const del = await app.request(`/api/customers/${cid}/quotes/${quoteId}/original`, { method: "DELETE", headers: auth });
    expect(del.status).toBe(200);
    const detail2 = (await (await app.request(`/api/customers/${cid}`, { headers: auth })).json()) as { quotes: Array<{ id: string; fileName: string | null }> };
    expect(detail2.quotes.find((x) => x.id === quoteId)!.fileName).toBeNull();
  } finally {
    await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});

test("견적 원본 #4d: 허용 안 되는 MIME → 415, 없는 견적 → 404", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const quoteId = await seedThrowawayQuote(cid);
  try {
    const fdBad = new FormData();
    fdBad.append("file", new File([new Uint8Array([1])], "메모.txt", { type: "text/plain" }));
    expect((await app.request(`/api/customers/${cid}/quotes/${quoteId}/original`, { method: "POST", headers: auth, body: fdBad })).status).toBe(415);

    const missing = "00000000-0000-0000-0000-000000000000";
    const fdPdf = new FormData();
    fdPdf.append("file", new File([new Uint8Array([1])], "q.pdf", { type: "application/pdf" }));
    expect((await app.request(`/api/customers/${cid}/quotes/${missing}/original`, { method: "POST", headers: auth, body: fdPdf })).status).toBe(404);
  } finally {
    await getDefaultDb().delete(quotes).where(eq(quotes.id, quoteId));
  }
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: 새 두 테스트 FAIL — 라우트 미존재로 404/400, `file_path 비노출` 단언도 실패(현재 전체 select라 `filePath` 노출).

- [ ] **Step 3: query 헬퍼 3 추가**

`src/db/queries/customer-quotes.ts` 파일 끝에 추가. (상단 import는 `import { and, asc, eq, like, sql } from "drizzle-orm";` + `import { quotes, quoteScenarios } from "../schema";` 이미 존재 — `and`/`eq`/`quotes` 사용 가능.)

```ts
// ── 견적 원본 파일(#4d) — quotes.file_* 영속. id AND customer_id 가드. ──────
export async function setQuoteFile(
  customerId: string,
  quoteId: string,
  file: { fileName: string; fileSize: number; fileMime: string | null; filePath: string },
  ex: Executor = getDefaultDb(),
): Promise<{ previousFilePath: string | null } | null> {
  const [prev] = await ex
    .select({ filePath: quotes.filePath })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  if (!prev) return null;
  await ex
    .update(quotes)
    .set({ fileName: file.fileName, fileSize: file.fileSize, fileMime: file.fileMime, filePath: file.filePath, updatedAt: new Date() })
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  return { previousFilePath: prev.filePath };
}

export async function clearQuoteFile(
  customerId: string,
  quoteId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ previousFilePath: string | null } | null> {
  const [prev] = await ex
    .select({ filePath: quotes.filePath })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  if (!prev) return null;
  await ex
    .update(quotes)
    .set({ fileName: null, fileSize: null, fileMime: null, filePath: null, updatedAt: new Date() })
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  return { previousFilePath: prev.filePath };
}

export async function getQuoteFilePath(
  customerId: string,
  quoteId: string,
  ex: Executor = getDefaultDb(),
): Promise<{ filePath: string | null; fileMime: string | null } | null> {
  const [row] = await ex
    .select({ filePath: quotes.filePath, fileMime: quotes.fileMime })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)));
  return row ?? null;
}
```

- [ ] **Step 4: getCustomer에서 `file_path` 비노출**

`src/db/queries/customers.ts`의 `QuoteWithScenarios`(66~68줄)를 교체:

```ts
export type QuoteWithScenarios = Omit<typeof quotes.$inferSelect, "filePath"> & {
  scenarios: (typeof quoteScenarios.$inferSelect)[];
};
```

그리고 map(116줄)을 교체 — `filePath`를 런타임에서도 제거:

```ts
  const quotesWithScenarios: QuoteWithScenarios[] = quoteRows.map(({ filePath: _filePath, ...rest }) => ({ ...rest, scenarios: scenariosByQuote.get(rest.id) ?? [] }));
```

- [ ] **Step 5: 라우트 3 추가**

`src/routes/customers.ts`의 견적 `DELETE /:id/quotes/:childId`(165~168줄) 블록 **아래**, 서류 라우트 시작(`// ── 서류함 …`) **전**에 추가. (import: 파일 상단에 `isAllowedMime`·`MAX_DOC_BYTES`·`safeFileName`·`uploadObject`·`removeObject`·`createSignedUrl`·`StorageEnv`가 서류용으로 이미 있다. 추가로 `setQuoteFile`·`clearQuoteFile`·`getQuoteFilePath`를 `customer-quotes`에서 import — 기존 `import { … updateQuote, deleteQuote, createQuote, nextQuoteCode } from "../db/queries/customer-quotes";` 줄에 추가.)

```ts
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
```

- [ ] **Step 6: 테스트 실행 → 통과 + 회귀 없음**

Run: `bun test --env-file=.env.local src/routes/customers.test.ts`
Expected: 새 두 테스트 PASS, 기존 견적/서류 테스트 전부 PASS.

- [ ] **Step 7: typecheck/lint → 커밋**

```bash
bun run typecheck && bun run lint
git add src/db/queries/customer-quotes.ts src/db/queries/customers.ts src/routes/customers.ts src/routes/customers.test.ts
git commit -m "feat(crm): 견적 원본 업로드 서버 — query 3 + 라우트 3 + file_path 비노출 #4d"
```
Expected: typecheck 0, lint 0.

---

## Task 3: 프론트 lib — 업로드/삭제/url 3

**Files:**
- Modify: `client/src/lib/customer-quotes.ts` (함수 3 추가, import)

- [ ] **Step 1: lib 함수 3 추가**

`client/src/lib/customer-quotes.ts` 상단 import를 확인한다. 현재 `import { invalidateCustomerDetail } from "./customers";` + `import { sendJson, sendVoid } from "./http";`가 있다. `apiFetch`·`getJson`을 추가 import:

```ts
import { apiFetch } from "./api";
import { invalidateCustomerDetail } from "./customers";
import { getJson, sendJson, sendVoid } from "./http";
```

파일 끝에 추가:

```ts
// ── 견적 원본 파일(#4d) — 서류 업로드와 동형. 성공 시 상세 캐시 무효화. ──────
// multipart라 lib/http(JSON 전용) 대신 apiFetch 직접 사용(브라우저가 boundary 포함).
export async function uploadQuoteOriginal(cid: string, quoteId: string, file: File): Promise<{ fileName: string; fileSize: number; fileMime: string | null }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await apiFetch(`/api/customers/${cid}/quotes/${quoteId}/original`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`견적 원본 업로드 실패: ${res.status}`);
  const data = (await res.json()) as { fileName: string; fileSize: number; fileMime: string | null };
  invalidateCustomerDetail(cid);
  return data;
}

export async function deleteQuoteOriginal(cid: string, quoteId: string): Promise<void> {
  await sendVoid(`/api/customers/${cid}/quotes/${quoteId}/original`, "DELETE");
  invalidateCustomerDetail(cid);
}

// url=미리보기, downloadUrl=원본(견적은 썸네일 없어 동일).
export async function getQuoteOriginalUrl(cid: string, quoteId: string): Promise<{ url: string; downloadUrl: string; fileMime: string | null }> {
  return getJson(`/api/customers/${cid}/quotes/${quoteId}/original/url`);
}
```

- [ ] **Step 2: typecheck/lint**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0. (`getJson`이 `./http`에 export돼 있음 — 서류 lib가 동일 import. 없으면 `sendJson`처럼 `./http`에 추가 확인.)

- [ ] **Step 3: 커밋**

```bash
git add client/src/lib/customer-quotes.ts
git commit -m "feat(crm): 견적 원본 업로드/삭제/url 프론트 lib #4d"
```

---

## Task 4: CustomerDetailPage — 첨부 영속 + 미리보기 signed + 삭제

**Files:**
- Modify: `client/src/pages/CustomerDetailPage.tsx` (import 7줄, state 917 근처, 파생/effect 982 근처, `attachQuoteFileToQuote` 2469 근처, 미리보기 모달 5566~5586)

> 거대 페이지라 단위테스트 없이 typecheck + 수동/브라우저 검증(프로젝트 관례).

- [ ] **Step 1: lib import 추가**

7줄 customer-quotes import에 3함수 추가:

```ts
import { updateQuote as apiUpdateQuote, deleteQuote as apiDeleteQuote, createQuote as apiCreateQuote, parseTermMonths, parseMonthlyPayment, uploadQuoteOriginal, deleteQuoteOriginal, getQuoteOriginalUrl, type QuoteWritePatch, type QuoteCreatePayload } from "@/lib/customer-quotes";
```

- [ ] **Step 2: `previewQuoteUrl` state 추가**

`const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);` 아래(917~919 근처)에 추가:

```ts
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [previewQuoteUrl, setPreviewQuoteUrl] = useState<string | null>(null);
```

- [ ] **Step 3: 미리보기 URL 파생 + signed URL effect**

`const previewQuote = quotes.find((quote) => quote.id === previewQuoteId) ?? null;`(982줄) **아래**에 추가:

```ts
  // 미리보기 URL: 업로드 직후 메모리 objectUrl 우선, 영속본은 signed URL을 비동기 발급.
  const activePreviewQuoteUrl = previewQuote ? previewQuote.objectUrl ?? previewQuoteUrl : null;
  useEffect(() => {
    if (!previewQuoteId || quotes.find((q) => q.id === previewQuoteId)?.objectUrl) return () => setPreviewQuoteUrl(null);
    let cancelled = false;
    getQuoteOriginalUrl(detail.id, previewQuoteId)
      .then((r) => { if (!cancelled) setPreviewQuoteUrl(r.url); })
      .catch(() => onToast("미리보기 URL 발급에 실패했습니다."));
    return () => { cancelled = true; setPreviewQuoteUrl(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewQuoteId 변경 시에만 재실행(quotes는 파생 조회라 dep 제외)
  }, [previewQuoteId, detail.id, onToast]);
```

- [ ] **Step 4: `attachQuoteFileToQuote` 재작성 + 삭제 핸들러**

`attachQuoteFileToQuote` 함수(현재 메모리만) 전체를 교체하고, 그 아래에 `removeQuoteOriginal`를 추가:

```ts
  function attachQuoteFileToQuote(quoteId: string, file: File) {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onToast("이미지 또는 PDF 파일만 첨부할 수 있습니다.");
      return;
    }
    const quoteTitle = quotes.find((quote) => quote.id === quoteId)?.title ?? "견적";
    const prevQuotes = quotes;
    const objectUrl = URL.createObjectURL(file);
    const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    setQuotes((current) => current.map((quote) => (
      quote.id === quoteId ? {
        ...quote,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        objectUrl,
        file,
        status: quote.status === "작성중" ? "발송대기" : quote.status,
        appStatus: quote.appStatus === "draft" ? "queued" : quote.appStatus,
        originalNeedsReplacement: false,
      } : quote
    )));
    markRecentUpdate("견적함");
    if (customer.id && !quoteId.startsWith("kim-")) {
      void uploadQuoteOriginal(customer.id, quoteId, file).catch(() => {
        URL.revokeObjectURL(objectUrl);
        setQuotes(prevQuotes);
        onToast("원본 업로드에 실패했습니다.");
      });
    }
    onToast(`${quoteTitle} 원본 첨부: ${file.name}`);
  }

  function removeQuoteOriginal(quoteId: string) {
    const prevQuotes = quotes;
    const target = quotes.find((quote) => quote.id === quoteId);
    if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
    setQuotes((current) => current.map((quote) => (
      quote.id === quoteId ? { ...quote, fileName: undefined, fileSize: undefined, mimeType: undefined, objectUrl: undefined, file: undefined } : quote
    )));
    setPreviewQuoteId((current) => (current === quoteId ? null : current));
    if (customer.id && !quoteId.startsWith("kim-")) {
      void deleteQuoteOriginal(customer.id, quoteId).catch(() => { setQuotes(prevQuotes); onToast("원본 삭제에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast("견적 원본을 삭제했습니다.");
  }
```

- [ ] **Step 5: 미리보기 모달 — signed URL + 다운로드/삭제 버튼**

미리보기 모달(5566~5586)에서 ① 닫기 버튼 옆에 다운로드·삭제 버튼 추가 ② 본문 `objectUrl`을 `activePreviewQuoteUrl`로 교체 + 로딩 상태.

닫기 버튼(5573줄) 부분을 교체:

```tsx
              <div className="kim-document-preview-head-actions">
                <button aria-label="견적 원본 다운로드" disabled={!activePreviewQuoteUrl} onClick={() => { if (activePreviewQuoteUrl) downloadKimDocument(activePreviewQuoteUrl, previewQuote.fileName ?? "quote"); }} type="button"><Download size={15} strokeWidth={2.3} /></button>
                <button aria-label="견적 원본 삭제" onClick={() => removeQuoteOriginal(previewQuote.id)} type="button"><Trash2 size={15} strokeWidth={2.3} /></button>
                <button aria-label="견적 원본 미리보기 닫기" onClick={() => setPreviewQuoteId(null)} type="button"><X size={15} strokeWidth={2.4} /></button>
              </div>
```

본문(5576~5582)을 교체:

```tsx
              {!activePreviewQuoteUrl ? (
                <p>불러오는 중…</p>
              ) : previewQuote.mimeType?.startsWith("image/") ? (
                <img alt={previewQuote.title} src={activePreviewQuoteUrl} />
              ) : kimDocumentFileKind(previewQuote.mimeType, previewQuote.fileName) === "PDF" ? (
                <iframe src={activePreviewQuoteUrl} title={previewQuote.title} />
              ) : (
                <p>미리보기를 지원하지 않는 파일입니다.</p>
              )}
```

(주의: `downloadKimDocument`·`Download`·`Trash2`·`X`·`kimDocumentFileKind`는 이미 import/정의돼 있다 — 서류 미리보기에서 사용 중. 미리보기 head에 `kim-document-preview-head-actions` 구조가 없으면 닫기 버튼만 감싸 추가.)

- [ ] **Step 6: typecheck/lint → 커밋**

```bash
bun run typecheck && bun run lint
git add client/src/pages/CustomerDetailPage.tsx
git commit -m "feat(crm): 견적함 원본 첨부 영속 + 미리보기/다운로드/삭제 #4d"
```
Expected: typecheck 0, lint 0.

---

## Task 5: 최종 검증 + 문서

**Files:**
- Modify: `ref/active-session-brief.md`

- [ ] **Step 1: 전체 검증 4종**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun test --env-file=.env.local && bun run build
```
Expected: typecheck 0 · lint 0 · test:unit 통과(kim-quote `file_*` 신규) · test:server 통과(견적 원본 2건 신규 = 기존 59 + 2 = 61) · build OK.

- [ ] **Step 2: brief 갱신**

`ref/active-session-brief.md` Current Focus에 #4d 항목 추가(구현 완료/브랜치 또는 머지 상태). `file_*` 컬럼 기존이라 **마이그레이션 없음** 명시. **⏳브라우저 검증 미완**(견적함 행 드롭→새로고침 유지·미리보기·다운로드·교체·삭제, #4c 일괄·인증 세션). 스펙·플랜 경로 기입.

- [ ] **Step 3: 커밋 + PR(사용자 지시 시)**

```bash
git add ref/active-session-brief.md ref/plans/2026-06-23-crm-quotes-original-upload.md
git commit -m "docs(brief,plan): 견적 원본 업로드 #4d 구현 반영"
```
PR/머지는 사용자(송실장/유슨생) 지시 시. `[skip ci]` 토큰 금지.

---

## Self-Review (작성자 체크 완료)

**1. Spec coverage**
- 범위(영속만·행 드롭만·원본 직접) → Task 1~4 ✅
- 계층 1 file_path 비노출(타입+런타임) → Task 2 Step 4 ✅
- 계층 2 query 헬퍼 3 → Task 2 Step 3 ✅
- 계층 3 라우트 3(POST/DELETE/GET url) → Task 2 Step 5 ✅
- 계층 4 kim-quote 어댑터 → Task 1 ✅
- 계층 5 프론트 lib 3 → Task 3 ✅
- 계층 6 CustomerDetailPage(attach/미리보기/삭제) → Task 4 ✅
- 검증(server 업로드·삭제·url·415·404 / unit 매핑 / 브라우저) → Task 2·1·5 ✅

**2. Placeholder scan** — 모든 step에 실제 코드/명령/기대출력. TBD 없음 ✅

**3. Type consistency**
- `setQuoteFile(customerId, quoteId, {fileName,fileSize,fileMime,filePath})` 정의(Task 2) ↔ 라우트 호출(Task 2 Step 5) 일치 ✅
- `uploadQuoteOriginal(cid, quoteId, file)` 정의(Task 3) ↔ `attachQuoteFileToQuote` 호출(Task 4) 일치 ✅
- `getQuoteOriginalUrl` 반환 `{url, downloadUrl, fileMime}` ↔ effect `r.url` 사용 일치 ✅
- `CustomerDetailQuote.fileName/fileSize/fileMime`(Task 1 Step 3) ↔ `setQuoteFile`/getCustomer select 컬럼명(`file_name`→camelCase `fileName`) 일치 ✅
- `QuoteWithScenarios = Omit<…, "filePath">` ↔ map의 `{ filePath: _filePath, ...rest }` 제거 일치 ✅

**구현자 caveat:**
- 모든 새 프론트 lib는 성공 시 `invalidateCustomerDetail` 호출(상세 캐시 불변식) — Task 3에 포함.
- 임시 id(`kim-`) 견적은 저장 전이라 업로드/삭제 API 생략(낙관만) — Task 4 가드 포함.
- `getJson`이 `client/src/lib/http.ts`에 export돼 있는지 확인(서류 lib가 사용 중이면 존재). 없으면 추가.
- Task 1 Step 3의 줄 번호는 참고용 — `file_*`는 **`CustomerDetailQuote`(quote)** 에 넣고 `CustomerDetailScenario`가 아님을 반드시 확인.
