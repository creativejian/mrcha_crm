# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 =
> `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-07

## 지금 상태

`feat/quote-request-ready-for-send`에 빠른견적 실제 사건 기반 4단계의 CRM producer 구현 후보가 있다.
앱 저장소 `feat/quick-quote-four-stage-progress`는 화면·DB 계약·consumer 구현과 로컬 검증을 마쳤지만
운영 Supabase·Edge Function에는 미배포다. CRM PR은 이 선행 배포를 merge·배포 게이트로 명시한다.

## 확정 계약 (이사님 08-07)

- 1 `견적 요청 완료` = 요청 생성, CRM 변경 없음.
- 2 `담당자 확인 완료` = 기존 `견적 작성` 최초 클릭·`confirmed_at`·푸시 배선 **그대로 유지**.
  기존 CRM payload의 차량명·subtitle도 축소하지 않는다.
- 3 `발송 준비 중` = 실제 `작성완료` 최초 성공. nullable `ready_for_send_at`을 한 번만 기록하고
  최초 `NULL → timestamp` 전이에서만 `{user_id, tag: quote-request-ready-for-send}` 내부 요청.
- 4 `견적 도착` = 기존 상담사 견적 등록·발송(DB trigger) 배선 그대로 유지.
- 차량명·구매방식·가격은 개인정보로 분류하지 않는다. 직접 식별정보는 FCM 표시/data payload에서
  제외하고, 3단계 표시 문구는 앱 consumer가 승인된 고정 문구로 변환한다.

## 구현

- 클라 `useQuoteWorkbench`: `작성완료(send:false)`의 INSERT/PATCH에만 `markReadyForSend:true` command.
  `작성 후 발송(send:true)`에는 싣지 않는다.
- 서버 `customers` route + `markQuoteRequestReadyForSend`: 견적 저장과 조건부 UPDATE를 같은 DB
  transaction에 묶고, 저장된 `source_quote_request_id`와 고객 앱계정 소유권을 서버에서 재검증한다.
- 커밋 뒤 최초 전이만 앱 `send-push`에 사건 tag로 best-effort 전달. 재클릭·재시도·새로고침은 no-op.
- CRM은 앱 소유 public migration을 만들지 않았다. 앱팀 회신 =
  `ref/2026-08-07-app-quote-request-ready-for-send-reply.md`.

## 검증

- ✅ `typecheck` · `lint` · `knip` · `format:check` · `build` · `git diff --check`
- ✅ unit **1441/1441** · pure **295/295** · 워크벤치 집중 **31/31** · 푸시 집중 **13/13**
- ✅ 기존 2단계 차량명+subtitle 보존 / 새 3단계 tag-only payload를 각각 exact assertion으로 잠금.
- 🔴 DB 멱등·롤백·route 통합 테스트 3건은 app migration 선행 전이라 미실행. 공유 master에
  `ready_for_send_at`이 확인된 뒤 선별 실행하고 `check:residue`까지 확인한다.

## ▶ 다음

1. 앱팀이 migration과 `send-push` consumer를 commit·merge·배포하고 운영 반영을 확인한다.
2. CRM에서 `quote-requests.confirm.test.ts`와 `customers.push.test.ts`를 선별 실행한다.
3. 잔재 0과 최종 diff를 확인해 PR 검증란을 갱신한 뒤 merge·배포한다. **CRM 배포는 앱 선행 배포 뒤에만**.

## 기존 대기

- 김지운 탈퇴 테스트(견적 20·앱카드 19) + `#445` 배너 육안 확인, 시범 고객 재지정.
- `director-pending-confirmations.md` 18건 + Supabase usage 배지 + D+5 SLA 해석.
- 버전 표시·릴리스 체계 보류. 재개 시 `ref/plans/2026-08-05-crm-versioning-release.md`부터.

## Boot

`AGENTS.md` → 이 파일 → `git status -sb` · `git log --oneline -5`.
