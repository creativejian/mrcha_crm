# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-04

## 지금 상태

main 전량 green(CI 8단계). unit **1345** · pure **281**.
**회원탈퇴 CRM 몫 코드는 전량 종결**(업무 AI 개인정보 3종까지 — `#440`). 앱 출시 게이트로 남은 건
**일괄 정리 1회 실행**뿐이다(코드 아님 — 직원 공지 후 `bun run purge:assistant -- --yes`).

## 직전 세션 (08-04 · 유슨생)

- **`#440` 업무 AI 개인정보 3종**(회신 §7): ①30일 rolling 파기(일일 크론 합류·**`waitUntil` 분리**·
  DB 시계 기준) ②turn provenance(마이그 **0051** `turn_id`+`subject_customer_ids`+GIN · 도구 9종
  수집 · 탈퇴/삭제 4경로 연결) ③출시 전 일괄 정리 스크립트(조회 기본·`--yes`에만 파기).
  🟡 **하드 삭제(`#212`)에서도 그 고객 대화가 함께 사라진다** — 계약은 탈퇴만 요구(좁히려면 호출
  한 줄 이동). 규약 전문은 **AGENTS.md "업무 AI 대화 보존 계약"** 항목에 박제.
- **`#439` mc-master 표적 정리**(행위 변경 0·CSS 무수정): 팝오버 좌표 2벌 → `lib/popover-pos`
  (플립은 `flipBelow` 옵션) · 변경 요청 행 카드/상태머신 **3벌** → `ChangeRequestRowCard` +
  `useChangeRequestRows` · MCMasterPage 863→**779**줄(훅 5개 분리).
- **`customer_deletions` 익명화 backfill 완료**(1행 — 회신 §6 이행. name·app_user_id NULL 실측).
- **`check:lenders` 실측 통과** — 제프 Workers 이전(08-01) 후 첫 확인, 8사·표시명 전량 일치.

## 08-03 세션 (출고·실적·매출 축)

경영 리포트 실데이터화(`#428` 5칩·문의·퍼널 / `#432` 히어로) · 출고 2단계와 정산(`#431`·`#433`
**admin 단독**) · mc-master 승인 워크플로 UX(`#434` 행 배지 diff·신규 트림 미리보기·이어서 수정 /
`#435` 그룹 순서 / `#437` 출고 후 미확정 배지).
⚠️ **"출고"가 두 사건을 가리킨다** — 실적 귀속은 **계약 확정일**이다(`#436`이 인도일 기준을 정정).
설계·산식 = `ref/specs/2026-08-03-crm-delivery-revenue-design.md`.

## ▶ 다음

- **앱 출시 게이트**: 업무 AI 일괄 정리 실행(**244행** · 유재민 228 — 실무자 계정이면 공지 우선).
  ⚠️ 안 해도 8월 말이면 rolling이 전량 치운다(최신 대화 07-28). 탈퇴 후속 잔여는 **0**.
- **출고 축 미결정 3건**(답 선행 — 코드가 못 나간다): 대수 구매방식별 표기 형태(추천 ⓐ 칩 아래
  소계 한 줄·소형) · 정산 탭 비용 구조(시공비·탁송비 등 항목 결정 선행·중형) · 금융리스/일시불
  실적 기준(현재 견적 0건이라 실영향 없음·코드는 방어적 제외).
- **이월(07-31)**: 실기 4건 — `#410` 레이아웃 · 팀장 폼 할인 · 교차 세션 실시간 · `#404` 체크리스트.

## 대기

**이사님** = `ref/director-pending-confirmations.md` **16건**(항목 14·16~30) + Supabase
**"EXCEEDING USAGE LIMITS" 배지**(08-01) 플랜 확인 + **D+5 자동 실행 최악 6일차** SLA 해석 +
**출고 축 미결정 3건**.

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`.
회원탈퇴 상세 = 회신·spec 2문서 + 감사 전말 = PR `#426` 본문 · 업무 AI 보존 계약 = AGENTS.md 항목.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).
