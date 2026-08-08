# 키보드 단축키 구현 계획 (2026-08-08)

설계 SSOT = `ref/specs/2026-08-08-crm-keyboard-shortcuts-design.md`. 이 문서는 **실행 순서와 검증
지점**만 담는다(스펙과 중복 서술 금지 — 배정표·근거는 스펙을 본다).

**전 태스크 TDD**: RED 실관찰 → 최소 구현 → GREEN → 커밋. 태스크 경계 = 커밋 경계.

## 파일 배치

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `client/src/lib/nav-visibility.ts` | role → 메뉴 가시성 판정 SSOT | 신규 |
| `client/src/lib/keyboard-shortcuts.ts` | 레지스트리(데이터) + role 필터 + 시퀀스 매칭 | 신규 |
| `client/src/hooks/useKeyboardShortcuts.ts` | 전역 리스너 + 가드 5종 | 신규 |
| `client/src/components/KeyboardShortcutsPanel.tsx` | 패널 UI(검색) | 신규 |
| `client/src/components/Sidebar.tsx` | `canView*` 로컬 계산 → SSOT import | 수정(순수) |
| `client/src/components/Topbar.tsx` | 훅 설치 · 패널 렌더 · 액션 매핑 | 수정 |
| `client/src/App.tsx` | `onShortcutNavigate` prop 전달 | 수정 |

## Task 1 — `nav-visibility.ts` 추출 (동작 변경 0)

**왜 먼저**: 단축키 role 필터가 이걸 import한다. 순서를 뒤집으면 판정이 두 벌 생긴다.

- 현재: `Sidebar.tsx:144-145`의 `canViewAdminMenu` / `canViewTeamMenu` 로컬 계산
- 추출: `canViewAdminMenu(role)` · `canViewTeamMenu(role)` · `isDealer(role)` 순수 함수
- 테스트: 4 role × 3 함수 진리표 12케이스
- **검증**: 기존 `Sidebar` 테스트가 **무수정으로 통과**해야 한다(순수 추출의 증거)
- 커밋: `refactor(crm): 메뉴 가시성 판정을 nav-visibility SSOT로 추출`

## Task 2 — 레지스트리 + role 필터

- `SHORTCUTS: Shortcut[]` (스펙 §2 배정표 전량) + `visibleShortcuts(role)`
- `label`은 `(role) => string` — `G M`만 role 분기(내부 "MC 마스터" / 딜러 "할인 업데이트")
- 테스트: **role별 id 집합**을 통째로 잠근다(개수만 세면 교체를 못 잡는다)
  - 딜러 3 · 상담사 15 · 팀장 20 · 최고관리자 22
  - 딜러 집합 = `{shortcuts-panel, toggle-sidebar, nav-mc-master}` 정확히
- 커밋: `feat(crm): 단축키 레지스트리와 role 필터`

## Task 3 — 시퀀스 매칭 (순수 상태머신)

```ts
type SequenceState = { prefix: string | null; at: number | null };
matchKeyEvent(state, ev: {code, key, shiftKey, metaKey, ctrlKey, altKey}, now, shortcuts)
  → { next: SequenceState; hit: Shortcut | null }
```

- **`event.code` 1차 판정**(스펙 §3.4) — `key`는 `?` 등 레이아웃 흡수용 폴백
- 타임아웃 1.5초는 `now` 인자로 주입(테스트가 시계를 소유 — `Date.now()` 직접 호출 금지)
- 테스트: `G`→`C` 성공 · 1.5초 초과 리셋 · modifier 동반 리셋 · 미등록 `G`→`Z` 무시 ·
  **한글 모드**(`key:"ㅎ", code:"KeyG"`) 매칭 · `⌘K` 단발 매칭
- 커밋: `feat(crm): 단축키 시퀀스 매칭 상태머신`

## Task 4 — `useKeyboardShortcuts` 훅

가드 5종(스펙 §4)을 여기서만 판정한다. 순수 판정은 `shouldIgnoreKeyEvent(target, isComposing, panelOpen)`로
분리해 테스트한다(훅 자체는 리스너 등록/해제만).

- 테스트: input·textarea·contentEditable·`isComposing`·패널 열림 5케이스 무시, 그 외 통과
- 커밋: `feat(crm): 전역 단축키 리스너 훅`

## Task 5 — 패널 UI

- `role="dialog"` + `aria-modal` + `usePopoverDismiss`(Esc·외부클릭) — 기존 팝오버 4종과 동형
- 그룹 2개(GLOBAL ACTIONS · NAVIGATION) + 검색 입력(레지스트리 label 필터)
- 키 표기: `⇧?` · `⌘K` · `G then C`
- 테스트: role별 렌더 항목 수 · 검색 필터 · 빈 결과 문구
- 커밋: `feat(crm): 단축키 패널 UI`

## Task 6 — Topbar·App 배선

- Topbar: 훅 설치(`roleTab` 전달) · 패널 상태 · 액션 5종 매핑
  (검색 `setGlobalSearchOpen` · 업무 AI `openWorkAi`/`closeWorkAi` · 계산기 `setCalculatorOpen` ·
   알림 `setNotificationsOpen` · 사이드바 `onToggleSidebar`)
- App: `onShortcutNavigate={(path) => navigate(path)}` prop 추가
- ⚠️ 액션 토글은 **기존 상호배타 로직 재사용**(팝오버가 서로를 닫는 규칙 — `openSettingsMenu` 참조).
  새 경로가 그 규칙을 우회하면 두 팝오버가 동시에 열린다
- 커밋: `feat(crm): 단축키 Topbar 배선`

## Task 7 — 드리프트 파리티

사이드바가 그리는 네비게이션 대상 집합 ↔ 레지스트리 `group:"navigation"` 집합을 **양방향** 대조.

- 한쪽에만 있으면 실패: 메뉴 추가 후 키 미부여 / 화면 없는 곳에 키 부여
- 딜러 목적지 없는 3개는 **양쪽 모두에서 제외**되는 것까지 단언
- 커밋: `test(crm): 사이드바↔단축키 드리프트 파리티`

## 마지막 — 변이 실증 3종 (커밋 없음, 원복 확인)

| 변이 | 기대 |
|---|---|
| `visibleShortcuts`의 role 필터 제거 | 딜러 집합 테스트 RED |
| IME `isComposing` 가드 제거 | 가드 테스트 RED |
| 시퀀스 타임아웃 비교 제거 | 타임아웃 테스트 RED |

⚠️ 변이 원복은 `git checkout`이 아니라 **수동 역편집**(08-08 교훈 — 같은 파일의 미커밋 수정이 날아간다).

## 검증 (PR 전)

`typecheck` · `lint` · `knip`(신규 export 다수 — 필수) · `format:check`(테스트 파일 다수) · `test:unit`

## 실기 확인 (스펙 §3.4)

한글 입력 모드에서 `G` `H` · `?` · `⌘K` 3종 — Safari·Chrome. 코드 논리만으로 단정하지 않는다.
