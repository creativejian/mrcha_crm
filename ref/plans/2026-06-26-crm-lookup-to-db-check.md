# CRM lookup_values → DB CHECK 전면 전환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lookup_values` 테이블·쿼리·시드를 폐기하고, 어휘를 `client/src/data` 코드 SSOT 단일로 두며, 검증을 앱(zod + 순수함수) + DB CHECK(14컬럼) 2층으로 재구성한다.

**Architecture:** crm은 CRM 백엔드만 쓰므로(외부 직접쓰기 없음) 종속(그룹-상태)은 앱이 검증하고 DB CHECK는 각 컬럼 값의 사전 소속만 단일컬럼으로 봉인한다. 검증 함수는 DB 쿼리 → 코드 상수 in-memory 순수함수로(왕복 0). status 종속은 `customerStatusGroups` 코드맵의 `Map<status, Set<group>>`로 다부모 정밀 표현(lookup이 못 한 것).

**Tech Stack:** drizzle-orm 0.45.2 `check()` 헬퍼 + `sql.join`, Hono + zod, bun:test(`test:server`)/vitest(`test:unit`), drizzle-kit 0.31.10 `db:generate`/`db:migrate`(`schemaFilter:["crm"]`).

**Spec:** `ref/specs/2026-06-26-crm-lookup-to-db-check-design.md`

**Branch:** `feat/crm-lookup-to-db-check` (이미 생성, spec 커밋됨 `1e2068a`)

---

## 파일 구조

- `scripts/seed-customers.ts` — line 166 "비교 견적" 정식값으로(재발원 차단, 수정).
- `src/lib/status-lookup.ts` — `buildStatusMaps` 추가 + `checkStatusSelection` 다부모(`Map<string,Set<string>>`)(수정).
- `src/lib/status-lookup.test.ts` — 다부모 케이스로 갱신(수정).
- `src/lib/lookup-validate.ts` — 코드 상수 순수 검증(`validateLookupValue`/`validateStatusSelection`)(신규).
- `src/lib/lookup-validate.test.ts` — 단위테스트(신규).
- `src/db/queries/lookups.ts` — 삭제.
- `src/routes/customers.ts` — import 교체 + 8개 검증 호출 동기화(수정).
- `client/src/data/customers.ts` — `CUSTOMER_TYPE_OPTIONS` 추가(수정).
- `src/db/schema.ts` — `lookupValues` 제거 + 14컬럼 `check()` 추가(수정).
- `drizzle/0007_*.sql`(+`meta/`) — DROP lookup_values + 14 CHECK(생성).
- `scripts/seed-lookups.ts` 삭제 · `package.json` `seed:lookups` 제거.

---

## Task 0: 데이터/시드 재발원 정리 (선행)

**Files:** `scripts/seed-customers.ts`(수정), 데이터(삭제).

- [ ] **Step 1: 시드 재발원 수정**

`scripts/seed-customers.ts:166` 의
```ts
scenario: { purchaseMethod: "비교 견적", lender: null as string | null, termMonths: null as number | null, monthlyPayment: null as string | null },
```
에서 `"비교 견적"` → `"운용리스"`(정식 6종 내). 재시드 시 garbage 부활 차단.

- [ ] **Step 2: garbage 4건 삭제 (공유 master, 사용자 확인 후)**

> ⚠️ 공유 master DB. 전부 test/시드 잔재라 손실 무해하나 실행 전 사용자 확인.

```bash
bun --env-file=.env.local -e "
import { sql } from 'drizzle-orm';
import { getDefaultDb } from './src/db/client';
const db = getDefaultDb();
await db.execute(sql\`DELETE FROM crm.customer_tasks WHERE category='없는분류'\`);
await db.execute(sql\`DELETE FROM crm.customer_schedules WHERE type='없는종류'\`);
await db.execute(sql\`DELETE FROM crm.customer_documents WHERE doc_type='존재하지않는종류'\`);
await db.execute(sql\`DELETE FROM crm.quotes WHERE quote_code='QT-2606-0007'\`); -- scenario ON DELETE CASCADE
console.log('deleted garbage');
process.exit(0);
"
```

- [ ] **Step 3: 14컬럼 전부 사전 내인지 재확인**

