# 니즈 앱 카드 로딩 캐시화 + 프리패치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 상세 니즈 영역의 앱 견적요청 카드(`fetchCustomerQuoteRequests`)를 고객별 캐시로 감싸고 행 hover 프리패치를 더해 로딩 지연을 없앤다.

**Architecture:** 기존 `detailCache`(고객별)·인박스 `fetchAppQuoteRequestsCached`(단일키) 패턴을 미러링. lib에 고객별 캐시(`Map` + TTL 60s + inflight dedupe)를 두고, 훅이 캐시 버전을 소비, 목록 행 hover(앱 유입 고객만)가 프리패치로 캐시를 미리 채운다.

**Tech Stack:** React + vitest(`bun run test:unit`). 프론트 전용(백엔드 무변경).

**참조 스펙:** `ref/specs/2026-06-30-crm-needs-cards-cache-design.md`

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `client/src/lib/quote-requests.ts` | 고객별 캐시 + 프리패치 + 무효화 함수 | Modify |
| `client/src/lib/quote-requests-cache.test.ts` | 고객별 캐시 단위테스트 | Modify |
| `client/src/components/customer-detail/hooks/useCustomerNeeds.ts` | 캐시 버전 소비 | Modify |
| `client/src/pages/CustomerManagementPage.tsx` | 행 hover 프리패치(앱 유입만) | Modify |

## 사전 확인된 사실

- `fetchCustomerQuoteRequests(customerId)`(원본 fetch)는 `lib/quote-requests.ts:109`에 있고 유지한다. 캐시 래퍼가 내부에서 호출.
- 인박스 캐시(`fetchAppQuoteRequestsCached`, 단일 키)와 detailCache(`customers.ts`, 고객별 Map)가 미러 대상. **이번은 고객별 Map**(detailCache 동형).
- 캐시 테스트 파일 `quote-requests-cache.test.ts`는 `vi.resetModules()`(beforeEach)로 모듈 전역 캐시를 매 테스트 격리하고, `okFetch`(URL 무관 rawRows 반환) + 동적 import로 검증한다. 이 패턴을 그대로 따른다.
- `useCustomerNeeds.ts`: effect(`:43`)와 `reloadAppRequests`(`:53`)가 `fetchCustomerQuoteRequests(detail.id)`를 직접 호출 → 캐시 버전으로 교체.
- `CustomerManagementPage.tsx:596` 행 `onMouseEnter`가 `prefetchCustomerDetail(customer.id)` 호출 중 → 옆에 게이트된 프리패치 추가.
- `Customer.source`(string) 존재. 앱 유입 고객 source = `"앱 견적비교"`(createCustomerFromRequest가 set).

---

## Task 1: lib — 고객별 캐시 + 프리패치 + 무효화 (+ 단위테스트)

