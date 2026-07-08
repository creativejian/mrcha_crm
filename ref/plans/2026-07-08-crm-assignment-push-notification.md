# 배정 알림 FCM 푸시 구현 계획 (슬라이스 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CRM에서 상담사에게 업무를 배정할 때 그 상담사에게 앱 FCM 푸시 알림을 보낸다(딥링크 없는 알림). 이 계획은 **CRM 몫(고객 담당자 배정)**을 구현하고, **앱 몫(실시간 상담 배정 트리거)**은 계약으로 인계한다.

**Architecture:** 앱이 이미 구축한 `send-push` Edge Function(device_tokens 조회→FCM v1 발송→만료 토큰 정리)을 재사용한다. CRM은 FCM을 직접 발송하지 않고 `{user_id, title, body}`만 send-push에 POST한다. 고객 담당자 배정은 CRM 백엔드 PATCH 경유라 `holdWork`(응답 비차단)로 발송한다. 실시간 상담 배정은 프론트 supabase-js 직결이라 앱 `chat_sessions` 트리거가 담당(앱 몫).

**Tech Stack:** TypeScript, Hono, Bun, drizzle. spec: `ref/specs/2026-07-08-crm-assignment-push-notification-design.md`.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/lib/push-notify.ts` | send-push Edge Function 호출 헬퍼(`sendAssignmentPush`) + 테스트 주입점(`pushNotifyDeps.fetchImpl`) | **Create** |
| `src/db/queries/customers.ts` | `getCustomerAdvisorName`을 `{advisorName, name}` 반환으로 확장(알림 body용 고객명) | **Modify** (77-83) |
| `src/routes/customers.ts` | Hono 타입에 `AuthVariables` 추가, 배정 분기에서 알림 대상 계산, `run` 콜백에서 `holdWork` 발송 | **Modify** (21, 102-133) |
| `src/lib/push-notify.test.ts` | `sendAssignmentPush` 단위 테스트(fetchImpl mock) | **Create** |
| `src/routes/customers.push.test.ts` | 배정 훅 통합 테스트(실 DB 고객 픽스처 + fetchImpl mock) | **Create** |

**앱 몫(별도, 유슨생 앱 폴더)**: `chat_sessions` 트리거 — 이 계획 맨 끝 "부록 A: 앱 계약"에 완성 SQL. CRM 코드 아님.

**참고 사실(조사 완료):**
- `AuthedUser = { id: string; role: string }` — 배정 실행자 user_id = `c.var.user.id`(JWT sub).
- customers 라우트에 auth 미들웨어가 붙어 있어(`app.ts:33`) `c.var.user`는 런타임에 존재. 단 `customers` Hono 타입이 `DbVariables`만이라 `AuthVariables & DbVariables`로 넓혀야 타입 접근 가능.
- `updateCustomer`는 `{id}`만 반환 → 고객명은 배정 분기에서 이미 호출하는 `getCustomerAdvisorName`을 확장해 조달(추가 쿼리 없음). 호출부는 `customers.ts:106` 단 1곳.
- `holdWork(c, work)` (`src/middleware/db.ts:46`): 응답 비차단 백그라운드 등록, 실패 흡수. `scheduleEmbedOnWrite`가 쓰는 정본 패턴.
- 시크릿/URL은 `env?.X ?? process.env.X` 관례(`storage.ts:9`). `SUPABASE_URL`은 이미 이 방식으로 읽음.
- 테스트: `makeTestAuth(role, sub)`(sub 지정 가능) + `createApp({keyResolver, issuer})` + `app.request()`. deps mock = 필드 교체 + afterEach 복원(`customers.embed.test.ts` 패턴). 실 master DB 픽스처는 랜덤 서픽스 + cleanup.
- `customers` insert 필수: `customerCode`(NOT NULL·unique), `name`(NOT NULL). 나머지 nullable/default.

---

## Task 1: send-push 호출 헬퍼

**Files:**
- Create: `src/lib/push-notify.ts`
- Test: `src/lib/push-notify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/push-notify.test.ts`:

```ts
import { test, expect, afterEach } from "bun:test";

import { pushNotifyDeps, sendAssignmentPush } from "./push-notify";

const ORIGINAL_FETCH = pushNotifyDeps.fetchImpl;
afterEach(() => { pushNotifyDeps.fetchImpl = ORIGINAL_FETCH; });

