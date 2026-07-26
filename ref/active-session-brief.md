# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다(2026-07-21에 142k자까지 자랐다).
> 지속 결정·계약은 `AGENTS.md`, 설계 근거는 `ref/specs/*`, 장기 상태는 `ref/current-working-state.md`.

Last updated: 2026-07-26 (오후)

## 지금 상태

**main 전량 green · 브랜치 0 · 미완 작업 없음.** 07-25 밤~07-26 머지 **8건**(`#363`~`#370`) · main `8e86d6a` · 마이그 0건.
눈 확인: `#365`~`#370` **전부 유슨생 확인 완료**. 남은 실기 1개(비긴급) = 비admin 계정으로
`/org-members`·`/ai-settings` URL → 홈(게이트는 코드 검증 완료). 검증: typecheck 0 · lint 0 · knip 0 ·
format 0 · unit **1164** · pure(CI 신설) · build · edge 26 · server 697+(07-25 — "server green"은 언제든 스테일).

## 직전 세션 요약 (07-25 밤~07-26 · 0725-fable5-refactoring)

**전반부(경량 체크 `#363`·CI 8단계 `#364`)는 아카이브 참조** — M1/M2·test:pure registry(fail-closed)·
bun `.env.local` 자동 로드 함정. **이월 L2**(createCustomerFromRequest 인라인 정리)는 그 파일 수정 때 함께.

**③ 상담 필요/계약 목록 칩 = 계약 가능성(`#365`).** 구 `priority`는 **쓰기 경로 0인 시드 박제 필드**(승격
신규 고객 전부 빈 칩) → `resolveChance` 한 벌로 드로어와 동축. 하단 글자 = 최신 미완료 할일(불변).
**④ 상담 메모 인라인 실저장(`#366`).** 목록 `latestTask`에 **id 동봉**(json 한 방) → 있으면 body 수정 /
없으면 새 할일(오늘·체크) / 빈 값 = 삭제. 활동 스탬프는 **새 할일 INSERT만** 낙관 반영(수정은 서버
스탬프 불변 — 거짓 "방금 전" 금지). + 드로어 할일 확인 팝오버 fixed 탈출(`lib/use-fixed-popover-position`
추출 — 고정 높이 스크롤 카드 바디는 absolute가 어느 방향이든 잘린다).
**⑤ 드로어 첫 로딩 딜레이 해소(`#367`+`#368`).** hover 프리패치 축 교정(source 문자열 → **appUserId**,
상담 승격 고객이 빠졌었다) + 클릭/URL 진입 시 상세·니즈·상담 **병렬 워밍**(직렬 2왕복 제거) +
니즈 카드 `content-visibility`(98카드 → 보이는 3~4장만 페인트). 유슨생 실측 "아주 좋아".
**⑥ 관리 상태 두 층 분리.** 가짜 "정상"(마킹이 pre-action 공백 게이트 우회)은 **버그 → `#369` 픽스**
(`resolveUpdateBadge` SSOT 게이트). 수동 상태가 진행 상태·계약 가능성 수정에 만료되는 건 **설계**(⑦-①
스누즈) — "실활동 정의를 좁힐까"를 **항목 29로 이사님 등재**(유슨생·영실 의견 = 좁히기 ⓑ).
**⑦ 전화번호 중복(`#370`).** 같은 번호 "연결 고객"은 계정·번호 매칭 둘 다 못 잡는 구멍(김지운 분화의
경위) → **`lib/phone-duplicate.ts` SSOT**(서버 견적요청·클라 상담 인박스 물리 공유, AGENTS 등재)로
경고 + 생성 2단 재확인(fail-open). 드로어 1차 번호 등록/수정에도 중복 advisory(등록 폼과 대칭).
secondary는 대조 제외(#276 매칭 금지). ⚠️ **앱 번호 유일성 요청문은 repo 폐기·유슨생 로컬 메모리 보관**
(이사님 노출 방지 — 휴대폰 로그인 구현 가능 시점에 `git show c483b46:...`로 복원·재실측 후 전달.
실측: 중복 5계정 전부 이사님 테스트·회수 장치 4층 모두 부재·상담신청 번호 강제는 확인됨).

## ▶ 그 다음

1. **requireRole 확산(2/11)** — 이사님 항목 16 답 대기. 2. **항목 29 답** 오면 스누즈 트리거 조정(소형).
3. 실기 1개(비admin URL — 비긴급) · L2 · pending-tasks 4건(디자인 확정 필요 — 이사님/실무 결정 대기).

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 14 · 16~28 · **29(신규: 수동 관리 상태 만료 트리거)**.
**앱 쪽** = 애플 개발자 등록 후 재론(FCM 실기기·앱 #582) · 휴대폰 로그인 전환은 아직 구현 불가(요청문 보류 중).

## Boot

1. `AGENTS.md` → 이 파일 순. 2. `git status --short --branch` · `git log --oneline -5`
3. 더 필요하면: 경량 체크 판정 = `ref/plans/2026-07-25-crm-lightweight-consistency-check.md` /
   니즈 파생 = `ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md` / 과거 세션 = `ref/session-archive.md`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 이전 것은 `ref/session-archive.md` 맨 위로.
- 행위 변경은 `ref/director-pending-confirmations.md`에 등재(PR 🟡와 병행). **단 유슨생이 그 자리에서
  승인하면 등재 없이 결정으로 박제**(07-26: 칩 축 교체·상담 메모 A안·같은 번호 경고 — 단 이사님 확정
  설계를 뒤집는 건은 승인 대신 등재했다, 항목 29가 그 사례).
