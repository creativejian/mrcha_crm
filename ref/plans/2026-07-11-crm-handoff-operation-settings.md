# 실시간 상담 운영 설정 구현 계획 (2026-07-11)

spec: `ref/specs/2026-07-11-crm-handoff-operation-settings-design.md` (계약·결정·검증 SSOT — 이 파일은 작업 순서만)

서버(src/) 변경 0 · 전부 클라 supabase-js. 직접 구현(클라 전용·접점 명확 — subagent 분해 실익 없음).

## Task 1 — 상수 + lib + 유닛 (TDD)

- `client/src/data/chat.ts`: `HANDOFF_MODES`/`HANDOFF_MODE_LABELS`/`HANDOFF_DAY_KEYS`/`HANDOFF_DAY_LABELS`
- `client/src/lib/handoff-settings.ts`: 타입 + fetch/save/audits/subscribe + 순수 함수 3종
  (`parseWeekSchedule`·`scheduleDraftErrors`·`availabilityBadge`)
- `client/src/lib/handoff-settings.test.ts`: 순수 함수 유닛(파싱 방어·검증·배지 파생) — RED 먼저

## Task 2 — HandoffOperationPage + CSS

- `client/src/pages/HandoffOperationPage.tsx`: 상태 카드 → 모드 세그먼트 → 요일 7행 → 문구 2 →
  사유+저장 → 이력. draft dirty 규칙·Realtime 재시드 규칙은 spec §3.
- CSS: `client/src/styles/settings.css`에 `handoff-op-*` 블록 추가(콘솔 톤 — 기존 settings/vehicle-admin 문법)

## Task 3 — 배선

- `App.tsx`: ViewKey/VIEW_TO_PATH/viewMeta/Route(admin 게이트 finance 패턴)
- `Topbar.tsx`: "차선생 앱 설정" 그룹 맨 아래 메뉴 행 + `SettingSolidIcon` 신규 name

## Task 4 — ChatPage 배지

- `client/src/components/chat/HandoffStatusBadge.tsx`: 판정 1회 + Realtime 재판정 + 60s 인터벌,
  admin 클릭 이동. `ChatPage.tsx` chat-tabs 행에 장착(roleTab prop 필요 — App에서 전달).

## Task 5 — 검증·스모크·PR

- 4종 + 격리 스택 브라우저 스모크(spec §검증 — psql 원복·감사 행 삭제까지) + PR(squash 대상, [skip ci] 금지)