test("sendAssignmentPush: send-push URL로 {user_id,title,body} POST", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  pushNotifyDeps.fetchImpl = (async (url: string | URL, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    return new Response(JSON.stringify({ message: "no tokens", sent: 0 }), { status: 200 });
  }) as typeof fetch;

  await sendAssignmentPush(
    { env: { SUPABASE_URL: "https://proj.test" } },
    { userId: "U-1", title: "담당 고객으로 배정되었습니다", body: "홍길동" },
  );

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://proj.test/functions/v1/send-push");
  expect(calls[0].body).toEqual({ user_id: "U-1", title: "담당 고객으로 배정되었습니다", body: "홍길동" });
});

test("sendAssignmentPush: fetch 예외를 흡수(throw 안 함)", async () => {
  pushNotifyDeps.fetchImpl = (async () => { throw new Error("network down"); }) as typeof fetch;
  // 예외를 삼켜야 저장 응답이 안 깨진다 — reject 안 하면 통과.
  await sendAssignmentPush({ env: { SUPABASE_URL: "https://proj.test" } }, { userId: "U-1", title: "t", body: "b" });
  expect(true).toBe(true);
});

test("sendAssignmentPush: SUPABASE_URL 부재 시 호출 없이 skip", async () => {
  let called = false;
  pushNotifyDeps.fetchImpl = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  await sendAssignmentPush({ env: {} }, { userId: "U-1", title: "t", body: "b" });
  expect(called).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:server src/lib/push-notify.test.ts`
Expected: FAIL — `Cannot find module './push-notify'` (또는 export 없음).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/push-notify.ts`:

```ts
// 앱이 배포한 send-push Edge Function 호출 — device_tokens 조회·FCM v1 발송·만료 토큰 정리는
// send-push가 담당한다(스펙 §5.3). CRM은 {user_id,title,body}만 전달(딥링크 없는 알림).
// best-effort: 어떤 경우에도 throw 하지 않는다(호출부의 저장 응답을 깨지 않기 위해). 실패는 로그만.

// 테스트 주입점(embedOnWriteDeps 패턴 — mock.module 대신 전역 누출 없는 필드 교체).
export const pushNotifyDeps = { fetchImpl: fetch };

export async function sendAssignmentPush(
  c: { env: unknown },
  msg: { userId: string; title: string; body: string },
): Promise<void> {
  try {
    const env = (c.env ?? {}) as { SUPABASE_URL?: string };
    const base = env.SUPABASE_URL ?? process.env.SUPABASE_URL;
    if (!base) {
      console.error("[push] SUPABASE_URL 미설정 — 배정 알림 skip");
      return;
    }
    const res = await pushNotifyDeps.fetchImpl(`${base}/functions/v1/send-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: msg.userId, title: msg.title, body: msg.body }),
    });
    if (!res.ok) {
      console.error(`[push] 배정 알림 발송 실패 user=${msg.userId} status=${res.status}`);
      return;
    }
    console.log(`[push] 배정 알림 → user=${msg.userId} "${msg.title}"`);
  } catch (e) {
    console.error(`[push] 배정 알림 예외 user=${msg.userId}:`, e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:server src/lib/push-notify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/push-notify.ts src/lib/push-notify.test.ts
git commit -m "feat(crm): send-push 호출 헬퍼 sendAssignmentPush(배정 알림)"
```

---

## Task 2: getCustomerAdvisorName에 고객명 추가

**Files:**
- Modify: `src/db/queries/customers.ts:76-83`

배정 알림 body(고객명)를 추가 쿼리 없이 조달하기 위해, 배정 분기에서 이미 호출하는 `getCustomerAdvisorName`이 `name`도 반환하게 확장한다. 호출부는 `customers.ts:106` 1곳뿐이라 안전.

- [ ] **Step 1: Modify the function**

`src/db/queries/customers.ts`의 `getCustomerAdvisorName`(현재 76-83행)을 아래로 교체:

```ts
// 현재 담당자 이름 + 고객명 조회(배정 PATCH의 assigned_at 스탬프 판정 + 배정 알림 body용). 없는 고객은 null.
export async function getCustomerAdvisorName(
  id: string,
  executor: Executor = getDefaultDb(),
): Promise<{ advisorName: string | null; name: string } | null> {
  const [row] = await executor
    .select({ advisorName: customers.advisorName, name: customers.name })
    .from(customers)
    .where(eq(customers.id, id));
  return row ?? null;
}
```

- [ ] **Step 2: Typecheck (호출부 정합 확인)**

Run: `bun run typecheck`
Expected: PASS. (호출부 `customers.ts:106`은 `current.advisorName`만 읽으므로 `name` 추가에 영향 없음. `name`은 Task 3에서 사용.)

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/customers.ts
git commit -m "feat(crm): getCustomerAdvisorName에 고객명(name) 추가 — 배정 알림 body용"
```

---

## Task 3: 고객 담당자 배정 훅 (customers.ts)

**Files:**
- Modify: `src/routes/customers.ts` (import 추가 21행, 배정 분기 101-114, run 콜백 115-131)
- Test: `src/routes/customers.push.test.ts` (Create)

발송 조건(스펙 §5.2, **알림에만** 적용 — 저장 로직 불변):
1. `advisorName`이 실제 변경됨(`current.advisorName !== patch.advisorName`) — 담당자 정체성 변경 신호.
2. `patch.advisorId`가 NOT NULL — 발송 대상 user_id 확보(advisorName만 오고 id 없으면 대상 불명 → skip).
3. `patch.advisorId !== c.var.user.id` — 배정 실행자 본인 = 대상이면 알림만 skip(저장은 정상).

- [ ] **Step 1: Write the failing test**

Create `src/routes/customers.push.test.ts`:

```ts
import { test, expect, afterEach } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customers } from "../db/schema";
import { pushNotifyDeps } from "../lib/push-notify";

const ORIGINAL_FETCH = pushNotifyDeps.fetchImpl;
const createdCustomerIds: string[] = [];

afterEach(async () => {
  pushNotifyDeps.fetchImpl = ORIGINAL_FETCH;
  const db = getDefaultDb();
  for (const id of createdCustomerIds.splice(0)) {
    await db.delete(customers).where(eq(customers.id, id));
  }
});

// send-push 호출 가로채 payload 기록. holdWork(비차단)라 응답 후 settle을 기다리기 위해
// resolve를 노출한다.
function mockPush() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let resolveNext: (() => void) | null = null;
  pushNotifyDeps.fetchImpl = (async (url: string | URL, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    resolveNext?.();
    return new Response(JSON.stringify({ message: "no tokens", sent: 0 }), { status: 200 });
  }) as typeof fetch;
  const waitForCall = () => new Promise<void>((r) => { resolveNext = r; });
  return { calls, waitForCall };
}

async function makeCustomer(fields: Partial<typeof customers.$inferInsert> = {}): Promise<string> {
  const db = getDefaultDb();
  const [row] = await db
    .insert(customers)
    .values({ customerCode: `PUSH-TEST-${crypto.randomUUID().slice(0, 12)}`, name: "푸시테스트고객", ...fields })
    .returning({ id: customers.id });
  createdCustomerIds.push(row.id);
  return row.id;
}

test("배정(대상≠배정자) → send-push 1건, payload {user_id,title,body}", async () => {
  const managerSub = crypto.randomUUID();
  const targetAdvisor = crypto.randomUUID();
  const { token, keyResolver, issuer } = await makeTestAuth("manager", managerSub);
  const app = createApp({ keyResolver, issuer });
  const { calls, waitForCall } = mockPush();
  const cid = await makeCustomer({ name: "김배정" });
  const settled = waitForCall();

  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ advisorName: "강현준", advisorId: targetAdvisor }),
  });
  expect(res.status).toBe(200);
  await settled;

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain("/functions/v1/send-push");
  expect(calls[0].body).toEqual({ user_id: targetAdvisor, title: "담당 고객으로 배정되었습니다", body: "김배정" });
});

test("자기 배정(대상=배정자) → 알림 미호출 · 단 배정 저장은 정상", async () => {
  const managerSub = crypto.randomUUID();
  const { token, keyResolver, issuer } = await makeTestAuth("manager", managerSub);
  const app = createApp({ keyResolver, issuer });
  const { calls } = mockPush();
  const cid = await makeCustomer();

  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ advisorName: "본인관리자", advisorId: managerSub }),
  });
  expect(res.status).toBe(200);
  // 저장은 됐는지(self여도 기능 정상) — advisor_id가 세팅됨.
  const [saved] = await getDefaultDb().select({ advisorId: customers.advisorId }).from(customers).where(eq(customers.id, cid));
  expect(saved.advisorId).toBe(managerSub);
  expect(calls).toHaveLength(0);
});

test("담당자 미변경(동일 이름 재저장) → 미호출", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("manager", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const { calls } = mockPush();
  const cid = await makeCustomer({ advisorName: "강현준", advisorId: crypto.randomUUID() });

  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ advisorName: "강현준", advisorId: crypto.randomUUID(), team: "인천본사" }),
  });
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(0);
});

test("배정 해제(advisorName null) → 미호출", async () => {
  const { token, keyResolver, issuer } = await makeTestAuth("manager", crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  const { calls } = mockPush();
  const cid = await makeCustomer({ advisorName: "강현준", advisorId: crypto.randomUUID() });

  const res = await app.request(`/api/customers/${cid}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ advisorName: null }),
  });
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:server src/routes/customers.push.test.ts`
Expected: FAIL — 첫 테스트 `calls` 0건(훅 미구현). (타입 에러 `c.var.user` 도 가능 — Task의 구현으로 해소.)

- [ ] **Step 3: Add imports to `src/routes/customers.ts`**

기존 import 블록(16-19행 근처)에 추가:

```ts
import type { AuthVariables } from "../middleware/auth";
import { holdWork } from "../middleware/db";
import { sendAssignmentPush } from "../lib/push-notify";
```

(참고: `type { DbVariables }`는 이미 18행에서 import됨.)

- [ ] **Step 4: Widen Hono Variables type**

`src/routes/customers.ts:21`을 교체:

```ts
export const customers = new Hono<{ Variables: AuthVariables & DbVariables }>();
```

- [ ] **Step 5: Compute assignment target in the assign branch**

배정 분기(현재 101-114행)를 아래로 교체 — `assignPush` 계산 추가:

```ts
    let finalPatch: CustomerWritePatch = patch;
    // 배정 알림 대상(저장 성공 후 발송). null이면 알림 없음. 저장 로직과 무관 — 알림에만 쓰인다.
    let assignPush: { userId: string; body: string } | null = null;
    if (patch.advisorName !== undefined) {
      if (patch.advisorName === null) {
        finalPatch = { ...patch, assignedAt: null };
      } else {
        const current = await getCustomerAdvisorName(c.req.valid("param").id, c.var.db);
        if (!current) return c.json({ error: "고객을 찾을 수 없습니다." }, 404);
        if (current.advisorName !== patch.advisorName) {
          finalPatch = { ...patch, assignedAt: new Date() };
          // 담당자 실제 변경 → 배정 알림 후보(스펙 §5.2). 발송 조건: advisorId NOT NULL(대상 user_id 확보) +
          // 배정 실행자 ≠ 대상(자기 배정은 저장은 되되 알림 skip). advisorName만 오고 id 없으면 대상 불명 → skip.
          if (patch.advisorId && patch.advisorId !== c.var.user.id) {
            assignPush = { userId: patch.advisorId, body: current.name };
          }
        }
      }
      // 담당자 변경인데 advisorId가 안 오면 id를 비운다 — 이름만 갈리고 구 id가 남는 스테일
      // (타 상담사 scope에 남의 고객이 잡히는 사고) 방지. 해제(null)도 같은 규칙으로 id 동반 해제.
      // 디렉토리 기반 배정 UI(후속 PR)가 항상 advisorId를 동봉하면 이 분기는 방어선으로만 남는다.
      if (patch.advisorId === undefined) finalPatch = { ...finalPatch, advisorId: null };
    }
