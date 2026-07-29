# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-29 (저녁)

## 지금 상태

**main 전량 green · 브랜치 0.** 딜러 도메인은 07-29 오전 5면 정합 종결에 이어 저녁까지 **후속 4PR
전부 머지·배포**(`#391`~`#394`). 4종 0 · unit **1217** · pure 259 · 실 DB 딜러 스위트 확장(채택
undo 4·게이트/드릴다운 +8) · 마이그 **0042**(`catalog_discount_adoptions.undo_of`, 실 DB 적용 완료).

## 직전 세션 요약 (07-29 오후~저녁 · 유슨생 — 딜러 UX 4연타 + 제프·의존성 종결)

- **`#391`**: 딜러 리로드마다 "불러오기 실패" 플래시 — 원인은 magiclink가 아니라 **스코프 센티널
  (-1)이 models fetch로 새어 400**. `SCOPE_BRAND_PENDING` 명명 + 훅이 fetch 자체를 차단. 부수로
  할인 셀 팝오버 트리거를 셀 전체로 확장(음수 마진).
- **`#392` 채택 되돌리기(undo)**: **토글 의미론**(직전 한 단계, 재클릭 = 복귀 — 사슬 걷기 기각.
  더 과거는 그 딜러 [채택] 직접 클릭). 감사 행 append + `undo_of` 자기참조 FK(마이그 0042).
  **출처는 복원 값의 원 출처를 이어받는다**(딜러 채택분 복원 → "채택됨" 복귀 — source의 의미는
  "어느 딜러의 값", 주체는 adopted_by). 드리프트 fail-closed · 할인변경일은 트리거가 되돌린 날로
  자동 스탬프(값만 과거, 날짜는 오늘이 참). 버튼 = 팝오버 "현재 확정" 줄 우측, 이력 없으면 disabled.
- **`#393` 명부 "입력 트림" 열**: 보라 "보기 (N)" → 팝오버("입력값 삭제"의 대상을 지우기 전에
  확인 — 구멍 메움). 행 클릭 → `/mc-master/:modelId?brand=&hl=trimId` **착지 플래시**(가운데
  스크롤·접힌 서브라인 자동 펼침·소비 후 hl 제거). 팝오버 = fixed(.table-scroll 클리핑 탈출)·
  내부 스크롤·max-content 폭·hover 프리패치 캐시. 삭제 버튼 건수는 중복이라 제거.
- **`#394` 딜러 본인 "내 입력 트림 (N)"**: 딜러 모드 헤더(브랜드 h2 옆) — 진입 프리로드로 (N)
  즉시, 0건 disabled. 팝오버 본체를 **공용 부품으로 추출**(`components/ProposalTrimsPopover` —
  명부와 한 벌) + **제안변경일 열**(두 팝오버 공통). 서버 `GET /api/dealer/my-proposal-trims`
  (게이트 없음 — 세션 본인, `/me` 축). 제안 저장 시 캐시 무효화.
- **그 외**: 의존성 14종(`#389` 13종 + `#390` jsdom 30 — @types/node 24·TS 6.0.3 보류 유지) ·
  MC 마스터 트림 탭 여백 12px·수직 중앙(main 직접) · 제프 colors 건 최종 종결 박제.
- ⚠️ 실기 교훈 재확인: **dev:api는 watch 없음** — 서버 라우트 추가 후 `bun dev` 재시작 필수
  (이번 세션에서 두 번 "안 돼요" 원인). 스크립트 치환은 assert 필수(무단 no-op이 CSS 커밋 하나를
  비웠다 — 후속 커밋으로 정정).

## ▶ 다음 — 미확정

**"CRM 이어가자"면**: ①제안 도착 알림 배지("대기 N건" — 관리자에게 새 제안 신호) ②그 외 자유.
(undo는 `#392`로 소진)

## 대기

**prod(유슨생)** = 오늘 4PR(`#391`~`#394`) 눈 확인 — 로컬 전 단계 검증 완료, 딜러 세션 링크 발급
상태. **판단(유슨생)** = `dev:api --watch` 도입(이번 세션에 재시작 함정 2회 — 재론 가치 상승).
**이사님** = ⓐBMW 523d 실데이터(자사 5,300,000 · 제휴 6,000,000 — 오늘 undo 테스트로 제안값
4,000,000/4,500,000/5,000,000 추가됨) 유지 판단 ⓑspec §7.1 뒤집힘
ⓒ`ref/director-pending-confirmations.md` **16건**. **제프** = **전면 종결**(서면 `debfcb8` + colors
`#118` 프로덕션 반영 — `ref/2026-07-29-jeff-sync-dryrun-colors-followup.md`). 기억 2건: ⓐcheapest
쓰게 되면 사전 통지 ⓑC 거부 게이트 켜지면 경고→차단 전환.

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 더 필요하면
딜러 건 = `ref/{specs,plans}/2026-07-27-crm-dealer-*` / undo 설계 = `#392` PR 본문 / 과거 =
`ref/session-archive.md`.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).
