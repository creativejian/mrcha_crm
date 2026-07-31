# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-31 (저녁)

## 지금 상태

**main 전량 green · 브랜치 0 · prod = CF Workers 전환 + Pages 폐기까지 완결**(PR `#412`·`#413`).
git push → **Workers Builds 자동 빌드·배포** 가동. wrangler 설정 = `wrangler.jsonc`. unit **1272**.

## 직전 세션 요약 (07-31 밤 · 유슨생 — 타깃 렌즈 배치)

- **fail-silent UI 경로 수색 완료**(`#414` 계급). 판정 SSOT =
  `ref/plans/2026-07-31-crm-targeted-lens-batch.md`. 규모 = 감사 정책 기본형(2앵글+실측 렌즈 1 ·
  적대 검증 상/중만 · 에이전트 7 · 전원 읽기 전용, 워킹트리 무손상).
- **결과: 상 0 · 중 1 · 하 9** — 수색이 낸 중 6건 중 **5건이 적대 검증에서 하로 강등**(과장 회수).
  **#414 원형(앵커 미매칭 → 무경고 영구 hidden) 잔존 0건** — 훅 소비처 5곳(컴포넌트 7개)과
  좌표 없는 fixed 클래스 8개 전수가 모두 좌표 공급 배선.
- **중 1건 수리·배포 완료**(`d9ee4ff`): 드로어 3카드(할일·일정·서류) 확인 팝오버가 스크롤·
  리사이즈에 안 닫혔다 — 훅 주석이 명시한 "닫기는 호출부 책임"을 목록만 이행하고 드로어는
  미이행. **실측: 드로어 400px 스크롤 시 행은 400px 이동, 팝오버는 0px** → "삭제하시겠습니까?"가
  구매조건 섹션 위에 떠 대상 오인 유발(드로어가 100vh/auto라 항목 1건에서도 발현).
  공용 훅 `use-popover-viewport-close.ts`로 목록·드로어 **한 벌**화 + 회귀 5케이스(변이 자가검증
  통과) + **prod 실기 확인 완주**.
- ⚠️ **main 직행 사고**: feature 브랜치로 커밋했는데 push가 main까지 밀었다(병렬 세션 공유
  워킹트리 + jj bookmark). 커밋 자체는 검증 5종 그린이라 유지, 브랜치는 정리. 재발 방지 =
  메모리 `parallel-session-shared-worktree-git-race`.

## ▶ 다음

- **제프 서비스(mc.mrcha.app) 이사님 CF 계정 이전 + Workers 구축(08-01 예정 · 유슨생 확정)**:
  계획 공유문서 = `~/Downloads/2026-07-31-제프-CF-Workers-이전-계획.md`(8단계 절차·담당 포함).
  근거: Workers Custom Domain은 zone 동일 계정 필수 → 제프 계정 잔류 시 mc.mrcha.app 불가.
  이사님 결정 대기 = 제프 계정 접근 범위(멤버 권한이 거침). 레시피 = CRM plans 문서 그대로.
- ~~타깃 렌즈 배치~~ **완료(07-31 밤)** → 위 요약. **보류 하 9건**은 판정 문서에 근거까지 박제.
  착수 가치 상위 3건(전부 한 줄~소규모): ①계산기 "조회 완료" 오표시(payload null인데 스냅샷
  선커밋 — 더티 경고가 거짓 완료로 뒤집힘, fail-silent 계급 일치) ②견적 CREATE 분기 발송 실패
  미원복(같은 함수 UPDATE 분기는 롤백 — 비대칭) ③견적 temp id 무음 스킵 6함수(가드 밖 성공
  토스트. 서류 훅엔 같은 레이스 보상이 이미 있음). ②③ 공통 뿌리 = `useQuoteList.quotes`가
  `detail.quotes`와 재동기화되지 않는 구조.

- ~~CF 잔여 권고~~ **전부 종결(07-31 저녁)**: rate limiting 가동(`assistant-ask-rate-limit` —
  IP당 5회/10초, 실측 429. ⚠️Free라 경로 eq만 가능) · AI Gateway 보류 · 프리뷰 Access 종결.
- 잔여 실기 확인(오전분 유지): ① `#410` 레이아웃(admin·팀장·딜러 전폭) ② 팀장 폼 할인 섹션
  부재+admin 폼 유지 ③ 교차 세션 실시간 ④ PR `#404` 체크리스트 잔여.

## 대기

**이사님** = 기존 항목 그대로(07-29 브리프 → 아카이브).

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 승인 워크플로
상세 = `ref/specs/2026-07-30-crm-catalog-change-approval-design.md`(§3.1 정정 포함) · plans pr1~3.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).
