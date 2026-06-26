# CRM 서류 doc_type 정리 + lookup 검증 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 죽은 `customer_documents.title` 컬럼을 제거하고, `doc_type`을 lookup(category="doc_type")으로 적재해 서류 POST/PATCH에 닫힌 집합 검증을 추가한다.

**Architecture:** `title`은 `docType` 복사본(POST가 `title=docType`으로 저장)이라 코드 참조 제거 후 DROP. `doc_type`은 닫힌 22종(`DOC_TYPE_OPTIONS`로 SSOT 이동)이며 chance에서 만든 `validateLookupValue`를 재사용한다.

**Tech Stack:** drizzle-orm 0.45, Hono + zod-validator, bun:test(`test:server`, 실 master DB + storage mock).

**Spec:** `ref/specs/2026-06-26-crm-doctype-cleanup-design.md`

**Branch:** `feat/crm-doctype-cleanup` (이미 생성, spec 커밋됨)

---

## 파일 구조

- `src/db/schema.ts` — `customerDocuments.title` 제거(수정).
- `src/db/queries/customer-documents.ts` — `addDocument` title 제거(수정).
- `src/db/queries/customers.ts` — `getCustomer` documents select title 제거(수정).
- `src/routes/customers.ts` — POST title 제거 + POST/PATCH docType 검증(수정).
- `client/src/lib/customers.ts` — `CustomerDetailDocument` title 제거(수정).
- `client/src/pages/CustomerDetailPage.tsx` — title 폴백 정리 + `kimDocumentTypeOptions`→import(수정).
- `client/src/data/customers.ts` — `DOC_TYPE_OPTIONS` export(수정).
- `scripts/seed-lookups.ts` — doc_type 시드(수정).
- `drizzle/0006_*.sql` — title DROP(생성).
- `src/routes/customers.test.ts` — doc_type 검증 테스트(수정).

---

## Task 1: title 코드 참조 + 스키마 제거

**Files:**
- Modify: `src/db/schema.ts`, `src/db/queries/customer-documents.ts:17-46`, `src/db/queries/customers.ts:91`, `src/routes/customers.ts:292-297`, `client/src/lib/customers.ts:82`, `client/src/pages/CustomerDetailPage.tsx:913`

- [ ] **Step 1: schema에서 title 컬럼 제거**

`src/db/schema.ts`의 `customerDocuments` 정의에서 `title` 줄을 삭제한다:

```ts
  // (삭제) title: text("title"),
```
(`docType: text("doc_type"),` 이하는 그대로 둔다.)

- [ ] **Step 2: addDocument title 제거**

`src/db/queries/customer-documents.ts` `addDocument`에서 `title` 파라미터와 values를 제거한다. 수정 후 시그니처/values:

```ts
export async function addDocument(
  customerId: string,
  v: {
    docType?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
    fileMime?: string | null;
    filePath: string;
    thumbPath?: string | null;
    sortOrder?: number | null;
  },
  ex: Executor = getDefaultDb(),
): Promise<Created> {
  const [row] = await ex
    .insert(customerDocuments)
    .values({
      customerId,
      docType: v.docType ?? null,
      fileName: v.fileName ?? null,
      fileSize: v.fileSize ?? null,
      fileMime: v.fileMime ?? null,
      filePath: v.filePath,
      thumbPath: v.thumbPath ?? null,
      sortOrder: v.sortOrder ?? null,
    })
    .returning({ id: customerDocuments.id, createdAt: customerDocuments.createdAt });
  return row;
}
```

- [ ] **Step 3: getCustomer documents select title 제거**

`src/db/queries/customers.ts`의 `getCustomer` documents select(약 88-101행)에서 `title: customerDocuments.title,` 줄을 삭제한다. (`CustomerDetail.documents`는 `Omit<typeof customerDocuments.$inferSelect, "filePath" | "thumbPath">[]`라 컬럼 제거 시 타입 자동 반영.)

- [ ] **Step 4: POST 라우트 title 제거**

`src/routes/customers.ts` 서류 POST(약 292-297행)에서 addDocument 호출과 응답의 `title: docType,`를 제거:

```ts
    const row = await addDocument(
      p.id,
      { docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, filePath: path, thumbPath, sortOrder },
      c.var.db,
    );
    return c.json({ id: row.id, docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, sortOrder, createdAt: row.createdAt }, 201);
```
(변수명 `p.id`/`path`/`thumbPath`/`sortOrder`는 기존 코드 그대로 유지 — title 키만 두 곳에서 제거.)

