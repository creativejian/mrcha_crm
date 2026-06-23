# 견적 수정 워크벤치 일원화 — PR3 (composer 완전 제거) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크벤치가 견적 작성·수정·OCR을 모두 대체했으므로, 죽은 composer 모달과 그 전용 상태/함수/CSS를 제거한다.

**Architecture:** 순수 제거. composer 모달 JSX + composer 전용 함수/state/파생/effect/외부 OCR 드롭존을 들어낸다. `recognizedQuoteFile`(워크벤치 OCR과 공유)·`editingQuoteId`·워크벤치 OCR 핸들러 3종은 보존한다. tsconfig에 `noUnusedLocals`가 없어 미사용은 typecheck가 아닌 **lint(@typescript-eslint/no-unused-vars)** 가 잡으므로, 각 단계 후 typecheck(참조 정합) + 최종 lint(미사용 0)로 안전을 확인한다. TDD 부적합(UI 제거) → 회귀 검증 중심.

**Tech Stack:** React, TypeScript, ESLint, Vitest/`bun test`(회귀).

---

## File Structure

- **Modify** `client/src/pages/CustomerDetailPage.tsx` — composer 제거(대부분)
- **Modify** `client/src/index.css` — composer 전용 CSS 보수적 정리

### 제거 대상 (composer 전용)
| 항목 | 현재 위치(머지 후 grep으로 재확인) |
|------|------|
| composer 모달 JSX | `{quoteComposerMode ? (` ~ `) : null}` (≈4893–5050) |
| `saveQuote` 함수 | ≈2237–2387 |
| `startQuoteFromOriginalFile` | ≈2664–2681 |
| `dropQuoteOriginalToComposer` | ≈2699–2707 |
| `selectQuoteOriginalFile` | ≈2709–2714 |
| state `quoteComposerMode` | 선언 ≈915 |
| state `selectedQuotePurchaseMethod` | 선언 ≈933 |
| state `quoteEntryMode` | 선언 ≈934 |
| state `isQuoteModalDragActive` | 선언 ≈937 |
| 파생 `quoteManualFieldConfig`/`quoteSolutionAvailable` | ≈1066–1067 |
| effect(quoteEntryMode guard) | ≈1513–1517 |
| 타입 `KimQuoteComposerMode`/`KimQuoteEntryMode` | 상단 type 정의 |
| 견적함 헤더 외부 OCR 드롭존 | `onDrop={dropQuoteOriginalToComposer}` + drag handlers + overlay (≈4395–4446 내 OCR 부분) |

### 보존 (워크벤치 공유/전용)
`recognizedQuoteFile`(935)·`editingQuoteId`(931)·`editingQuote`(파생)·`saveQuoteFromWorkbench`·`recognizeQuoteOriginalForWorkbench`·`selectQuoteWorkbenchOriginalFile`·`dropQuoteOriginalToWorkbench`·`isQuoteWorkbenchOriginalDragActive`·`solutionWorkbench*`·워크벤치 모달 JSX·`KimQuotePurchaseMethod` 타입(워크벤치도 사용).

### 조건부
`setQuoteComposerMode(null)` 호출 중 **4433·4732**는 줄만 제거(주변 워크벤치 초기화는 유지). 2319·2380·4903·5041은 제거 대상 블록(saveQuote/모달) 안이라 함께 사라짐.

---

## Task 1: composer 모달 JSX + 외부 OCR 드롭존 제거

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: composer 모달 JSX 블록 제거**

`{quoteComposerMode ? (` 로 시작하는 블록 전체(닫는 `) : null}`까지)를 삭제한다. (워크벤치 모달 `{isQuoteSolutionWorkbenchOpen ? (` 블록은 그 다음에 있으므로 건드리지 않는다.) 실행 시 `grep -n "quoteComposerMode ? ("` 로 시작 라인을, 그 블록의 대응 `) : null}` 로 끝 라인을 확인해 정확히 잘라낸다.

- [ ] **Step 2: 견적함 헤더 외부 OCR 드롭존 제거**

견적함 헤더(`<h3>견적함</h3>` 포함 컨테이너, ≈4395–4447)에서 OCR 드롭 관련만 제거하고 "견적 작성" 버튼/제목은 유지한다:
- `onDragEnter`/`onDragLeave`/`onDragOver`/`onDrop={dropQuoteOriginalToComposer}` 핸들러 제거
- `isQuoteHeaderDragActive` 관련 클래스·state가 이 드롭존 전용이면 함께 제거(grep `isQuoteHeaderDragActive` 로 다른 사용처 없음 확인 후)
- `.kim-file-drop-overlay`(견적함 헤더용 OCR 오버레이 div) 제거

