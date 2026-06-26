# CRM 기술값 enum 강화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `customers.customer_type`·`quote_scenarios.purchase_method`의 백엔드 zod를 `z.string()`→`z.enum`으로 좁히고, purchaseMethod 옵션을 SSOT화한다.

**Architecture:** 기술 내부값은 lookup이 아니라 zod enum + TS union으로 타입 안전을 준다. 핵심 대부분은 이미 z.enum이고, 남은 둘만 좁힌다. purchase_method의 "비교 견적" 잔재 1건(QT-2606-0003) 정리가 선행. 마이그레이션 없음(zod만).

**Tech Stack:** Hono + zod-validator, bun:test(`test:server`), drizzle(데이터 정리만).

**Spec:** `ref/specs/2026-06-26-crm-tech-enum-design.md`

**Branch:** `feat/crm-tech-enum` (이미 생성, spec 커밋됨)

---

## 파일 구조

- `client/src/data/customers.ts` — `PURCHASE_METHOD_OPTIONS`·`PurchaseMethod` SSOT(수정).
- `client/src/pages/CustomerDetailPage.tsx` — `KimQuotePurchaseMethod`/옵션을 SSOT 별칭으로(수정).
- `src/routes/customers.ts` — `customerType`·`purchaseMethod` z.enum(수정).
- `src/routes/customers.test.ts` — 검증 라운드트립(수정).

---

## Task 1: QT-2606-0003 잔재 정리 (선행)

**Files:** 데이터만(코드 변경 없음).

- [ ] **Step 1: 잔재 견적 확인**

Run:
```bash
bun --env-file=.env.local -e "import { sql } from 'drizzle-orm'; import { getDefaultDb } from './src/db/client'; const r = await getDefaultDb().execute(sql\`select quote_code, app_status, trim_name from crm.quotes where quote_code='QT-2606-0003'\`); console.log(JSON.stringify(r)); process.exit(0);"
```
Expected: `QT-2606-0003`, `app_status=draft`, `trim_name=재고 비교`(잔재 확인).

- [ ] **Step 2: 견적 삭제(공유 master, 사용자 확인 후)**

> ⚠️ 공유 master DB. draft 잔재라 손실 무해하나 실행 전 사용자 확인.

Run:
```bash
bun --env-file=.env.local -e "import { eq } from 'drizzle-orm'; import { getDefaultDb } from './src/db/client'; import { quotes } from './src/db/schema'; await getDefaultDb().delete(quotes).where(eq(quotes.quoteCode, 'QT-2606-0003')); console.log('deleted'); process.exit(0);"
```
Expected: `deleted`. (scenario는 ON DELETE CASCADE.)

- [ ] **Step 3: purchase_method가 전부 6종 내인지 확인**

Run:
```bash
bun --env-file=.env.local -e "import { sql } from 'drizzle-orm'; import { getDefaultDb } from './src/db/client'; const r = await getDefaultDb().execute(sql\`select distinct purchase_method from crm.quote_scenarios where purchase_method is not null\`); console.log(JSON.stringify(r)); process.exit(0);"
```
Expected: 운용리스/중고리스만(전부 6종 내, "비교 견적" 사라짐).

(커밋 없음 — 데이터 정리.)

---

## Task 2: PURCHASE_METHOD_OPTIONS SSOT

**Files:**
- Modify: `client/src/data/customers.ts`, `client/src/pages/CustomerDetailPage.tsx:3,98,323`

- [ ] **Step 1: data에 SSOT 상수 추가**

`client/src/data/customers.ts`의 `SCHEDULE_TYPE_OPTIONS` 아래에 추가:

```ts
// 구매 방식(quote_scenarios.purchase_method) — 닫힌 6종. CustomerDetailPage·백엔드 zod 공유.
export const PURCHASE_METHOD_OPTIONS = ["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"] as const;
export type PurchaseMethod = (typeof PURCHASE_METHOD_OPTIONS)[number];
```

- [ ] **Step 2: CustomerDetailPage가 SSOT를 import·별칭화**

`client/src/pages/CustomerDetailPage.tsx`:
- 상단 `@/data/customers` import에 `PURCHASE_METHOD_OPTIONS`·`type PurchaseMethod` 추가.
- 98행 `type KimQuotePurchaseMethod = "장기렌트" | ... | "일시불";` → 별칭으로 교체:
  ```ts
  type KimQuotePurchaseMethod = PurchaseMethod;
  ```
- 323행 `const kimQuotePurchaseMethodOptions: KimQuotePurchaseMethod[] = ["장기렌트", ...];` → SSOT 참조:
  ```ts
  const kimQuotePurchaseMethodOptions = PURCHASE_METHOD_OPTIONS;
  ```
  (사용처 `normalizeKimQuotePurchaseMethod`·`useState<KimQuotePurchaseMethod>` 등은 `PurchaseMethod`=`KimQuotePurchaseMethod`라 변경 불필요.)

- [ ] **Step 3: typecheck (동작 불변)**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: 커밋**

