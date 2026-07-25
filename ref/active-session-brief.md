# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다(2026-07-21에 142k자까지 자랐다).
> 지속 결정·계약은 `AGENTS.md`, 설계 근거는 `ref/specs/*`, 장기 상태는 `ref/current-working-state.md`.

Last updated: 2026-07-25 (오후)

## 지금 상태

**main 전량 green · 브랜치 0 · 미완 작업 없음.** 07-25 머지 **4건**(`#357`~`#360`) · prod `2ee2934` Active.
**prod 눈 확인 전부 완료**(오늘 4건 + 이전 세션 잔여 `#346`~`#348`) — **미확인 UI 0.**
검증: typecheck 0 · lint 0 · knip 0 · format 0 · unit **1152** · build · edge 26 · server **692** · 잔재 0.

## 직전 세션 요약 (2026-07-25 · 0725-fresh-start)

**"수기 니즈 카드와 앱 승격 카드 디자인이 다른데 SSOT 가능한가"에서 출발했다.** 두 카드는 CSS 껍데기를 **이미 공유**했고 갈린 건 **필드 배치**뿐이라 공용 컴포넌트 추출 없이 배치만 맞췄고, 그 과정에 결함 4건이 드러났다.

**① 디자인(`#357`·`#359`·`#360`).** 차량 **2줄**(모델/트림) 통일 — `toAppQuoteRequest`가 모델·트림 라벨을 내고 한 줄이
필요한 곳(인박스·토스트)의 `vehicleLabel`은 **같은 재료로 합성** · 자유문의를 수기·상담 카드와 같은 **하단 문의사항
블록**으로(의미는 그대로 요청별) · 계약+출고 **한 줄 결합** · 대표 카드 **차 아이콘 반전**(🔴 표시 전용·조작은 star) ·
🟡 구매방식 배지 **의도적 미통일** · 니즈 카드 **빈 값 줄째 제거**(차종만 안내) · 픽커 로고·이미지 뒤 **회색 판 제거**.

**② 설계 D2가 UI에서만 안 지켜지고 있었다(`#357`).** 서버 PATCH 409는 **`featured_request_id`**로 판정하는데 화면은
**`app_user_id`**로 갈라 편집 진입점을 숨겼다 → 요청 0건 앱 고객이 니즈를 쓸 방법이 없었다. 판정을 featured 축으로 맞추고
수기 카드를 `renderNeedsCard()` 1벌로 공유. ⚠️ **그 빈 카드를 없애면 이 문제로 되돌아간다**(카드가 곧 입력 진입점) —
`NEEDS_MODEL_PLACEHOLDER`도 **표시 전용**(상태 초기값으로 쓰면 빈 값이 그 문자열로 저장된다).

**③ 대표 지정이 네 경로 중 둘에 없었다(`#357`+`#358`).** `linkConsultationToCustomer`·**`createCustomerFromConsultation`**이 빠져
있어, 요청 가진 유저를 상담 인박스에서 연결·승격하면 ⭐ 미점등 + 니즈 빈값(실측 `CU-2607-0002` 요청 14건·대표 null).
**`featureFirstRequestOf`**로 네 경로 전부 공유. ⚠️ **남은 구멍 1개**: 연결·승격 **후에** 첫 요청이 들어오면 대표가 없다(앱
INSERT를 CRM이 훅하지 않음) — ⭐ 한 번으로 해소되는 자기 치유. 김민준이 그 대기 상태(요청 0건 → **정상**).

**④ ⚠️ `test:server` 선재 실패 2건**(CI에 없어 아무도 못 잡는 자리) — **"server green" 기록은 언제든 스테일이다.**

**⑤ 같은 번호로 앱 계정 3개가 있다(이사님 예전 테스트, `01095880812` → 김민준·김지안·김지운).** **CRM에 전화번호 중복
감지는 없다** — dedupe는 `app_user_id` 기준뿐이고 phone 매칭은 앱 미연결 고객만 본다(계약). 중복 표시 UI는
`ref/pending-tasks.md`에 **미구현 과제로 이미 등록**돼 있다.

**⑥ 앱 Performance Advisor = 전량 무대응**(마이그·코드 0건 · 근거·재검토 트리거는 `ref/current-working-state.md`「DB 인덱스 — 무대응 결정」`036745d`). RLS 계열 지적은 **CRM 몫 기본 0**(정책 0건·`rolbypassrls=true`).

## ▶ 그 다음

1. **`requireRole` 확산**(적용 2/11) — 단 `customers.ts`는 필드 단위 게이트가 정답이라 **이사님 항목 16 답 받고** 착수.
2. **Phase 2-6**(AI 청크 재백필) — V2 데이터 3건뿐이라 **의도적 보류**. 위 ③의 남은 구멍도 자기 치유라 급하지 않다.

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 14 · 16·17 · 18·19 · 20 · **21·22** · 23 · 24 · 25 · 26 · 27 · **28**. **앱 쪽** =
이사님 착수 승인 1건 · 실기 협조 2건(FCM 실기기·앱 #582)은 **애플 개발자 등록 후 재론**.

## Boot

1. `AGENTS.md` → 이 파일 순. 2. `git status --short --branch` · `git log --oneline -5`
3. 더 필요하면: **니즈 파생 = `ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md`** / V2 출고 = `ref/2026-07-24-app-delivery-contract-reply.md` / 과거 세션 = `ref/session-archive.md`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 이전 것은 `ref/session-archive.md` 맨 위로.
- 행위 변경은 `ref/director-pending-confirmations.md`에 등재(PR 🟡와 병행). **단 유슨생이 그 자리에서 승인하면 등재 없이 결정으로 박제**(07-24 D1~D7 · 07-25 니즈 카드 배치·아이콘 반전·빈 상태·픽커 배경).