*(헤더 드롭존이 복잡하면, OCR onDrop만 떼고 drag-active 시각효과는 남겨도 무방 — 핵심은 `dropQuoteOriginalToComposer` 진입 제거.)*

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 0 errors(참조 정합). 이 시점엔 `saveQuote`/`dropQuoteOriginalToComposer` 등이 미사용이 되지만 typecheck는 통과(noUnusedLocals 없음) — 다음 Task에서 제거.

---

## Task 2: composer 전용 함수 제거

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: 함수 4종 제거**

다음 함수 전체를 삭제한다(각 `function 이름(...) {` ~ 대응 닫는 `}`):
- `saveQuote`
- `startQuoteFromOriginalFile`
- `dropQuoteOriginalToComposer`
- `selectQuoteOriginalFile`

실행 시 `grep -n "function saveQuote\b\|function startQuoteFromOriginalFile\|function dropQuoteOriginalToComposer\|function selectQuoteOriginalFile"` 로 시작 라인을 잡고 각 함수 끝까지 삭제. (`saveQuoteFromWorkbench`·`selectQuoteWorkbenchOriginalFile`·`dropQuoteOriginalToWorkbench`는 보존 — 이름이 다르니 혼동 주의.)

- [ ] **Step 2: typecheck + lint**

Run: `bun run typecheck` → 0.
Run: `bun run lint` → 남은 미사용 state(`quoteComposerMode` 등)가 error로 보고됨(다음 Task에서 제거). 이 단계는 lint error가 "예상된 미사용 목록"인지 확인용.

---

## Task 3: composer 전용 state/파생/effect/잔여 호출부 제거

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: 잔여 `setQuoteComposerMode(null)` 줄 제거 (4433·4732)**

워크벤치 "+" 열기 onClick(≈4433)과 견적 수정 진입 onClick(≈4732)에서 `setQuoteComposerMode(null);` **한 줄만** 삭제한다. 주변 `setEditingQuoteId(null)`/`setManualQuoteCards(...)`/`setIsQuoteSolutionWorkbenchOpen(true)` 등은 유지. (grep `setQuoteComposerMode(null)` 으로 남은 2곳 확인.)

- [ ] **Step 2: composer 전용 state/파생/effect 제거**

- state 선언 제거: `quoteComposerMode`(915), `selectedQuotePurchaseMethod`(933), `quoteEntryMode`(934), `isQuoteModalDragActive`(937)
- 파생 제거: `quoteManualFieldConfig`(1066), `quoteSolutionAvailable`(1067)
- effect 제거: `quoteEntryMode` guard effect(≈1513–1517, `if (!quoteSolutionAvailable && (quoteEntryMode === ...))` 블록 + deps)

각 제거 전 grep으로 "다른 사용처 0"을 확인한다(워크벤치는 `solutionWorkbench*`를 쓰므로 영향 없음). `selectedQuotePurchaseMethod` 제거 시 `2677 setSelectedQuotePurchaseMethod("운용리스")`는 `startQuoteFromOriginalFile`(Task2에서 이미 삭제) 안이라 함께 사라졌어야 함 — 잔여 호출 있으면 그 줄도 정리.

- [ ] **Step 3: 미사용 타입 제거**

`KimQuoteComposerMode`·`KimQuoteEntryMode` 타입 정의를 제거한다(lint `no-unused-vars`가 잡으면). `KimQuotePurchaseMethod`는 워크벤치(`solutionWorkbenchPurchaseMethod`)가 쓰므로 보존.

- [ ] **Step 4: typecheck + lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0(미사용 0).
실패 시: 아직 참조가 남은 심볼이 있다는 뜻 → grep으로 사용처 찾아, 워크벤치 공유면 보존(제거 취소), composer 잔재면 제거.

---

## Task 4: 스크롤 잠금 / onEditorOpenChange 조건 정리