```bash
bun --env-file=.env.local -e "
import { sql } from 'drizzle-orm';
import { getDefaultDb } from './src/db/client';
const db = getDefaultDb();
const r = await db.execute(sql\`
SELECT 'task' k, json_agg(DISTINCT category) v FROM crm.customer_tasks
UNION ALL SELECT 'sched', json_agg(DISTINCT type) FROM crm.customer_schedules
UNION ALL SELECT 'doc', json_agg(DISTINCT doc_type) FROM crm.customer_documents
UNION ALL SELECT 'pm', json_agg(DISTINCT purchase_method) FROM crm.quote_scenarios\`);
console.log(JSON.stringify(r));
process.exit(0);
"
```
Expected: garbage 4종 사라짐(task=견적/안내/체크, sched=견적, doc=기타서류/사업자등록증, pm=운용리스/중고리스).

(커밋은 Task 1 코드와 함께 — Step 1 시드 수정만 Task 1 커밋에 포함.)

---

## Task 1: 코드 검증 재설계 (TDD)

**Files:** `src/lib/status-lookup.ts`·`.test.ts`(수정), `src/lib/lookup-validate.ts`·`.test.ts`(신규), `src/routes/customers.ts`(수정), `src/db/queries/lookups.ts`(삭제).

- [ ] **Step 1: status-lookup 다부모 테스트 작성(실패)**

`src/lib/status-lookup.test.ts` 전체를 교체:
```ts
import { describe, expect, test } from "vitest";

import { buildStatusMaps, checkStatusSelection } from "./status-lookup";

const groups = {
  신규: ["상담접수", "지속적부재"],
  관리중: ["추후재컨택"],
  상담완료: ["추후재컨택"],
  계약완료: ["출고완료"],
};
const { activeGroups, statusParents } = buildStatusMaps(groups);

describe("checkStatusSelection", () => {
  test("빈 선택 통과", () => expect(checkStatusSelection(activeGroups, statusParents, {})).toBeNull());
  test("유효 종속 통과", () => expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "계약완료", status: "출고완료" })).toBeNull());
  test("group 단독 통과", () => expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "신규" })).toBeNull());
  test("status 단독 통과", () => expect(checkStatusSelection(activeGroups, statusParents, { status: "출고완료" })).toBeNull());
  test("잘못된 group", () => expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "없음", status: "출고완료" })).toContain("1차"));
  test("잘못된 status", () => expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "계약완료", status: "없음" })).toContain("2차"));
  test("종속 위반", () => expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "신규", status: "출고완료" })).toContain("속하지 않"));
  test("null 둘 다 통과", () => expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: null, status: null })).toBeNull());
  // 다부모: 추후재컨택은 관리중·상담완료 둘 다 허용
  test("다부모 - 관리중 허용", () => expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "관리중", status: "추후재컨택" })).toBeNull());
  test("다부모 - 상담완료 허용", () => expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "상담완료", status: "추후재컨택" })).toBeNull());
  test("다부모 - 신규엔 불속", () => expect(checkStatusSelection(activeGroups, statusParents, { statusGroup: "신규", status: "추후재컨택" })).toContain("속하지 않"));
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit src/lib/status-lookup.test.ts`
Expected: `buildStatusMaps` 미존재 / 시그니처 불일치로 FAIL.

- [ ] **Step 3: status-lookup.ts 구현**

`src/lib/status-lookup.ts` 전체 교체:
```ts
export type StatusSelection = { statusGroup?: string | null; status?: string | null };

// customerStatusGroups(코드 SSOT) → 검증용 맵. status는 여러 group에 속할 수 있어 Set<group>.
export function buildStatusMaps(groups: Record<string, string[]>): {
  activeGroups: ReadonlySet<string>;
  statusParents: ReadonlyMap<string, ReadonlySet<string>>;
} {
  const activeGroups = new Set(Object.keys(groups));
  const statusParents = new Map<string, Set<string>>();
  for (const [group, statuses] of Object.entries(groups)) {
    for (const s of statuses) {
      const set = statusParents.get(s) ?? new Set<string>();
      set.add(group);
      statusParents.set(s, set);
    }
  }
  return { activeGroups, statusParents };
}

// 진행상태 1차(group)/2차(status) 종속 검증(순수, DB 미접근).
// 단독 전송은 그 값의 유효성만, 둘 다 오면 status의 부모 집합에 group이 포함되는지(다부모 종속).
export function checkStatusSelection(
  activeGroups: ReadonlySet<string>,
  statusParents: ReadonlyMap<string, ReadonlySet<string>>,
  sel: StatusSelection,
): string | null {
  const group = sel.statusGroup;
  const status = sel.status;
  if (group != null && !activeGroups.has(group)) {
    return `유효하지 않은 진행 1차 상태입니다: ${group}`;
  }
  if (status != null) {
    const parents = statusParents.get(status);
    if (parents === undefined) return `유효하지 않은 진행 2차 상태입니다: ${status}`;
    if (group != null && !parents.has(group)) {
      return `진행 2차 상태 "${status}"는 1차 "${group}"에 속하지 않습니다.`;
    }
  }
  return null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit src/lib/status-lookup.test.ts`
