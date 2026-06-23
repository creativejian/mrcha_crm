# 견적 수정 워크벤치 일원화 — PR1 (읽기 어댑터 catalog FK 노출) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적 읽기 어댑터(`CustomerDetailQuote`/`KimQuoteItem`/`toKimQuoteItem`)에 catalog FK(`trimId`/`exteriorColorId`/`interiorColorId`)를 노출해, 이후 PR2(워크벤치 수정모드)에서 차량/색상을 catalog로 복원할 데이터 기반을 만든다.

**Architecture:** 백엔드 `getCustomer`는 이미 `quotes` 전체 컬럼을 camelCase로 직렬화해 보낸다(`src/db/queries/customers.ts:103` `select()`, `routes/customers.ts:41`이 결과를 변형 없이 `c.json`). 따라서 변경은 **프론트 어댑터 한 파일**에 국한된다 — 타입에 FK 3개를 추가하고 `toKimQuoteItem`이 통과시키기만 하면 된다. UI 변화·마이그레이션 없음.

**Tech Stack:** TypeScript, React, Vitest(단위), `bun test`(서버), drizzle.

---

## File Structure

- **Modify** `client/src/lib/kim-quote.ts`
  - `CustomerDetailQuote`(API 응답 타입)에 `trimId: number | null`, `exteriorColorId: number | null`, `interiorColorId: number | null` 추가
  - `KimQuoteItem`(UI 타입)에 `trimId?: number`, `exteriorColorId?: number`, `interiorColorId?: number` 추가
  - `toKimQuoteItem`에 3필드 매핑(`?? undefined`) 추가
- **Modify** `client/src/lib/kim-quote.test.ts`
  - `makeQuote` fixture에 새 필수 필드 기본값(`null`) 추가
  - FK 매핑/폴백 테스트 추가
- **확인(변경 없음)** `src/db/queries/customers.ts`, `src/routes/customers.ts` — 이미 전체 컬럼 노출. PR1에서 손대지 않음.

스키마 컬럼(참고, `src/db/schema.ts`): `trimId: bigint("trim_id", {mode:"number"})`, `exteriorColorId: bigint("exterior_color_id", ...)`, `interiorColorId: bigint("interior_color_id", ...)` — drizzle이 camelCase로 직렬화하므로 응답 키는 `trimId`/`exteriorColorId`/`interiorColorId`.

---

## Task 1: 어댑터 타입에 catalog FK 추가

**Files:**
- Modify: `client/src/lib/kim-quote.ts:66-104` (`CustomerDetailQuote`), `client/src/lib/kim-quote.ts:4-44` (`KimQuoteItem`)

- [ ] **Step 1: `CustomerDetailQuote`에 FK 3필드 추가**

`client/src/lib/kim-quote.ts`의 `CustomerDetailQuote`에서 `options:` 줄 **위**(가격 스냅샷 블록)에 추가한다:

```typescript
  finalVehiclePrice: string | null;
  acquisitionCost: string | null;
  // PR1: catalog FK(워크벤치 수정모드 차량/색상 복원용). bigint mode:"number"라 number|null.
  trimId: number | null;
  exteriorColorId: number | null;
  interiorColorId: number | null;
  options: { id: number; name: string; price: number | null }[] | null;
```

- [ ] **Step 2: `KimQuoteItem`에 FK 3필드 추가**

`client/src/lib/kim-quote.ts`의 `KimQuoteItem`에서 `// #4c-2 표시용 가격/색상` 블록 끝(`interiorColorHex?: string;` 다음)에 추가한다:

```typescript
  interiorColorHex?: string;
  // PR1: catalog FK(PR2 워크벤치 수정모드 prefill에서 소비)
  trimId?: number;
  exteriorColorId?: number;
  interiorColorId?: number;
```

- [ ] **Step 3: typecheck로 fixture 누락 확인**

Run: `bun run typecheck`
Expected: FAIL — `kim-quote.test.ts`의 `makeQuote` 반환 객체가 `trimId`/`exteriorColorId`/`interiorColorId`를 빠뜨려 `CustomerDetailQuote`에 할당 불가 에러. (이게 다음 스텝에서 fixture를 고칠 신호다.)

---

## Task 2: 테스트 fixture 보강 + FK 매핑 (TDD)

**Files:**
- Modify: `client/src/lib/kim-quote.test.ts:7-48` (`makeQuote`), 테스트 추가
- Modify: `client/src/lib/kim-quote.ts:177-212` (`toKimQuoteItem`)

- [ ] **Step 1: `makeQuote` 기본값에 FK 추가**

`client/src/lib/kim-quote.test.ts`의 `makeQuote` 기본 객체에서 `acquisitionCost: null,` 다음 줄에 추가한다:

```typescript
    acquisitionCost: null,
    trimId: null,
    exteriorColorId: null,
    interiorColorId: null,
    options: null,
```

(기존 `options: null,` 줄은 중복되므로 위 블록으로 합쳐 한 번만 남긴다.)

- [ ] **Step 2: FK 매핑 실패 테스트 작성**