**Files:** Modify `client/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: `detailOverlayOpen`에서 quoteComposerMode 조건 제거**

스크롤 잠금 effect의 `detailOverlayOpen`(≈1059, PR1에서 추가)에서 `quoteComposerMode !== null ||` 줄을 제거한다(나머지 오버레이 조건 — previewDocumentId/previewQuoteId/previewSentQuoteId/`isQuoteSolutionWorkbenchOpen` — 유지).

- [ ] **Step 2: `onEditorOpenChange`에서 quoteComposerMode 제거**

`onEditorOpenChange?.(... quoteComposerMode !== null || ...)`(≈1508)에서 `quoteComposerMode !== null ||` 항을 제거하고, 같은 effect의 deps 배열(≈1510)에서 `quoteComposerMode`를 제거한다.

- [ ] **Step 3: typecheck + lint**

Run: `bun run typecheck` → 0 · `bun run lint` → 0.

---

## Task 5: composer 전용 CSS 보수적 정리

**Files:** Modify `client/src/index.css`

- [ ] **Step 1: composer 전용 클래스만 제거**

`client/src/index.css`에서 **composer 전용이 확실한** 클래스 규칙만 제거한다:
- `.kim-quote-builder-modal`
- 견적함 헤더 OCR 드롭존 전용(`.kim-quote-original-dropzone` 등, 워크벤치 `.kim-quote-workbench-*` 와 이름이 다른 것만)

**보존**: `.kim-quote-modal`·`.kim-quote-modal-backdrop`·`.kim-quote-modal-head`·`.kim-quote-modal-actions` 는 워크벤치 모달도 공유하므로 **건드리지 않는다**. 불확실한 클래스는 제거하지 말고 남긴다(죽은 CSS는 무해, 동적 클래스 오제거가 위험).

각 제거 전 `grep -rn "클래스명" client/src` 로 JSX 잔여 사용 0 확인.

- [ ] **Step 2: typecheck / lint / build**

Run: `bun run typecheck` → 0 · `bun run lint` → 0 · `bun run build` → OK(CSS 컴파일 확인).

---

## Task 6: 전체 검증 + 커밋 + PR

**Files:** 없음(검증·커밋만)

- [ ] **Step 1: 검증 4종 + build**

Run: `bun run typecheck` → 0 · `bun run lint` → 0 · `bun run test:unit` → PASS(224 유지) · `bun run test:server` → PASS(62 유지) · `bun run build` → OK.

- [ ] **Step 2: 브랜치 + 커밋(spec·plan 동봉)**

```bash
git checkout -b feat/crm-quotes-edit-workbench-pr3
git add client/src/pages/CustomerDetailPage.tsx client/src/index.css \
  ref/specs/2026-06-23-crm-quotes-edit-via-workbench-design.md \
  ref/plans/2026-06-23-crm-quotes-edit-workbench-pr3.md
git commit -m "$(cat <<'EOF'
refactor(crm): composer 견적 모달 완전 제거 (워크벤치 일원화 PR3)

- composer 모달 JSX + saveQuote/startQuoteFromOriginalFile/drop·selectQuoteOriginalFile 제거
- composer 전용 state(quoteComposerMode/quoteEntryMode/selectedQuotePurchaseMethod/isQuoteModalDragActive) + 파생/effect/타입 제거
- 견적함 헤더 외부 OCR 드롭존 제거. setQuoteComposerMode(null) 잔여 2곳 정리(워크벤치 초기화 유지)
- 스크롤 잠금/onEditorOpenChange의 quoteComposerMode 조건 제거
- recognizedQuoteFile·editingQuoteId·워크벤치 OCR(3핸들러)은 보존(공유)
- composer 전용 CSS(kim-quote-builder-modal 등) 보수적 정리

검증: typecheck 0 · lint 0 · test:unit 224 · test:server 62 · build OK
브라우저 실측(카카오 세션) — 견적 작성·수정·OCR 회귀

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: push + PR (머지는 브라우저 실측 후)**

```bash
git push -u origin feat/crm-quotes-edit-workbench-pr3
gh pr create --base main --head feat/crm-quotes-edit-workbench-pr3 \
  --title "refactor(crm): composer 견적 모달 완전 제거 (워크벤치 일원화 PR3)" \
  --body "<제거 요약 + 보존 목록 + 검증 + 브라우저 실측 체크리스트. skip-ci 토큰 금지. 머지는 워크벤치 실측 후>"
```

---

## 검증 한계

composer 제거는 typecheck(참조)+lint(미사용)+회귀로 "안 깨짐"을 강하게 보장하지만, **견적 작성/수정/OCR이 워크벤치 경로로 정상 동작하는지는 브라우저 실측(카카오 세션, 배포본)** 으로 확인해야 한다. 특히 OCR 원본인식(워크벤치 헤더 드롭)이 `recognizedQuoteFile` 보존으로 정상인지. 머지는 PR2c-1/2c-2 워크벤치 실측이 통과한 뒤에 한다.

## Self-Review (작성자 체크 결과)

- **Spec coverage:** spec "PR3 — composer 완전 제거" 전 항목(모달·상태·saveQuote·OCR composer 진입·스크롤 잠금 조건·CSS) 커버. OCR은 워크벤치 헤더 경로 유지(보존 목록 명시). ✅
- **Placeholder scan:** 제거 작업이라 "삭제 대상 심볼/블록 + 검증"으로 기술. 라인은 머지 후 shift되므로 grep 마커로 재확인 지시(placeholder 아님, 안전 절차). ✅
- **Type consistency:** 보존/제거 경계가 Explore 의존 그래프와 일치. `recognizedQuoteFile`/`editingQuoteId`/워크벤치 OCR 3핸들러/`KimQuotePurchaseMethod` 보존, composer 전용만 제거. ✅
- **주의:** tsconfig에 `noUnusedLocals` 없음 → 미사용은 lint가 안전망. 각 Task 후 typecheck(참조)+lint(미사용) 둘 다 확인해야 죽은 코드 0 보장. 워크벤치 공유 심볼을 실수로 지우면 typecheck가 즉시 error로 잡음(복원 신호).
