# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 =
> `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-08

## 지금 상태

main 전량 green(CI 8단계) = `081e08f`. 08-08 오전 8 PR(hermetic 이관·리뷰 이행)에 이어 오후 3 PR.
빠른견적 4단계는 08-07 전 구간 배포 완결(계약 SSOT = `ref/2026-08-07-app-quote-request-ready-for-send-reply.md`)
— 실기 확인만 이사님 대기다. 오전 세션 상세 = `ref/session-archive.md` 맨 위.

## 직전 세션 (08-08 오후 · 유슨생) — 3 PR

- **`#475` 관리중 고객이 두 업무함에 동시 노출되던 것 해소** — 미배정 + "관리중"이 상담 필요·보류/
  이탈 **양쪽에** 떠 어느 쪽도 소진되지 않았다(9명 중 3명). `#260`이 배정 축만 고치고 stage set은
  목업 시절 것을 둔 **잔재**였고, 같은 PR이 세운 "불발→보류/이탈이 담당" 배타 원칙을 마저 적용했다.
  상담필요 9→6. 🟡 `director-pending-confirmations` **항목 33**(사후 공유 · 기각이면 한 줄 원복)에
  판정·기각안·반증 실측이 전문으로 있다.
- **`#476` 키보드 단축키**(신규) — `?`로 우측 시트, 전역 6 + 화면 이동 22. 설계 SSOT =
  `ref/specs/2026-08-08-crm-keyboard-shortcuts-design.md`. 🔴 **꼭 알 것 3가지**:
  ①**판정은 `event.key`가 아니라 `event.code`(물리 키)** — 한글 모드에서 `g`는 `key="ㅎ"`이라
  key로 읽으면 시퀀스가 죽는데 **영문 테스트는 전부 통과**한다(유슨생 질의로 설계 단계 포착).
  ②**`lib/nav-visibility.ts` = 메뉴 가시성 SSOT** — 사이드바와 공유하므로 새 메뉴는 여기만 고친다
  (`shortcut-menu-parity.test.tsx`가 양방향 드리프트를 잡는다). ③**딜러는 3건뿐** — 목적지 없는
  메뉴엔 키를 주지 않는다(사이드바 disabled와 같은 근거).
- **`#477` 단축키 힌트 노출** — 사이드바 메뉴 hover = 라벨 옆 인라인(펼친 상태만) · Topbar 아이콘
  5종 = **버블**. 조회는 사이드바=라벨, 아이콘=`action` id. 실기 피드백에서 **레지스트리 중복**이
  드러나 정리했다(`G A`·`G I`가 같은 경로 → `G A` = "상담사 배정 · 상담 신청 DB"로 통합, `G I` 삭제 ·
  파리티 예외는 죽은 코드가 돼 비움. 노출 수 팀장 19 · 관리자 21).
  ⚠️ **규칙: 같은 목적지에 새 키를 주지 말 것.** "실시간 상담 요청"은 전용 화면이 아니라 chat 콘솔
  리라우트 진입점이라(2026-07-20 결정 ①) 목적지 화면의 키(`G T`)를 안내한다 —
  `advisorAssignmentModes` 3번째 원소가 "표시 이름 ≠ 레지스트리 어휘"를 데이터로 드러낸다.
- 변이 실증 **7종** 전부 RED 후 수동 역편집 원복 · 워킹트리 무손상(누적 22종).

## ▶ 다음 (미확정 — 트리거 없음)

**hermetic 이관 후보는 소진**됐다. 남은 registry 47은 ⓐ실 데이터가 검증 대상 ⓑ실 Gemini 호출
ⓒ실 조직 데이터(staff) — 옮기면 의미를 잃는다. 리뷰 보류분(무잠금 경합·TOCTOU·cross-brand)은 기록만.
후보 하나 발굴됨: **Topbar 실적 배지가 하드코딩 목업**(`Topbar.tsx` "2026년 5월 · 86대 · 48.7억")인데
같은 3지표의 실데이터 조립기(`lib/admin-hero.ts`, `#428`)가 이미 있다 — 배선만 남았고, 당월 0건일 때
표시 방식이 결정 사항이다.

## 실기 대기 (이사님)

2·3단계 최초 1회 · iOS 문구 · 4단계 구매방식/차량 조각 + **v39 timing 실측**(`[send-push] timing`).
🔵 유슨생 몫 1건: **한글 입력 모드에서 `G H`·`?`·`⌘K`**(Safari·Chrome) — macOS 한글 입력기는
브라우저마다 미묘한 차이가 있어 코드 논리만으로 단정하지 않았다(스펙 §3.4).
이상 시 경계 좁히기: DB timestamp → CRM tag 요청 → App consumer → iOS 표시 순.

## 기존 대기

- ⚠️ CI 그물 `delete-where-guard`(`#460`) — 파기 `.delete(테이블)`은 `.where()` 필수(ALLOW에 사유 등록).
- 김지운 탈퇴 테스트(견적 20·앱카드 19) + `#445` 배너 육안 · 🔴 시범 고객 재지정(이사님 결정 영역).
- 트림 mc_code 미부여 198/1869(08-06 실측·차단 0) — 트림 등록 후 "고유번호 할당"이 운영 절차.
- `ref/director-pending-confirmations.md` **19건**(08-08 항목 33 신설) + Supabase usage 배지 + D+5 SLA 해석.
- 버전 표시·릴리스 체계 보류 — 재개 시 `ref/plans/2026-08-05-crm-versioning-release.md`부터(재논의 금지).

## Boot / 세션 마무리 규칙

부팅: `AGENTS.md` → 이 파일 → `git status -sb` · `git log --oneline -5`.
마무리: **교체**(누적 금지 · 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(유슨생 현장 승인은 등재 없이 박제 · 이사님 확정 설계를
뒤집는 건만 등재). 상세 규칙 = AGENTS.md "Handoff Documents".
