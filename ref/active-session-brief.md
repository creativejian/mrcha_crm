# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다(2026-07-21에 142k자까지 자랐다).
> 지속 결정·계약은 `AGENTS.md`, 설계 근거는 `ref/specs/*`, 장기 상태는 `ref/current-working-state.md`.

Last updated: 2026-07-24 (밤)

## 지금 상태

**main 전량 green · 브랜치 0 · 미완 작업 없음.** 07-24 머지 **25건**(오전~오후 18 + 밤 7: `#349`~`#355`).
검증: typecheck 0 · lint 0 · knip 0 · format 0 · unit **1149** · build · edge 26 · server **687** · 잔재 0.

## 직전 세션 요약 (2026-07-24 밤 · 0724-needs-staleness)

**전 세션 1순위였던 고객 니즈(`need_*`) 스테일 문제를 설계부터 구현까지 종결했다.**
설계 SSOT = `ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md`(D1~D7) ·
계획 = `ref/plans/2026-07-24-crm-featured-request-needs.md`.

**① 해법은 자동 갱신이 아니라 "대표 견적요청"이다.** 실측이 방향을 뒤집었다 — 제임스는 요청 **98건**,
**하루에만 서로 다른 차 3대**를 요청했다. "최신 요청 = 현재 관심" 가정이 성립하지 않아, 상담사가 카드의
**star로 대표 1건을 지정**하고 니즈 7필드를 거기서 파생하는 구조로 갔다. 기본 대표 = 최초 요청.

**② `#349`+`#350`.** `featured_request_id` 컬럼 · 파생 순수 모듈(`quote-request-needs.ts`, 서버 공용) ·
승격 시드 개편(비파괴 → **덮어쓰기**) · 백필 2명 · 대표 지정 API · star UI · 파생 7필드 **PATCH 409** ·
상세 read-only · 출고 시기 프리셋을 앱 4종(`이번 달`·`다음 달`·**`3개월 이내`**·`미정`)으로.
⚠️ **read-only 판정은 `app_user_id`가 아니라 `featured_request_id`**(요청 0건 앱 고객은 수기 입력 유지).

**③ 계획을 실행 중 3번 정정했다(전부 실측 근거).** ⓐ 라우트를 `quote-requests` → **`customers`**로(저쪽은
인박스 전면 게이트라 드로어 호출부가 staff에서 403 — `#302`와 같은 축) ⓑ 세 승격 경로가 **모두 최초 요청**을
대표로 ⓒ `detail-utils` 대신 `toLocaleString`(그 파일이 react를 import).

**④ 실기가 즉시반영 버그 2건.** `useCustomerPurchase`가 `detail`을 `useState` 초기화 함수로만 읽어 **최초 마운트 값에 고정**돼 있었다(동기화 effect 추가) · 고객 목록은 **상세와 별도 캐시**라 재페치 배선 필요.

**⑤ 부수 3건.** `#351` 배지를 출고 칩과 같은 입체로 통일(`.badge`를 `.stage-status-button` 그룹에 합침 —
**앱 전체 배지가 커졌다**) · `#352` **prod 딜레이 해소**(왕복 2회 → 갱신값을 응답에 실어 1회) + 계약 차종 열
폭 · `#353` 차량 셀 2줄(견적에 이미 나뉘어 있던 구조를 합치느라 잘렸다) · `#354`·`#355` **즉시 반영 축 정리**(목록 행·니즈↔구매조건 동기화 + 니즈 폼 `미정` 옵션 — 없어서 관심 차종만 저장해도 `장기렌트`가 박혔고, `입력값 || 기존값` 폴백 탓에 한 번 넣은 값을 지울 수 없었다).

## ▶ 그 다음

1. **prod 눈 검증** — star 토글 · read-only · 프리셋 4종 · `#353` 차량 2줄 · **배지(앱 전체가 커졌으니 대시보드·정산·파트너·AI 설정·채팅도 훑을 것)**.
2. **이전 세션 잔여** — V2 출고 prod 확인 3건(`#346`~`#348`) · Phase 2-6(AI 청크 재백필 — V2 데이터 3건뿐이라 **의도적 보류**) · 경량 정합성 체크 1회(**풀 감사 안 함**).
3. **이사님 회신 대기** — pending 열린 14건. 🔵 하나캐피탈 통보 오면 `SOLUTION_LENDERS` 한 줄.

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 14 · 16·17 · 18·19 · 20 · **21·22** · 23 · 24 · 25 · 26 · 27 · **28**.
**앱 쪽** = 이사님 착수 승인 1건(출고 시기 2종 미노출은 **의도된 예약** `886431de`) · 실기 협조 2건(FCM 실기기·앱 #582)은 **애플 개발자 등록 후 재론**.

## Boot

1. `AGENTS.md` → 이 파일 순으로 읽는다. 2. `git status --short --branch` · `git log --oneline -5`
3. 더 필요하면: **니즈 파생 = `ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md`** /
   V2 출고 = `ref/2026-07-24-app-delivery-contract-reply.md` / 과거 세션 = `ref/session-archive.md`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 이전 것은 `ref/session-archive.md` 맨 위로.
- 행위 변경은 `ref/director-pending-confirmations.md`에 등재(PR 본문 🟡와 병행). **단 유슨생이 그 자리에서
  승인하면 등재하지 않고 결정으로 박제한다**(오늘 D1~D7이 그 경우).
