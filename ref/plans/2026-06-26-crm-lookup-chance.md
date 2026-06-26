# CRM lookup chance 슬라이스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `customers.chance`(계약 가능성)를 `crm.lookup_values`(category="chance")로 시드하고, PATCH에서 닫힌 집합 검증을 추가한다.

**Architecture:** 진행상태 파일럿(#107)이 깐 `lookup_values` 테이블·검증 패턴을 재사용한다. chance는 종속 없는 닫힌 집합이라 **마이그레이션 0** + 범용 검증 함수 `validateLookupValue`(향후 닫힌 도메인 재사용)로 처리한다. `priority`는 레거시라 손대지 않는다.

**Tech Stack:** drizzle-orm 0.45, Hono + zod-validator, bun:test(`test:server`, 실 master DB 라운드트립).

**Spec:** `ref/specs/2026-06-26-crm-lookup-chance-design.md`

**Branch:** `feat/crm-lookup-chance` (이미 생성, spec 커밋됨)

---

## 파일 구조

- `scripts/seed-lookups.ts` — chance 카테고리 시드 추가(수정).
- `src/db/queries/lookups.ts` — `validateLookupValue` 추가(수정).
- `src/routes/customers.ts` — PATCH에 chance 검증 연결(수정).
- `src/routes/customers.test.ts` — chance 라운드트립 테스트 추가(수정, bun).

마이그레이션·신규 파일 없음.

---

## Task 1: chance 시드 추가

**Files:**
- Modify: `scripts/seed-lookups.ts`

- [ ] **Step 1: 시드 스크립트에 chance 추가**

`scripts/seed-lookups.ts`를 수정한다. (a) import에 `CHANCE_OPTIONS` 추가, (b) chance 행 생성, (c) delete 카테고리·로그에 chance 반영.

import 줄 교체:

```ts
import { CHANCE_OPTIONS, customerStatusGroups } from "../client/src/data/customers";
```

status 루프(`for (const [group, statuses] ...)` 블록) **바로 다음**에 chance 행 생성 추가:

```ts
  // 계약 가능성(chance) — 종속 없는 닫힌 집합(CHANCE_OPTIONS).
  CHANCE_OPTIONS.forEach((value, i) => {
    rows.push({ category: "chance", value, parentValue: null, sortOrder: i });
  });
```

delete 줄의 카테고리 목록에 `"chance"` 추가:

```ts
  await db.delete(lookupValues).where(and(inArray(lookupValues.category, ["status_group", "status", "chance"])));
```

console.log 메시지 교체:

```ts
  console.log(`seeded lookup_values: ${deduped.length} rows (status_group/status/chance)`);
```

- [ ] **Step 2: 타입 점검**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: 시드 실행(공유 master, 확인 후) + 멱등 확인**

> ⚠️ 공유 master DB. 실행 전 사용자 확인. additive(chance 5행 추가, 기존 status 39행은 delete→재삽입으로 유지).

Run: `bun run seed:lookups` (2회)
Expected: 두 번 모두 `seeded lookup_values: 44 rows (status_group/status/chance)`(39 + chance 5). 누적 없음.

- [ ] **Step 4: 커밋**

```bash
git add scripts/seed-lookups.ts
git commit -m "$(cat <<'EOF'
feat(crm): chance 카테고리 lookup 시드 추가

CHANCE_OPTIONS → lookup_values(category="chance") 5행. 종속 없는 닫힌 집합.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 범용 검증 함수 validateLookupValue

**Files:**
- Modify: `src/db/queries/lookups.ts`

- [ ] **Step 1: `validateLookupValue` 추가**

`src/db/queries/lookups.ts` 끝(`validateStatusSelection` 함수 뒤)에 추가한다. 기존 import(`and, asc, eq, inArray`)에 이미 `and`/`eq`가 있어 추가 import 불필요.

```ts
// 종속 없는 닫힌 집합 도메인의 단일 값 검증(예: chance). value null → 통과(왕복 0).
// (category, value, active) 1행이 있으면 OK, 없으면 에러 메시지(400 본문). 닫힌 도메인 재사용.
export async function validateLookupValue(
  category: string,
  value: string | null | undefined,
  executor: Executor = getDefaultDb(),
): Promise<string | null> {
  if (value == null) return null;
  const rows = await executor
    .select({ value: lookupValues.value })
    .from(lookupValues)
    .where(
      and(
        eq(lookupValues.category, category),
        eq(lookupValues.value, value),
        eq(lookupValues.active, true),
      ),
    )
    .limit(1);
  return rows.length ? null : `유효하지 않은 ${category} 값입니다: ${value}`;
}
```

- [ ] **Step 2: 타입 점검**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: 커밋**

```bash
git add src/db/queries/lookups.ts
git commit -m "$(cat <<'EOF'
feat(crm): 범용 lookup 단일값 검증 validateLookupValue

종속 없는 닫힌 집합용(chance 등). value 올 때만 1쿼리, 없으면 왕복 0.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 라우트 PATCH chance 검증 + 서버 테스트

**Files:**
- Modify: `src/routes/customers.test.ts`(테스트 추가)
- Modify: `src/routes/customers.ts:12-17`(import), PATCH 핸들러

- [ ] **Step 1: 실패 테스트 추가**

`src/routes/customers.test.ts` 맨 끝에 추가한다. Task 1 시드로 chance lookup이 적재된 master DB를 전제로 한다.

```ts
test("chance 검증: 없는 chance 값 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const res = await app.request(`/api/customers/${list[0].id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ chance: "존재하지않는값" }),
  });
  expect(res.status).toBe(400);
});