**Files:**
- Modify: `client/src/lib/quote-requests.ts`
- Test: `client/src/lib/quote-requests-cache.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`client/src/lib/quote-requests-cache.test.ts` 맨 아래(마지막 `});` 다음)에 새 describe 추가. 기존 `okFetch`(URL 무관)·`beforeEach(resetModules)`·`afterEach(restoreAllMocks)`를 그대로 활용한다.

```ts
describe("고객별 앱 견적요청 캐시", () => {
  it("같은 고객 두 번째 호출은 캐시 hit(fetch 1회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchCustomerQuoteRequestsCached } = await import("./quote-requests");
    await fetchCustomerQuoteRequestsCached("c1");
    await fetchCustomerQuoteRequestsCached("c1");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("다른 고객은 별도 키(fetch 2회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchCustomerQuoteRequestsCached } = await import("./quote-requests");
    await fetchCustomerQuoteRequestsCached("c1");
    await fetchCustomerQuoteRequestsCached("c2");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("force=true는 캐시 우회 재fetch(fetch 2회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchCustomerQuoteRequestsCached } = await import("./quote-requests");
    await fetchCustomerQuoteRequestsCached("c1");
    await fetchCustomerQuoteRequestsCached("c1", true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("같은 고객 동시 호출은 inflight dedupe(fetch 1회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchCustomerQuoteRequestsCached } = await import("./quote-requests");
    await Promise.all([fetchCustomerQuoteRequestsCached("c1"), fetchCustomerQuoteRequestsCached("c1")]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("prefetch가 캐시를 채워 이후 fetch 0(총 1회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchCustomerQuoteRequestsCached, prefetchCustomerQuoteRequests } = await import("./quote-requests");
    prefetchCustomerQuoteRequests("c1");
    await new Promise((r) => setTimeout(r, 0)); // prefetch 워밍 완료 대기
    await fetchCustomerQuoteRequestsCached("c1");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("invalidate 후 재fetch(fetch 2회)", async () => {
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchCustomerQuoteRequestsCached, invalidateCustomerQuoteRequests } = await import("./quote-requests");
    await fetchCustomerQuoteRequestsCached("c1");
    invalidateCustomerQuoteRequests("c1");
    await fetchCustomerQuoteRequestsCached("c1");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("TTL 만료 후 재fetch(fetch 2회)", async () => {
    vi.useFakeTimers();
    const spy = okFetch();
    vi.stubGlobal("fetch", spy);
    const { fetchCustomerQuoteRequestsCached } = await import("./quote-requests");
    await fetchCustomerQuoteRequestsCached("c1");
    await vi.advanceTimersByTimeAsync(61_000);
    await fetchCustomerQuoteRequestsCached("c1");
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test:unit client/src/lib/quote-requests-cache.test.ts`
Expected: FAIL — `fetchCustomerQuoteRequestsCached`/`prefetchCustomerQuoteRequests`/`invalidateCustomerQuoteRequests` 미export.

- [ ] **Step 3: 캐시 구현**

`client/src/lib/quote-requests.ts`에서 `fetchCustomerQuoteRequests` 함수(현재 `:109~111`) **바로 아래**에 추가:

```ts
// 고객별 앱 견적요청 캐시 + inflight dedupe (detailCache·인박스 캐시와 동형, 고객 uuid 키).
// 행 hover 프리패치·재진입은 캐시 hit으로 즉시(왕복 0). 승격 후엔 force=true로 우회(배지 fresh).
const NEEDS_TTL_MS = 60_000;
const needsCache = new Map<string, { value: AppQuoteRequest[]; at: number }>();
const needsInflight = new Map<string, Promise<AppQuoteRequest[]>>();

export function fetchCustomerQuoteRequestsCached(customerId: string, force = false): Promise<AppQuoteRequest[]> {
  const cached = needsCache.get(customerId);
  if (!force && cached && Date.now() - cached.at < NEEDS_TTL_MS) return Promise.resolve(cached.value);
  const existing = needsInflight.get(customerId);
  if (!force && existing) return existing;
  const p = fetchCustomerQuoteRequests(customerId)
    .then((value) => {
      needsCache.set(customerId, { value, at: Date.now() });
      return value;
    })
    .finally(() => {
      if (needsInflight.get(customerId) === p) needsInflight.delete(customerId);
    });
  if (!force) needsInflight.set(customerId, p);
  return p;
}

// 고객 행 hover가 호출. 백그라운드 워밍(결과/에러 무시).
export function prefetchCustomerQuoteRequests(customerId: string): void {
  void fetchCustomerQuoteRequestsCached(customerId).catch(() => {});
}

// 캐시 버림(대칭용). 현재 무효화는 reloadAppRequests의 force로 처리되나, 외부 무효화 경로용으로 노출.
export function invalidateCustomerQuoteRequests(customerId: string): void {
  needsCache.delete(customerId);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test:unit client/src/lib/quote-requests-cache.test.ts`
Expected: PASS(기존 + 신규 7개).

- [ ] **Step 5: typecheck + 커밋**

```bash
bun run typecheck
git add client/src/lib/quote-requests.ts client/src/lib/quote-requests-cache.test.ts
git commit -m "$(cat <<'EOF'
perf(crm): 고객별 앱 견적요청 캐시 + 프리패치/무효화 lib (detailCache 동형)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: hook — 캐시 버전 소비

**Files:**
- Modify: `client/src/components/customer-detail/hooks/useCustomerNeeds.ts`

> 훅은 단위테스트 없음(현행). typecheck/lint + 수동 검증.

- [ ] **Step 1: import 교체**

`useCustomerNeeds.ts:4` 현재:
```ts
import { fetchCustomerQuoteRequests, type AppQuoteRequest } from "@/lib/quote-requests";
```
를 아래로:
```ts
import { fetchCustomerQuoteRequestsCached, type AppQuoteRequest } from "@/lib/quote-requests";
```

- [ ] **Step 2: 첫 로드 effect를 캐시 버전으로**

effect 안(현재 `:43`) `void fetchCustomerQuoteRequests(detail.id)` 를:
```ts
    void fetchCustomerQuoteRequestsCached(detail.id)
      .then((r) => { if (!cancelled) setAppRequests(r); })
      .catch(() => { if (!cancelled) setAppRequests([]); });
```
(앞뒤 `let cancelled`/`return () => { cancelled = true; }`·deps `[detail.appUserId, detail.id]`는 그대로.)

- [ ] **Step 3: reloadAppRequests를 force로**

`reloadAppRequests`(현재 `:53`) `void fetchCustomerQuoteRequests(detail.id).then(setAppRequests)...` 를:
```ts
    void fetchCustomerQuoteRequestsCached(detail.id, true).then(setAppRequests).catch(() => undefined);
```

- [ ] **Step 4: 검증 + 커밋**

```bash
bun run typecheck
bun run lint
git add client/src/components/customer-detail/hooks/useCustomerNeeds.ts
git commit -m "$(cat <<'EOF'
perf(crm): 니즈 훅이 앱 견적요청 캐시 버전 소비(첫 로드 캐시·승격 force)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: page — 행 hover 프리패치 (앱 유입 고객만)

**Files:**
- Modify: `client/src/pages/CustomerManagementPage.tsx`

> 페이지 단위테스트 없음. typecheck/lint/build + 수동 검증.

- [ ] **Step 1: import 추가**

`CustomerManagementPage.tsx` 상단 import 블록에 추가(`@/lib/customers`의 `prefetchCustomerDetail`는 이미 있음):
```ts
import { prefetchCustomerQuoteRequests } from "@/lib/quote-requests";
```
(파일에 이미 `@/lib/quote-requests` import가 있으면 거기에 `prefetchCustomerQuoteRequests`를 추가한다.)

- [ ] **Step 2: onMouseEnter에 게이트된 프리패치 추가**

`CustomerManagementPage.tsx:596` 현재:
```ts
      onMouseEnter: onOpenCustomer && customer.id ? () => prefetchCustomerDetail(customer.id as string) : undefined,
```
를 아래로:
```ts
      onMouseEnter: onOpenCustomer && customer.id
        ? () => {
            prefetchCustomerDetail(customer.id as string);
            if (customer.source === "앱 견적비교") prefetchCustomerQuoteRequests(customer.id as string);
          }
        : undefined,
```

- [ ] **Step 3: 검증 + 커밋**

```bash
bun run typecheck
bun run lint
bun run build
git add client/src/pages/CustomerManagementPage.tsx
git commit -m "$(cat <<'EOF'
perf(crm): 고객 행 hover 시 앱 유입 고객 견적요청 프리패치(첫 진입 즉시)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 최종 검증 (전 태스크 후)

```bash
bun run typecheck   # 0 errors
bun run lint        # 0 problems
bun run test:unit   # 기존 + 신규 7(고객별 캐시)
bun run build       # OK
```

**브라우저 수동(유슨생):**
- 앱 유입 고객(제임스/김지안) 행 hover 후 상세 진입 → 카드 **즉시**(프리패치 캐시 hit).
- 그 고객 상세 닫았다 재진입 → 즉시(캐시 hit).
- 견적 승격(워크벤치 INSERT) 후 → 카드/배지 fresh(force).
- 수기 고객(김민준) 상세 → 단일 need 카드 회귀 없음(프리패치 안 함, 캐시 miss→fetch→다음 즉시).

---

## Self-Review (작성자 점검)

**1. Spec coverage:**
- 고객별 캐시(Map+TTL+dedupe) → Task 1. ✅
- 첫 로드 캐시 허용 / 승격 force → Task 2. ✅
- 행 hover 프리패치(앱 유입만, source 게이트) → Task 3. ✅
- 무효화 함수(대칭용) → Task 1. ✅
- 라우트 1왕복화 = 범위 밖(spec 명시) → 미포함. ✅
- 캐시 단위테스트(hit/per-key/force/dedupe/prefetch/invalidate/TTL) → Task 1. ✅

**2. Placeholder scan:** 없음(모든 코드 완전). ✅

**3. Type consistency:** `fetchCustomerQuoteRequestsCached(customerId, force?)`·`prefetchCustomerQuoteRequests(customerId)`·`invalidateCustomerQuoteRequests(customerId)` — Task 1 정의와 Task 2/3 호출 시그니처 일치. `AppQuoteRequest`(기존 타입) 재사용. ✅