```

- [ ] **Step 6: Send push after successful save**

`run` 콜백(현재 115-131행)의 `if (row) { ... }` 블록 끝(embed 훅들 뒤, `}` 앞)에 추가:

```ts
        // 배정 알림(저장 성공 후, 응답 비차단). self·advisorId 부재는 위 분기에서 이미 걸러짐.
        // holdWork가 실패를 흡수하고 sendAssignmentPush 자체도 throw 안 하지만, 이중으로 안전.
        if (assignPush) {
          holdWork(c, sendAssignmentPush(c, {
            userId: assignPush.userId,
            title: "담당 고객으로 배정되었습니다",
            body: assignPush.body,
          }));
        }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun run test:server src/routes/customers.push.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Run full server suite + typecheck + lint (회귀)**

Run: `bun run test:server && bun run typecheck && bun run lint`
Expected: 전부 PASS, lint 0 problems. (기존 `customers.test.ts`·`customers.embed.test.ts` 불변 — 배정 훅은 advisorName 변경 + advisorId 동봉 시에만 발동.)

- [ ] **Step 9: Commit**

```bash
git add src/routes/customers.ts src/routes/customers.push.test.ts
git commit -m "feat(crm): 고객 담당자 배정 시 상담사 FCM 푸시(holdWork→send-push)"
```

