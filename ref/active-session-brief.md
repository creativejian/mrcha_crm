# Mr. Cha CRM Active Session Brief

Last updated: 2026-06-15

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
- 2026-06-15 (PR #13, branch `feat/quote-price-injection`): 트림 선택 → 가격 패널 **1단계 연결 완료**. `VehiclePicker onChange` → `fetchTrimDetail`로 기본가←`trim.price`, 할인←`financialDiscountAmount`, 옵션←0 자동 채움. 최종차량가/등록비용/기타비용/취득원가 합산은 `client/src/lib/quote-pricing.ts`(순수함수, `computePricing`) 자동 재계산, summary는 React state 파생. 입력 input은 uncontrolled 유지(Jeff money UX 보존), 재계산 트리거는 패널 `onInput` + money `blur` + 자동채움 직후. 식별자는 `data-pricing="base|option|discount|acquisitionTax|bond|delivery|incidental"`. DB 변경 0 (catalog read-only SELECT만). 취득세 공식·옵션/컬러 선택·구매방식별 할인 매핑·segment 토글은 2단계. 설계/계획: `ref/specs/2026-06-15-quote-price-injection-design.md`, `ref/plans/2026-06-15-quote-price-injection.md`.
- 2026-06-15 (PR #14, #15): 옵션 선택 **2단계 + excludes UX 완료**. `OptionPicker`(다중선택 드롭다운)로 trim의 basic/tuning 옵션 선택 → `option-selection.ts`(`resolveSelection`/`optionTotal`/`disabledOptionIds`/`excludeGroups`/`excludePartners`, 순수·TDD) → 옵션 합계를 `data-pricing="option"` input에 반영 → 1단계 `recompute`. **basic도 유료 제조사 옵션**(데이터 검증: trim_options 6,737개 중 99.6% 유료)이라 선택·합산 대상. excludes는 **비활성화 UX**(미스터차 앱 정합): 배타그룹 색점(6색 순환) · 선택 시 같은 그룹 회색 disabled · "⇄ ○○와 중복 선택 불가" 설명 · 상단 안내. includes는 자동추가(한 단계) 유지. 트림 변경 시 `key`로 재마운트 초기화. 설계/계획: `ref/specs|plans/2026-06-15-quote-option-selection*`, `…-quote-option-exclude-ux*`. **교훈: DB 컬럼/enum 의미는 구현 전 실제 샘플로 검증**(basic 가정 오류 사례).
- 2026-06-15: After pulling remote option/price work, reapplied the lower manual form UI: `세부 견적 수기 입력` and `추가 안내 사항` are equal split sections with independent navy headers and a 2px gray center divider. `추가 안내 사항` uses a Jeff-style row table with matching 38px row rhythm (`label | control`), not label-above form styling.
- 2026-06-15: Lower manual form sections now follow the same vertical rhythm as upper Jeff panels: no body top/bottom padding after the navy header; rows start immediately and keep only the 20px side inset.
- 2026-06-15: Discount section now supports additional discount rows without changing the section shell. Base `할인 금액` row stays unlabeled; `+` adds labeled rows such as 재구매/법인 추가 with amount/% controls and delete. Row amounts are summed into existing `data-pricing="discount"` final discount input, preserving quote-pricing recompute.
- 2026-06-15: Acquisition tax row now has `일반 / 하이브리드 감면 / 전기차 감면 / 직접 입력`; automatic modes render the amount as readonly calculated UI, and only `직접 입력` enables money editing.
- 2026-06-15: Manual quote entry direction changed from one-condition form to max 3-condition comparison, matching Jeff CRM/Solution output shape. New `견적 작성 1~3` columns now sit at the top of the manual section using the same single-panel/3-column/2px-divider grammar as the upper Jeff panels, not card-inside-card. The previous split form (`기존 세부 견적 수기 입력` + `추가 안내 사항`) is kept below as a legacy/reference block. Header quote action now has only one `견적 작성` button, opening the workbench with a document-plus icon; the old modal entry button was removed.
- 2026-06-15: Workbench header action order changed to `초기화` / `작성완료` | `솔루션조회` / `견적서보기` / `앱카드보기` / `견적함에 저장`. `작성완료` runs the draft save/validation that used to live inside the manual section header, and the manual section's duplicate save button was removed.
- 2026-06-15: Manual quote condition inputs now reuse the upper Jeff panel money grammar: numeric value inside input, unit in separate `<em>` (`원`/`%`), lighter input font weight, and subsidy `비해당` amount rendered readonly with `0 원`.
- 2026-06-15: In `견적 작성 1~3`, non-period segment controls now use the same total width ending at the `24개월` tab boundary, while value inputs/selects start at the `48개월` boundary. Finance/mileage/additional-discount selects use right-aligned text and CSS chevrons aligned with the `원/%` unit position.
- 2026-06-15: In upper `취득원가 설정`, keep the 4-tab acquisition-tax control wide for readability, but align `공채`/`탁송료`/`부대비용` 2-tab controls to the same segment-width grammar.
- 2026-06-15: `견적 작성 1~3` typography was aligned to the upper Jeff panels: section header `14px/500`, row labels `12px/500`, segment text `12px/500`, select text `500`; avoid the earlier heavier `650` labels/headings.
- 2026-06-15: In `견적 작성 1~3`, `월 납입금` now sits directly below `보조금` as the primary emphasized row. The remaining output values sit below it as a compact 2x2 horizontal row grid: `반납 총비용`/`인수 총비용`, `출고 전 납입`/`금리`.
- 2026-06-15: `월 납입금` row is visually emphasized with a subtle full-width gray band, while the 2x2 calculated result grid below uses a lighter disabled/calculated background. Intent: monthly payment is the advisor-entered primary value; the four values below are read-only/auto-calculated.
- 2026-06-15: Manual condition value boxes share `--kim-manual-value-width`, matching the upper rows where value boxes start at the `48개월` boundary. The calculated result area must use a 4-column row grammar (`label/value/label/value`), not two independent half cards, otherwise equal-width value boxes drift. `월 납입금` is a `.kim-manual-compare-row`, not a `<label>`, so clicking the gray row background does not enter replace-preview edit mode; only the input box click should.
- 2026-06-15: Each `견적 작성 1~3` condition now has a bottom save button (`n번 조건 저장`). Saving one condition only locks that card, applies `is-saved` disabled styling, disables its body controls, changes the bottom button to `n번 조건 저장됨`, and adds a header `수정` button before `재입력`. Card 1 still has no copy button; cards 2/3 keep their copy button.
- 2026-06-15: Only the bottom `n번 조건 저장` button was compacted (34px height, 13px text). Do not shrink the rest of the manual condition card typography/row/control heights unless explicitly requested.
- 2026-06-16 (PR #17): 외장/내장 **색상 선택 완료**. `ColorPicker`(controlled, `colorType`로 외장/내장 재사용, hex 스와치 단일선택)로 `trimDetail.colors`에서 선택 → 🎨 섹션 버튼 + 앱카드/견적 `외장/내장 컬러` 반영. `colors`=트림별 기본 팔레트(exterior 7,914/interior 2,569, hex+code 완비, 한글 82%/영문 18% 원본명, **가격 무관**). 유료 매트 도장은 `trim_options` 외장컬러와 별개(겹치지 않음). 트림 변경 시 state 초기화(controlled라 key 불필요). 차량→가격→옵션→색상 구성 완성. 설계/계획: `ref/specs|plans/2026-06-16-quote-color-selection*`.
- 2026-06-16 (브랜치 `feat/catalog-sync`): **작업 트랙 전환 → catalog 거울 sync**. quote 할인/취득세 공식은 **master secret key가 막혀 보류**(현재 `MRCHA_MASTER_PUBLISHABLE_KEY`만 있어 차량 테이블 read만 됨, 전체 스키마/RPC·Edge Function 조사 불가 → 이사님께 master service_role 키 요청 필요). sync 코어(1단계) **설계·spec 완료, brainstorming까지만 진행 후 compact 예정**. 데이터 검증: master는 **hard-delete**(`deleted_at` 없음) + `updated_at`은 `trims`에만 → **full sync**(전체 비교, 증분 불가). 설계: 화이트리스트 fetch + Range 페이징(`Prefer: count=exact`) → catalog drizzle `onConflictDoUpdate`(`deleted_at=NULL` 부활) + master에 없는 id soft-delete(**total 검증 통과 시만**). conflict target 대부분 `id`, `trim_no_options`만 `trim_id`. 코어 CLI(`bun run sync`) 먼저, UI 버튼은 2단계. spec: `ref/specs/2026-06-16-catalog-sync-design.md`. **다음(compact 후): `feat/catalog-sync`에서 writing-plans → 구현(`src/sync/` sync-diff TDD + master-client + sync.ts).**

## Verification / Next

- After DOM/TS changes, run `bun run typecheck`.
- Latest check: `bun run typecheck`, `bun run lint`, and `bunx playwright test tools/customer-detail-screenshot.spec.ts --project=chromium` passed after adding the 3-condition manual quote cards and removing the old quote modal entry button.
- Avoid Playwright for every small spacing tweak; use screenshots after larger stabilization.
- 2026-06-16 검증: `typecheck`/`lint` 0, `test:unit` 45 passed, `build` 성공. 가격/옵션/excludes/색상 모두 브라우저 확인 + main 머지(PR #13~17). 이사님 수기 3조건 UX(commit `1a4228a`)도 merge됨.
- Next (다음 단계): 구매방식별 할인 매핑(financial/partner/cash)·취득세 공식 자동계산 — **이사님 할인 다중행·취득세 4탭 UI(`1a4228a`) 위에 실제 계산 연결**, segment 토글 재분류, 가격 패널·옵션·컬러 통합 컴포넌트 추출, 견적 저장(quotes 스키마). 별개로 header/body spacing QA, saved workbench draft/app-send 흐름.

## Collaboration

- User is `이사님`; assistant is `영실`.
- Judgment questions: give recommendation first, ask `적용할까요?`.
- Execution words like `응`, `해줘`, `적용해`, `진행하자`: implement directly.
