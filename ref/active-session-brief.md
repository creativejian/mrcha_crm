# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-12

Purpose: `영실아 이어가자` 이후 현재 작업만 빠르게 복구하기 위한 압축 문서.

## Boot

1. Read this file first.
2. Run `git status --short --branch` and `git log --oneline --decorate --max-count=5`.
3. Read `ref/current-working-state.md` only if this is insufficient.
4. Do not read planning source files unless the task touches strategy, roadmap, AI policy, architecture, or quote engine decisions.

## Current Focus

- Scope: 김민준 customer detail drawer, `CU-2605-0020`.
- Current task: new quote workbench opened from the quote box header.
- Keep existing `견적 작성` button and old modal unchanged for reference.
- New workbench button sits left of the existing quote button.

## Files / State

- Main UI: `client/src/pages/CustomerDetailPage.tsx`
- Styles: `client/src/index.css`
- Handoff: `ref/active-session-brief.md`
- Recent base commit: `26439d5 feat: complete Kim quote box layout`
- Branch before compression: `main...origin/main [ahead 7, behind 5]`
- Modified: `CustomerDetailPage.tsx`, `index.css`, this brief.

## Workbench Modal

- `.kim-quote-solution-modal` is a right-side work area attached to the sidebar line:
  `inset: 0 0 0 234px`, no radius, stronger dim `rgba(15,23,42,.34)`.
- Layout is `flex column`:
  header `flex/height/min-height: 85px`, body scrolls, bottom action bar relative.
- Body shell: `.kim-quote-solution-shell { flex: 1 1 auto; overflow: auto; padding: 14px 14px 18px; }`.
- Closes by outside dim click and Esc. No X button.
- Uses `kim-workbench-sheet-in` animation.

## Header

- Copy:
  `고객 관리 > 김민준 CU-2605-0020 > 새 견적 작성`
  `최근 견적 3개 · Maybach S 500 · {구매방식} 60개월 견적 작성 필요`
- Left copy is absolute and vertically centered in the 85px header.
- Right controls are absolute at bottom-right:
  `구매방식 [운용리스 ▾] | 작성방식 [직접 입력 ▾]`
- Labels stay outside select boxes.
- Between purchase/method groups, keep one subtle vertical divider, 22px high.
- Do not reintroduce grouped box, segmented rail, or independent pill experiments.

## Selector Logic

- Purchase method defaults from Kim detail `상세 구매조건 > 구매방식` when opening.
- Entry method default: `직접 입력`.
- Entry dropdown order: `직접 입력 → 솔루션 조회 → 원본 인식`.
- Changing purchase method must not force `솔루션 조회`.
- Unsupported purchase methods only protect `솔루션 조회` back to `직접 입력`.
- `원본 인식` is allowed for every purchase method.

## Drop Overlay

- Workbench header is the original-quote drop target.
- Use existing `.kim-file-drop-overlay` strength.
- Header class: `.kim-quote-workbench-drop-overlay`.
- Must explicitly set `position: absolute; inset: 5px;`.
- Reason: `.kim-quote-workbench-head > * { position: relative; }` otherwise breaks the 5px inset.
- Text:
  `원본 견적서 인식`
  `첨부한 견적서의 값으로 자동 입력합니다`
- Icon: `FileUp size={22} strokeWidth={1.9}`.
- Header overlay text is smaller/lighter than document vault overlay due to short header height.

## Body

- Top common area mirrors Jeff solution:
  `차량 선택 / 옵션·컬러 / 할인 / 취득원가 설정 / 최종 가격`.
- Bottom: 3 quote comparison cards using lease/rent table grammar.
- `직접 입력` mode emphasizes actual proposal values such as 월 납입금, not seller/fee fields.
- Current mock: Maybach S-Class / S 500 / 운용리스 60개월.

## Verification / Next

- After DOM/TS changes, run `bun run typecheck`.
- Latest check before compression: `bun run typecheck` passed.
- Avoid Playwright for every small spacing tweak; use screenshots after larger stabilization.
- Next: continue visual QA of header/body spacing, then connect `견적함에 저장`.

## Collaboration

- User is `이사님`; assistant is `영실`.
- Judgment questions: give recommendation first, ask `적용할까요?`.
- Execution words like `응`, `해줘`, `적용해`, `진행하자`: implement directly.
