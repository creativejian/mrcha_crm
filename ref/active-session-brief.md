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
  `구매방식 [운용리스 ▾] | 작성방식 [수기 작성 ▾] | [초기화] [솔루션조회] [견적서보기] [견적함에 저장]`
- Labels stay outside select boxes.
- Between purchase/method/action groups, keep subtle vertical dividers, 22px high.
- Workbench has no bottom footer and no close button; close remains outside dim click and Esc.
- Do not reintroduce grouped box, segmented rail, or independent pill experiments.

## Selector Logic

- Purchase method defaults from Kim detail `상세 구매조건 > 구매방식` when opening.
- Entry method default: `수기 작성`.
- Entry dropdown order: `수기 작성 → 솔루션 조회 → 원본 인식`.
- Changing purchase method must not force `솔루션 조회`.
- Unsupported purchase methods only protect `솔루션 조회` back to `수기 작성`.
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
- `수기 작성` mode emphasizes actual proposal values such as 월 납입금, not seller/fee fields.
- Current mock: Maybach S-Class / S 500 / 운용리스 60개월.

## Latest Update

- Connected new workbench `견적함에 저장` to actual quote creation.
- Moved workbench action buttons from bottom footer into the header right tool cluster.
- Keep the header tool cluster on the lower toolbar line (`bottom: 12px`), not vertically centered.
- Header action order: 초기화, 솔루션조회, 견적서보기, 견적함에 저장. 솔루션조회/견적서보기 are intentionally muted for now.
- Header action button styling follows customer management top actions: 28px height, 6px radius, `padding: 0 11px 0 9px`, `gap: 6px`, no fixed widths; muted gray disabled-like buttons, purple primary save.
- Saved row defaults: Maybach S 500 4M Long, selected purchase method, 60개월, 우리금융캐피탈, 월 2,398,000원, D-6.
- Source/meta follow entry mode: 수기 작성, 솔루션 조회, or 원본 인식 후 보정.
- If an original file was attached in the workbench, it is carried into the saved quote row.
- Jeff design package received at `/Users/jian/Downloads/jeff-design.zip`; extracted inspection copy used `/tmp/jeff-design`.
- Use Jeff design only inside the quote workbench/modal body. Do not apply it to other CRM screens or global CRM components.
- Relevant Jeff files: `QuoteRevolutionV2.tsx`, `redesign/TopSelectionCards.tsx`, `redesign/ConditionCards.tsx`, `index.css`, `quote-bottom-bar/QuoteBottomBar.tsx`.
- Jeff package uses Tailwind v4/shadcn/base-nova; do not copy its global `index.css` wholesale into CRM. Translate needed visual rules into scoped `.kim-quote-*` CSS.
- Applied Jeff visual language only under quote modal body wrapper `.kim-jeff-quote-body`; modal header and CRM-wide UI remain untouched.
- Jeff top body area now follows source proportions: top 3 equal columns, lower 2 equal columns, 2px dividers, emoji section titles, fixed 400px common-panel height.
- Jeff body controls were tightened: segmented buttons/input boxes reduced to ~90% height, radius softened to 4px, and money displays split number/unit so summary rows and input suffixes share the same unit spacing.
- Jeff money inputs now use a replace-preview interaction: focus puts the caret before the existing value, dims the value, and the first typed/pasted input replaces the old value without manual deletion.
- Briefly tried adding Mr. Cha purple to Jeff body active states, then reverted. Quote modal body should stay as close to Jeff visual language as possible for now; branding polish is deferred.
- Manual 운용리스 lower body no longer uses 3 comparison cards. It now focuses on `세부 견적 작성` as the source data for multiple outputs. App card preview is not shown in the main body; it opens from the header `앱카드보기` action as a separate modal. `견적서보기` and `앱카드보기` should eventually render two customer-facing outputs from the same draft data.
- Quote output actions are draft-gated. Until `세부 견적 작성` is saved, header `견적서보기`/`앱카드보기`/`견적함에 저장` stay disabled-feeling and show validation/save guidance. `견적 저장` validates missing/placeholder fields such as exterior/interior `미선택`; after save, `앱카드보기` turns green and opens the app-card modal. Any later top/body input change marks the draft dirty and changes the form button to `변경된 조건으로 저장`.
- `핵심 견적 값` in manual 운용리스 now uses Jeff-style condition controls instead of plain inputs: fixed purchase method, finance select, lease term segmented control, deposit/down payment/residual segmented+input, mileage segmented+select, tax/subsidy segmented controls, readonly calculated totals/rate, and manual monthly payment.

## Verification / Next

- After DOM/TS changes, run `bun run typecheck`.
- Latest check: `bun run typecheck` passed after Jeff money input replace-preview behavior.
- Avoid Playwright for every small spacing tweak; use screenshots after larger stabilization.
- Next: continue visual QA of header/body spacing, then decide whether saved workbench rows should stay draft or trigger app-send confirmation.

## Collaboration

- User is `이사님`; assistant is `영실`.
- Judgment questions: give recommendation first, ask `적용할까요?`.
- Execution words like `응`, `해줘`, `적용해`, `진행하자`: implement directly.
