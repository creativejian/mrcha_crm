# 관리자 채택 구현 계획 (슬라이스 C) — 새 세션 즉시 착수용

> **새 세션에서 "CRM 이어가자" → 이 파일을 읽고 `superpowers:executing-plans`로 Task 0부터.**
> 사전 조사는 끝났다(아래 "확정된 사실" 참조). spec = `ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md`
> 선행 = A(#375) · B1(#376) · B2a(#377) · B2b(#378) **전부 머지 완료**

**목표:** 이사님이 딜러 제안을 보고 **필드별로 채택**하면 그 금액이 `catalog.trims` 확정 할인에
반영된다. 자사·제휴·타사가 **각각 독립**이다(자사는 동성모터스, 제휴는 코오롱 값 가능).

**지금 상태:** 딜러가 넣은 제안은 `crm.dealer_trim_discounts`에 쌓이는데 **이사님이 볼 화면이 0**이다.

---

## 확정된 사실 (재조사 불필요 — 2026-07-27 실측)

| 항목 | 사실 |
|---|---|
| **`discount_updated_at`** | **직접 찍지 않는다.** 트리거 `trims_discount_updated`(BEFORE UPDATE → `catalog.update_discount_timestamp()`)가 3할인 중 하나라도 `IS DISTINCT FROM`일 때만 `NOW()`를 찍는다(DB 시계·멱등). 직접 넣으면 같은 값 재채택 시 **거짓 스탬프**가 된다 |
| 쿼리 함수 관례 | `fn(input, executor: Executor = getDefaultDb())` — `src/db/queries/catalog-admin.ts` 참조 |
| 트림 수정 함수 | `updateTrim(id, patch, executor)`가 이미 3할인을 받는다(`catalog-admin.ts`) — 채택은 이걸 **재사용**한다 |
| 라우트 게이트 | `protect("/api/catalog/*")` = auth → dealerWriteGate → db. **admin 전용은 `requireRoles(["admin"])`를 명시로 붙인다**(catalog 라우터엔 role 게이트가 없어 staff가 쓸 수 있는 상태) |
| profiles 조인 | **읽기는 계약 위반이 아니다**(`staff.ts`가 이미 그렇게 한다). 자격 판정에 `profiles.role`을 read-through로 본다 |
| 실 DB 테스트 실행 | `EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local <파일>` |
| `profiles-write-guard` | `.insert/.delete(dealerProfiles)`는 오탐으로 잡힌다 → 픽스처 생성은 `upsertDealerProfile()` 함수를 쓰고, 정리(`delete`)만 `ALLOW`에 등록(선례 3건) |
| db-bound registry | 새 실 DB 테스트는 `src/test-utils/db-bound-tests.ts`에 알파벳 순 등록(미등록 = CI red) |

---

### Task 0: 브랜치

```bash
git switch main && git pull -q && git switch -c 0728-dealer-discount-c
git status --short --branch
```

---

### Task 1: `crm.catalog_discount_adoptions` + 마이그 0041

**Files:** Modify `src/db/schema.ts`(끝) · Create `drizzle/0041_*.sql`

- [ ] **Step 1: 테이블 정의** (`schema.ts` 맨 끝, `dealerTrimDiscounts` 다음)

```ts
// 확정 할인 채택 감사(2026-07-27, 슬라이스 C) — **필드 단위 1행**이라 "자사는 동성모터스, 제휴는
// 코오롱" 같은 독립 채택이 자연스럽게 표현된다(이사님 요구).
// 채택은 catalog.trims를 갱신하는 관리자 행위이고, 이 표는 "누가·언제·어느 딜러 값을·무엇에서"를
// 남긴다. catalog.trims엔 discount_updated_at만 있어 **누가 바꿨는지가 남지 않는다** — 그 공백을
// 메우는 게 이 테이블의 존재 이유다(딜러 = 외부 인원이고 그 값이 앱 고객에게 보인다).
// source_dealer_user_id = NULL 이면 관리자 직접 입력(TrimEditPanel 경로).
// previous_amount는 되돌리기 근거로만 남긴다(undo는 이번 범위 밖).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.3
export const catalogDiscountAdoptions = crm.table(
  "catalog_discount_adoptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trimId: bigint("trim_id", { mode: "number" }).notNull(), // → catalog.trims.id(loose id)
    field: text("field").notNull(), // 'financial' | 'partner' | 'cash'
    amount: integer("amount"), // 채택된 금액. null = "비움"을 채택
    previousAmount: integer("previous_amount"), // 직전 catalog 값
    sourceDealerUserId: uuid("source_dealer_user_id"), // NULL = 관리자 직접 입력
    adoptedBy: uuid("adopted_by").notNull(), // → public.profiles.id(채택한 관리자)
    adoptedAt: timestamp("adopted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("catalog_discount_adoptions_field_check", sql`${table.field} in ('financial','partner','cash')`)],
);
```

- [ ] **Step 2~4: 생성 → 육안 검사 → 적용**

```bash
bun run db:generate && cat drizzle/0041_*.sql
```

⚠️ **`CREATE TABLE "crm"."catalog_discount_adoptions"` + CHECK 외에 아무것도 없어야 한다.**
`DROP`이 한 줄이라도 있거나 `public.`/`catalog.` 스키마가 나오면 **즉시 중단**(공유 master다).

```bash
bun run db:migrate
set -a && source .env.local && set +a && psql "$DATABASE_URL" -X -c "\d crm.catalog_discount_adoptions"
```

- [ ] **Step 5: 커밋** — `feat(crm): crm.catalog_discount_adoptions 테이블 — 필드 단위 채택 감사 (0041)`

---

### Task 2: 상태 파생 순수 함수 + 단위테스트

**Files:** Create `client/src/lib/discount-adoption.ts` · `client/src/lib/discount-adoption.test.ts`

> 서버→클라 순수 모듈 import 경계(AGENTS.md)에 맞춰 **클라 lib에 두고 서버가 import**한다.
> 부작용 0 순수 함수라 그 경계에 허용된다(`quote-write-access.ts` 등 선례).

- [ ] **Step 1: 실패 테스트 먼저** (`discount-adoption.test.ts`, vitest — `test:unit`이 잡는다)

판정 3케이스 + 자격 상실:

```ts
import { describe, expect, test } from "vitest";

import { proposalState } from "./discount-adoption";

describe("proposalState", () => {
  test("채택됨 — 최신 채택의 출처가 이 딜러이고 금액도 같다", () => {
    expect(proposalState({ proposalAmount: 6_500_000, adoptedAmount: 6_500_000, adoptedFromThisDealer: true })).toBe("adopted");
  });

  test("수정됨 — 출처는 이 딜러인데 제안 금액이 달라졌다(재채택 필요)", () => {
    expect(proposalState({ proposalAmount: 6_800_000, adoptedAmount: 6_500_000, adoptedFromThisDealer: true })).toBe("changed");
  });

  test("미채택 — 다른 딜러(또는 관리자 직접)가 채택된 상태", () => {
    expect(proposalState({ proposalAmount: 6_200_000, adoptedAmount: 6_500_000, adoptedFromThisDealer: false })).toBe("none");
  });

  test("미채택 — 아직 아무것도 채택되지 않았다", () => {
    expect(proposalState({ proposalAmount: 6_200_000, adoptedAmount: null, adoptedFromThisDealer: false })).toBe("none");
  });

  test("비움 채택도 '채택됨'이다(null == null)", () => {
    expect(proposalState({ proposalAmount: null, adoptedAmount: null, adoptedFromThisDealer: true })).toBe("adopted");
  });
});
```

- [ ] **Step 2: 구현**

```ts
// 딜러 제안 1건 × 할인 필드 1개의 상태. **컬럼을 두지 않고 조회 시 파생**한다(spec §4).
// 금액 대조를 쓰는 이유: 제안 행 updated_at 비교는 딜러가 **다른 필드만** 고쳐도 시각이 움직여
// 오탐이 난다. 필드 단위 금액 비교가 정확하다.
export type ProposalState = "adopted" | "changed" | "none";

export function proposalState(input: {
  proposalAmount: number | null;
  adoptedAmount: number | null;
  adoptedFromThisDealer: boolean;
}): ProposalState {
  if (!input.adoptedFromThisDealer) return "none";
  return input.proposalAmount === input.adoptedAmount ? "adopted" : "changed";
}
```

- [ ] **Step 3: 통과 확인 + 커밋** — `bun run test:unit client/src/lib/discount-adoption.test.ts`

---

### Task 3: 조회·채택 쿼리 + 실 DB 테스트

**Files:** Create `src/db/queries/discount-adoptions.ts` · `src/db/queries/discount-adoptions.test.ts`
· Modify `src/test-utils/db-bound-tests.ts`

- [ ] **Step 1: 실패 테스트 먼저** — 검증할 것 4가지

1. `listTrimProposals(trimId)` — 딜러 2명의 제안이 **딜러명·비고와 함께** 나오고, 각 필드 상태가 파생된다
2. `listTrimProposals` — `profiles.role`이 dealer가 아닌 제안자는 `isDealer: false`로 표시된다(자격 상실)
3. `adoptDiscount({trimId, field, sourceDealerUserId, adoptedBy})` — **트랜잭션**으로
   `catalog.trims`의 그 필드만 갱신 + 감사 1행 INSERT. `previous_amount`가 직전 값을 담는다
4. **`discount_updated_at`이 트리거로 갱신된다**(우리가 안 찍는데도 값이 바뀐다) —
   같은 값 재채택 시엔 **안 바뀐다**(멱등 확인)

⚠️ 픽스처: 딜러 프로필은 `upsertDealerProfile()`로 만들고(guard 오탐 회피), `afterAll`에서
`dealer_trim_discounts` · `dealerProfiles` · `catalog_discount_adoptions`를 정리한다.
⚠️ **`catalog.trims`를 되돌린다** — 테스트가 실 확정 할인을 바꾸므로 `afterAll`에서 원래 3금액으로
복원해야 한다(공유 master · 앱 고객에게 보이는 값이다). 원래 값을 `beforeAll`에 저장해 둘 것.

- [ ] **Step 2: 구현** — 핵심 계약

```ts
// 트림 1개의 전 딜러 제안 + 각 필드 상태(admin 전용 조회).
// profiles를 **읽기만** 한다(계약 준수 — staff.ts 선례): full_name = 딜러명, role = 자격 판정.
// 자격 상실(role != 'dealer')은 soft delete 컬럼 없이 read-through로 판정한다(spec §5).
export async function listTrimProposals(trimId: number, executor: Executor = getDefaultDb()) { … }

// 필드 단위 채택 — **한 트랜잭션**으로 ①updateTrim(해당 필드만) ②감사 INSERT.
// ⚠️ discount_updated_at은 넣지 않는다(트리거가 찍는다 — 위 "확정된 사실").
export async function adoptDiscount(
  input: { trimId: number; field: "financial" | "partner" | "cash"; amount: number | null; sourceDealerUserId: string | null; adoptedBy: string },
  executor: Executor = getDefaultDb(),
) { … }
```

- [ ] **Step 3: registry 등록 + 커밋**

---

### Task 4: 라우트 2개 (admin 전용)

**Files:** Modify `src/routes/catalog/trims.ts`(또는 신설 `src/routes/catalog/discounts.ts`)
· Create `src/routes/catalog.discount-adoptions.test.ts` · Modify registry

- [ ] **Step 1: 게이트 테스트 먼저** — dealer·staff·manager 403 / admin 200

```
GET  /api/catalog/trims/:id/discount-proposals   (admin)
POST /api/catalog/trims/:id/discount-adoptions   (admin)
```

⚠️ **`requireRoles(["admin"])`를 명시로 붙인다** — catalog 라우터엔 role 게이트가 없어서 staff도
쓸 수 있는 상태다. dealer는 dealerWriteGate가 이미 막지만(POST) **GET은 안 막는다** → 명시 필요.

- [ ] **Step 2: 구현 + 변이 검증** — `requireRoles` 제거 → 403 기대만 실패하는지 확인 → 원복 → clean

- [ ] **Step 3: 커밋**

---

### Task 5: 할인 셀 팝오버 (admin UI)

**Files:** Modify `client/src/pages/mc-master/trim-cells.tsx` · `client/src/pages/MCMasterPage.tsx`
· Create `client/src/lib/discount-proposals.ts`(조회·채택 훅) · Modify `client/src/styles/vehicle-admin.css`

- [ ] **Step 1: 훅** — `useTrimProposals(trimId | null)` 로드 + `adopt(field, dealerUserId)`.
      실패는 throw(셀이 상태 표시 — B2b 선례)
- [ ] **Step 2: 셀에 진입점** — admin 모드에서 할인 셀을 누르면 팝오버. **제안이 있는 셀에만 표시 단서**
      (개수 배지 또는 밑줄). 팝오버 닫기는 `usePopoverDismiss`(레포 공용) 사용
- [ ] **Step 3: 팝오버 본문** — spec §7.2 형태

```
자사할인 — 520i (MC070526005)
현재 확정: 6,500,000원(9.3%)  ← 출처: 동성모터스 · 2026-07-25 채택
──────────────────────────────────────────
동성모터스   권지현   6,800,000원(9.7%)  🟡 새 제안   [채택]
코오롱모터스 김ㅇㅇ   6,500,000원(9.3%)  ✅ 채택됨
(현재 딜러 아님) 이ㅇㅇ 7,000,000원        ⛔ 채택 불가
```

- [ ] **Step 4: 채택 후 갱신** — `reloadTrims()`(기존 훅)로 확정값을 다시 읽어 셀에 반영
- [ ] **Step 5: 커밋**

---

### Task 6: 검증 + PR

- [ ] 4종(typecheck·lint·knip·format) + `test:unit` + `test:pure` + `build`
- [ ] 실 DB 전량 + `bun run check:residue`
- [ ] **`catalog.trims` 원복 확인** — 테스트가 실 확정 할인을 건드렸다면 원래 값인지 psql로 확인
- [ ] PR 본문: 트리거가 스탬프를 찍는다는 사실 · 자격 상실 read-through 판정 · 변이 검증 결과 ·
      🟡 **채택은 앱 고객에게 보이는 값을 바꾼다**(실기 확인 시 대상 트림을 신중히 고를 것)

---

## 이번 범위 밖 (별건)

- **채택 되돌리기(undo)** — `previous_amount`를 남겨두므로 필요할 때 구현 가능
- **제안 도착 알림/배지** — MC 마스터 메뉴에 "대기 N건" 형태(딜러가 늘면 필요)
- **조직 화면 저장 방식 통일** — 지금 조직 화면은 [저장] 버튼, 딜러 셀은 자동 저장(유슨생 판단 대기)
