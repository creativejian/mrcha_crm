# 인박스 이름 매칭 제안 Implementation Plan

> **✅ 전량 실행 완료 — #282 squash `04ee963` 머지(2026-07-18).** 검증 typecheck 0·lint 0·unit 834·server 580·최종 적대 리뷰 정합성 결함 0. 아래 체크박스는 실행 당시 미갱신 상태로 남은 것(배치 9 C#1에서 완료 마커로 동기화 — 개별 체크 대신 이 헤더가 SSOT).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인박스 두 곳(상담 신청 DB · 앱 견적요청)에서 `none`(신규·미연결) 매칭일 때 같은 이름의 미연결 고객을 제안 노출해, 상담사가 `[고객 생성]` 대신 기존 고객에 `[연결]`하도록 유도(중복 고객 예방).

**Architecture:** matchType(`app_user`/`phone`/`none`)은 불변. `none`일 때만 별도 필드 `nameMatches`에 같은 이름(정규화 후) 미연결 고객 배열을 담는다. 상담 인박스는 클라 파생(`consultation-inbox.ts`, 서버 변경 0), 견적요청 인박스는 서버 파생(`src/db/queries/quote-requests.ts`). `[연결]`은 기존 link 라우트에 선택한 후보 id를 넘겨 재사용 — 병합 엔진 없음.

**Tech Stack:** TypeScript 6, React, vitest(클라 유닛), bun:test(서버 실 master DB), 기존 quote-inbox.css.

**Spec:** `ref/specs/2026-07-18-crm-inbox-name-match-suggestion-design.md`

---

## File Structure

- `client/src/lib/consultation-inbox.ts` — 상담 인박스 클라 파생. `nameMatches` 필드 + `byNameUnlinked` 인덱스 + `normalizeName` 로컬 헬퍼.
- `client/src/lib/consultation-inbox.test.ts` — 파생 유닛.
- `client/src/pages/ConsultationRequestsPage.tsx` — 제안 UI + `handleLink(g, customerId?)` 확장.
- `src/db/queries/quote-requests.ts` — 서버 파생. `nameMatches` 필드 + `custByNameUnlinked` 인덱스 + `normalizeName` 로컬 헬퍼.
- `src/db/queries/quote-requests.test.ts` — 서버 파생 실 DB 유닛(기존 파일에 케이스 추가, 없으면 신설).
- `client/src/lib/quote-requests.ts` — 클라 `AppQuoteRequestRow`(JSON 미러)·`AppQuoteRequest`에 `nameMatches` 배선 + `toAppQuoteRequest` 패스스루.
- `client/src/pages/AppRequestsPage.tsx` — 제안 UI + `handleLink(r, customerId?)` 확장.
- `client/src/styles/quote-inbox.css` — `.app-req-name-suggest` 블록(양 페이지 공용).

**이름 정규화는 공유 모듈을 만들지 않는다** — 서버/클라 import 경계 때문에 phone 정규화(`sanitizePhoneDigits` 클라 / `normalizePhoneDigits` 서버)가 이미 각자 사는 선례를 따라, `normalizeName`을 양쪽에 2줄로 각자 둔다.

---

## Task 1: 상담 인박스 nameMatches 파생 (클라, TDD)