Expected: 전부 PASS.

- [ ] **Step 5: lookup-validate 테스트 작성(실패)**

`src/lib/lookup-validate.test.ts`(신규):
```ts
import { describe, expect, test } from "vitest";

import { validateLookupValue, validateStatusSelection } from "./lookup-validate";

describe("validateLookupValue", () => {
  test("null 통과", () => expect(validateLookupValue("chance", null)).toBeNull());
  test("유효 chance 통과", () => expect(validateLookupValue("chance", "높음")).toBeNull());
  test("무효 chance 거부", () => expect(validateLookupValue("chance", "외계인")).toContain("chance"));
  test("유효 task_category 통과", () => expect(validateLookupValue("task_category", "견적")).toBeNull());
  test("무효 task_category 거부", () => expect(validateLookupValue("task_category", "없는분류")).toContain("task_category"));
  test("알 수 없는 category 통과(방어)", () => expect(validateLookupValue("unknown", "x")).toBeNull());
});

describe("validateStatusSelection", () => {
  test("유효 종속 통과", () => expect(validateStatusSelection({ statusGroup: "계약완료", status: "출고완료" })).toBeNull());
  test("종속 위반 거부", () => expect(validateStatusSelection({ statusGroup: "신규", status: "출고완료" })).toContain("속하지 않"));
  test("다부모 통과(추후재컨택=관리중)", () => expect(validateStatusSelection({ statusGroup: "관리중", status: "추후재컨택" })).toBeNull());
});
```

- [ ] **Step 6: 실패 확인**

Run: `bun run test:unit src/lib/lookup-validate.test.ts`
Expected: 모듈 미존재로 FAIL.

- [ ] **Step 7: lookup-validate.ts 구현**

`src/lib/lookup-validate.ts`(신규):
```ts
import {
  CHANCE_OPTIONS,
  SOURCE_OPTIONS,
  DOC_TYPE_OPTIONS,
  TASK_CATEGORY_OPTIONS,
  SCHEDULE_TYPE_OPTIONS,
  customerStatusGroups,
} from "../../client/src/data/customers";
import { buildStatusMaps, checkStatusSelection, type StatusSelection } from "./status-lookup";

// 종속 없는 닫힌 도메인 — 코드 상수 SSOT의 in-memory Set.
const LOOKUP_SETS: Record<string, ReadonlySet<string>> = {
  chance: new Set(CHANCE_OPTIONS),
  source: new Set(SOURCE_OPTIONS),
  doc_type: new Set(DOC_TYPE_OPTIONS),
  task_category: new Set(TASK_CATEGORY_OPTIONS),
  schedule_type: new Set(SCHEDULE_TYPE_OPTIONS),
};

// value null → 통과. 알 수 없는 category → 통과(방어). 사전 밖 → 400 메시지.
export function validateLookupValue(category: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  const set = LOOKUP_SETS[category];
  if (!set) return null;
  return set.has(value) ? null : `유효하지 않은 ${category} 값입니다: ${value}`;
}

const statusMaps = buildStatusMaps(customerStatusGroups);
export function validateStatusSelection(sel: StatusSelection): string | null {
  return checkStatusSelection(statusMaps.activeGroups, statusMaps.statusParents, sel);
}
```

- [ ] **Step 8: 통과 확인**

Run: `bun run test:unit src/lib/lookup-validate.test.ts`
Expected: 전부 PASS.

- [ ] **Step 9: routes 검증 호출 동기화 + lookups.ts 삭제**

`src/routes/customers.ts`:
- line 13 import 교체:
  ```ts
  import { validateLookupValue, validateStatusSelection } from "../lib/lookup-validate";
  ```
- 8개 호출에서 `await` 제거 + `c.var.db` 인자 제거:
  - line 52: `const error = validateStatusSelection(sel);` (sel 객체 인자 그대로, db 제거)
  - line 60: `validateLookupValue("chance", patch.chance)`
  - line 65: `validateLookupValue("source", patch.source)`
  - line 186/195: `validateLookupValue("task_category", body.category)`
  - line 208/217: `validateLookupValue("schedule_type", body.type)`
  - line 302: `validateLookupValue("doc_type", docType)`
  - line 345: `validateLookupValue("doc_type", body.docType)`
  (`await ... , c.var.db)` → `...)`. 핸들러의 `if (error) return c.json({...}, 400)` 로직은 동일.)