- [ ] **Step 5: 프론트 타입·폴백 title 제거**

`client/src/lib/customers.ts:82` `CustomerDetailDocument`에서 `title: string | null;` 제거:

```ts
type CustomerDetailDocument = { id: string; docType: string | null; fileName: string | null; fileSize: number | null; fileMime: string | null; sortOrder: number | null; createdAt: string | null };
```

`client/src/pages/CustomerDetailPage.tsx:913` title 폴백에서 `d.title` 제거:

```ts
      title: d.docType ?? "",
```

- [ ] **Step 6: typecheck로 정합 확인**

Run: `bun run typecheck`
Expected: 0 errors. (title 참조가 남아 있으면 여기서 에러로 잡힘 — 잡히면 그 위치도 제거.)

- [ ] **Step 7: 커밋**

```bash
git add src/db/schema.ts src/db/queries/customer-documents.ts src/db/queries/customers.ts src/routes/customers.ts client/src/lib/customers.ts client/src/pages/CustomerDetailPage.tsx
git commit -m "$(cat <<'EOF'
refactor(crm): 죽은 서류 title 컬럼 코드 참조 제거

title은 docType 복사본(POST가 title=docType 저장)이라 중복. addDocument·
getCustomer·POST 응답·프론트 타입·#69 폴백에서 title 제거(진실원본=doc_type).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: title DROP 마이그레이션

**Files:**
- Create: `drizzle/0006_*.sql`

- [ ] **Step 1: 마이그레이션 생성**

Run: `bun run db:generate`
Expected: `drizzle/0006_*.sql`에 `ALTER TABLE "crm"."customer_documents" DROP COLUMN "title";` (crm only). 다른 스키마 변경 없음.

- [ ] **Step 2: 생성 SQL 확인**

Run: `cat drizzle/0006_*.sql`
Expected: `customer_documents` DROP COLUMN title만. public/catalog DDL 없음.

- [ ] **Step 3: title 데이터 안전성 확인(공유 master, 적용 전)**

> ⚠️ title DROP은 비가역. title은 docType 복사본이라 손실 무해하나, 적용 전 확인.

Run: `bun run --env-file=.env.local -e "import('./src/db/client').then(async ({getDefaultDb})=>{const {sql}=await import('drizzle-orm');const db=getDefaultDb();const r=await db.execute(sql\`select count(*) filter (where title is not null and title is distinct from doc_type) as mismatch from crm.customer_documents\`);console.log(r);process.exit(0)})"`
Expected: `mismatch = 0`(모든 title이 doc_type와 같거나 null → 손실 무해). mismatch>0이면 중단하고 사용자에게 보고.

- [ ] **Step 4: 마이그레이션 적용(공유 master, 확인 후)**

> ⚠️ 공유 master DB DROP COLUMN. 사용자 확인 후 실행.

Run: `bun run db:migrate`
Expected: `0006` 적용 성공.

- [ ] **Step 5: 커밋**

```bash
git add drizzle/
git commit -m "$(cat <<'EOF'
feat(crm): 서류 title 컬럼 DROP 마이그레이션 0006

docType 복사본이던 죽은 title 제거(crm only). 진실원본=doc_type.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: DOC_TYPE_OPTIONS SSOT 이동 + doc_type 시드

**Files:**
- Modify: `client/src/data/customers.ts`, `client/src/pages/CustomerDetailPage.tsx:326-349,5160`, `scripts/seed-lookups.ts`

- [ ] **Step 1: DOC_TYPE_OPTIONS를 data로 이동·export**

`client/src/data/customers.ts`에 추가(다른 export 상수 근처, 예: `CHANCE_OPTIONS` 아래):

```ts
// 서류 분류 종류(닫힌 집합 22종). classifyKimDocumentFile 반환값과 동일.
export const DOC_TYPE_OPTIONS: readonly string[] = [
  "면허증",
  "주민등록등본",
  "원천징수영수증",
  "사업자등록증",
  "부가세과세증명원",
  "소득금액증명원",
  "자동이체통장사본",
  "매매계약서",
  "리스승인서",
  "계약사실확인서",
  "법인(점)주주명부",
  "법인(점)등기부등본",
  "법인(점)법인인감증명서",
  "법인(점)개인인감증명서",
  "법인(점)재무제표(당해)",
  "법인(점)재무제표(전기)",
  "등록(점)자동차등록증",
  "등록(점)세금계산서",
  "등록(점)취득세납부영수증",
  "등록(점)등록비영수증",
  "등록(점)보험가입증명서",
  "기타서류",
];
```

