# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-31 (오후)

## 지금 상태

**main 전량 green · 브랜치 0.** MC 마스터 승인 3부작 + 실기 후속 7건(`#405`~`#411`) 전부
머지·배포(오전, 상세 = 아카이브 맨 위). 오후 = **CF 인프라 세션**(아래). unit **1267**.

## 직전 세션 요약 (07-31 오후 · 유슨생 — CF 최적화)

- **build watch paths 적용**(CF API PATCH): `path_excludes: ["ref/*", "*.md"]` — 문서만 바뀐
  push는 빌드 자동 스킵(실측 `35e9f8d` = `is_skipped: true`). 스킵돼도 배포 행은 생기고 Idle로
  보인다 — 확정 판별은 API `is_skipped`. **`[skip ci]` 토큰 전면 금지로 규칙 교체**
  (CLAUDE.md·AGENTS.md). 빈 커밋 push는 무조건 빌드(재트리거 요령 유지). 롤백 = excludes `[]`.
- **Hyperdrive 캐싱 실측**: 이미 `disabled: true`(06-18부터) — 스테일 리스크 원래 없음.
- **Workers Paid 구독**($5/월·계정 단위, 유슨생 결제): 즉시 효과 = Pages Functions CPU
  10ms→30초·일 10만 요청 하드컵 해제. 7월 실사용 = 요청 12.09k·CPU 158k ms(포함량의 ~0.1%).

## ▶ 다음 — Workers 마이그레이션 (새 세션 권장 · 집중 반나절)

목적 = **Workers Logs(7일 보존·검색 로그)** — "조용한 prod 실패"(#202 두 달 무발송·#145~#147
SSE 524) 대비. Pages는 실시간 tail뿐이라 그 순간을 안 보고 있으면 증거가 없다. 절차:
①Worker 병행 생성(`main`+`assets`, `run_worker_first: /api/*`) ②env·시크릿 **손 재입력**
(내보내기 불가 — 체크리스트 필수, 누락 = 조용한 실패) ③`*.workers.dev` 전체 스모크(로그인·
SSE 스트리밍·Hyperdrive·서류 업로드) ④`crm.mrcha.app` 스위치(롤백 = 도메인 되돌리기)
⑤watch paths 재설정(Workers Builds에 동일 기능 있으나 자동 이관 안 됨). 로컬 dev(`bun run
dev`)는 CF 무관·영향 0. 덤 = Cron·Queues·점진 배포·즉시 롤백·ctx 자동 전달(Pages 엔트리
수동 전달 누락 → SSE 데드락 함정이 구조적으로 소멸).

## CF 추천 잔여 (07-31 조사 · 미착수)

- **프리뷰 배포 Access 보호**(원클릭·무료) — `*.pages.dev` 프리뷰가 공개인데 실 DB에 붙는다.
- **rate limiting** `/api/assistant*` — 토큰 유출·루프 버그 시 Gemini 비용 보험.
- **AI Gateway**(Gemini 호출 로그·비용 추적·무료) — ⚠️ `crm-gemini-proxy` 서울 핀 사유(리전
  차단)와 충돌 가능. 전환 전 실측 1회 필수.
- 기각: Smart Placement/Argo(사용자·DB 모두 한국 — 실익 0)·R2 서류 이관·Turnstile.

## 잔여 실기 확인 (오전분 유지 · 유슨생)

① `#410` 레이아웃(admin·팀장·딜러 전폭 — 타이틀 부동·브랜드 열 자체 스크롤·낮은 창·착지 hl)
② 팀장 폼 할인 섹션 부재 + admin 폼 유지 ③ 교차 세션 실시간(브라우저 2개) ④ PR `#404` 본문
체크리스트 잔여. 매니저 계정 = 상담사테스트(magiclink 절차 = dealer-magiclink-smoke 메모리).

## 대기

**이사님** = 기존 항목 그대로(07-29 브리프 → 아카이브).

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 승인 워크플로
상세 = `ref/specs/2026-07-30-crm-catalog-change-approval-design.md`(§3.1 정정 포함) · plans pr1~3.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).
