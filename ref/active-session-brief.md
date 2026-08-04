# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-04

## 지금 상태

main 전량 green(CI 8단계). unit **1350** · pure **281**. **회원탈퇴 CRM 몫 코드는 전량 종결**이고
**파기 로직 감사도 종결**(아래) — 앱 출시 게이트로 남은 건 **업무 AI 일괄 정리 1회 실행**뿐
(직원 공지 후 `bun run purge:assistant -- --yes` · 244행 중 유재민 228이라 공지 우선).

## 직전 세션 (08-04 · 유슨생)

- **`#440` 업무 AI 개인정보 3종**(회신 §7): 30일 rolling 파기(크론 합류·`waitUntil` 분리·DB 시계) ·
  turn provenance(마이그 **0051** `turn_id`+`subject_customer_ids`+GIN · 도구 9종 · 탈퇴/삭제 4경로) ·
  일괄 정리 스크립트. 🟡 **하드 삭제(`#212`)에서도 그 고객 대화가 사라진다**(계약은 탈퇴만 요구 —
  좁히려면 호출 한 줄 이동). 규약 전문 = **AGENTS.md "업무 AI 대화 보존 계약"**.
- **`#442` 그 파기 로직 감사**(트리거 ⓐⓑ · 경량 2앵글+렌즈 1) → **상 0·중 1·하 3·행위 변경 0.**
  파기 로직 자체 결함 **0건 = 일괄 정리 실행 게이트 통과.** 판정 SSOT =
  `ref/plans/2026-08-04-crm-purge-logic-audit.md`. 고친 중 1건 = **경계 테스트가 "하루 늦게 지우는"
  변이를 통과시켰다**(픽스처 31/29일 → 통과 범위 (29,31] · 스큐가 **덜 지우는 방향**만 가렸다).
  적대 검증 `interval '1 month'` 치환도 전 그물 통과(파기량 104→102행). 수정 = **픽스처를 30일 ±1시간으로**(프로덕션 무수정) — 다시 벌리지 말 것.
- **`#441` 출고 대수 구매방식별 표기** — 이사님 확정(§1)의 이행. **형태는 바 목록으로 확정**
  (Ladle에서 두 안 실물 비교 후 유슨생 선택 — 칩 안 소계 한 줄은 비율이 안 읽혔다). 곁가지로
  **Ladle dev 서버 복구**(아래 함정).
- **`#439` mc-master 표적 정리**(행위 변경 0·CSS 무수정): 팝오버 좌표 2벌·행 카드/상태머신 3벌
  중복 제거(`lib/popover-pos`·`ChangeRequestRowCard`) — MCMasterPage 863→**779**줄.
- **의존성 갱신**(`#443` 패치 6 · `#444` 마이너 8 · 릴리스 노트 대조 = `#444` 코멘트). 남은 outdated =
  **major 2건 보류** — TS 7(typescript-eslint peer `<6.1.0` → lint 사망 · 트리거 = TS 7.1 API+지원) · `@types/node` 26(bun이라 실익 0).
- **`customer_deletions` 익명화 backfill**(1행 · 회신 §6) · **`check:lenders` 실측 통과**(8사 일치).
- ⚠️ **팀 공통 — `dev:ladle` 흰 화면**(`Missing field 'moduleType'`): **vite 8 자체가 rolldown 기반**인데
  Ladle은 **자체 번들한 구 vite**를 써서 `@vitejs/plugin-react`가 깨진다 → `.ladle/vite.config.ts` 분리로 해소.

## ▶ 다음

- 🔴 **앱 출시 게이트 = 업무 AI 일괄 정리 실행.** 감사가 통과시켰으니 남은 조건은 **직원 사전 공지**
  뿐이다(계약 조건). ⚠️ 되돌릴 수 없고 백업이 없다. 안 해도 8월 말이면 rolling이 전량 치운다
  (최신 대화 07-28). 탈퇴 후속 잔여 **0**.
- **출고 축 미결정 2건**(답 선행): 정산 탭 비용 구조(시공비·탁송비 항목 결정 선행·중형) ·
  금융리스/일시불 실적 기준(견적 0건이라 실영향 없음). ⚠️ **실 DB 계약 확정일 0건**이라 히어로가
  0인 건 정상(상담사가 채워야 산다). 화면 확인은 Ladle `CRM/Admin Hero`.
- **이월(07-31)**: 실기 4건 — `#410` 레이아웃 · 팀장 폼 할인 · 교차 세션 실시간 · `#404` 체크리스트.
  ⚠️ 교차 세션 실시간은 08-04에 broadcast 전달·화면 배선까지 실측 확인했고 2세션 실기만 남았다.

## 대기

**이사님** = `ref/director-pending-confirmations.md` **16건**(항목 14·16~30) + Supabase
**"EXCEEDING USAGE LIMITS" 배지**(08-01) 플랜 + **D+5 최악 6일차** SLA 해석 + **출고 축 미결정 2건**.
💡 회신 때 **🟡 하드 삭제 확장(`#440`)을 항목 28**(AI 기록에 번호 잔존)**과 묶을 것** — 같은 축·미등재.

## Boot

`AGENTS.md` → 이 파일 → `git status -sb` · `git log --oneline -5`. 상세: 회원탈퇴 = 회신·spec 2문서 + PR `#426` 본문 · 업무 AI 보존 계약 = AGENTS.md.

## 세션 마무리 규칙

**교체**(누적 금지 · 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인은 등재 없이 박제** · 이사님 확정
설계를 뒤집는 건만 등재 · 신설 시 그 파일 롤업 2곳도). 상세 규칙 = AGENTS.md "Handoff Documents".
