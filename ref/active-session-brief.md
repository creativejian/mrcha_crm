# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다 — 2026-07-21에 이 파일이
> 142k자까지 자라 세션 컨텍스트의 14%를 먹고 있었다. 지속되는 결정·계약은 `AGENTS.md`(불변 규칙),
> `ref/specs/*`(설계 근거), `ref/current-working-state.md`(장기 상태)가 각각 집이다.

Last updated: 2026-07-24

## 지금 상태

**main 전량 green · 브랜치 0 · 진행 중인 미완 작업 없음.** 07-24 머지 14건(코드 7 + 문서 7).
검증: typecheck 0 · lint 0 · knip 0 · format 0 · unit **1128** · build · edge 26 · server **677** · 잔재 0.

## 직전 세션 요약 (2026-07-24 · 0724-quote-parity)

**앱 빠른 견적 V2 출고 계약을 확정하고 CRM 소비를 구현·실기 검증했다.** 계약 SSOT = 앱 레포
`reference/design/quote-v2-delivery-crm-data-contract-proposal.md`(v3) · **착수 지점 = `ref/2026-07-24-app-delivery-contract-reply.md`**(Phase 2 잔여·실기 관측이 전부 여기 있다).

**① 계약 확정.** 컬러 null 정합 확인에서 출발해 **V2 출고 정보가 DB에 저장되지 않음**을 실측(컬럼 0·RPC 인자 0) → 앱과 D1~D6 확정. **핵심 = 카디널리티 하이브리드**(요청당 스냅샷 + 승격 시 고객 수렴) — 앱은 요청마다 새로 묻고 제출 시 리셋하는데 고객당 요청이 최대 95건이라 갈랐다. D5·D6은 유슨생 즉시 승인(pending 미등재).

**② 구현 `#340`~`#342` + 실기 3케이스.** 미러 13컬럼 · `quote-delivery.ts` 순수 모듈(서버 공용) · 승격 시드(UPDATE WHERE 비파괴) · 앱카드 지역 3단 폴백. **지역 3갈래(인수·등록·`payment_method` null) × 시기 3형태를 실데이터로 전부 검증**했다.

**③ 실기가 부수 결함 4건을 찾았다.** ⓐ`#343` `deposit_type='none'`(무보증) 라벨 누락 — 07-17부터 raw "none" 노출 ⓑ`#345` 니즈 카드가 `additional_request`를 렌더 안 함(#340 누락) ⓒ`#344` **카카오 OAuth가 앱 도메인으로 튀던 것** ⓓ`#346` 계약·출고 목록이 니즈를 계약 차량처럼 표시.

**④ `#344`가 이번 세션 최대 교훈 — `window.location.origin`엔 trailing slash가 없다.** Supabase redirect allowlist가 `https://crm.mrcha.app/**`(경로 구분자 `/` 요구)라 매칭 실패 → **에러 없이 Site URL(mrcha.app)로 폴백**한다(공식 문서). ⚠️ 새 도메인을 붙일 때 재발한다. 진단 중 내가 **"허용목록 누락"·"코드로 못 고침" 두 번 오진**했고 유슨생 스크린샷으로 바로잡았다 — allowlist엔 있었고 코드 한 글자(`/`)로 고쳤다.

**⑤ `#346` — 니즈는 계약 화면에 두면 안 된다.** 제임스 계약은 BMW 운용리스인데 목록엔 "기아 레이 · 장기렌트"(니즈)가 떴다. 니즈는 **최초 승격 때 한 번 박히고 갱신 안 되며**(앱 연결 고객은 편집 UI조차 없다) 요청 95건이 와도 그대로다. 처음엔 `[관심]` 배지로 구분했으나 **유슨생 판단으로 폴백 자체를 제거** — 니즈가 보이면 상담사가 진짜 계약 차량을 안 채운다(실측: **계약완료 8명 전원 계약 차량 미입력**). 이제 계약차량 → 계약진행 견적 → **"차량 미입력"**(입력 유도)이고 구매방식도 동일 규칙(서버 `contractingQuoteSummary`에 `purchaseMethod` 추가).

⚠️ **prod 백지를 한 번 겪었으나 배포 전파 중 일시 현상**이었다(자산 200·번들 정상, 잠시 뒤 복구). 캐시로 구 번들이 뜨는 것도 겪었다 — **prod 확인 전 `bun dev` 재시작/시크릿 창**을 먼저 의심할 것.

## ▶ 다음 작업

1. **Phase 2-6(AI 청크 + 재백필)만 남았다** — V2 데이터가 3건뿐이라 **의도적 보류**. 지금 태우면 데이터 축적 후 또 태운다. 문구(D3·D4)는 확정본에서 **바꾸지 말 것**(바꿔도 재백필).
2. ~~Phase 2-7 인박스 열~~ → **불필요 판단으로 종료**(유슨생 — 목록은 훑고 승격하는 용도, 출고 세부는 카드에서 본다).
3. **`#346` prod 눈 검증** — 계약·출고 관리에서 제임스가 BMW/운용리스, 나머지가 "차량 미입력"으로 뜨는지.
4. **이사님 회신 대기** — pending 열린 14건(21·22는 묶어서). 🔵 하나캐피탈 통보 오면 `SOLUTION_LENDERS` 한 줄.

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 14 · 16·17 · 18·19 · 20 · **21·22** · 23 · 24 · 25 · 26 · 27 · **28**.
**앱 쪽** = 이사님 구현 착수 승인 1건. 앱 출고 시기 2종(`as_soon_as_favorable`·`specific_month`) 미노출은 **의도된 예약**(이사님 판정, `886431de`) — CRM은 6값 준비 완료라 앱이 켜면 무변경 수용.
실기 협조 2건(FCM 실기기·앱 #582)은 **애플 개발자 등록 후 재론**.

## Boot

1. `AGENTS.md` → 이 파일 순으로 읽는다.
2. `git status --short --branch` · `git log --oneline --decorate --max-count=5`
3. 더 필요하면: **V2 출고 = `ref/2026-07-24-app-delivery-contract-reply.md`** / 연락처 라우팅 = `ref/plans/2026-07-23-crm-assistant-contact-routing.md` / 과거 세션 = `ref/session-archive.md` / 장기 상태 = `ref/current-working-state.md` / 설계 근거 = `ref/specs/*`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 그 이전 것은 `ref/session-archive.md` 맨 위로 옮긴다.
- 행위 변경이 생기면 `ref/director-pending-confirmations.md`에 등재한다(PR 본문 🟡와 병행). **단 유슨생이 그 자리에서 승인하면 등재하지 않고 결정으로 박제한다**(D5·D6·`#346` 사례).
- 지속되는 계약·함정은 `AGENTS.md`에, 설계 근거는 `ref/specs/*`에 — 여기 쌓지 않는다.
