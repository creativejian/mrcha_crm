# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-01 (밤)

## 지금 상태

**main 전량 green · 회원탈퇴 CRM 전량 완결**(정책→구현→스모크→배선, PR `#420`~`#422` 머지·prod
배포). unit **1276**. 탈퇴 크론 가동 = 매일 01:00 UTC(10:00 KST, D+3 재촉·D+5 자동 실행).

## 직전 세션 요약 (08-01 · 유슨생 — 회원탈퇴 전면 구현)

- **정책**: 이사님 앱 원문(#609 handoff) → CRM 회신 `ref/2026-08-01-app-account-deletion-crm-reply.md`
  (**디스코드로 영실 전달 완료** — 수정 시 전달본과 드리프트 주의). 4분류 수용 · 정책성 5건은
  "기본값+거부권"으로 확정 · **탈퇴 인지 큐 = 이사님 직접 결정**(즉시 삭제 금지·확인=가속기·삭제
  거부권 아님) · SLA 5일 = 표준 개인정보 보호지침 "5일 이내"(상한 — 연장 불가) · DB project 일치
  실측(앱이 본 불일치 정황 = `.env.local` 주석 잔재). 구현 spec =
  `ref/specs/2026-08-01-crm-account-deletion-flow-design.md`.
- **PR-1 `#420`**: 마이그 0046·0047(`account_deletion_jobs`·`settlement_references`·customers
  retention 2컬럼·`customer_deletions` name/deleted_by nullable) · `applyAppUserUnlink`(단일
  UPDATE로 phone CHECK 통과) · 3분류 실행 경로(#212 코어 공유·탈퇴는 발송 카드 가드 생략).
  🟡 **행위 변경 박제**: 스태프 삭제(#212) 감사행도 name·app_user_id 미기록(회신 §6 전체 익명화
  정합 — 유슨생 머지 승인).
- **PR-2 `#421`**: `/api/app/account-deletion`(공유 시크릿·멱등·202/200·미설정 503 fail-closed) ·
  잡 상태기계(D+5 폴백 = B후보→C스켈레톤 · 실제 실행 분류를 confirmed에 기록) · **worker.ts
  scheduled 전환**(app.test 엔트리 잠금은 `worker.fetch === app.fetch` 참조 동일성으로 변경).
- **PR-3 `#422`**: 목록 상단 탈퇴 알림·행 "탈퇴 접수" 배지·드로어 배너+탈퇴확인 **인라인 패널**
  (팝오버 아님 — #414 축 구조 회피) · 발송 차단 409(spec §3e) · `quoteWritable` 합성 잠금.
- **실기 스모크 통과**: CU-SMOKE 픽스처 → magiclink → 알림·배지·배너·확정 실행(purge) → 감사
  익명(name·appUserId NULL) 실측 → 잔재 0.
- **배선 완료**: `APP_DELETION_SECRET`(CF+CRM/앱 env 3곳 동일 — prod 401 실측. 유출 1회 →
  **rotate 완료**, Supabase 대시보드도 신값) · `DELETION_DISCORD_WEBHOOK`(테스트 204, 잡도리 알람).
- **오후 2차 — 영실 계약 회신(PR `#423`·`#424`, 종결 = 회신 문서 §12)**: retained 응답에
  retentionBasis·retentionUntil + `reviewStatus`·`reviewDueAt`(마이그 0048 기본 +30일 — 크론이
  도래 시 재알림+30일 굴림·clawback 확정 시 해제) · 수신 헤더 **`X-App-Deletion-Secret`** 통일.
  **prod 202 handshake 실측**(무헤더 401·구헤더 401·연결 고객 POST 202·잔재 0).

## ▶ 다음

- ~~앱 몫~~ ✅ **완료(08-01 밤)**: 오케스트레이터 배포 + §12 null retentionUntil 수용(앱 PR `#787`,
  `account-deletion` v4) — 회신 문서 열린 리스크 종결(CRM 추가 조치 불요). 앱 잔여 게이트 =
  Partner 계약·E2E·푸시 큐 드레인(8월말).
- **CRM 후속(30일 내 무공백)**: 업무 AI 기존 메시지 일괄 정리(**앱 출시 게이트** — 실행 시점 직원
  공지만) · 30일 rolling cron · assistant provenance 계측 · `customer_deletions` 기존 행 backfill.
  ~~`retention_until` 도래 PURGE 수렴 잡~~ ✅ **구현 완료(08-02)** — 크론 스텝 추가(출고 완료
  흔적 있으면 정산 스켈레톤 축소·없으면 전체 파기·익명 감사·Discord 코드 알림).
- **이월(07-31)**: 제프 mc.mrcha.app CF Workers 이전이 08-01 새벽 실행됨(유슨생 언급) —
  `bun run check:lenders` 실측 확인 권장 · 죽은 상태 modifier 4종 · `useQuoteList.quotes`
  미재동기화 · 오전분 실기 4건(#410 레이아웃·팀장 폼 할인·교차 세션 실시간·#404 체크리스트).

## 대기

**이사님** = 기존 항목 그대로. + Supabase 대시보드 **"EXCEEDING USAGE LIMITS" 배지** 목격
(2026-08-01) — 플랜 한도 확인 권장.

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 회원탈퇴 상세 =
위 회신·spec 2문서.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).