```bash
git add client/src/data/customers.ts client/src/pages/CustomerDetailPage.tsx
git commit -m "$(cat <<'EOF'
refactor(crm): purchaseMethod PURCHASE_METHOD_OPTIONS SSOT화

구매방식 6종을 data/customers.ts로(KimQuotePurchaseMethod=별칭). 동작 불변.
백엔드 zod enum과 값 공유 토대.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: customerType + purchaseMethod z.enum + 서버 테스트

**Files:**
- Modify: `src/routes/customers.test.ts`(테스트 추가), `src/routes/customers.ts:25,81`

- [ ] **Step 1: 실패 테스트 추가**

`src/routes/customers.test.ts` 맨 끝에 추가:

```ts
test("customerType enum: 잘못된 값 → 400 / 유효 → 200(원복)", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; customerType: string | null }>;
  const target = list[0];
  expect((await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ customerType: "외계인" }) })).status).toBe(400);
  try {
    expect((await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ customerType: "개인" }) })).status).toBe(200);
  } finally {
    await app.request(`/api/customers/${target.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ customerType: target.customerType }) });
  }
});

test("purchaseMethod enum: 잘못된 값 견적 생성 → 400", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("admin");
  const app = createApp({ keyResolver, issuer });
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = (await (await app.request("/api/customers", { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string }>;
  const cid = list[0].id;
  const res = await app.request(`/api/customers/${cid}/quotes`, {
    method: "POST", headers: h,
    body: JSON.stringify({ entryMode: "manual", scenario: { purchaseMethod: "비교 견적" } }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: 두 테스트의 400 단언이 FAIL(현재 z.string이라 통과).

- [ ] **Step 3: customerType·purchaseMethod z.enum**

`src/routes/customers.ts`:
- `customerWriteSchema`(25행) `customerType`:
  ```ts
  customerType: z.enum(["개인", "개인사업자", "법인사업자"]).nullable().optional(),
  ```
- `quoteScenarioBody`(81행) `purchaseMethod`:
  ```ts
  purchaseMethod: z.enum(["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"]).nullable().optional(),
  ```

- [ ] **Step 4: 테스트 통과 + typecheck**

Run: `bun run typecheck && bun test src/routes/customers.test.ts --env-file=.env.local`
Expected: typecheck 0. 새 테스트 2개 PASS, 기존 테스트 전부 PASS(기존 견적 테스트의 purchaseMethod는 운용리스/장기렌트/할부 등 6종 내).

- [ ] **Step 5: 커밋**

```bash
git add src/routes/customers.ts src/routes/customers.test.ts
git commit -m "$(cat <<'EOF'
feat(crm): customerType·purchaseMethod z.enum 강화

customerWriteSchema.customerType(3종)·quoteScenarioBody.purchaseMethod(6종)을
z.string→z.enum. 잘못된 값 400. 서버 테스트 2.

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
bun run test:unit   # 기존 통과(KimQuotePurchaseMethod 별칭, 동작 불변)
bun run test:server # 기존 + enum 2 통과
bun run build       # OK
```

- [ ] **Step 2: 푸시 + PR(사용자 확인 후)**

```bash
git push -u origin feat/crm-tech-enum
gh pr create --title "feat(crm): customerType·purchaseMethod z.enum 강화 (🅲)" --body "$(cat <<'EOF'
## 요약
enum/lookup 🅲(기술 내부값) — 남은 z.string 기술값 2개를 z.enum로 좁힘. (핵심 entry/app/decision/tax는 이미 z.enum.)

- `customerType` → `z.enum(개인/개인사업자/법인사업자)` (DB 3종 일치).
- `purchaseMethod` → `z.enum(6종)`. `PURCHASE_METHOD_OPTIONS` SSOT화(기존 `KimQuotePurchaseMethod` union=별칭).
- **선행**: QT-2606-0003(김민준 draft 잔재, purchase_method "비교 견적") 삭제 — 코드 미생성 일회성값.
- 마이그레이션 0(zod만), `customerTypeDetail`은 2단계라 유지.

## 검증
typecheck 0 · lint 0 · test:server(+2) · test:unit · build OK.

스펙 `ref/specs/2026-06-26-crm-tech-enum-design.md` · 플랜 `ref/plans/2026-06-26-crm-tech-enum.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> 커밋/푸시/PR은 CLAUDE.md 규약상 사용자 지시 시. squash 머지 시 skip-ci 토큰 금지.

---

## Self-review 메모

- **Spec 커버리지**: 잔재 정리(Task1) / SSOT(Task2) / customerType·purchaseMethod z.enum(Task3) — 전부 매핑.
- **타입 일관성**: `PURCHASE_METHOD_OPTIONS`·`PurchaseMethod`(Task2 정의)가 별칭 `KimQuotePurchaseMethod`·zod 목록(Task3)과 값 일치. zod는 서버라 직접 기재(client import 안 함)하되 값 동일.
- **순서 의존**: Task1 잔재 삭제 → Task3 purchaseMethod z.enum(삭제 후 DB 전부 6종 내라야 기존 견적 PATCH 안 깨짐).
- **데이터 안전**: customer_type 3종 정확 일치, purchase_method는 잔재 삭제 후 6종 내. 기존 견적 테스트의 purchaseMethod(운용리스/장기렌트/할부)도 6종 내.
