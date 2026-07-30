# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-31

## 지금 상태

**main 전량 green · 브랜치 0.** **MC 마스터 변경 승인 워크플로 3부작 전부 머지·배포** — PR 1
서버 `#399` · PR 2 관리자 UI `#402` · **PR 3 팀장 개방 `#404`**(squash `f48fb4f`, 07-31 새벽).
PR 3는 서버 무변경(클라 전용 22파일 — 라우트는 PR 1이 전부 선반영). unit **1258**.

## 직전 세션 요약 (07-30 밤 · 유슨생 — PR 3 팀장 개방)

- **①canPropose 개방**: 편집 UI는 admin과 동일하되 저장 = "승인 요청"(트림/모델 패널 + 옵션
  인라인 에디터), 202 `{queued}`는 **catalog.ts 쓰기 8종 wrapper + pub/sub** 공통 감지(호출부
  무수술·리스너 예외 격리) → 토스트·화면 값 불변(무옵션 토글 낙관 플립도 queued 스킵). 409는
  panelError(요청자·시각은 행 배지가 예방 — HttpError 확장 안 함).
- **②행 배지 + pill**: 모델 단위 pending(admin·manager) → 트림 행 "승인 대기"(호버 = 요청자·
  경과·작업, `TrimPendingBadge` 공용 조각) + 트림에 못 붙는 건 헤더 pill. focus 재검증. create류는
  409가 아니라 **중복 적재**됨(부분 UNIQUE는 target_id 있는 행만) — pill은 인지 목적.
- **③내 요청 (N)**: pending 취소·반려 사유·착지 점프(`changeRequestDest` SSOT — 대기열과 공유)·
  pending 우선 정렬. `.va-cr-*` 셸 공유(특이도 충돌 → `.va-cr-requester` 의미 클래스로 해소).
- **④캐시**: `invalidateCatalogAfterApproval`(makeCache clear 축) — 승인 후 화면 밖 모델 30s
  스테일 해소(브리프 이월 항목 종결).
- **사이드바 팀장 진입점 신설**(종전 0 — admin 전용 2곳뿐이라 죽은 기능이었음. 배지는 admin 전용
  유지 — 유슨생 머지로 박제) · 헤더 승인 대기열 버튼 canEdit 잠금 유지(기존 테스트).
- 과정 = PR 1·2 패턴(서브에이전트 + 태스크별 2단 리뷰 + 전 브랜치 최종 리뷰). 검출·반영: 리스너
  예외가 성공 저장을 거짓 실패화·옵션 에디터 라벨 누락(spec §7.1 공백)·CSS 특이도로 상태 칩
  3색 사망·취소 실패 에러 영구 잔존 등. 변이 자가검증 3회. 계획 = `ref/plans/…-pr3.md`.

## ▶ 다음 — 실기 일괄 확인 (유슨생, 오늘)

**PR `#404` 본문 체크리스트 8항목** = 실기 대본: 팀장 저장 3종 202 결말 · 무옵션 토글 라벨 불변 ·
배지 툴팁 줄바꿈(그룹/평면 양뷰) · 대기열 요청자 굵게 + 내 요청 칩 3색(CSS 수정 실측) · 착지
점프(hl·승인 후 타 모델 스테일 해소) · 역할 교차(팀장 진입·admin 불변) · create류 중복 적재 모습 ·
팀장 섹션 구분선 미관. 매니저 계정 = 상담사테스트(`crm-staff-test@example.com`, role=manager —
magiclink 절차는 dealer-magiclink-smoke 메모리/AGENTS.md).

## 후속 후보 (비긴급)

spec 부록 B(딜러 제안 배지 합산·staff 개방 재론·대기열 알림) + PR 3 리뷰 잔여: `mine=1` 50건
창(오래된 pending 밀림 — 서버 몫) · 팝오버 재클릭 안 닫힘(선재 관례) · `/mc-master` 라우트
무가드(상담사 URL 직접 = 읽기 전용, 선재).

## 대기

**이사님** = 기존 항목 그대로(07-29 브리프 → 아카이브).

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 승인 워크플로
상세 = `ref/specs/2026-07-30-crm-catalog-change-approval-design.md` · plans pr1~3.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).
