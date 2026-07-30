# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-30

## 지금 상태

**main 전량 green · 브랜치 0.** **MC 마스터 변경 승인 워크플로 PR 1(서버 `#399`)·PR 2(관리자
대기열 UI `#402`) 머지·배포** — 마이그 **0043·0044**(`crm.catalog_change_requests`) 실 DB 적용.
병행 세션분(`#400` 색상 칩 툴팁·`#401` 워크벤치 취득원가+0045·`#403` 앱카드 otherCostLabel)도
main. unit **1235** · 실 DB 승인 3스위트 31 · 잔재 그물에 고아 변경 요청 추가.

## 직전 세션 요약 (07-30 · 유슨생 — 변경 승인 워크플로 PR1+PR2)

- **요구(이사님)**: 팀장이 mc-master 수정·추가 가능하되 **반영은 admin 최종 컨펌**. 상담사 제외 ·
  삭제/이동/mc_code/reorder는 admin 전용 · 대상+작업당 pending 1건(딜러 멀티 제안과 반대 — 의도).
- **PR 1(서버)**: 큐 테이블(kind SSOT 배열 파생 CHECK·kind↔target_type 교차 CHECK·부분 UNIQUE) ·
  kind 레지스트리(적재 스냅샷/승인 replay **단일 소스** — admin 직접 실행과 같은 execute) ·
  드리프트 fail-closed(409·pending 유지) · **게이트 봉인**(구 staff API 직접 쓰기 구멍 폐쇄 —
  유슨생 현장 승인) · 대기열 라우트 6종 · 역할 매트릭스 테스트(무변이 원칙·kind 배선 DB 단언).
- **PR 2(관리자 UI)**: 헤더 "승인 대기 (N)" 팝오버 — 전→후 diff(미변경 필드 필터)·인라인
  승인/반려(사유 필수)·행별 409 드리프트 표시·착지 점프(서버가 좌표 3필드 동봉, 추가 쿼리 0) ·
  사이드바 admin "MC 마스터" 메뉴 **신설**+배지(60s+focus+승인/반려 즉시 무효화 pub/sub) ·
  kind 어휘 SSOT를 클라 순수 lib `catalog-change-kinds.ts`로 이동(AGENTS.md 경계 등재,
  schema.ts는 re-export 경유) · **parsed.data 일원화**(저장 payload = 실행 값 = diff 값).
- 서브에이전트 구현 + 태스크별 spec/품질 2단 리뷰 — 검출·반영: NaN 500·승인 불가 요청 적재
  차단·연식 "2,024" 오표기·배지 60s 스테일·화면 어휘 정합(구동방식·인승) 등.
- **mc_code 채번 조사 박제**(spec 부록 A): 통산 순번이 현행이자 정답 — 연식별 리셋 기각.

## ▶ 다음 — PR 3 (팀장 개방)

spec `ref/specs/2026-07-30-crm-catalog-change-approval-design.md` §7.1~§7.3 · 계획 패턴 =
`ref/plans/2026-07-30-crm-catalog-change-approval-pr{1,2}.md`(TDD·서브에이전트·2단 리뷰).
① `canPropose`(팀장) 편집 개방 — 저장 버튼 "승인 요청", **202 `{queued}` 공통 처리**(클라
catalog.ts 쓰기 헬퍼들 — 로컬 상태 미반영+토스트), 409(타인 pending) 안내 ② 행 "승인 대기"
배지(모델 단위 조회 `GET /models/:id/change-requests` 기존재) ③ "내 요청 (N)" 팝오버(mine=1 ·
취소 · 반려 사유 확인) ④ 이월: 승인 후 타 모델 점프 시 catalog-cache 30s 스테일(force 무효화).
⚠️ 헤더 승인 대기열 버튼은 **canEdit(admin) 전용 유지** — 팀장 노출 금지, MCMasterPage.test의
팀장 케이스가 잠근다(canPropose를 그 게이트에 섞지 말 것).

## 대기

**유슨생** = PR 1~3 실기 확인은 **PR 3 이후 일괄**(2026-07-30 본인 결정). 매니저 테스트 계정 =
상담사테스트(`crm-staff-test@example.com`, role=manager 전환 완료 — magiclink 절차는
`dealer-magiclink-smoke` 메모리/AGENTS.md). **이사님** = 기존 항목 그대로(07-29 브리프 → 아카이브).

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 승인 워크플로
상세 = 위 spec·plans.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).
