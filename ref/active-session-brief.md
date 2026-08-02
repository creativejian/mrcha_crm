# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-02 (낮)

## 지금 상태

**main 전량 green · 회원탈퇴 CRM+앱 계약 전량 종결**(파트너 계약까지 — 앱 PR `#788`·`#789`).
unit **1280** · pure **272**. 탈퇴 크론 = 매일 10:00 KST **4스텝**(D+3 재촉·D+5 자동 실행·
보존 기한 도래 수렴·정산 재검토).

## 직전 세션 요약 (08-02 · 유슨생 — 탈퇴 감사·이월 정리·수렴 잡·딜러 UI)

- **앱쪽 완결 확인(읽기 전용)**: 파트너 trace 삭제 계약 종결(수탁 확정·로그 "직접 식별자 없음+
  7일 자동 소멸" 확약·`/api/external/quotes/deletion` 실측). 앱 잔여 게이트 = E2E·푸시 큐
  드레인(8월말)·처리방침(§D). **CRM 몫 앱 출시 게이트 = 업무 AI 기존 메시지 일괄 정리뿐.**
- **탈퇴 감사 → PR `#426`**(트리거 기반 2앵글+상/중 적대 검증): ①**경합 잠금** — confirm·D+5
  크론 양쪽 FOR UPDATE+상태 재확인(stale 자동 실행이 보존 확정 고객을 재파기 가능했음)
  ②no-op 실행(고객 선삭제)은 **effective purge 기록**(구현대로면 앱이 "정산행 없는 retained"로
  영구 잠금) ③🟡B 스크럽에 customer_tasks 삭제(화이트리스트 정합) ④🟡D+0 접수 Discord 알림
  (회신 §1 이행 · NODE_ENV=test 게이트 필수 — 없으면 로컬 test:server가 실알림 발사) ⑤시크릿
  게이트 pure 분리(CI 272) ⑥잔재 그물에 `account_deletion_jobs`·`settlement_references`
  (received 잔재 = 목록 유령 알림). 🟡 2건 = 유슨생 현장 승인 박제.
- **PR `#427`**: `retention_until` 도래 수렴 잡 — 회신 §2-B 약속 이행(출고 완료 흔적 있으면 정산
  스켈레톤 축소·없으면 전체 파기·익명 감사·Discord 코드 알림). B 확정 0건 창에 무위험 배포.
- **이월 정리 PR `#425`**: `useQuoteList` 재동기화(낙관 쓰기 비행 중 스냅샷 폐기 = 되돌림 방지·
  temp 카드/objectUrl 보존·회귀 4케이스) + 죽은 modifier 4종 제거(**git 전 이력 CSS 0건 실측**
  — 07-31 "원 의도 미확증" 해소). 07-31 이월 중 실기 4건만 잔존.
- **딜러 UI 2건(main 직접)**: 할인 입력칸 "원" 단위(`6f9ae50`) · 상단바 내부 도구 5종(검색·업무
  AI·계산기·상담 대기·알림)을 disabled 노출 → **미표시** 전환(`62e2d6a`).
- **보류 박제(PR #426 본문)**: D+5 최악 6일차(일 1회 크론 — SLA 해석은 이사님 몫) · 크론 글루
  무테스트(커밋 실행이라 테스트 사고 위험 > 실익) · 채팅 §3e(실경로 없음).
- ⚠️ main 직접 push **첫 시도 실패 2회 반복**(재시도 즉시 성공 — jj ref 경합 추정, 재발 시 조사).
- ⚠️ 팀 공통 함정: 로컬 CF 토큰을 `.env.local`에 둘 때 변수명 `CLOUDFLARE_API_TOKEN` 금지 —
  **wrangler v4가 `.env.local`을 직접 로드**해 OAuth를 가린다(유슨생 PC는 `CF_WORKERS_LOGS_TOKEN`
  으로 개명 완료·저장 로그 query API 전용).

## ▶ 다음

- **CRM 후속(30일 내 무공백)**: 업무 AI 기존 메시지 일괄 정리(**앱 출시 게이트** — 실행 시점 직원
  공지만) · 30일 rolling cron · assistant provenance 계측 · `customer_deletions` 기존 행 backfill.
- **이월(07-31 잔여)**: `bun run check:lenders` 실측(제프 Workers 이전 08-01 새벽 후 미확인) ·
  오전분 실기 4건(#410 레이아웃·팀장 폼 할인·교차 세션 실시간·#404 체크리스트).

## 대기

**이사님** = 기존 항목 그대로 + Supabase **"EXCEEDING USAGE LIMITS" 배지**(08-01) 플랜 확인 권장 +
**D+5 자동 실행 최악 6일차** SLA 해석(당기려면 D+4 판정+재촉 문구 변경 — 질문 전달은 유슨생 지시 시).

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 회원탈퇴 상세 =
회신·spec 2문서 + 감사 전말 = PR `#426` 본문.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).
