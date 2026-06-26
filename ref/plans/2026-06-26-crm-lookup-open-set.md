# CRM 열린집합 source/category/type lookup 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 유입경로(source)·할일분류(category)·일정종류(type)를 lookup으로 시드하고 검증을 추가하며, source의 "기타" 자유입력을 제거해 닫힌화한다.

**Architecture:** chance·doctype 패턴 재사용(현행 옵션 → data SSOT 이동 + 시드 + `validateLookupValue`). source만 "기타" custom 입력 UI 제거가 추가된다. team은 별도 슬라이스. 마이그레이션 0(lookup_values 재사용).

**Tech Stack:** drizzle-orm 0.45, Hono + zod-validator, bun:test(`test:server`), vitest(`test:unit`, kim-status-fields).

**Spec:** `ref/specs/2026-06-26-crm-lookup-open-set-design.md`

**Branch:** `feat/crm-lookup-open-set` (이미 생성, spec 커밋됨)

---

## 파일 구조

- `client/src/data/customers.ts` — 옵션 상수 export(신규 6개)(수정).
- `client/src/lib/kim-status-fields.ts` — source 상수 re-export + `parseKimSourceValue` 닫힌화(수정).
- `client/src/lib/kim-status-fields.test.ts` — `parseKimSourceValue` 테스트 갱신(수정).
- `client/src/pages/CustomerDetailPage.tsx` — category/type 로컬 상수 제거·import, source 편집기 "기타" 제거(수정).
- `scripts/seed-lookups.ts` — source/task_category/schedule_type 시드(수정).
- `src/routes/customers.ts` — source·category·type 검증(수정).
- `src/routes/customers.test.ts` — 3종 라운드트립 테스트(수정).

---

## Task 1: 옵션 상수 SSOT 이동 (동작 불변)

**Files:**
- Modify: `client/src/data/customers.ts`, `client/src/lib/kim-status-fields.ts:9-11`, `client/src/pages/CustomerDetailPage.tsx:322,324,2950,3036,4017`

- [ ] **Step 1: data에 옵션 상수 추가**

`client/src/data/customers.ts`의 `DOC_TYPE_OPTIONS` 아래에 추가(현행 값 그대로):

```ts
// 유입 경로(source) — 자동/수동 + 합본. kim-status-fields가 re-export, seed/검증에 공유.
export const SOURCE_AUTOMATIC_OPTIONS: readonly string[] = ["앱 견적비교", "앱 AI상담", "앱 상담원 연결", "디엘(상담)", "디엘(견적서)"];
export const SOURCE_MANUAL_OPTIONS: readonly string[] = ["대표전화", "카카오", "소개", "추천", "재구매", "유튜브", "검색", "기타"];
export const SOURCE_OPTIONS: readonly string[] = [...SOURCE_AUTOMATIC_OPTIONS, ...SOURCE_MANUAL_OPTIONS];
export const SOURCE_LEGACY_AUTOMATIC_OPTIONS: readonly string[] = ["디엘홈페이지"];

// 할일 분류(tasks.category) — 닫힌 6종.
export const TASK_CATEGORY_OPTIONS: readonly string[] = ["체크", "견적", "안내", "요청", "내부", "심사"];

// 일정 종류(schedules.type) — 닫힌 8종.
export const SCHEDULE_TYPE_OPTIONS: readonly string[] = ["재연락", "결정확인", "체크", "견적", "안내", "요청", "내부", "심사"];
```

- [ ] **Step 2: kim-status-fields가 source 상수를 data에서 re-export**

`client/src/lib/kim-status-fields.ts`의 9-11행(`kimAutomaticSourceOptions`·`kimLegacyAutomaticSourceOptions`·`kimManualSourceOptions` 정의)을 data import + re-export로 교체:

```ts
import { SOURCE_AUTOMATIC_OPTIONS, SOURCE_MANUAL_OPTIONS, SOURCE_LEGACY_AUTOMATIC_OPTIONS } from "@/data/customers";

export const kimAutomaticSourceOptions = SOURCE_AUTOMATIC_OPTIONS;
export const kimLegacyAutomaticSourceOptions = SOURCE_LEGACY_AUTOMATIC_OPTIONS;
export const kimManualSourceOptions = SOURCE_MANUAL_OPTIONS;
```
(이름 유지 → 소비처 `CustomerDetailPage`(678/681)·`isKimAutomaticSource`는 변경 없음.)

- [ ] **Step 3: CustomerDetailPage category/type 로컬 상수 제거·import**

`client/src/pages/CustomerDetailPage.tsx`에서 로컬 `kimCheckCategoryOptions`(322행)·`kimScheduleTypeOptions`(324행) 정의를 **삭제**하고, 상단 `@/data/customers` import에 `TASK_CATEGORY_OPTIONS`·`SCHEDULE_TYPE_OPTIONS`를 추가한다.

사용처를 교체(이름만):
- 2950행 `kimScheduleTypeOptions.map` → `SCHEDULE_TYPE_OPTIONS.map`
- 3036행 `kimCheckCategoryOptions.map` → `TASK_CATEGORY_OPTIONS.map`
- 4017행 `kimCheckCategoryOptions.map` → `TASK_CATEGORY_OPTIONS.map`

- [ ] **Step 4: typecheck (동작 불변 확인)**

Run: `bun run typecheck`
Expected: 0 errors. (상수 이동만, 값·동작 불변.)

- [ ] **Step 5: 커밋**

