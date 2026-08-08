# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 =
> `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-08

## 지금 상태

main 전량 green(CI 8단계) = `3ecb5a8`. 08-07 브리프의 **"잔여 구조 패키지" 4항목 전부 완료** +
hermetic 이관 2·3단계까지(`#466`~`#473` 8 PR). 빠른견적 4단계는 08-07 전 구간 배포 완결(계약 SSOT
= `ref/2026-08-07-app-quote-request-ready-for-send-reply.md`) — 실기 확인만 이사님 대기다.

## 직전 세션 (08-08 · 유슨생) — 8 PR

- **`#466`·`#472`·`#473` CI 커버리지(핵심)** — hermetic **PGlite** seam(`test-utils/hermetic-db.ts`):
  기존 `setTestDb`에 실 master 대신 in-memory Postgres를 꽂는 **dual-mode**(로컬 test:server = 실
  master 그대로 / CI test:pure = PGlite · 미러는 `pushSchema` · crm은 실 마이그 53개).
  권한·파기·돈·전이 12 → 발송·탈퇴·`me` 4 → 카탈로그 승인 3. **registry 54→47 · pure 295→471.**
  배치 16의 "WHERE를 지워도 CI 전량 통과"가 닫혔다. 설계·함정·시드 계약 =
  `ref/plans/2026-08-07-crm-ci-coverage-hermetic-db.md`. 하네스 함정 3:
  ⚠️ PGlite 미종료 = **0 fail이어도 exit 99**(bunfig `[test].preload` teardown) ·
  `pushSchema`는 트리거를 못 만들어 `sort_order`가 겹친다(**충돌 회피용 더블**이라 순번 단언 테스트는
  이관 금지) · `execute()` 반환형이 드라이버마다 다르다(`toRows`).
  🔴 **`staff.test.ts` 이관 부적합** — 실 조직 데이터를 훑어 대조하므로 빈 DB에서 루프가 0회 돌아
  **공허하게 통과**한다(초록 거짓말). 사유를 registry에 박아뒀다 — 같은 형태를 이관 판단 기준으로 쓸 것.
- **`#467`** 2단계 푸시에 `tag: quote-request-confirmed` + 구 계약 문서 superseded 표시.
  앱 v39 `fcm.ts`가 tag 분기를 subtitle 일치와 **OR**로 이미 지원(실측) → 표시 문구 불변·앱 무변경.
- **`#468`·`#469`·`#470`** = `#461`·`#462` 리뷰 이행. 판정 23건·보류 사유 SSOT =
  `ref/plans/2026-08-07-crm-review-461-462-findings.md`. 다음 세션이 꼭 알아야 할 3가지만:
  - 🔴 **`#462`의 근거가 사실과 달랐다** — "mcCode 링크 없으면 modelName 폴백 매칭"이 CRM 도달
    경로에 **없다**(파트너 레포 실측: 폴백 없이 400). canonical은 오매칭 방지 장치가 **아니고**,
    그 없는 근거로 mcCode 없는 경로를 열면 오히려 진짜 휴리스틱 임의 매칭을 만난다. 주석·스펙 정정.
  - **`trim_name` 빈 행 정책 ⓐ 확정**(유슨생): 라이브 경로도 백필처럼 **재계산 안 함**(공유 순수
    함수 `canonicalTrimName`). ⚠️ `trims.name` 폴백은 **실측 기각** — 1902행 중 331행에서 name이
    트림명이 아니라 레거시 장문 라벨(`[2026년형 …] XLE(A/T) (2,487cc)`).
  - 빈 patch 500은 **manager 할인 전용 편집 → 승인 replay** 경로가 실재해 라우트가 아니라 쿼리에서
    막았다. 그 밖 수정·그물 4종(드리프트 트립와이어·두 빌더 양방향 패리티 등)은 판정 문서 참조.
- 변이 실증 누적 **15종** 전부 RED 후 원복 · 워킹트리 무손상. ⚠️ 교훈 2: ①변이 원복을
  `git checkout`으로 하면 **같은 파일의 미커밋 원 수정까지 날아간다**(커밋 먼저) ②새 그물에도 같은
  공백이 생긴다(훅 배선 첫 3케이스가 오타 변이를 통과 → 소스별 최소 1회 드러나게 보강).

## ▶ 다음 (미확정 — 트리거 없음)

**hermetic 이관 후보는 소진**됐다. 남은 registry 47은 ⓐ실 데이터가 검증 대상(리포트 집계·임베딩
코퍼스·잔재/드리프트 스캔) ⓑ실 Gemini 호출(업무 AI) ⓒ실 조직 데이터(staff) — 옮기면 의미를 잃는다.
리뷰 보류분(무잠금 경합·TOCTOU·cross-brand)은 창이 좁아 기록만.

## 실기 대기 (이사님)

2·3단계 최초 1회 · iOS 문구 · 4단계 구매방식/차량 조각 + **v39 timing 실측**(`[send-push] timing`).
이상 시 경계 좁히기: DB timestamp → CRM tag 요청 → App consumer → iOS 표시 순.

## 기존 대기

- ⚠️ CI 그물 `delete-where-guard`(`#460`) — 파기 `.delete(테이블)`은 `.where()` 필수(ALLOW에 사유 등록).
- 김지운 탈퇴 테스트(견적 20·앱카드 19) + `#445` 배너 육안 · 🔴 시범 고객 재지정(이사님 결정 영역).
- 트림 mc_code 미부여 198/1869(08-06 실측·차단 0) — 트림 등록 후 "고유번호 할당"이 운영 절차.
- `ref/director-pending-confirmations.md` 18건 + Supabase usage 배지 + D+5 SLA 해석.
- 버전 표시·릴리스 체계 보류 — 재개 시 `ref/plans/2026-08-05-crm-versioning-release.md`부터(재논의 금지).

## Boot / 세션 마무리 규칙

부팅: `AGENTS.md` → 이 파일 → `git status -sb` · `git log --oneline -5`.
마무리: **교체**(누적 금지 · 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(유슨생 현장 승인은 등재 없이 박제 · 이사님 확정 설계를
뒤집는 건만 등재). 상세 규칙 = AGENTS.md "Handoff Documents".