test("chance 검증: 유효한 chance → 200(원복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; chance: string | null }>;
  const target = list[0];
  try {
    const res = await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ chance: "높음" }),
    });
    expect(res.status).toBe(200);
  } finally {
    // 원래 값으로 복원(공유 master DB).
    await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ chance: target.chance }),
    });
  }
});

test("chance 검증: chance=null(해제)은 통과 → 200", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; chance: string | null }>;
  const target = list[0];
  try {
    const res = await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ chance: null }),
    });
    expect(res.status).toBe(200);
  } finally {
    await app.request(`/api/customers/${target.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ chance: target.chance }),
    });
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: "chance 검증: 없는 chance 값 → 400"이 FAIL(현재 chance 검증이 없어 200). 나머지 200 케이스는 통과.

- [ ] **Step 3: 라우트에 chance 검증 연결**

`src/routes/customers.ts`의 import에서 기존 `validateStatusSelection` import 줄(12-17행 근처)을 교체:

```ts
import { validateLookupValue, validateStatusSelection } from "../db/queries/lookups";
```

PATCH 핸들러의 진행상태 검증 블록 **바로 다음**에 chance 검증 추가:

```ts
    // 계약 가능성(chance) 닫힌 집합 검증. chance 키가 올 때만 1쿼리.
    if (patch.chance !== undefined) {
      const error = await validateLookupValue("chance", patch.chance, c.var.db);
      if (error) return c.json({ error }, 400);
    }
```

(즉 PATCH 핸들러는 statusGroup/status 검증 → chance 검증 → `run(...)` 순.)

- [ ] **Step 4: 테스트 통과 확인 + typecheck**

Run: `bun run typecheck && bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: typecheck 0. chance 테스트 3개 PASS, 기존 테스트 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "$(cat <<'EOF'
feat(crm): customers PATCH에 chance 닫힌 집합 검증 연결

chance 키가 올 때만 validateLookupValue("chance") 호출, 위반 400.
서버 테스트 3(없는값400·유효200·null통과).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 최종 검증 + PR

- [ ] **Step 1: 검증 4종 + 빌드**

```bash
bun run typecheck   # 0
bun run lint        # 0 problems
bun run test:unit   # 기존 그대로(client 무변경)
bun run test:server # 기존 + chance 3 통과
bun run build       # OK
```

Expected: 전부 통과. `test:server`는 chance 시드(Task 1)를 전제로 함.

- [ ] **Step 2: 푸시 + PR 생성(사용자 확인 후)**

```bash
git push -u origin feat/crm-lookup-chance
gh pr create --title "feat(crm): chance lookup + PATCH 닫힌 집합 검증" --body "$(cat <<'EOF'
## 요약
enum/lookup 가로 확장 첫 도메인 = chance(계약 가능성). 진행상태 파일럿(#107) 인프라 재사용.

- 기존 `crm.lookup_values` 재사용(**마이그레이션 0**), `category="chance"` 5행 시드(`CHANCE_OPTIONS`).
- 범용 `validateLookupValue(category, value)` — 종속 없는 닫힌 집합용, 향후 도메인 재사용.
- `customers` PATCH: chance 키 올 때만 검증, 위반 400. "확정"↔계약완료 종속은 워크플로우 규칙 유지.
- `priority`는 레거시(쓰기 경로 없음)라 비범위.

## 검증
typecheck 0 · lint 0 · test:server(+chance 3) · test:unit · build OK. 시드 멱등(44행, 2회 동일).

스펙 `ref/specs/2026-06-26-crm-lookup-chance-design.md` · 플랜 `ref/plans/2026-06-26-crm-lookup-chance.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> 커밋/푸시/PR은 CLAUDE.md 규약상 사용자 지시 시. squash 머지 시 커밋 메시지에 skip-ci 토큰 금지.

---

## Self-review 메모

- **Spec 커버리지**: 데이터 재사용(Task1, 마이그0) / 시드(Task1) / 범용 검증(Task2) / 라우트(Task3) / priority 비범위(spec 문서화, 코드 변경 없음) / perf(조건부 1쿼리, Task2·3) — 전부 매핑됨.
- **타입 일관성**: `validateLookupValue(category, value, executor)` 시그니처가 Task2 정의·Task3 호출에서 일치. `validateStatusSelection`(파일럿)과 별개 유지.
- **종속 비검증**: "확정"↔계약완료는 워크플로우 규칙이라 lookup 검증 안 함(spec·라우트 주석 일치).
