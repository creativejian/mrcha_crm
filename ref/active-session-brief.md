# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-31 (저녁)

## 지금 상태

**main 전량 green · 브랜치 0 · prod = CF Workers 전환 + Pages 폐기까지 완결**(PR `#412`·`#413`).
git push → **Workers Builds 자동 빌드·배포** 가동. wrangler 설정 = `wrangler.jsonc`. unit **1276**.

## 직전 세션 요약 (07-31 밤 · 유슨생 — 타깃 렌즈 배치)

- **fail-silent UI 경로 수색**(`#414` 계급, 감사 정책 기본형 · 에이전트 7 · 워킹트리 무손상).
  **상 0 · 중 1 · 하 9** — 수색이 낸 중 6건 중 **5건이 적대 검증에서 강등**(과장 회수).
  **#414 원형(앵커 미매칭 → 무경고 영구 hidden) 잔존 0건.** 판정 SSOT =
  `ref/plans/2026-07-31-crm-targeted-lens-batch.md`.
- **중 1건**(`d9ee4ff`): 드로어 3카드 확인 팝오버가 스크롤·리사이즈에 안 닫혔다(계약 "닫기는
  호출부 책임"을 목록만 이행). **실측 400px 스크롤 시 행 400px·팝오버 0px** → 확인창이 구매조건
  섹션 위에 떠 대상 오인. 공용 훅 `use-popover-viewport-close.ts`로 한 벌화 + 회귀 5케이스.
- **하 5건**(PR `#415`): ①계산기 "조회 완료" 오표시(`isVehicleReady` 가드) ②견적 CREATE 발송
  실패 미원복(UPDATE와 대칭 롤백) ③견적 temp id 무음 스킵 6함수(`blockedWhileQuoteSaving`
  +회귀 4) ④메모 팝오버 `ConfirmPopover` 이주 ⑤`heightDep` Boolean→문자열. +도달 불가 저장
  핸들러 2건 경고 주석.
- **`.va-disc-pop` 하→중 승격 후 수리**(PR `#416`): 딜러 계정으로 5 Series 마지막 트림(550e)에
  제안을 넣자 prod 즉시 재현 — **가시 0px·[채택] y=872로 뷰포트 800 초과 = 클릭 불가**.
  `useFixedPopoverPosition`(앵커 `.va-disc-cell`·align end) + `max-height:60vh` + 시프트 닫기.
  **flip-up 필수라 `popoverPosFromRect`(아래로만)를 쓰지 않았다.**
- ⚠️ **main 직행 사고**: 첫 커밋 push가 main까지 밀었다(병렬 세션 공유 워킹트리 + jj bookmark).
  이후 **SHA 고정 refspec**으로 재발 0. 재발 방지 = 메모리 `parallel-session-shared-worktree-git-race`.

## ▶ 다음

- **제프 서비스(mc.mrcha.app) 이사님 CF 계정 이전 + Workers 구축(08-01 예정 · 유슨생 확정)**:
  계획 공유문서 = `~/Downloads/2026-07-31-제프-CF-Workers-이전-계획.md`(8단계 절차·담당 포함).
  근거: Workers Custom Domain은 zone 동일 계정 필수 → 제프 계정 잔류 시 mc.mrcha.app 불가.
  이사님 결정 대기 = 제프 계정 접근 범위(멤버 권한이 거침). 레시피 = CRM plans 문서 그대로.
- ~~타깃 렌즈 배치~~ **완료(07-31 밤 · 후속 3PR까지 종결)** → 위 요약. 근거 =
  `ref/plans/2026-07-31-crm-targeted-lens-batch.md`. **잔여 = 죽은 상태 modifier 4종**(no-op 확인·
  제거/CSS복구 중 원 의도 불명). 구조 개선 후보 = `useQuoteList.quotes`가 `detail.quotes`와
  재동기화되지 않는 것(개별 롤백보다 근본 지점). ⚠️`#416` **prod 실기는 유슨생이 직접 확인 예정** ·
  검증용 딜러 제안(550e 자사200/제휴220/타사240만, 채택 전이라 확정 할인 무영향) 정리 여부도 판단 대기.
- ~~CF 잔여 권고~~ **전부 종결(07-31 저녁)**: rate limiting 가동(IP당 5회/10초·실측 429) ·
  AI Gateway 보류 · 프리뷰 Access 종결.
- 잔여 실기 확인(오전분 유지): ①`#410` 레이아웃(admin·팀장·딜러) ②팀장 폼 할인 섹션 부재
  +admin 폼 유지 ③교차 세션 실시간 ④PR `#404` 체크리스트 잔여.

## 대기

**이사님** = 기존 항목 그대로(07-29 브리프 → 아카이브).

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 승인 워크플로
상세 = `ref/specs/2026-07-30-crm-catalog-change-approval-design.md`(§3.1 정정 포함) · plans pr1~3.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).
