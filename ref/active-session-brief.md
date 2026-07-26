# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다(2026-07-21에 142k자까지 자랐다).
> 지속 결정·계약은 `AGENTS.md`, 설계 근거는 `ref/specs/*`, 장기 상태는 `ref/current-working-state.md`.

Last updated: 2026-07-26 (아침)

## 지금 상태

**main 전량 green · 브랜치 0 · 미완 작업 없음.** 07-25 밤 머지 2건(`#363`·`#364`) · main `85340ca` · 마이그 0건.
prod 눈 확인: 구성원 6명·연락처·"나" 배지 ✅(유슨생 07-26). 남은 실기 1개(비긴급) = **비admin 계정**으로
`/org-members`·`/ai-settings` URL → 홈 확인(팝오버 메뉴 미노출 + 라우트 게이트 이중 차단은 코드 검증 완료).
검증: typecheck 0 · lint 0 · knip 0 · format 0 · unit 1152 · **pure 246(신설)** · build · edge 26 · server 697+(07-25).

## 직전 세션 요약 (2026-07-25 밤 · 0725-fable5-refactoring)

**① 경량 정합성 체크 1회차 완결(`#363`)** — 배치 폐지 후 새 관례의 첫 실전. **상 0 · 중 2(적대 검증) · 하 5**,
판정 SSOT = `ref/plans/2026-07-25-crm-lightweight-consistency-check.md`. 실측 렌즈(승격·연결 4경로 ×
요청 유무 6시나리오 롤백 재현) 전부 설계 일치·잔재 0.
- **M1(중)**: `#357`이 link에 니즈 파생을 붙였는데 **customer_profile 재임베딩 훅이 안 따라옴**(need_* 7필드
  전부 프로필 청크 구성 필드) → 4경로 customerId 동봉 + 회귀 그물. 소급 백필 **0/186** 실측(오염 없음).
- **M2(중)**: promotedQuoteIds 테스트가 실채번(QT-YYMM) 견적을 **임의 실고객**에 실 INSERT — 끊기면
  `check:residue` 두 그물(QT 접두사·픽스처 앵커) 다 못 보는 유령 → 픽스처 고객 앵커로 전환.
- L1 `/ai-settings` isAdmin 라우트 게이트(행위 변경 — 유슨생 그 자리 승인 박제) · L3·L4·L5 = 테스트
  데이터 의존 제거(요청 ≥2건 가정·레거시 최초 요청 가정·catalog 정확 건수 하드코딩).
- **이월 1건 = L2**: `createCustomerFromRequest` 인라인 재구현 정리 — 기능 동등, 그 파일 다음 수정 때 함께.

**② CI 8단계(`#364`)** — **`test:pure` 신설**: `test:server` 중 DB·시크릿 무관 **32파일**(계약 tripwire
`profiles-write-guard`·`roles-parity`·`fixture-codes` 포함)이 매 PR·push마다 돈다(246테스트 0.4s).
- ⚠️ **새 DB 의존 테스트는 `src/test-utils/db-bound-tests.ts`에 등록**(fail-closed — 미등록이면 CI가
  env 없이 그 파일을 돌려 red가 난다. 새 순수 테스트는 자동 편입).
- ⚠️ **bun은 `.env.local`을 자동 로드**한다 — 순수 여부 판별은 `.env.local` 없는 worktree에서만 유효.
  러너(`src/scripts/run-pure-tests.ts`)는 `--env-file=/dev/null`+민감 env 제거로 로컬=CI 동형.
- 잡 이름 = `typecheck · lint · knip · format · unit · pure · build · edge`(step 추가 시 이름 동기화 — #333 교훈).

## ▶ 그 다음

1. **requireRole 확산(2/11)** — `customers.ts`는 필드 단위 게이트가 정답이라 **이사님 항목 16 답 대기**.
2. 실작업 후보 = **전화번호 중복 표시 UI**(`ref/pending-tasks.md` 첫 항목 — 같은 번호 앱 계정 3개 실사례
   있음, dedupe는 `app_user_id` 기준뿐) — 표시 위치·흐름 설계 논의부터 시작.
3. L2는 그 파일 만질 때 · Phase 2-6은 V2 데이터 3건뿐이라 **의도적 보류** 유지.

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 14 · 16·17 · 18·19 · 20 · 21·22 · 23 · 24 · 25 · 26 · 27 · 28.
**앱 쪽** = 이사님 착수 승인 1건 · 실기 협조 2건(FCM 실기기·앱 #582)은 **애플 개발자 등록 후 재론**.

## Boot

1. `AGENTS.md` → 이 파일 순. 2. `git status --short --branch` · `git log --oneline -5`
3. 더 필요하면: 니즈 파생 = `ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md` /
   경량 체크 판정 = `ref/plans/2026-07-25-crm-lightweight-consistency-check.md` / 과거 세션 = `ref/session-archive.md`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 이전 것은 `ref/session-archive.md` 맨 위로.
- 행위 변경은 `ref/director-pending-confirmations.md`에 등재(PR 🟡와 병행). **단 유슨생이 그 자리에서
  승인하면 등재 없이 결정으로 박제**(07-24 D1~D7 · 07-25 니즈 카드 배치 등 · 07-25 밤 `/ai-settings` 게이트).
