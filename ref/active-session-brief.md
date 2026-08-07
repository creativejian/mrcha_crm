# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 =
> `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-07

## 지금 상태

빠른견적 실제 사건 기반 4단계 CRM producer가 PR `#463`으로 main merge·운영 배포됐다(`eecbde2`).
App migration `20260807140000`·`20260807141000`, `send-push` v35 선행 배포도 직접 대조 완료.
Cloudflare Version `0eabe602-e5ac-4b5e-9152-290625ce1e0b`, 운영 health 200·Hyperdrive active다.

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
- ✅ 운영 master: query 전이 **4/4** · 실제 CRM route **5/5**. 전용 `상담사테스트` profile만 읽고
  임시 고객을 생성·삭제했다. 종료 후 fixture 고객·견적·최근 견적요청 **각 0**, `check:residue` 0.
- ✅ 로컬 `.env.local`의 폐기 project ref `qtirm…`를 현재 master `wmkbm…`로 교정(비밀번호 불변).

## ▶ 다음

1. 지정 계정으로 2·3단계 최초 1회와 iOS 문구, 4단계 구매방식·차량 조각을 실기 확인한다.
2. 이상이 있으면 DB timestamp → CRM tag 요청 → App consumer → iOS 표시 순서로 경계를 좁힌다.

## 기존 대기

- 김지운 탈퇴 테스트(견적 20·앱카드 19) + `#445` 배너 육안 확인, 시범 고객 재지정.
- `director-pending-confirmations.md` 18건 + Supabase usage 배지 + D+5 SLA 해석.
- 버전 표시·릴리스 체계 보류. 재개 시 `ref/plans/2026-08-05-crm-versioning-release.md`부터.

## Boot

`AGENTS.md` → 이 파일 → `git status -sb` · `git log --oneline -5`.
