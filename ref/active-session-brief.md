# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-31 (저녁)

## 지금 상태

**main 전량 green · 브랜치 0 · prod = CF Workers 전환 + Pages 폐기까지 완결**(PR `#412`·`#413`).
git push → **Workers Builds 자동 빌드·배포** 가동. wrangler 설정 = `wrangler.jsonc`(승격 —
bare 커맨드 자연 동작). Pages 프로젝트 삭제 완료(앱 `mr-cha-app` 불가침). unit 1267.

## 직전 세션 요약 (07-31 오후~저녁 · 유슨생 — Workers 마이그레이션 완결)

- **Pages→Workers 전 절차 완료**: Worker `mrcha-crm`(`src/worker.ts`+assets
  `run_worker_first: /api/*`·Hyperdrive·**Workers Logs on**) · 시크릿 7종 재입력 · workers.dev+
  prod 전 스택 스모크(로그인·SSE·catalog·서류 서명 URL·브라우저) · **crm.mrcha.app 정식 Custom
  Domain**(CNAME 삭제=유슨생 대시보드, 구 zone route 제거) · **Workers Builds 연결**(빌드/배포
  명령·VITE 2종·watch paths `ref/*`·`*.md` 제외·캐시 on). 판정 SSOT+시크릿 체크리스트+롤백 =
  `ref/plans/2026-07-31-crm-workers-migration.md`.
- **함정 실측**: ①`_redirects` SPA 룰을 Workers가 거부·`.assetsignore` 무효 → deploy 스크립트가
  빌드 후 rm ②Custom Domain은 기존 CNAME이 있으면 100117 거부 + wrangler 토큰에 DNS 스코프
  없음 ③Pages 커스텀 도메인 > zone route 우선 ④`wrangler tail`은 `-c wrangler.worker.jsonc`
  필수 ⑤대시보드 "내부 오류" 토스트≠실패("trigger already exists"=사실 저장됨).
- 스위치 첫 시도 순서 실수로 **522 약 1분 1회**(즉시 복구), 이후 무중단. **Pages 폐기까지 같은 날
  완결**(`#413` — SEND_PUSH_SECRET 인증 프로브 실증으로 앞당김·배포 1,273개 루프 삭제·프로젝트
  삭제). 서류 업로드(쓰기)+AI 분류까지 유슨생 실기 확인(17:19) — **미실증 경로 0**.
- **`#414` 서류·일정 확인 팝오버 오프스크린 수리**(마이그레이션 무관 — `#366` 07-26 회귀 발굴):
  fixed 전환 시 좌표 훅이 할일에만 배선돼 **서류 삭제·일정 완료/삭제가 5일간 조용히 불능**
  ("눌러도 아무 일 없음"). 공용 `ConfirmPopover`(anchorSelector)로 3카드 배선·prod 실기 완주.
  진단 전말(뷰포트 밖 렌더 실측·네트워크 0건 판별) = PR `#414` 본문.

## ▶ 다음

- CF 잔여 권고(07-31 조사): rate limiting `/api/assistant*` · AI Gateway(서울 핀 충돌 실측 선행).
  프리뷰 Access 보호는 Workers 전환+브랜치 빌드 off로 표면 자체가 소멸 — 사실상 종결.
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