`client/src/lib/kim-quote.test.ts`의 `describe("toKimQuoteItem", ...)` 블록 안, `#4c-2 가격/색상 없으면 undefined` 테스트 **다음**에 추가한다:

```typescript
  it("PR1 catalog FK(trimId/색상 id) 있으면 number 매핑", () => {
    const k = toKimQuoteItem(makeQuote({ trimId: 1024, exteriorColorId: 7, interiorColorId: 12 }), NOW);
    expect(k.trimId).toBe(1024);
    expect(k.exteriorColorId).toBe(7);
    expect(k.interiorColorId).toBe(12);
  });

  it("PR1 catalog FK 없으면(null) undefined", () => {
    const k = toKimQuoteItem(makeQuote(), NOW);
    expect(k.trimId).toBeUndefined();
    expect(k.exteriorColorId).toBeUndefined();
    expect(k.interiorColorId).toBeUndefined();
  });
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts`
Expected: 새 테스트 2개 중 "있으면 number 매핑"이 FAIL — `k.trimId`가 `undefined`(아직 `toKimQuoteItem`이 매핑하지 않음). "없으면 undefined"는 우연히 PASS할 수 있음(아직 키 자체가 없어 undefined).

- [ ] **Step 4: `toKimQuoteItem`에 매핑 추가**

`client/src/lib/kim-quote.ts`의 `toKimQuoteItem` 반환 객체에서 `interiorColorHex: q.interiorColorHex ?? undefined,` 다음 줄에 추가한다:

```typescript
    interiorColorHex: q.interiorColorHex ?? undefined,
    trimId: q.trimId ?? undefined,
    exteriorColorId: q.exteriorColorId ?? undefined,
    interiorColorId: q.interiorColorId ?? undefined,
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `bun run test:unit client/src/lib/kim-quote.test.ts`
Expected: PASS (새 테스트 2개 포함 전부 통과).

---

## Task 3: 전체 검증 + 커밋

**Files:** 없음(검증·커밋만)

- [ ] **Step 1: typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 2: lint**

Run: `bun run lint`
Expected: 0 problems.

- [ ] **Step 3: 전체 단위테스트**

Run: `bun run test:unit`
Expected: PASS (기존 + 신규 2개; 총계가 직전 대비 +2).

- [ ] **Step 4: 서버 테스트(백엔드 무변 확인)**

Run: `bun run test:server`
Expected: PASS (변경 없음 — getCustomer 응답이 이미 FK를 포함하므로 회귀 없음).

- [ ] **Step 5: build**

Run: `bun run build`
Expected: OK.

- [ ] **Step 6: 브랜치 생성 + 커밋(spec·plan 동봉)**

이 PR1 브랜치에 spec/plan 문서도 함께 올린다.

```bash
git checkout -b feat/crm-quotes-edit-workbench-pr1
git add client/src/lib/kim-quote.ts client/src/lib/kim-quote.test.ts \
  ref/specs/2026-06-23-crm-quotes-edit-via-workbench-design.md \
  ref/plans/2026-06-23-crm-quotes-edit-workbench-pr1.md
git commit -m "$(cat <<'EOF'
feat(crm): 견적 읽기 어댑터에 catalog FK 노출 (견적 수정 워크벤치화 PR1)

- CustomerDetailQuote/KimQuoteItem에 trimId·exteriorColorId·interiorColorId 추가
- toKimQuoteItem 매핑(?? undefined) + 단위테스트 2건
- 백엔드 무변(getCustomer가 이미 quotes 전체 컬럼 직렬화) · 마이그레이션 없음 · UI 변화 없음
- PR2(워크벤치 수정모드)에서 차량/색상 catalog 복원의 데이터 기반

검증: typecheck 0 · lint 0 · test:unit · test:server · build OK

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: push + PR 생성**

```bash
git push -u origin feat/crm-quotes-edit-workbench-pr1
gh pr create --base main --head feat/crm-quotes-edit-workbench-pr1 \
  --title "feat(crm): 견적 읽기 어댑터에 catalog FK 노출 (견적 수정 워크벤치화 PR1)" \
  --body "<PR 본문: spec 링크 + 변경 요약 + 검증 결과. skip-ci 토큰 금지>"
```

---

## Self-Review (작성자 체크 결과)

- **Spec coverage:** spec "PR1 — 견적 읽기 어댑터에 catalog FK 노출" 전 항목 커버(타입 2곳·매핑·백엔드 확인·검증). ✅
- **Placeholder scan:** 코드 스텝은 모두 실제 코드. PR 본문만 실행 시 채움(문서 표준). ✅
- **Type consistency:** `CustomerDetailQuote`는 `number | null`(API 응답, drizzle bigint mode:number), `KimQuoteItem`은 `number | undefined`(optional, UI). 매핑은 `q.<fk> ?? undefined`로 null→undefined 일관. fixture 기본값 `null`. ✅
- **주의:** Step에서 `options: null,` 줄이 fixture에 이미 존재 → Task2 Step1에서 중복 제거(한 번만) 명시함.