- [ ] **Step 2: CustomerDetailPage에서 로컬 상수 제거·import 사용**

`client/src/pages/CustomerDetailPage.tsx`의 로컬 `kimDocumentTypeOptions = [...]`(326-349행) 정의를 삭제하고, 상단 `@/data/customers` import에 `DOC_TYPE_OPTIONS`를 추가한다. 사용처(약 5160행)의 `kimDocumentTypeOptions.map` → `DOC_TYPE_OPTIONS.map`으로 교체.

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: seed-lookups에 doc_type 추가**

`scripts/seed-lookups.ts` import에 `DOC_TYPE_OPTIONS` 추가:

```ts
import { CHANCE_OPTIONS, DOC_TYPE_OPTIONS, customerStatusGroups } from "../client/src/data/customers";
```

chance 블록 다음에 doc_type 행 추가:

```ts
  // 서류 종류(doc_type) — 닫힌 집합(DOC_TYPE_OPTIONS).
  DOC_TYPE_OPTIONS.forEach((value, i) => {
    rows.push({ category: "doc_type", value, parentValue: null, sortOrder: i });
  });
```

delete 카테고리 목록에 `"doc_type"` 추가:

```ts
  await db.delete(lookupValues).where(and(inArray(lookupValues.category, ["status_group", "status", "chance", "doc_type"])));
```

console.log 메시지 교체:

```ts
  console.log(`seeded lookup_values: ${deduped.length} rows (status_group/status/chance/doc_type)`);
```

- [ ] **Step 5: 시드 실행(공유 master, 확인 후) + 멱등**

> ⚠️ 공유 master DB. 확인 후. additive(doc_type 22행 추가).

Run: `bun run seed:lookups` (2회)
Expected: 두 번 모두 `seeded lookup_values: 66 rows (status_group/status/chance/doc_type)`(44 + doc_type 22). 누적 없음.

- [ ] **Step 6: 커밋**

```bash
git add client/src/data/customers.ts client/src/pages/CustomerDetailPage.tsx scripts/seed-lookups.ts
git commit -m "$(cat <<'EOF'
feat(crm): doc_type DOC_TYPE_OPTIONS SSOT 이동 + lookup 시드

서류 분류 22종을 data/customers.ts로 이동(SSOT), CustomerDetailPage는 import.
seed:lookups에 category="doc_type" 22행 추가.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 서류 POST/PATCH doc_type 검증 + 서버 테스트

**Files:**
- Modify: `src/routes/customers.ts`(POST·PATCH docType 검증), `src/routes/customers.test.ts`(테스트 추가)

- [ ] **Step 1: 실패 테스트 추가**

`src/routes/customers.test.ts` 맨 끝에 추가한다. Task 3 시드(doc_type)를 전제. storage는 파일 상단에서 이미 mock 처리됨.

```ts
test("서류 doc_type 검증: 업로드 시 없는 docType → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
  fd.append("docType", "존재하지않는종류");
  const res = await app.request(`/api/customers/${list[0].id}/documents`, { method: "POST", headers: auth, body: fd });
  expect(res.status).toBe(400);
});

test("서류 doc_type 검증: 유효 docType 업로드→PATCH(없는값 400·유효 200)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const auth = { Authorization: `Bearer ${token}` };
  const h = { ...auth, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: auth })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3])], "사업자등록증.png", { type: "image/png" }));
  fd.append("docType", "사업자등록증");
  const up = await app.request(`/api/customers/${cid}/documents`, { method: "POST", headers: auth, body: fd });
  expect(up.status).toBe(201);
  const doc = (await up.json()) as { id: string };
  try {
    const bad = await app.request(`/api/customers/${cid}/documents/${doc.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ docType: "없는종류" }) });
    expect(bad.status).toBe(400);
    const ok = await app.request(`/api/customers/${cid}/documents/${doc.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ docType: "기타서류" }) });
    expect(ok.status).toBe(200);
  } finally {
    // 공유 master DB라 throwaway 서류 정리.
    await getDefaultDb().delete(customerDocuments).where(eq(customerDocuments.id, doc.id));
  }
});
```

(파일 상단에 `customerDocuments`·`getDefaultDb`·`eq` import는 기존 서류 테스트에서 이미 있음 — 없으면 추가.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: "업로드 시 없는 docType → 400"과 PATCH "없는값 400"이 FAIL(현재 검증 없어 201/200). 유효 케이스는 통과.

- [ ] **Step 3: POST/PATCH에 doc_type 검증 연결**

`src/routes/customers.ts` 서류 POST(약 266행 핸들러)에서 `docType` 추출 직후, `addDocument` 호출 전에 추가:

```ts
    if (docType !== null) {
      const error = await validateLookupValue("doc_type", docType, c.var.db);
      if (error) return c.json({ error }, 400);
    }
