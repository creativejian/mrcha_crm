# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다(2026-07-21에 142k자까지 자랐다).
> 지속 결정·계약은 `AGENTS.md`, 설계 근거는 `ref/specs/*`, 장기 상태는 `ref/current-working-state.md`.

Last updated: 2026-07-25 (오후)

## 지금 상태

**main 전량 green · 브랜치 0 · 미완 작업 없음.** 07-25 머지 **6건**(`#357`~`#362`) · prod `f06ac22` Active · **마이그 0건**.
prod 눈 확인은 `#361`·`#362`만 남음. 검증: typecheck 0 · lint 0 · knip 0 · format 0 · unit **1152** · build · edge 26 · server **697**.

## 직전 세션 요약 (2026-07-25 · 0725-fresh-start)

**"수기 니즈 카드와 앱 승격 카드 디자인이 다른데 SSOT 가능한가"에서 출발**했고, 두 카드가 CSS 껍데기를 **이미 공유**해 배치만 맞췄다. 그 과정에 결함 4건이 드러났고, 뒤이어 조직 화면 목업까지 실데이터화했다.
**① 니즈 카드 디자인(`#357`·`#359`·`#360`).** 차량 **2줄**(모델/트림) 통일 — 한 줄이 필요한 곳(인박스·토스트)의 `vehicleLabel`은
**같은 재료로 합성** · 자유문의 **하단 블록** · 계약+출고 **한 줄** · 대표 카드 **아이콘 반전**(🔴 표시 전용·조작은 star) ·
🟡 구매방식 배지 **의도적 미통일** · **빈 값 줄째 제거** · 픽커 로고 뒤 **회색 판 제거**.

**② 설계 D2가 UI에서만 안 지켜지고 있었다(`#357`).** 서버 PATCH 409는 **`featured_request_id`**로 판정하는데 화면은 **`app_user_id`**로
갈라 편집 진입점을 숨겼다(요청 0건 앱 고객이 니즈를 쓸 수 없었다). ⚠️ **그 빈 카드를 없애면 이 문제로 되돌아간다**(카드가 곧
입력 진입점) — `NEEDS_MODEL_PLACEHOLDER`도 **표시 전용**(상태 초기값으로 쓰면 저장된다).

**③ 대표 지정이 네 경로 중 둘에 없었다(`#357`+`#358`).** `linkConsultationToCustomer`·**`createCustomerFromConsultation`**이 빠져 ⭐ 미점등
+ 니즈 빈값이 됐다(실측 `CU-2607-0002` 요청 14건·대표 null). **`featureFirstRequestOf`**로 네 경로 공유. ⚠️ **남은 구멍**: 연결·승격
**후에** 첫 요청이 들어오면 대표가 없다 — ⭐ 한 번으로 해소되는 자기 치유(김민준이 그 상태).

**④ `/org-members`「구성원」탭 실데이터화(`#361`+`#362`).** **`GET /api/staff/org` 신설** — ⚠️ 기존 `/api/staff`(배정 후보)를
넓히지 않고 **나눴다**: 배정 후보는 `ADVISOR_ROLES`(dealer 제외 — 담당 고객 개념이 없어 배정되면 scope 전제가 깨진다),
조직은 `CRM_ROLES` 전부. 컬럼은 **실제 있는 값만** — `profiles` 10컬럼엔 **팀·직함·상태가 없다**(구 "기술본부"는 지어낸 값):
담당 고객 수·상담 수신·연락처·본인 "나" 배지(**id 매칭** — 이름은 3계정이 전부 "김지안"). ⚠️ `ROLE_ACCESS_SUMMARY`는 표시 전용
(권한 규칙 바뀌면 같이 고칠 것). **「조직」·「권한」·`/partners`는 목업 유지** · 접근 제어 = **메뉴·라우트·API 3층 admin**.

**⑤ ⚠️ `test:server` 선재 실패 2건**(CI에 없어 아무도 못 잡는 자리) — **"server green" 기록은 언제든 스테일이다.**
**⑥ 같은 번호로 앱 계정 3개(이사님 예전 테스트).** **CRM에 전화번호 중복 감지는 없다**(dedupe는 `app_user_id` 기준뿐) — 중복 표시 UI는 `ref/pending-tasks.md`에 미구현 과제로 등록됨.
**⑦ 앱 Performance Advisor = 전량 무대응**(근거·트리거는 `ref/current-working-state.md`「DB 인덱스」`036745d`) · RLS 계열 지적은 **CRM 몫 기본 0**.

## ▶ 그 다음

1. 🔵 **경량 정합성 체크 = 착수 지점**(유슨생 지시 2026-07-25). 계획·판정 SSOT =
   **`ref/plans/2026-07-25-crm-lightweight-consistency-check.md`** — 트리거 판정·2앵글·실측 렌즈·하지 않을 것까지
   그 파일만 읽고 바로 시작할 수 있게 써 뒀다. ⚠️ **풀 감사 아님**(배치 15로 폐지).
2. **prod 눈 확인** — `#361`·`#362`(구성원 6명·연락처·본인 배지 · 다른 역할로 `/org-members` URL → 홈 이동).
3. **`requireRole` 확산**(적용 2/11) — `customers.ts`는 필드 단위 게이트가 정답이라 **이사님 항목 16 답 받고** 착수.
   **Phase 2-6**은 V2 데이터 3건뿐이라 **의도적 보류**(위 ③의 남은 구멍도 자기 치유라 급하지 않다).

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 14 · 16·17 · 18·19 · 20 · **21·22** · 23 · 24 · 25 · 26 · 27 · **28**. **앱 쪽** =
이사님 착수 승인 1건 · 실기 협조 2건(FCM 실기기·앱 #582)은 **애플 개발자 등록 후 재론**.

## Boot

1. `AGENTS.md` → 이 파일 순. 2. `git status --short --branch` · `git log --oneline -5`
3. 더 필요하면: **니즈 파생 = `ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md`** / V2 출고 = `ref/2026-07-24-app-delivery-contract-reply.md` / 과거 세션 = `ref/session-archive.md`
## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 이전 것은 `ref/session-archive.md` 맨 위로.
- 행위 변경은 `ref/director-pending-confirmations.md`에 등재(PR 🟡와 병행). **단 유슨생이 그 자리에서 승인하면 등재 없이 결정으로 박제**(07-24 D1~D7 · 07-25 니즈 카드 배치·아이콘 반전·빈 상태·픽커 배경·조직 구성원 컬럼 구성).