---

## Task 4: 빌드 검증 + prod 배포 확인 노트

**Files:** (없음 — 검증만)

- [ ] **Step 1: Full build**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 2: (선택) 트리거 발화 스모크 — 실기기 없이 가능한 범위**

device_tokens 0행이라 실제 FCM 수신 e2e는 실기기 로그인 후에만 가능하다. 그 전까지 확인 가능한 것:
- CRM 배정 PATCH → send-push 호출은 **단위 테스트(Task 3)로 검증됨**.
- 실 배포 후: 실기기(상담사 앱) 로그인으로 device_tokens 채워지면, CRM에서 고객 담당자 배정 → 앱 푸시 수신 확인(유슨생/앱).

이 태스크는 코드 변경 없음 — 빌드 통과 확인 + 아래 부록 인계.

---

## 부록 A: 앱 계약 (유슨생 앱 폴더 몫 — CRM 코드 아님)

실시간 상담 배정(`chat_sessions.assigned_staff_id`)은 프론트 supabase-js 직결이라 CRM 백엔드가 못 가로챈다. 앱 `push_triggers.sql`(기존 견적·채팅 트리거 옆)에 아래 함수+트리거를 추가하고 `supabase db push`.

```sql
-- 실시간 상담 배정 → 상담사에게 push (딥링크 없는 알림, self=takeOver/본인 assign 제외)
CREATE OR REPLACE FUNCTION public.notify_chat_session_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public, net'
AS $$
DECLARE
  customer_name text;
BEGIN
  IF NEW.assigned_staff_id IS NULL THEN RETURN NEW; END IF;                            -- 미배정/해제 무시
  IF NEW.assigned_staff_id IS NOT DISTINCT FROM OLD.assigned_staff_id THEN RETURN NEW; END IF; -- 배정 무변화 무시
  IF NEW.assigned_staff_id IS NOT DISTINCT FROM auth.uid() THEN RETURN NEW; END IF;    -- self(takeOver/본인 assign) 알림 제외
  SELECT full_name INTO customer_name FROM public.profiles WHERE id = NEW.user_id;
  customer_name := coalesce(customer_name, '고객');
  PERFORM net.http_post(
    url := 'https://wmkbmlespgzkeekliwio.supabase.co/functions/v1/send-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_id', NEW.assigned_staff_id,
      'title',   '새 실시간 상담이 배정되었습니다',
      'body',    customer_name,
      'tag',     'chat-assign-' || NEW.id::text
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_chat_session_assigned ON public.chat_sessions;
CREATE TRIGGER on_chat_session_assigned
  AFTER UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.notify_chat_session_assigned();

REVOKE EXECUTE ON FUNCTION public.notify_chat_session_assigned() FROM PUBLIC, anon;
```

