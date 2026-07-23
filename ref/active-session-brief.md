# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다 — 2026-07-21에 이 파일이
> 142k자까지 자라 세션 컨텍스트의 14%를 먹고 있었다. 지속되는 결정·계약은 `AGENTS.md`(불변 규칙),
> `ref/specs/*`(설계 근거), `ref/current-working-state.md`(장기 상태)가 각각 집이다.

Last updated: 2026-07-22

## 지금 상태

**오늘(2026-07-23) 5건 머지 완료 — main 전량 green. 진행 중인 미완 작업 없음.**
`c11c439`(`#329` ②c controlled 전환) · `30f9272`(`#330` 금융사 드리프트 가드) · `4c4d0bc`(`#331` 개명 축) · `fd36a8d`(`#332` 업무 AI 연락처) + docs 2건.
검증: typecheck 0 · lint 0 · knip 0 · unit **1086** · build · format · server 653 pass(선재 실패 1건은 아래).

## 직전 세션 요약 (2026-07-23 · 0722-batch13-fix)

**① 배치 13 마지막 별건 ②c 종결(`#329`).** 워크벤치 금융사·판매사 select를 uncontrolled DOM → **카드 controlled state**로 승격. 거울 `lenderByCard`·재동기화 `useLayoutEffect` 폐기(state가 진실). **`lenderSeed` 신설**(②b 기각 사유 회피 = 레거시 금융사로 되돌아오기)·**`manualQuoteCardsRef`**(늦은 응답 stale 가드, #163 재발 방지). 🟡**K1-c 신 정책**: 구매방식 전환으로 미취급이 된 금융사를 조용히 리셋하던 것 → **리셋+토스트**(pending 27). 변이 3종 RED 실증. **실 Safari 눈확인 통과**(유슨생·prod) — 자동화가 원리적으로 못 보는 유일한 축이 사람 눈으로 닫혔다. SSOT = `ref/plans/2026-07-22-crm-workbench-select-controlled.md`.

**② 금융사 SSOT 드리프트 가드 신설(`#330`·`#331`).** `SOLUTION_LENDERS`가 파트너 미러인데 **감지 장치가 0**이었다(CRM은 파트너 lenders 경로를 아예 안 부름). **live fetch로 바꾸지 않는 이유**(컴파일타임 타입·저장 label 계약·CRM 상위집합·파트너 없이도 뜨는 드롭다운)를 `AGENTS.md`에 박제하고, 대신 그물 2겹: ⓐ런타임(매트릭스 수신 시 1회 경고, **화면 동작 불변**) ⓑ**`bun run check:lenders`**. 축 3개 = 추가·삭제·**개명**. 제프에 `lenderName`을 요청했더니 **당일 수락·구현·배포** → 실기로 `표시명 전량 일치 ✅ (lenderName 8건)`. 제프도 대칭 가드(라우트 테스트에 8사 리터럴)를 세워 **양쪽이 서로 감시**한다.

**③ 업무 AI 연락처 사고 수정(`#332`).** "제임스 연락처?" → "조회 결과에 연락처 정보가 없습니다". **AI 결함이 아니라** 도구 프로젝션에 phone이 아예 없었다. ⚠️**순진한 픽스는 더 나빴다** — 소유권 계약(#276)상 앱 연결 고객은 `customers.phone`이 **항상 NULL**이라(제임스·김지안 둘 다 앱연결·컬럼 NULL 실측) 화면엔 번호가 보이는데 AI만 "없다"고 단정하게 된다. 목록·상세와 같은 **합성**(`composedPhone` export + profiles 조인)을 쓰고 `phone_secondary`도 **"추가 연락처" 라벨로 구분**해 실었다. 변이로 RED 실증. 🟡pending 28.

**④ ⚠️ 발견한 정책 충돌(pending 28에 명시).** 근거 검색 **코퍼스는 phone을 2026-07-06에 의도적으로 제외**했다("PII — 프롬프트 노출 리스크", `assistant-corpus.ts`). 이번엔 **도구**에 넣었으므로 두 경로 정책이 갈렸다. 판단 근거 = 노출 조건 차이(코퍼스=**모든 질문에 상시** vs 도구=**명시적으로 검색했을 때만**). 통일 지시가 오면 맞춘다.

**⑤ 선재 플레이크 1건(별건).** `customers.delivery.test.ts:56` 타임스탬프 동등성 단언이 **전체 실행에서만** 실패한다(단독 8 pass). stash 후 main에서도 동일 재현(650/1) → **오늘 변경과 무관**. 테스트 주석이 스스로 시계 스큐 플레이크를 인정한 지점.

## ▶ 다음 작업

1. 🔵 **[집에서 바로 착수 · 설계 확정됨] 업무 AI 연락처 질문이 경로 따라 답이 갈린다.** 설계 SSOT = **`ref/plans/2026-07-23-crm-assistant-contact-routing.md`**(증상 4종·근본 원인 2겹·D1/D2/D3·함정·검증법 전부 거기). 이사님 확인 불필요 — 유슨생 결정으로 진행.
   - **결론 요약**: ⓐ**주 = `CustomerMeta`에 연락처 병기**(레포에 이미 있는 패턴 — 진행 상태가 같은 이유로 코퍼스에서 빠지고 메타로 실린다). 임베딩 무변경·재임베딩 0이고 **라우팅 뽑기가 무관해진다** ⓑ부 = 라우터 프롬프트/description이 "필터(입력)"와 "묻는 값(출력)"을 구분하게 정리 ⓒ**도구 호출 강제는 기각**(`mode:"ANY"`는 `none`을 죽여 잡담까지 도구를 부르고, 정규식은 이름 추출이 브리틀 — 둘 다 증상만 고친다).
   - ⚠️ **최대 함정**: `getCustomerMetaByIds`가 `customers.phone`만 읽으면 **신고된 케이스가 그대로 안 고쳐진다** — 제임스·김지안 **둘 다 앱연결**이라 그 컬럼이 NULL이다. `composedPhone` + `profiles` 조인 필수(`#332`와 동일 함정).
   - ⚠️ **검증**: 골든 4종으로 안 잡히는 축 → **실기 4종 × 반복 전/후 대조**가 유일 수단. 회귀로 `마이바흐…`(`#315` top1 0.6146·마진 0.0146)와 잡담 1종을 함께 본다. **`SIMILARITY_THRESHOLD`는 건드리지 않는다.**
2. **이사님 회신 대기** — pending **열린 14건**(25·26·27·**28** 신설). **21·22는 묶어서** 여쭙는 게 효율적. ⚠️ **NO_HITS 문구+sources 동시 렌더**는 21·22 결정과 얽혀 보류(지금 고치면 두 번 고친다) — 오늘 실기 화면에서도 그 증상이 재확인됐다.
3. **🔵 하나캐피탈 통보 대기** — 파트너가 배선 착수 전 통보 약속. 오면 `SOLUTION_LENDERS`에 `{code,label}` 한 줄 추가(`code`가 컴파일타임 타입이라 자동 반영 안 됨. 가드도 `onlyPartner`로 잡는다).
4. **선재 플레이크 정리(선택)** — 위 ⑤.

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 항목 14 · 16·17 · 18·19 · 20 · **21·22**(업무 AI 표시 UX — 묶어서 여쭙는 게 효율적) · 23 · 24.
**파트너 Phase B 완료 시** 산은·iM·농협 게이트 자동 점등 → 실기 1회(이때 **구매방식 전환 후 기간 상태** 확인).
실기 협조 2건(FCM 실기기·앱 #582 크로스)은 **애플 개발자 등록 후 재론** — 먼저 밀지 말 것.

## Boot

1. `AGENTS.md` → 이 파일 순으로 읽는다.
2. `git status --short --branch` · `git log --oneline --decorate --max-count=5`
3. 더 필요하면: 배치 15 판정 = `ref/plans/2026-07-22-crm-refactor-batch-15.md` / 과거 세션 = `ref/session-archive.md` / 장기 상태 = `ref/current-working-state.md` / 설계 근거 = `ref/specs/*`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 그 이전 것은 `ref/session-archive.md` 맨 위로 옮긴다.
- 행위 변경이 생기면 `ref/director-pending-confirmations.md`에 등재한다(PR 본문 🟡와 병행).
- 지속되는 계약·함정은 `AGENTS.md`에, 설계 근거는 `ref/specs/*`에 — 여기 쌓지 않는다.