```bash
git add client/src/data/customers.ts client/src/lib/kim-status-fields.ts client/src/pages/CustomerDetailPage.tsx
git commit -m "$(cat <<'EOF'
refactor(crm): source/category/type 옵션 상수 data SSOT 이동

SOURCE_*·TASK_CATEGORY_OPTIONS·SCHEDULE_TYPE_OPTIONS를 data/customers.ts로.
kim-status-fields는 re-export(이름 유지), 동작 불변. lookup 시드/검증 공유 토대.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: source "기타" 자유입력 제거 (닫힌화)

**Files:**
- Modify: `client/src/lib/kim-status-fields.ts:71-76`, `client/src/lib/kim-status-fields.test.ts:45-48`, `client/src/pages/CustomerDetailPage.tsx:664-690,1900`

- [ ] **Step 1: parseKimSourceValue 테스트 갱신(실패 유도)**

`client/src/lib/kim-status-fields.test.ts`의 45-48행 테스트를 닫힌화 후 동작으로 교체:

```ts
  it("parseKimSourceValue는 등록 옵션/레거시를 정규화하고 미등록은 기타로", () => {
    expect(parseKimSourceValue("앱 견적비교")).toBe("앱 견적비교");
    expect(parseKimSourceValue("디엘홈페이지")).toBe("디엘(상담)");
    expect(parseKimSourceValue("지인 소개행사")).toBe("기타");
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:unit client/src/lib/kim-status-fields.test.ts`
Expected: FAIL — 현재 `parseKimSourceValue`가 `{ selected, custom }` 객체를 반환해 `.toBe` 불일치.

- [ ] **Step 3: parseKimSourceValue를 string 반환으로 닫힌화**

`client/src/lib/kim-status-fields.ts`의 71-76행을 교체:

```ts
export function parseKimSourceValue(value: string): string {
  const allOptions = [...kimAutomaticSourceOptions, ...kimManualSourceOptions];
  if (allOptions.includes(value)) return value;
  if (kimLegacyAutomaticSourceOptions.includes(value)) return "디엘(상담)";
  return "기타";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/kim-status-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: source 편집기에서 custom 입력 제거**

`client/src/pages/CustomerDetailPage.tsx`의 `KimSourceStatusEditor`(664-690행)를 수정. custom input을 없애면 `selectedSource` state가 더 안 쓰이므로 useState·onChange도 제거한다:
- 664행: `initialSource`가 이제 string — 그대로 유지(`const initialSource = parseKimSourceValue(initialValue);`).
- 665행 `const [selectedSource, setSelectedSource] = useState(initialSource.selected);` **삭제**.
- select(671-683행)에서 `onChange={(event) => setSelectedSource(event.currentTarget.value)}` **삭제**, `defaultValue={initialSource.selected}` → `defaultValue={initialSource}`. (`name="source"`로 폼 제출되므로 state 불필요.)
- 685-690행(`{selectedSource === "기타" ? (<label>기타 경로 …</label>) : null}`)을 **통째로 삭제**.

수정 후 `KimSourceStatusEditor` 반환 JSX의 select:
```tsx
        <select autoFocus defaultValue={initialSource} name="source">
          <optgroup label="자동 접수">
            {kimAutomaticSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </optgroup>
          <optgroup label="수동 접수">
            {kimManualSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </optgroup>
        </select>
```

- [ ] **Step 6: saveSourceField에서 custom 로직 제거**

`client/src/pages/CustomerDetailPage.tsx`의 `saveSourceField`(약 1895행)에서 customSource 분기를 제거:

```ts
  function saveSourceField(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextSource = String(formData.get("source") ?? "").trim();
    if (!nextSource) return;
    const prevSource = statusValues.source;
    setStatusValues((current) => ({ ...current, source: nextSource }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
```
(이하 기존 코드 유지 — `customSource` 변수와 `source === "기타" ? customSource …` 줄만 제거.)

- [ ] **Step 7: typecheck + 커밋**

Run: `bun run typecheck && bun run test:unit client/src/lib/kim-status-fields.test.ts`
Expected: typecheck 0, 테스트 PASS.

```bash
git add client/src/lib/kim-status-fields.ts client/src/lib/kim-status-fields.test.ts client/src/pages/CustomerDetailPage.tsx
git commit -m "$(cat <<'EOF'
feat(crm): source "기타" 자유입력 제거(닫힌화)

parseKimSourceValue를 string 정규화로(미등록→기타), 편집기 custom input·
저장 customSource 분기 제거. 13종 닫힌 선택만. 검증 가능 토대.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 시드 (source/task_category/schedule_type)

**Files:**
- Modify: `scripts/seed-lookups.ts`

- [ ] **Step 1: seed-lookups에 3카테고리 추가**

`scripts/seed-lookups.ts` import에 3상수 추가:

```ts
import { CHANCE_OPTIONS, DOC_TYPE_OPTIONS, SOURCE_OPTIONS, TASK_CATEGORY_OPTIONS, SCHEDULE_TYPE_OPTIONS, customerStatusGroups } from "../client/src/data/customers";
```

doc_type 블록 다음에 추가:

```ts
  // 유입 경로(source) — 닫힌 13종(자동+수동).
  SOURCE_OPTIONS.forEach((value, i) => {
    rows.push({ category: "source", value, parentValue: null, sortOrder: i });
  });

  // 할일 분류(task_category) — 닫힌 6종.
  TASK_CATEGORY_OPTIONS.forEach((value, i) => {
    rows.push({ category: "task_category", value, parentValue: null, sortOrder: i });
  });

  // 일정 종류(schedule_type) — 닫힌 8종.
  SCHEDULE_TYPE_OPTIONS.forEach((value, i) => {
    rows.push({ category: "schedule_type", value, parentValue: null, sortOrder: i });
  });
```

delete 카테고리 목록 교체:

```ts
  await db.delete(lookupValues).where(and(inArray(lookupValues.category, ["status_group", "status", "chance", "doc_type", "source", "task_category", "schedule_type"])));
```

console.log 교체:

```ts
  console.log(`seeded lookup_values: ${deduped.length} rows (status_group/status/chance/doc_type/source/task_category/schedule_type)`);
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: 시드 실행(공유 master, 확인 후) + 멱등**

> ⚠️ 공유 master DB. 확인 후. additive(source 13 + task_category 6 + schedule_type 8 = 27행 추가).

Run: `bun run seed:lookups` (2회)
Expected: 두 번 모두 `seeded lookup_values: 93 rows (…)`(66 + 27). 누적 없음.

- [ ] **Step 4: 커밋**

```bash
git add scripts/seed-lookups.ts
git commit -m "$(cat <<'EOF'
feat(crm): source/task_category/schedule_type lookup 시드

3카테고리 27행 추가(총 93행). 멱등.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: source/category/type 검증 + 서버 테스트

**Files:**
- Modify: `src/routes/customers.test.ts`(테스트 추가), `src/routes/customers.ts`(검증 3곳)

- [ ] **Step 1: 실패 테스트 추가**

`src/routes/customers.test.ts` 맨 끝에 추가(시드 전제). 자식(task/schedule) throwaway는 `finally`로 정리.

```ts
test("source 검증: 없는 source → 400 / 유효 → 200(원복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; source: string | null }>;
  const target = list[0];
  expect((await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ source: "없는경로" }) })).status).toBe(400);
  try {
    expect((await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ source: "대표전화" }) })).status).toBe(200);
  } finally {
    await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ source: target.source }) });
  }
});

