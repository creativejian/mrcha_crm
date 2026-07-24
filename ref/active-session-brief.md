# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다 — 2026-07-21에 이 파일이
> 142k자까지 자라 세션 컨텍스트의 14%를 먹고 있었다. 지속되는 결정·계약은 `AGENTS.md`(불변 규칙),
> `ref/specs/*`(설계 근거), `ref/current-working-state.md`(장기 상태)가 각각 집이다.

Last updated: 2026-07-24

## 지금 상태

**main 전량 green. 코드 변경 없음(이번 세션은 조사·계약 확정만). 우리 액션이 남은 항목 0.**
07-24 머지 2건 = `2289fb1`(`#339` staff scope 연락처 회귀 그물 + `formatPhone` 서울 02) · `d2d38c8`(앱 V2 출고 계약 회신 문서).
검증: 직전 세션 기준 typecheck 0 · lint 0 · knip 0 · format 0 · unit **1092** · build · edge · server **671** pass · 잔재 0.

## 직전 세션 요약 (2026-07-24 · 0724-quote-parity)

**앱 빠른 견적 V2 출고·추가요청 13필드의 저장 계약을 앱과 공동 확정했다.** 코드는 건드리지 않았고 산출물은 회신 문서 1건.
SSOT = **앱 레포** `reference/design/quote-v2-delivery-crm-data-contract-proposal.md`(v3) · CRM 회신·Phase 2 목록 = `ref/2026-07-24-app-delivery-contract-reply.md`.

**① 발단은 컬러 null 정합성 확인이었는데 더 큰 게 나왔다.** 컬러는 정합 확인(mode null 101행 = 마이그 이전 행 · `selected` 6/6이 컬러 채워짐 = "selected일 때만 저장" 계약 실증 · 앱도 CRM도 nullable). 그 과정에서 **앱 V2 출고 정보가 아직 DB에 저장되지 않는다**는 걸 실측했다 — `quote_requests` 컬럼 23개 중 delivery 계열 **0개**, RPC 인자 22개 중 **0개**. 앱이 "마무리"한 건 UI 플로우이고 **저장 계약은 백지**였다.

**② 핵심 합의 = 카디널리티 하이브리드.** 유슨생 직관("출고는 견적당이 아니라 고객당")이 정확했고 코드 주석에 이미 그 계약이 있었다(`quote-guidance.ts:33` — 지역은 거주지 파생, 입력 UI 없음). 앱은 요청마다 새로 묻고 제출 시 리셋(`finally { reset() }` → `empty()`, 로컬 영속화·프로필 프리필 **0**)이고 고객당 요청이 **최대 95건**(제임스)이라, 요청당 스냅샷 저장 + **승격 시 고객 필드로 수렴**으로 갈랐다. ⚠️ 견적당 "출고" 칸 3개(`quotes.delivery`=탁송료 금액 · `dueAtDelivery`=출고 전 납입 · `guidance.deliveryComment`/`expectedDelivery`=**상담사→고객 안내 문구**)는 전부 다른 의미다.

**③ CRM이 제공한 것 = 정정 2 + 논점 4 + 추가 3(전부 계약에 반영됨).** 정정: `need_delivery_method` CHECK는 4값이 아니라 **5값**(5번째는 미입력 센티넬) · `same_as_delivery`는 "예약"이 아니라 **구조적으로 저장 불가**(renderer·fromPayload가 `different`로 재스탬프). 논점: 🔴**임베딩 전량 재백필** · 두 지역 동시 존재 시 소비 규칙 · 거주지 파생 충돌(→D6) · 희망≠실적. 추가: 과거 월 시드는 정상 · `payment_method` null은 V2부터 생기는 새 경로(기존 113건 전부 non-null) · 어휘 변경 사전 통보.

**④ D1~D6 확정 · D5·D6 승인 완료(유슨생).** D1 `text 'YYYY-MM'` · D2 `text[]` · D3 절대화(앵커 병기 안 함) · D4 마감형 · D5 **빈 칸만 채우기**(현행은 기존 고객 무갱신, `quote-requests.ts:373`) · D6 `customerRegion` **3단 폴백**(앱 지역 → 거주지 파생 → "확인 필요"). D6은 실측이 질문을 바꾼 사례 — `customerRegion`은 저장값을 무시하고 **항상 거주지 재파생**하는 단일 소스라(`useQuoteWorkbench.ts:1649`) "우선순위" 개념이 없었다. **승인 완료라 `director-pending-confirmations.md`에는 등재하지 않았다.**

## ▶ 다음 작업

1. **앱 Phase 1 대기** — migration + RPC + 클라 배선. 그 다음 **CRM Phase 2**(회신 문서 §작업 목록 6항목: 미러 갱신·라벨 +36개·지역 분기(**null 테스트 필수**)·승격 시드·`customerRegion` 3단 폴백(**조립기 2벌 + 파리티 테스트 3곳 동시**)·AI 청크 **1회 재백필**). 앱 잔여 = 이사님 구현 착수 승인 1건.
2. **이사님 회신 대기** — pending **열린 14건**. **21·22는 묶어서**. 항목 **28**은 범위가 좁아져 남은 질문은 "연락처를 물어본 대화 기록에 번호가 남는다" 하나. ⚠️ **NO_HITS 문구+sources 동시 렌더**는 21·22와 얽혀 보류.
3. **🔵 하나캐피탈 통보 대기** — 오면 `SOLUTION_LENDERS`에 `{code,label}` 한 줄(`code`가 컴파일타임 타입이라 자동 반영 안 됨).

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 항목 14 · 16·17 · 18·19 · 20 · **21·22** · 23 · 24 · 25 · 26 · 27 · **28**.
**파트너 Phase B 완료 시** 산은·iM·농협 게이트 자동 점등 → 실기 1회(이때 **구매방식 전환 후 기간 상태** 확인).
실기 협조 2건(FCM 실기기·앱 #582 크로스)은 **애플 개발자 등록 후 재론** — 먼저 밀지 말 것.

## Boot

1. `AGENTS.md` → 이 파일 순으로 읽는다.
2. `git status --short --branch` · `git log --oneline --decorate --max-count=5`
3. 더 필요하면: V2 출고 계약 = `ref/2026-07-24-app-delivery-contract-reply.md` / 연락처 라우팅 = `ref/plans/2026-07-23-crm-assistant-contact-routing.md` / 배치 15 판정 = `ref/plans/2026-07-22-crm-refactor-batch-15.md` / 과거 세션 = `ref/session-archive.md` / 장기 상태 = `ref/current-working-state.md` / 설계 근거 = `ref/specs/*`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 그 이전 것은 `ref/session-archive.md` 맨 위로 옮긴다.
- 행위 변경이 생기면 `ref/director-pending-confirmations.md`에 등재한다(PR 본문 🟡와 병행). **단 유슨생이 그 자리에서 승인하면 등재하지 않고 결정으로 박제한다**(이번 D5·D6 사례).
- 지속되는 계약·함정은 `AGENTS.md`에, 설계 근거는 `ref/specs/*`에 — 여기 쌓지 않는다.