그 후:
```bash
rm src/db/queries/lookups.ts
```

- [ ] **Step 10: typecheck + 서버 테스트**

Run: `bun run typecheck && bun run test:server`
Expected: typecheck 0. 기존 검증 라운드트립(없는분류/없는종류/존재하지않는종류 POST→400, 비교 견적 견적 POST→400)이 코드 validate로도 동일 400. 전부 PASS. (`listLookup`은 미사용이라 삭제 영향 없음 — Step 9 후 import 잔재 없음 확인.)

- [ ] **Step 11: 커밋**

```bash
git add scripts/seed-customers.ts src/lib/status-lookup.ts src/lib/status-lookup.test.ts src/lib/lookup-validate.ts src/lib/lookup-validate.test.ts src/routes/customers.ts
git rm src/db/queries/lookups.ts
git commit -m "$(cat <<'EOF'
refactor(crm): lookup 검증을 DB쿼리→코드 순수함수로 + 다부모 종속

validateLookupValue/validateStatusSelection을 client/src/data 코드 상수
in-memory로(DB 왕복 0). status 종속을 Map<status,Set<group>>로 다부모
정밀화(추후재컨택=관리중·상담완료·불발 정확 허용). queries/lookups.ts 삭제.
seed-customers의 "비교 견적" 재발원도 정식값으로 수정.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: schema CHECK 14컬럼 + lookupValues 제거 + 마이그레이션

**Files:** `client/src/data/customers.ts`(수정), `src/db/schema.ts`(수정), `drizzle/0007_*`(생성).

- [ ] **Step 1: CUSTOMER_TYPE_OPTIONS 상수 추가**

`client/src/data/customers.ts`의 `PURCHASE_METHOD_OPTIONS` 위에 추가:
```ts
// 고객 유형(customers.customer_type) — 닫힌 3종. 백엔드 zod·DB CHECK 공유.
export const CUSTOMER_TYPE_OPTIONS = ["개인", "개인사업자", "법인사업자"] as const;
```

- [ ] **Step 2: schema.ts — import·상수·check helper·14 check·lookupValues 제거**

`src/db/schema.ts`:
- import에 `check` 추가: `import { pgSchema, uuid, text, ..., uniqueIndex, check } from "drizzle-orm/pg-core";` + `import { sql } from "drizzle-orm";` + `import { AnyPgColumn } from "drizzle-orm/pg-core";`
- 코드 상수 import(파일 상단, `crm` 선언 위):
  ```ts
  import {
    CHANCE_OPTIONS, SOURCE_OPTIONS, DOC_TYPE_OPTIONS, TASK_CATEGORY_OPTIONS,
    SCHEDULE_TYPE_OPTIONS, PURCHASE_METHOD_OPTIONS, CUSTOMER_TYPE_OPTIONS, customerStatusGroups,
  } from "../../client/src/data/customers";

  const STATUS_GROUP_OPTIONS = Object.keys(customerStatusGroups);
  const STATUS_OPTIONS = [...new Set(Object.values(customerStatusGroups).flat())];
  const ENTRY_MODES = ["manual", "solution", "original"];
  const APP_STATUSES = ["draft", "queued", "sent", "viewed"];
  const DECISION_STATUSES = ["none", "considering", "confirmed", "contracting"];
  const ACQ_TAX_MODES = ["normal", "hybrid", "electric", "manual"];
  const QUOTE_DISPLAY_STATUSES = ["고객 확인 전", "고객 열람"];

  // nullable 컬럼 대상 IN CHECK(기존 null 보존). 값은 코드 상수 SSOT에서 sql.join.
  function inListCheck(col: AnyPgColumn, values: readonly string[]) {
    return sql`${col} IS NULL OR ${col} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
  }
  ```
- `customers`에 3번째 인자 추가:
  ```ts
  }, (t) => [
    check("customers_status_group_check", inListCheck(t.statusGroup, STATUS_GROUP_OPTIONS)),
    check("customers_status_check", inListCheck(t.status, STATUS_OPTIONS)),
    check("customers_chance_check", inListCheck(t.chance, CHANCE_OPTIONS)),
    check("customers_source_check", inListCheck(t.source, SOURCE_OPTIONS)),
    check("customers_customer_type_check", inListCheck(t.customerType, CUSTOMER_TYPE_OPTIONS)),
  ]);
  ```
- `customerTasks`: `}, (t) => [check("customer_tasks_category_check", inListCheck(t.category, TASK_CATEGORY_OPTIONS))]);`
- `customerSchedules`: `}, (t) => [check("customer_schedules_type_check", inListCheck(t.type, SCHEDULE_TYPE_OPTIONS))]);`
- `customerDocuments`: `}, (t) => [check("customer_documents_doc_type_check", inListCheck(t.docType, DOC_TYPE_OPTIONS))]);`
- `quotes`: 3번째 인자에 5개:
  ```ts
  }, (t) => [
    check("quotes_entry_mode_check", inListCheck(t.entryMode, ENTRY_MODES)),
    check("quotes_app_status_check", inListCheck(t.appStatus, APP_STATUSES)),
    check("quotes_decision_status_check", inListCheck(t.decisionStatus, DECISION_STATUSES)),
    check("quotes_acquisition_tax_mode_check", inListCheck(t.acquisitionTaxMode, ACQ_TAX_MODES)),
    check("quotes_status_check", inListCheck(t.status, QUOTE_DISPLAY_STATUSES)),
  ]);
  ```
- `quoteScenarios`: `}, (t) => [check("quote_scenarios_purchase_method_check", inListCheck(t.purchaseMethod, PURCHASE_METHOD_OPTIONS))]);`
- `lookupValues` 정의(202~219행) + 그 주석 블록 제거.

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 0. (`AnyPgColumn` import·`check`/`sql` 사용 정합.)

- [ ] **Step 4: 마이그레이션 생성 + 산출물 검증**

Run: `bun run db:generate`
검증: `drizzle/0007_*.sql`을 열어 ① `DROP TABLE ... crm.lookup_values` ② 14개 `ADD CONSTRAINT ... CHECK (... IS NULL OR ... IN (...))` 확인. 값이 코드 상수와 일치하는지 육안 확인.

> ⚠️ 폴백: `db:generate`가 `check()`를 빠뜨리거나 형식이 깨지면, `0007_*.sql`을 손으로 보정(schema의 check 정의는 유지해 drift 최소화) 후 `meta/_journal.json` 정합 확인.

- [ ] **Step 5: 마이그레이션 적용 (공유 master, 사용자 확인 후)**

> ⚠️ 공유 master DB 스키마 변경(lookup DROP + 14 CHECK). Task 0 garbage 삭제가 선행돼야 ALTER 성공. 실행 전 사용자 확인.

Run: `bun run db:migrate`
Expected: 0007 적용 성공.

- [ ] **Step 6: CHECK 실측(방어 확인)**

```bash
bun --env-file=.env.local -e "
import { sql } from 'drizzle-orm';
import { getDefaultDb } from './src/db/client';
const db = getDefaultDb();
const checks = await db.execute(sql\`SELECT conname FROM pg_constraint WHERE connamespace=(SELECT oid FROM pg_namespace WHERE nspname='crm') AND contype='c' ORDER BY conname\`);
console.log('CHECKS', JSON.stringify(checks));
let rejected = false;
try { await db.execute(sql\`UPDATE crm.customers SET chance='외계인' WHERE false\`); } catch { rejected = true; }
// false라 행 0건이라 통과 — 대신 실제 한 행에 시도:
const one = await db.execute(sql\`SELECT id FROM crm.customers LIMIT 1\`);
try { await db.execute(sql\`UPDATE crm.customers SET chance='외계인' WHERE id=\${one[0].id}\`); console.log('REJECT? no'); } catch (e) { console.log('REJECTED ok'); }
await db.execute(sql\`UPDATE crm.customers SET chance=chance WHERE id=\${one[0].id}\`);
process.exit(0);
"
```
Expected: 14 CHECK 존재 + 사전 밖 UPDATE는 `REJECTED ok`.

- [ ] **Step 7: 커밋**

```bash
git add client/src/data/customers.ts src/db/schema.ts drizzle/
git commit -m "$(cat <<'EOF'
feat(crm): 어휘/기술값 14컬럼 DB CHECK + lookup_values 폐기

어휘 9(status_group·status·chance·source·customer_type·task.category·
schedule.type·doc_type·purchase_method) + 기술값 5(quotes entry/app/
decision/tax/status) 단일컬럼 CHECK(nullable 보존). 값=코드 상수 SSOT
sql.join. lookup_values 테이블 DROP(0007). 종속은 앱 검증.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 시드/스크립트 정리

**Files:** `scripts/seed-lookups.ts`(삭제), `package.json`(수정).

- [ ] **Step 1: 시드 삭제 + 스크립트 제거**

```bash
git rm scripts/seed-lookups.ts
```
`package.json` line 28 `"seed:lookups": "..."` 제거(앞 줄 `seed:customers` 끝 콤마 정리).

- [ ] **Step 2: typecheck + 커밋**

Run: `bun run typecheck`
Expected: 0(seed-lookups 참조 없음 확인).

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore(crm): seed-lookups·seed:lookups 제거 (lookup_values 폐기 후속)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 최종 검증 + PR

- [ ] **Step 1: 검증 4종 + 빌드**

```bash
bun run typecheck   # 0
bun run lint        # 0
bun run test:unit   # status-lookup·lookup-validate 포함 통과
bun run test:server # 기존 검증 라운드트립 통과(코드 validate)
bun run build       # OK
```

- [ ] **Step 2: 푸시 + PR(사용자 확인 후)**

```bash
git push -u origin feat/crm-lookup-to-db-check
gh pr create --title "feat(crm): lookup_values→DB CHECK 전면 전환" --body "$(cat <<'EOF'
## 요약
관리 UI 미제작 확정 → lookup 동적 이점 사장. 어휘는 이미 코드 SSOT, lookup 93행은 DB 그림자인데 정작 DB 방어는 0(crm enum/CHECK 0). C 전면 전환.

- **lookup_values·queries·시드 폐기** → 어휘=`client/src/data` 코드 SSOT 단일.
- **검증 2층**: 앱(zod + 코드 순수함수, DB 왕복 0) + **DB CHECK 14컬럼**(어휘 9 + 기술값 5, nullable 보존).
- **종속은 앱**(crm=CRM 백엔드 전용). `Map<status,Set<group>>` **다부모 정밀화**(추후재컨택=관리중·상담완료·불발 정확) — 기존 lookup 복합키 과제 해소.
- **데이터 정리**: garbage 4건(test/시드 잔재) 삭제 + seed-customers "비교 견적" 재발원 수정.
- `priority`·`customer_type_detail`·`consultations.status` 보류.

## 마이그레이션
`0007`: DROP `lookup_values` + 14 CHECK(crm only). 공유 master 적용 완료.

## 검증
typecheck 0 · lint 0 · test:unit · test:server · build OK. CHECK 실측(사전 밖 UPDATE 거부).

스펙 `ref/specs/2026-06-26-crm-lookup-to-db-check-design.md` · 플랜 `ref/plans/2026-06-26-crm-lookup-to-db-check.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> 커밋/푸시/PR은 CLAUDE.md 규약상 사용자 지시 시. squash 머지 시 skip-ci 토큰 금지.

- [ ] **Step 3: brief/AGENTS 반영(머지 후)**

`ref/active-session-brief.md`의 "⚠️ 유슨생 아키텍처 지적(검토 대기)"을 "lookup→DB CHECK 전환 완료"로 갱신. lookup_values 관련 서술(파일럿~open-set) 옆에 폐기 표시.

---

## Self-review 메모

- **Spec 커버리지**: ① 범위 14(Task2) ② 데이터 정리(Task0) ③ 마이그(Task2) ④ 검증 재설계(Task1) ⑤ 시드/schema 정리(Task2·3) — 전부 매핑.
- **정정(spec 대비)**: garbage 재발원은 test가 아니라 `seed-customers.ts:166`(재시드 부활). 현재 검증 테스트는 앱 검증이 400을 내 CHECK 후에도 그대로 통과(테스트 수정 불필요). → spec의 "test:server 잔재 차단"은 정확히는 "seed 재발원 수정 + 과거 잔재 1회 삭제". (spec 본문도 이 표현으로 미세 정정 권장.)
- **순서 의존**: Task0(garbage 삭제) → Task2 Step5(마이그 ALTER) 필수 선행. Task1(코드)은 lookup DROP과 독립이나 한 PR로 일관 적용.
- **타입 일관성**: `buildStatusMaps` 반환 타입 = `checkStatusSelection` 2번째 인자 = `validateStatusSelection` 내부 사용, 전부 `ReadonlyMap<string, ReadonlySet<string>>`로 일치.
- **리스크**: drizzle `check()` 마이그 생성 불확실 → Task2 Step4 산출물 검증 + 수동 폴백. 공유 master 변경 2회(garbage 삭제·마이그)는 사용자 확인 게이트.
```
