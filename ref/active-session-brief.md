# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다(2026-07-21에 142k자까지 자랐다).
> 지속 결정·계약은 `AGENTS.md`, 설계 근거는 `ref/specs/*`, 장기 상태는 `ref/current-working-state.md`.

Last updated: 2026-07-25 (오전)

## 지금 상태

**main 전량 green · 브랜치 0 · 미완 작업 없음.** 07-25 머지 **1건**(`#357`) · prod 확인 완료.
검증: typecheck 0 · lint 0 · knip 0 · format 0 · unit **1152** · build · edge 26 · server **690** · 잔재 0.

## 직전 세션 요약 (2026-07-25 오전 · 0725-fresh-start)

**"수기 니즈 카드와 앱 승격 카드 디자인이 다른데 SSOT 가능한가"에서 출발해, 디자인 4건 + 그 과정에 드러난 결함 3건을 `#357` 한 PR로 종결했다.**
두 카드는 CSS 껍데기를 **이미 공유**했고 갈린 건 **필드 배치**뿐이라, 공용 컴포넌트 추출 없이 배치만 맞췄다(같은 파일에 나란히 있어 위험 낮음).

**① 디자인 4건.** 차량 **2줄**(모델/트림) 통일 — `toAppQuoteRequest`가 `vehicleModelLabel`·`vehicleTrimLabel`을 내고
한 줄이 필요한 곳(인박스·토스트)의 `vehicleLabel`은 **같은 재료로 합성** · 자유문의를 수기·상담 카드와 같은 **하단
문의사항 블록**으로(의미는 그대로 요청별) · 계약+출고 **한 줄 결합** · 대표 카드 **차 아이콘 반전**. 🔴 **아이콘은
표시 전용·조작은 계속 star** · 🟡 **구매방식 배지는 의도적 미통일**(둘 다 사유는 주석에).

**② 설계 D2가 UI에서만 안 지켜지고 있었다.** 서버 PATCH 409는 **`featured_request_id`**로 판정하는데 화면은
**`app_user_id`**로 갈라 편집 진입점을 숨겼다 → **상담신청으로만 유입돼 요청 0건인 앱 고객은 니즈를 쓸 방법이 없었다**
(승격 시 상담 차종이 `need_model`에 들어가 "값은 있는데 못 고침"). 수기 카드를 `renderNeedsCard()` 1벌로 뽑아 공유.

**③ 연결 경로 비대칭.** `linkRequestToCustomer`만 대표를 정하고 `linkConsultationToCustomer`는 빠져 있어, 요청 가진 유저를 상담 인박스에서 연결하면 ⭐ 미점등 + 니즈가 옛 수기값. **`featureFirstRequestOf`**로 뽑아 세 호출부 공유.

**④ ⚠️ `test:server` 선재 실패 2건 발견(CI에 없어 아무도 못 잡는 자리).** `routes/quote-requests.test.ts`가 정렬 없는
`limit(1)`로 집은 고객이 **어제 생긴 `CU-2607-0001`(phone 보유)로 바뀌며** `app_user_id` 세팅이 CHECK에 거부됐다(픽스처
`phone: null`로 해소). **"server green" 기록은 언제든 스테일 — 실측이 우선.**

**⑤ prod 배포 확인은 `wrangler pages deployment list`의 Source 해시 대조로.** main push엔 CF가 commit status를 안 붙여
(PR에만) `gh api .../status`가 늘 `pending`으로 보인다.

## ▶ 그 다음

1. **이전 세션 잔여** — V2 출고 prod 확인 3건(`#346`~`#348`) · Phase 2-6(AI 청크 재백필 — V2 데이터 3건뿐이라
   **의도적 보류**) · 경량 정합성 체크 1회(**풀 감사 안 함**).
2. **미확인 UI** — 대표 없는 앱 고객의 수기 편집 카드는 **해당 고객 0명이라 화면에서 못 봤다**(요청 0건
   상담신청 유저 1명 대기 중 — 승격하면 재현).
3. **이사님 회신 대기** — pending 열린 14건. 🔵 하나캐피탈 통보 오면 `SOLUTION_LENDERS` 한 줄.

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 14 · 16·17 · 18·19 · 20 · **21·22** · 23 · 24 · 25 · 26 · 27 · **28**.
**앱 쪽** = 이사님 착수 승인 1건(출고 시기 2종 미노출은 **의도된 예약** `886431de`) · 실기 협조 2건(FCM 실기기·앱 #582)은 **애플 개발자 등록 후 재론**.

## Boot

1. `AGENTS.md` → 이 파일 순. 2. `git status --short --branch` · `git log --oneline -5`
3. 더 필요하면: **니즈 파생 = `ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md`** / V2 출고 =
   `ref/2026-07-24-app-delivery-contract-reply.md` / 과거 세션 = `ref/session-archive.md`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 이전 것은 `ref/session-archive.md` 맨 위로.
- 행위 변경은 `ref/director-pending-confirmations.md`에 등재(PR 🟡와 병행). **단 유슨생이 그 자리에서 승인하면 등재
  없이 결정으로 박제**(07-24 D1~D7 · 07-25 니즈 카드 배치·아이콘 반전).
