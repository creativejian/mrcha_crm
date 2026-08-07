# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 =
> `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-07 (저녁)

## 지금 상태

main 전량 green(CI 8단계) = `9c53e0a`. **빠른견적 4단계 전 구간 완결·운영 배포**: CRM producer
(`#463` 이사님) + 사후 가드(`#465` 유슨생) + 앱 판정·realtime·consumer(앱 `#839`, send-push **v39**).
계약 SSOT = `ref/2026-08-07-app-quote-request-ready-for-send-reply.md`.

## 직전 세션 (08-07 저녁 · 유슨생) — `#463` 리뷰 → `#465` 수정 머지 + 앱 전수 검토

- `/code-review 463 high` 15건 → 코드로 검증해 **4건 수정**(`#465` squash `9c53e0a` · prod 반영 실측):
  ①발송된 요청(status=completed) 3단계 역행 차단 ②탈퇴 접수 고객 사건 푸시 가드(전이는 유지 —
  재클릭 no-op 수렴 때문) ③소유권 4분기 회귀 테스트 ④`public.quote_requests` 잔재 스캐너 편입
  (`TEST_APP_PROFILE_NAMES` registry 신설 · report-only). **변이 4종 각각 RED 실증 후 원복.**
  ⚠️ 탈퇴 가드는 holdWork **안**에서 갈려 응답 직후 단언은 위약 — DB 1왕복 시간 후 단언할 것.
- 앱 `#839` 전수 검토 = **문제 0**(판정 순서 정확 · 마이그 3종 멱등 · `141000`이 notify_advisor_quote
  재정의하면서 **skip_notify 가드 보존** · realtime 3중 보강). 10초 푸시 지연은 이사님이 v39에서
  OAuth 병렬화+timing 계측으로 대응 — **v39 이후 발화 0건이라 실측은 다음 실기 1회가 처음**이다.
- 🟡 consumer 2단계 변환이 subtitle **문자열 정확 일치** 의존(앱 `fcm.ts` privacySafeNotification) —
  CRM이 문구를 바꾸면 조용히 일반 폴백. 해소 = CRM 2단계 푸시에 `tag: "quote-request-confirmed"` 한 줄.

## ▶ 다음 세션 = 잔여 구조 패키지 (유슨생 승인 08-07 — 배치 17 풀 감사 아님)

1. **CI 커버리지 설계(핵심)** — 권한·파기·돈·이번 전이 그물이 전부 db-bound registry라 **CI에서 0**.
   배치 16과 `#463` 리뷰가 연속으로 같은 지목. pure-testable seam 설계가 본체다.
2. 문서 정합 — `ref/2026-07-27-app-quote-request-confirmed-request.md`에 superseded 표시
   ("3·4단계는 푸시하지 않습니다"가 새 계약과 상충 · 단계 번호 체계도 5→4로 바뀜).
3. CRM 2단계 푸시 tag 한 줄(위 🟡).
4. (옵션) `#461`·`#462` 경량 리뷰 — 파트너 계약 축이나 실측 완결(백필 불일치 0/1869)이라 낮은 우선.

## 실기 대기 (이사님)

- 2·3단계 최초 1회 · iOS 문구 · 4단계 구매방식/차량 조각 + **v39 timing 실측**(`[send-push] timing` 로그).
- 이상 시 경계 좁히기: DB timestamp → CRM tag 요청 → App consumer → iOS 표시 순.

## 기존 대기

- ⚠️ **CI 그물 `delete-where-guard`**(`#460`) — 파기 `.delete(테이블)`은 **`.where()` 필수**. 정당한
  전량 삭제는 그 파일 ALLOW에 사유와 함께 등록(정규식·SKIP으로 우회 금지).
- 김지운 탈퇴 테스트(견적 20·앱카드 19) + `#445` 배너 육안 · 🔴 시범 고객 재지정(이사님 결정 영역).
- 트림 mc_code 미부여 198/1869(08-06 실측·차단 0) — 트림 등록 후 "고유번호 할당" 실행이 운영 절차.
- `ref/director-pending-confirmations.md` 18건 + Supabase usage 배지 + D+5 SLA 해석.
- 버전 표시·릴리스 체계 보류 — 재개 시 `ref/plans/2026-08-05-crm-versioning-release.md`부터(재논의 금지).

## Boot

`AGENTS.md` → 이 파일 → `git status -sb` · `git log --oneline -5`.

## 세션 마무리 규칙

**교체**(누적 금지 · 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(유슨생 현장 승인은 등재 없이 박제 · 이사님 확정 설계를
뒤집는 건만 등재). 상세 규칙 = AGENTS.md "Handoff Documents".