**추가 확인(앱 폴더):** `FCM_SERVICE_ACCOUNT` 시크릿이 Supabase에 설정됐는지(`supabase secrets list`). 미설정 시 트리거는 발화해도 send-push가 500 — 이 파이프라인 전체의 유일한 미확인 지점.

---

## Self-Review 체크

- **스펙 커버리지**: §5.2 고객 담당자 훅 = Task 1(헬퍼)+Task 3(훅). §5.3 send-push 헬퍼 = Task 1. §5.1 실시간 트리거 = 부록 A(앱 몫). §7 검증 = Task 3 단위 테스트 4종 + Task 4 빌드. §5.4 문구 = Task 3(고객)·부록 A(실시간). §8 시크릿 확인 = 부록 A. ✓
- **타입 일관성**: `sendAssignmentPush(c: {env}, {userId,title,body})` — Task 1 정의 = Task 3 호출 일치. `getCustomerAdvisorName` `{advisorName, name}` — Task 2 정의 = Task 3 `current.name` 사용 일치. `c.var.user.id` — `AuthVariables` 넓힌 후 접근(Task 3 Step 4). ✓
- **플레이스홀더**: 없음(모든 스텝 실제 코드/명령). ✓
- **비차단 발송 테스트 타이밍**: `holdWork`는 응답 반환 후 settle. 테스트는 `waitForCall()`(fetch mock resolve)로 발송 완료를 기다린 뒤 단언 — race 방지. 미호출 케이스는 응답 200 직후 단언(호출이 없으므로 대기 불필요). ✓