**Files:**
- Modify: `client/src/lib/consultation-inbox.ts`
- Test: `client/src/lib/consultation-inbox.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `consultation-inbox.test.ts` 하단에 추가

> 이 파일 상단의 기존 헬퍼 `row(overrides?: Partial<AppConsultationRow>)`(상담 행 — `userId`·`customerName`·`phoneNumber` 필드)와 `customer(overrides?: Partial<Customer>)`(고객 — `id`·`name`·`customerId`·`phone`·`appUserId` 필드)를 그대로 재사용한다. 둘 다 Partial이라 필요한 필드만 넘기면 된다.

```ts
describe("nameMatches (이름 매칭 제안)", () => {
  it("none일 때 같은 이름 미연결 고객을 nameMatches에 노출", () => {
    const rows = [row({ userId: "u-new", customerName: "김지운", phoneNumber: "01011112222" })];
    const customers = [customer({ id: "c-1", name: "김지운", customerId: "CU-2605-0018", phone: "010-9999-8888", appUserId: null })];
    const [g] = buildConsultationInboxGroups(rows, customers);
    expect(g.matchType).toBe("none");
    expect(g.nameMatches.map((m) => m.code)).toEqual(["CU-2605-0018"]);
  });

  it("연결 고객(appUserId 보유)은 nameMatches에서 제외", () => {
    const rows = [row({ userId: "u-new", customerName: "김지운", phoneNumber: "01011112222" })];
    const customers = [customer({ id: "c-1", name: "김지운", customerId: "CU-2605-0018", phone: "010-9999-8888", appUserId: "someone-else" })];
    const [g] = buildConsultationInboxGroups(rows, customers);
    expect(g.matchType).toBe("none");
    expect(g.nameMatches).toEqual([]);
  });

  it("phone 매칭이면 nameMatches는 비운다(none이 아니므로)", () => {
    const rows = [row({ userId: "u-new", customerName: "김지운", phoneNumber: "01011112222" })];
    const customers = [customer({ id: "c-1", name: "김지운", customerId: "CU-2605-0018", phone: "010-1111-2222", appUserId: null })];
    const [g] = buildConsultationInboxGroups(rows, customers);
    expect(g.matchType).toBe("phone");
    expect(g.nameMatches).toEqual([]);
  });

  it("동명이인 미연결 고객 2명을 모두 나열(고객번호 순)", () => {
    const rows = [row({ userId: "u-new", customerName: "김지운", phoneNumber: "01011112222" })];
    const customers = [
      customer({ id: "c-2", name: "김지운", customerId: "CU-2605-0031", phone: "010-3333-3333", appUserId: null }),
      customer({ id: "c-1", name: "김지운", customerId: "CU-2605-0018", phone: "010-9999-8888", appUserId: null }),
    ];
    const [g] = buildConsultationInboxGroups(rows, customers);
    expect(g.nameMatches.map((m) => m.code)).toEqual(["CU-2605-0018", "CU-2605-0031"]);
  });

  it("이름 정규화 — 앞뒤 공백·대소문자 무관", () => {
    const rows = [row({ userId: "u-new", customerName: "  Daniel Kang ", phoneNumber: "01011112222" })];
    const customers = [customer({ id: "c-1", name: "daniel kang", customerId: "CU-2605-0018", phone: "010-9999-8888", appUserId: null })];
    const [g] = buildConsultationInboxGroups(rows, customers);
    expect(g.nameMatches.map((m) => m.code)).toEqual(["CU-2605-0018"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bunx vitest run client/src/lib/consultation-inbox.test.ts`
Expected: FAIL — `g.nameMatches`가 `undefined`(속성 없음) → `.map` TypeError, 또는 타입 에러.

- [ ] **Step 3: 타입 + 파생 구현** — `consultation-inbox.ts`

`ConsultationInboxGroup` 타입에 필드 추가(`matchedCustomerCode` 아래):

```ts
  matchedCustomerCode: string | null;
  // none일 때만 채우는 같은 이름 미연결 고객 후보(예방용 제안 — 자동 연결 아님). 그 외 매칭은 빈 배열.
  nameMatches: MatchedCustomer[];
```

파일 상단(import 아래, `matchLabelOf` 근처)에 정규화 헬퍼 추가:

```ts
// 이름 매칭 정규화 — 앞뒤/중복 공백 접기 + 소문자. digits(phone)와 별개(spec §3).
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
```

고객 인덱스 루프(`byAppUser`/`byPhone` 만드는 for 루프)의 `if (c.appUserId) continue;` **아래**(미연결 고객만 도달)에 name 인덱스 추가:

```ts
    if (c.appUserId) continue;
    const nameKey = normalizeName(c.name);
    if (nameKey) {
      const list = byNameUnlinked.get(nameKey) ?? [];
      list.push(entry);
      byNameUnlinked.set(nameKey, list);
    }
    const digits = sanitizePhoneDigits(c.phone);
    if (digits && !byPhone.has(digits)) byPhone.set(digits, entry);
```

루프 앞 `byPhone` 선언 근처에 인덱스 선언:

```ts
  const byNameUnlinked = new Map<string, MatchedCustomer[]>();
```

그룹 map 반환 객체에 필드 추가(`matchedCustomerCode` 아래). `matched`/`matchType`은 이미 계산돼 있다:

```ts
      matchedCustomerCode: matched?.code ?? null,
      nameMatches:
        matchType === "none"
          ? (byNameUnlinked.get(normalizeName(latest.customerName)) ?? [])
              .slice()
              .sort((a, b) => a.code.localeCompare(b.code))
          : [],
```

- [ ] **Step 4: 통과 확인**

Run: `bunx vitest run client/src/lib/consultation-inbox.test.ts`
Expected: PASS (기존 케이스 + 신규 5).

- [ ] **Step 5: 변이 검증** — `matchType === "none" ?` 조건을 임시로 `true ?`로 바꿔 실행 → "phone 매칭이면 nameMatches 비운다" 테스트만 실패하는지 확인 후 원복.

- [ ] **Step 6: 커밋**

```bash
git add client/src/lib/consultation-inbox.ts client/src/lib/consultation-inbox.test.ts
git commit -m "feat(crm): 상담 인박스 nameMatches 파생 — none일 때 같은 이름 미연결 고객 제안(TDD)"
```

---

## Task 2: 상담 인박스 제안 UI + handleLink 확장

**Files:**
- Modify: `client/src/pages/ConsultationRequestsPage.tsx`
- Modify: `client/src/styles/quote-inbox.css`

- [ ] **Step 1: handleLink 시그니처 확장** — `handleLink(g: ConsultationInboxGroup)`를 명시 customerId 수용으로

```ts
  async function handleLink(g: ConsultationInboxGroup, customerId: string | null = g.matchedCustomerId) {
    if (!customerId) return;
    setActingKey(g.key);
    setLinkConflict(null);
    try {
      const linked = await linkConsultationToCustomer(g.latestConsultationId, customerId);
```

> 본문의 나머지(토스트·onCustomerListChanged·setRows·catch)는 불변. `g.matchedCustomerId` → `customerId`로 바뀐 건 link 호출 인자 한 곳뿐.

- [ ] **Step 2: 제안 UI 렌더** — `<div className="app-req-match-inner">` 안, `{g.matchType === "none" && g.canPromote && ( ...고객 생성... )}` 블록 **바로 앞**에 삽입

```tsx
                          {g.matchType === "none" && g.canPromote && g.nameMatches.length > 0 && (
                            <div className="app-req-name-suggest">
                              <span className="app-req-name-suggest-label">이름이 같은 미연결 고객</span>
                              {g.nameMatches.map((m) => (
                                <button
                                  key={m.id}
                                  className="app-req-action"
                                  disabled={actingKey === g.key}
                                  onClick={(event) => {
                                    stopRowToggle(event);
                                    void handleLink(g, m.id);
                                  }}
                                  type="button"
                                >
                                  {m.name} {m.code} 연결
                                </button>
                              ))}
                            </div>
                          )}
```

> 기존 `고객 생성` 버튼은 그대로 둔다(후보가 있어도 "새로 생성" 경로 유지 — 동명이인이라 아무도 맞지 않을 수 있다).

- [ ] **Step 3: CSS 추가** — `client/src/styles/quote-inbox.css` `.app-req-conflict` 블록 근처에

```css
.app-req-name-suggest { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; align-items: flex-start; }
.app-req-name-suggest-label { font-size: 11px; font-weight: 600; color: #7f858c; }
```

- [ ] **Step 4: 검증**

Run: `bun run typecheck && bun run lint`
Expected: 0 errors / 0 problems.

- [ ] **Step 5: 커밋**

```bash
git add client/src/pages/ConsultationRequestsPage.tsx client/src/styles/quote-inbox.css
git commit -m "feat(crm): 상담 인박스 이름 매칭 제안 UI + handleLink 후보 id 확장"
```

---

## Task 3: 견적요청 인박스 서버 nameMatches 파생 (TDD 실 DB)

**Files:**
- Modify: `src/db/queries/quote-requests.ts`
- Test: `src/db/queries/quote-requests.test.ts` (신설)

> **⚠️ 실 master DB.** `bun run test:server`로만 실행(개별 `bun test` 금지 — EMBED_ON_WRITE 게이트). **이 테스트는 `public.quote_requests`에 쓰지 않는다** — `buildAppQuoteRequestRows`에 **합성 `QuoteRequestBaseRow[]`를 직접 넘기고** 실 executor는 `crm.customers`(픽스처)만 읽게 한다(catalog는 `trimId: null`이라 스킵, quotes/options는 합성 id라 빈 결과). crm.customers 픽스처만 실 INSERT — 랜덤 서픽스 + `afterAll` 정리, 이름은 `TEST_CUSTOMER_NAMES` registry에 **먼저 등록**(예: `"이름매칭테스트"`).

> **핵심 서버 변경**: 현재 고객 로드 쿼리는 `phone IN (요청 전화) OR appUserId IN (요청 유저)`로만 후보를 불러온다 — 이름만 같고 번호 다른 고객은 **애초에 안 불러온다**. 이름 매칭을 위해 쿼리에 **`OR name IN (요청자 이름)`을 추가**해야 한다(fetch는 exact-name, JS에서 normalizeName로 그룹핑). **알려진 한계**: fetch가 exact `customers.name`이라 요청자 이름과 고객 이름의 공백/대소문자만 다른 변형은 fetch 단계에서 놓친다(한글 이름은 사실상 무관 — 클라 인박스는 전체 목록 메모리라 완전 정규화됨. spec §3에 각주).

- [ ] **Step 1: 함수 export** — `src/db/queries/quote-requests.ts:70` `async function buildAppQuoteRequestRows` → `export async function buildAppQuoteRequestRows`(테스트에서 합성 rows로 직접 호출).

- [ ] **Step 2: 실패 테스트 작성** — `src/db/queries/quote-requests.test.ts` 신설. crm.customers 픽스처 헬퍼는 `src/db/queries/customers.create.test.ts`의 `createCustomerManual` 사용 패턴을 미러(랜덤 서픽스 이름). `QuoteRequestBaseRow`는 export 안 됐으면 `import type`용으로 export하거나 인라인 객체 리터럴로 구성(필수 필드 전부 — 아래).

```ts
import { afterAll, expect, test } from "bun:test";
import { getDefaultDb } from "../client";
import { createCustomerManual } from "./customers";
import { buildAppQuoteRequestRows } from "./quote-requests";

const db = getDefaultDb();
const NAME = `이름매칭테스트`; // TEST_CUSTOMER_NAMES에 등록 필요
const createdIds: string[] = [];

afterAll(async () => {
  for (const id of createdIds) await db.delete(/* crm.customers */).where(/* id */);
  // ↑ 실제 삭제는 customers.create.test.ts의 정리 패턴을 그대로 미러(deleteCustomer 헬퍼 or 직접 delete).
});

test("nameMatches — none 요청에 같은 이름 미연결 고객 노출", async () => {
  const cust = await createCustomerManual({ name: NAME, phone: "01099998888", source: null }, db);
  createdIds.push(cust.id);
  const syntheticRow = {
    id: "qr-synthetic-1", createdAt: "2026-07-18T00:00:00.000+00:00",
    userId: "00000000-0000-0000-0000-000000000000", // 미연결(어떤 고객의 appUserId도 아님)
    trimId: null, paymentMethod: null, period: null, depositType: null, depositRatio: null,
    rentalDeposit: null, trimPrice: null, status: "open", colorPreferenceMode: null,
    exteriorColorId: null, exteriorColorName: null, exteriorColorHex: null,
    interiorColorId: null, interiorColorName: null, interiorColorHex: null,
    requesterName: NAME, requesterPhone: "01011112222", // 고객과 다른 번호 → phone 매칭 실패 → none
  };
  const rows = await buildAppQuoteRequestRows([syntheticRow], db);
  const r = rows.find((x) => x.id === "qr-synthetic-1")!;
  expect(r.matchType).toBe("none");
  expect(r.nameMatches.map((m) => m.code)).toContain(cust.customerCode);
});
```

> `createCustomerManual`의 정확한 인자/반환(`{id, customerCode}`)과 정리 헬퍼는 `src/db/queries/customers.create.test.ts`에서 확인해 미러한다. `QuoteRequestBaseRow` 타입 export가 필요하면 함께 export.

- [ ] **Step 3: 실패 확인**

Run: `bun run test:server 2>&1 | grep -B1 -A4 nameMatches`
Expected: FAIL — 픽스처 고객이 이름 조건 없는 쿼리에 안 잡혀 `nameMatches`가 `[]`(또는 필드 없음).

- [ ] **Step 4: 서버 파생 구현** — `src/db/queries/quote-requests.ts`

서버 `AppQuoteRequestRow` 타입에 필드 추가(`matchType` 근처):

```ts
  matchType: "app_user" | "phone" | "none";
  nameMatches: { id: string; name: string; code: string }[];
```

모듈 상단에 로컬 정규화 헬퍼:

```ts
// 이름 매칭 정규화 — 클라 consultation-inbox.normalizeName와 동일 규칙(공유 모듈은 import 경계상 미도입).
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
```

`requesterName` 목록 파생(기존 `phones`/`userIds` 선언 근처):

```ts
  const names = [...new Set(rows.map((r) => r.requesterName).filter((v): v is string => v != null))];
```

고객 select의 `where(or(...))`에 이름 조건 추가:

```ts
      .where(
        or(
          phones.length ? inArray(customers.phone, phones) : undefined,
          userIds.length ? inArray(customers.appUserId, userIds) : undefined,
          names.length ? inArray(customers.name, names) : undefined,
        ),
      ),
```

고객 인덱스 루프에 name 인덱스 추가(`custByPhone`/`custByAppUser` for 루프):

```ts
  const custByNameUnlinked = new Map<string, { id: string; name: string; code: string }[]>();
  for (const c of custRows) {
    const entry = { id: c.id, name: c.name, code: c.code };
    if (c.phone && !c.appUserId) custByPhone.set(c.phone, entry);
    if (c.appUserId) custByAppUser.set(c.appUserId, entry);
    if (!c.appUserId) {
      const nameKey = normalizeName(c.name);
      if (nameKey) {
        const list = custByNameUnlinked.get(nameKey) ?? [];
        list.push(entry);
        custByNameUnlinked.set(nameKey, list);
      }
    }
  }
```

`rows.map` 반환 객체에 필드 추가(`matchType` 아래):

```ts
      matchType,
      nameMatches:
        matchType === "none" && r.requesterName
          ? (custByNameUnlinked.get(normalizeName(r.requesterName)) ?? [])
              .slice()
              .sort((a, b) => a.code.localeCompare(b.code))
          : [],
```

- [ ] **Step 5: 통과 확인**

Run: `bun run test:server 2>&1 | tail -5`
Expected: 신규 테스트 PASS, 총계 = 이전 +1. `check:residue` 잔재 0.

- [ ] **Step 6: 커밋**

```bash
git add src/db/queries/quote-requests.ts src/db/queries/quote-requests.test.ts src/test-utils/fixture-residue.ts
git commit -m "feat(crm): 견적요청 인박스 서버 nameMatches 파생 — 고객 쿼리 이름 조건 추가(실 DB TDD)"
```

---

## Task 4: 견적요청 인박스 클라 배선 + 제안 UI

**Files:**
- Modify: `client/src/lib/quote-requests.ts`
- Modify: `client/src/pages/AppRequestsPage.tsx`

- [ ] **Step 1: 클라 타입 배선** — `client/src/lib/quote-requests.ts`

`AppQuoteRequestRow`(JSON 미러)에 `matchType` 아래 추가:

```ts
  matchType: "app_user" | "phone" | "none";
  nameMatches: { id: string; name: string; code: string }[];
```

`AppQuoteRequest`(화면 타입)에 `matchType` 근처 추가:

```ts
  matchType: AppQuoteRequestRow["matchType"];
  nameMatches: AppQuoteRequestRow["nameMatches"];
```

`toAppQuoteRequest` 반환 객체에 패스스루(`matchType: row.matchType` 아래):

```ts
    matchType: row.matchType,
    nameMatches: row.nameMatches,
```

- [ ] **Step 2: handleLink 확장** — `AppRequestsPage.tsx` `handleLink(r: AppQuoteRequest)`를

```ts
  async function handleLink(r: AppQuoteRequest, customerId: string | null = r.matchedCustomerId) {
    if (!customerId) return;
    setActingId(r.id);
    setLinkConflict(null);
    try {
      const linked = await linkRequestToCustomer(r.id, customerId);
```

> 나머지 본문 불변(`r.matchedCustomerId` → `customerId`는 link 호출 인자 한 곳뿐).

- [ ] **Step 3: 제안 UI 렌더** — `AppRequestsPage.tsx`. 이 페이지는 **행 펼침이 없어 `stopRowToggle`이 없다**(상담 페이지와 다름 — plain onClick). none 게이트는 `r.matchType === "none"`만(canPromote 없음). 기존 `{r.matchType === "none" && ( <button>신규 생성</button> )}` 블록 **바로 앞**에 삽입:

```tsx
                          {r.matchType === "none" && r.nameMatches.length > 0 && (
                            <div className="app-req-name-suggest">
                              <span className="app-req-name-suggest-label">이름이 같은 미연결 고객</span>
                              {r.nameMatches.map((m) => (
                                <button
                                  key={m.id}
                                  className="app-req-action"
                                  disabled={actingId === r.id}
                                  onClick={() => handleLink(r, m.id)}
                                  type="button"
                                >
                                  {m.name} {m.code} 연결
                                </button>
                              ))}
                            </div>
                          )}
```

> 기존 `신규 생성` 버튼은 그대로 둔다(후보가 있어도 새로 생성 경로 유지). CSS `.app-req-name-suggest`는 Task 2에서 이미 추가됨(공용). 이 셀이 flex-column 컨테이너가 아니면(`.app-req-match-inner`는 flex-wrap row) 제안 블록이 자연히 다음 줄로 래핑된다 — 시각 확인만.

- [ ] **Step 4: 검증**

Run: `bun run typecheck && bun run lint`
Expected: 0 / 0.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/quote-requests.ts client/src/pages/AppRequestsPage.tsx
git commit -m "feat(crm): 견적요청 인박스 nameMatches 클라 배선 + 이름 매칭 제안 UI"
```

---

## Task 5: 통합 검증

**Files:** 없음(검증만).

- [ ] **Step 1: 전체 검증**

Run:
```bash
bun run typecheck && bun run lint && bun run test:unit && bun run build && bun run knip
```
Expected: typecheck 0 · lint 0 · unit 통과(+상담 유닛 5) · build ✓ · knip delta 0(신규 export는 전부 사용).

- [ ] **Step 2: 서버 검증**

Run: `bun run test:server 2>&1 | tail -5`
Expected: 통과(+견적요청 유닛 1). `net._http_response` 증가분 0(알림 미접촉).

- [ ] **Step 3: 픽스처 잔재 확인**

Run: `bun run check:residue`
Expected: 잔재 0(신규 서버 픽스처가 afterAll로 정리됨).

- [ ] **Step 4: 최종 커밋(있으면)** — 검증만이면 생략.

---

## Self-Review 결과

- **Spec 커버리지**: §3 매칭 계층(Task 1·3 nameMatches 파생·none 게이트) · §4 데이터 모델(Task 1·3·4 타입) · §5 화면(Task 2·4 UI·handleLink 확장) · §6 서버(Task 3) · §8 검증(Task 1·3 유닛·Task 5 통합) 전부 태스크 존재.
- **동명이인**: Task 1·2·4 모두 배열 나열 + 수동 [연결] — 자동 연결 없음(spec §2-3).
- **matchType 불변**: 어느 태스크도 matchType 계산을 안 건드림(nameMatches는 별도 필드) — 기존 phone/app_user 테스트 무영향.
- **타입 일관성**: nameMatches 원소 = `{id,name,code}`(상담 = MatchedCustomer 재사용, 서버/클라 = 인라인 동형). handleLink 시그니처 = `(item, customerId = 기존 단일)` 양 페이지 동일.
- **서버 fetch 한계**: Task 3는 고객을 exact `customers.name`으로 fetch(공백/대소문자 변형은 fetch 단계 누락 — 한글 이름 무관, spec §3 각주). 클라(상담)는 전체 목록 메모리라 완전 정규화 — 의도적 비대칭.
- **Task 3 픽스처**: `public.quote_requests` 미접촉(합성 rows 직접 주입) + crm.customers 픽스처만 실 INSERT. 이름 `TEST_CUSTOMER_NAMES` registry 선등록 필수. `createCustomerManual` 인자/정리 헬퍼는 `customers.create.test.ts`에서 확인 후 미러.