```

서류 PATCH(약 310행 핸들러)를 검증 포함으로 교체:

```ts
customers.patch("/:id/documents/:childId", zValidator("param", childParam), zValidator("json", z.object({ docType: z.string().nullable().optional() })), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.docType !== undefined) {
    const error = await validateLookupValue("doc_type", body.docType, c.var.db);
    if (error) return c.json({ error }, 400);
  }
  return run(c, () => updateDocument(p.id, p.childId, body, c.var.db), "서류를 찾을 수 없습니다.");
});
```

(`validateLookupValue`는 이미 `src/routes/customers.ts` 상단에 chance에서 import됨 — 확인.)

- [ ] **Step 4: 테스트 통과 + typecheck**

Run: `bun run typecheck && bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: typecheck 0. doc_type 테스트 PASS, 기존 서류 테스트 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "$(cat <<'EOF'
feat(crm): 서류 POST/PATCH doc_type 닫힌 집합 검증

docType이 올 때만 validateLookupValue("doc_type") 호출, 위반 400.
자동 분류 결과는 목록과 일치라 통과. 서버 테스트 2.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 최종 검증 + PR

- [ ] **Step 1: 검증 4종 + 빌드**

```bash
bun run typecheck   # 0
bun run lint        # 0
bun run test:unit   # 기존 통과(DOC_TYPE_OPTIONS 이동 동작 불변·kim-detail-utils classify 무관)
bun run test:server # 기존 + doc_type 2 통과
bun run build       # OK
```

- [ ] **Step 2: 푸시 + PR(사용자 확인 후)**

```bash
git push -u origin feat/crm-doctype-cleanup
gh pr create --title "feat(crm): 서류 doc_type 정리 + lookup 검증 (#69 후속)" --body "$(cat <<'EOF'
## 요약
서류 `title`/`doc_type` 중복 정리(#69 후속) + doc_type lookup 검증.

- **title 제거**: docType 복사본이던 죽은 `title` 컬럼 코드 참조 제거 + DROP(마이그 `0006`, crm only). 진실원본=doc_type.
- **doc_type SSOT**: `kimDocumentTypeOptions`(22종) → `data/customers.ts DOC_TYPE_OPTIONS`로 이동, CustomerDetailPage는 import. classify 반환값과 일치.
- **검증**: `category="doc_type"` 22행 시드 + 서류 POST/PATCH에 `validateLookupValue("doc_type")`(chance 함수 재사용). 자동분류는 통과, 잘못된 값만 400.

## 검증
typecheck 0 · lint 0 · test:server(+doc_type 2) · test:unit · build OK. 시드 멱등(66행). title DROP 전 mismatch=0 확인.

스펙 `ref/specs/2026-06-26-crm-doctype-cleanup-design.md` · 플랜 `ref/plans/2026-06-26-crm-doctype-cleanup.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> 커밋/푸시/PR은 CLAUDE.md 규약상 사용자 지시 시. squash 머지 시 커밋 메시지에 skip-ci 토큰 금지.

---

## Self-review 메모

- **Spec 커버리지**: title 코드 제거(Task1) / title DROP(Task2) / DOC_TYPE_OPTIONS SSOT(Task3) / doc_type 시드(Task3) / POST·PATCH 검증(Task4) — 전부 매핑.
- **타입 일관성**: `validateLookupValue(category, value, executor)` chance에서 정의·재사용. `addDocument` title 제거가 schema·POST 호출과 일치. `DOC_TYPE_OPTIONS` 정의(Task3 Step1)·소비(CustomerDetailPage·seed) 일치.
- **순서 의존**: Task3 시드 → Task4 서버 테스트(doc_type lookup 전제). Task1 코드 title 제거 → Task2 schema DROP(코드가 title 안 쓴 뒤 DROP).
- **검증 안전성**: doc_type 목록 = classify 반환값이라 자동분류 업로드도 통과. 잘못된 수동 값만 400.