test("task category 검증: 없는 category POST → 400, 유효 → 201", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  expect((await app.request(`/api/customers/${cid}/tasks`, { method: "POST", headers: h, body: JSON.stringify({ category: "없는분류", body: "x" }) })).status).toBe(400);
  const ok = await app.request(`/api/customers/${cid}/tasks`, { method: "POST", headers: h, body: JSON.stringify({ category: "견적", body: "x" }) });
  expect(ok.status).toBe(201);
  const taskId = ((await ok.json()) as { id: string }).id;
  await app.request(`/api/customers/${cid}/tasks/${taskId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
});

test("schedule type 검증: 없는 type POST → 400, 유효 → 201", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  expect((await app.request(`/api/customers/${cid}/schedules`, { method: "POST", headers: h, body: JSON.stringify({ type: "없는종류", scheduledDate: "2026-06-01" }) })).status).toBe(400);
  const ok = await app.request(`/api/customers/${cid}/schedules`, { method: "POST", headers: h, body: JSON.stringify({ type: "견적", scheduledDate: "2026-06-01" }) });
  expect(ok.status).toBe(201);
  const schId = ((await ok.json()) as { id: string }).id;
  await app.request(`/api/customers/${cid}/schedules/${schId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: 세 테스트의 400 단언이 FAIL(검증 없어 200/201). 유효 케이스는 통과.

- [ ] **Step 3: customers PATCH에 source 검증 추가**

`src/routes/customers.ts` PATCH 핸들러의 chance 검증 블록 다음에 추가:

```ts
    // 유입 경로(source) 닫힌 집합 검증.
    if (patch.source !== undefined) {
      const error = await validateLookupValue("source", patch.source, c.var.db);
      if (error) return c.json({ error }, 400);
    }
```

- [ ] **Step 4: task POST·PATCH에 category 검증 추가**

`src/routes/customers.ts`의 task POST(약 178행)·PATCH(약 180행)를 검증 포함으로 교체:

```ts
customers.post("/:id/tasks", zValidator("param", idParam), zValidator("json", taskBody), async (c) => {
  const body = c.req.valid("json");
  if (body.category !== undefined) {
    const error = await validateLookupValue("task_category", body.category, c.var.db);
    if (error) return c.json({ error }, 400);
  }
  return c.json(await addTask(c.req.valid("param").id, body, c.var.db), 201);
});
customers.patch("/:id/tasks/:childId", zValidator("param", childParam), zValidator("json", taskBody), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.category !== undefined) {
    const error = await validateLookupValue("task_category", body.category, c.var.db);
    if (error) return c.json({ error }, 400);
  }
  return run(c, () => updateTask(p.id, p.childId, body, c.var.db), "할 일을 찾을 수 없습니다.");
});
```

- [ ] **Step 5: schedule POST·PATCH에 type 검증 추가**

`src/routes/customers.ts`의 schedule POST(약 189행)·PATCH(약 191행)를 교체:

```ts
customers.post("/:id/schedules", zValidator("param", idParam), zValidator("json", scheduleBody), async (c) => {
  const body = c.req.valid("json");
  if (body.type !== undefined) {
    const error = await validateLookupValue("schedule_type", body.type, c.var.db);
    if (error) return c.json({ error }, 400);
  }
  return c.json(await addSchedule(c.req.valid("param").id, body, c.var.db), 201);
});
customers.patch("/:id/schedules/:childId", zValidator("param", childParam), zValidator("json", scheduleBody), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.type !== undefined) {
    const error = await validateLookupValue("schedule_type", body.type, c.var.db);
    if (error) return c.json({ error }, 400);
  }
  return run(c, () => updateSchedule(p.id, p.childId, body, c.var.db), "일정을 찾을 수 없습니다.");
});
```

- [ ] **Step 6: 테스트 통과 + typecheck**

Run: `bun run typecheck && bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: typecheck 0. 3종 테스트 PASS, 기존 자식 CRUD 테스트(category "체크"/type "견적" 사용)도 통과(목록에 있음).

- [ ] **Step 7: 커밋**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "$(cat <<'EOF'
feat(crm): source/category/type 닫힌 집합 검증 연결

customers PATCH(source)·task POST/PATCH(category)·schedule POST/PATCH(type)에
validateLookupValue. 키 올 때만 1쿼리, 위반 400. 서버 테스트 3.

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
bun run test:unit   # 기존 + kim-status-fields 갱신 통과
bun run test:server # 기존 + source/category/type 3 통과
bun run build       # OK
```

- [ ] **Step 2: 푸시 + PR(사용자 확인 후)**

```bash
git push -u origin feat/crm-lookup-open-set
gh pr create --title "feat(crm): 열린집합 source/category/type lookup + 검증" --body "$(cat <<'EOF'
## 요약
enum/lookup 가로확장 🅰 — 열린 집합 3종 lookup화. chance·doctype 패턴 재사용(마이그 0).

- 옵션 상수 SSOT 이동: `SOURCE_*`·`TASK_CATEGORY_OPTIONS`·`SCHEDULE_TYPE_OPTIONS` → `data/customers.ts`(현행 그대로).
- **source "기타" 자유입력 제거**(닫힌화): `parseKimSourceValue` string 정규화 + 편집기 custom·저장 분기 제거. 13종 닫힌 선택만.
- seed `source`(13)·`task_category`(6)·`schedule_type`(8) 27행(총 93행).
- 검증: customers PATCH(source)·task POST/PATCH(category)·schedule POST/PATCH(type)에 `validateLookupValue`. 현행 옵션=목록이라 정상 입력 통과, 잘못된 값만 400.
- **team 제외**(쓰기경로·재배정UI 없음, 별도 슬라이스).

## ⚠️ 결정 메모
- source 옵션은 **현행 13종**(재구매/검색/기타 포함, 이사님 문서 10종과 다름) — 현행 코드 기준.

## 검증
typecheck 0 · lint 0 · test:unit · test:server(+3) · build OK. 시드 멱등(93행).

스펙 `ref/specs/2026-06-26-crm-lookup-open-set-design.md` · 플랜 `ref/plans/2026-06-26-crm-lookup-open-set.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> 커밋/푸시/PR은 CLAUDE.md 규약상 사용자 지시 시. squash 머지 시 skip-ci 토큰 금지.

---

## Self-review 메모

- **Spec 커버리지**: SSOT 이동(Task1) / source 닫힌화(Task2) / 시드(Task3) / 검증 3곳(Task4) / team 제외(설계) — 전부 매핑.
- **타입 일관성**: `parseKimSourceValue` string 반환(Task2)이 소비처(664-665·673)·테스트와 일치. `validateLookupValue(category,value,executor)` 재사용. `SOURCE_OPTIONS` 등 정의(Task1)·소비(Task3 시드) 일치.
- **순서 의존**: Task3 시드 → Task4 서버 테스트(lookup 전제). Task1 SSOT → Task2 source 닫힌화(같은 파일).
- **데이터 충돌 없음**: DB source 10종·category/type 기존값이 현행 옵션(목록)에 포함 → 정상 입력 통과. 기존 자식 CRUD 테스트의 category "체크"/type "견적"도 목록에 있음.
