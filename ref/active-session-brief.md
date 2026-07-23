# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다 — 2026-07-21에 이 파일이
> 142k자까지 자라 세션 컨텍스트의 14%를 먹고 있었다. 지속되는 결정·계약은 `AGENTS.md`(불변 규칙),
> `ref/specs/*`(설계 근거), `ref/current-working-state.md`(장기 상태)가 각각 집이다.

Last updated: 2026-07-23

## 지금 상태

**main 전량 green. 진행 중인 미완 작업 없음.**
오늘 머지 **10건** — 오전 5건(`#329`~`#332` + docs 2) · 오후 5건: `8799def`(`#333` 업무 AI 연락처 라우팅 종결) · `6d8845b`·`67f26f6`(CI 서술·잡 이름 정정) · `366b5bd`(`#334` updated_at 시계) · `bb2b6ed`(`#335` 전량 통일 + tripwire).
검증: typecheck 0 · lint 0 · knip 0 · format 0 · unit **1086** · build · edge · server **668** pass · 잔재 0.

## 직전 세션 요약 (2026-07-23 오후 · 0723-customer-meta)

**① 업무 AI 연락처가 말투에 따라 답이 갈리던 것 종결(`#333`).** 설계 SSOT의 D1·D2를 이행하고 D4를 추가했다. **실측 대조가 이 슬라이스의 핵심** — 변경 전 `제임스 연락처?`/`… 알려줘`/`제임스 연락처`/`김지안 연락처?` **각 3회 = 12/12 전부 실패**(설계 문서가 성공으로 적은 김지안조차 재현 안 됨 = "뽑기" 진단의 재확인) → 변경 후 **12/12 성공**.
- **D1** `CustomerMeta`에 연락처 병기 — `composedPhone` + `profiles` 조인 **필수**(앱 연결 고객은 `customers.phone`이 CHECK상 항상 NULL). 임베딩 무변경·재임베딩 0. 헤더는 **매 청크 반복**(고객당 1회는 기각 — 청크에 `customerId`가 없어 이름으로 묶으면 동명이인의 두 번째 번호가 빠진다).
- **D2** 라우터 프롬프트 + `search_customers` description에 "필터는 **검색 조건**이지 답의 내용을 제한하지 않는다". ⚠️ **설계 문서의 "D2는 부"를 정정했다** — D1은 `metaById`를 hits에서 만들어 **hits 0이면 원리적으로 무효**고, 실기 4종 중 2종이 그 상태였다. 변경 후 4종이 전부 `sources: tool` = **닫은 것은 D2**.
- **D4**(유슨생 지시) 묻지 않은 연락처를 답에 쓰지 않는다 — `CONTACT_DISCLOSURE_RULE`을 **RAG·도구 양쪽 프롬프트가 공유**(한쪽만 넣으면 "경로 따라 갈린다"가 재발). 근거에서 빼는 게 아니라 **실어두되 쓰지 말라**. 재측정: 마이바흐 3/3 노출 0 · `장기렌트 고객 누구야?`(9명) 3/3 노출 0 — **`#332`부터 있던 도구 경로 대량 노출도 함께 닫혔다**.
- 회귀 무손상: `마이바흐…` 3/3 정상 · `안녕?` 3/3 범위 밖(`none` 생존). **`SIMILARITY_THRESHOLD`는 건드리지 않았다.**

**② 실기 방법이 재사용 자산이다.** 브라우저 대신 magiclink 토큰 + `POST /api/assistant/ask` 직접 호출로 **반복 횟수를 벌었다**(스크립트: 스크래치패드 `probe.sh`/`probe2.sh` — 세션 소멸성이라 필요하면 재작성). ⚠️ **매 요청 후 `crm.assistant_messages` 삭제 필수** — 라우터가 history를 함께 넘겨서 안 지우면 2회차부터 1회차 답에 끌려가 독립 시행이 아니게 된다. BEFORE는 유슨생이 띄워둔 dev 서버(8788)가 **변경 전 코드 그대로**여서 그대로 썼고(`dev:api`는 watch 없음), AFTER는 8789에 따로 띄워 대조했다.

**③ "선재 플레이크"가 실제 결함이었다(`#334`·`#335`).** 별건으로 미뤄둔 `customers.delivery.test.ts` 플레이크를 유슨생이 되짚어 봐서 잡았다. `updated_at`을 **INSERT는 `defaultNow()`(DB 시계)·UPDATE만 `new Date()`(앱 시계)**로 찍고 있어 **갱신할 때마다 스탬프가 과거로 되돌아갔다**(실측: 앱이 2.08초 뒤처져 upsert **12/12 역전**).
- ⚠️ **테스트가 왜 못 잡았나** — 구 단언은 두 실패 모드 사이에 끼어 있었다: `>`는 스큐가 크면 깨지고(그래서 `not.toBe`로 완화됨), `not.toBe`는 스큐 ~0에서 두 호출이 같은 ms에 떨어지면 깨진다(JS Date는 ms 절삭 = "전체 실행에서만 실패"의 정체). **통과하는 쪽이 오히려 시계가 더 틀어진 상태였다.** → 비교를 **DB 안으로**(`updated_at > created_at`, 마이크로초).
- **`#335`에서 9곳 전량 통일** + 소스 스캔 tripwire(`src/db/updated-at-clock-guard.test.ts` — **변수 우회도 fail-closed**). 가장 미묘한 축은 **스누즈**: 유효 규칙 `manage_status_at >= staffActivityAt`의 greatest에 자식 `created_at`(DB 시계)이 들어가는데 `manage_status_at`만 앱 시계라 **켜자마자 만료**될 수 있었다. `updateCustomer`는 인라인 `sql\`now()\`` 2회로 바꾸고 "한 statement의 now()는 동일"을 **실 DB 테스트로 잠갔다**.
- **실 데이터 역전 0건**(customers 22 · quotes 8 · deliveries 0) — **prod 손상 없음**. 2.08초는 이 개발 머신 실측이고 **prod 스큐는 미측정**이다. 계약은 `AGENTS.md`에 박제.

**④ CI 서술 스테일 정정(`6d8845b`·`67f26f6`).** AGENTS.md·CLAUDE.md가 CI를 "4종(typecheck·lint·unit·build)"으로 적고 **"knip·format:check은 제외"**라고 못 박고 있었으나, 둘 다 기준선 0으로 정리된 뒤 2026-07-22에 **이미 추가돼 있었다**(실제 **7단계**: +knip·format·edge). 그 서술과 **잡 이름**이 겹쳐 `#333`에서 로컬 knip을 건너뛰었고 unused export 1건으로 CI가 한 번 빨개졌다. → 문서 정정 + **잡 이름을 실제 7단계로 교체**(`typecheck · lint · knip · format · unit · build · edge`) + `ci.yml`에 "step 추가·제거 시 이름도 함께 고친다" 규칙 명시.

## ▶ 다음 작업

1. **이사님 회신 대기** — pending **열린 14건**. **21·22는 묶어서** 여쭙는 게 효율적. 항목 **28은 범위가 좁아졌다** — 부작용(묻지 않은 노출)은 D4로 닫혔고 남은 질문은 **"연락처를 물어본 대화 기록에 번호가 남는다"** 하나다. ⚠️ **NO_HITS 문구+sources 동시 렌더**는 21·22 결정과 얽혀 보류(지금 고치면 두 번 고친다).
2. **🔵 하나캐피탈 통보 대기** — 파트너가 배선 착수 전 통보 약속. 오면 `SOLUTION_LENDERS`에 `{code,label}` 한 줄 추가(`code`가 컴파일타임 타입이라 자동 반영 안 됨. 가드도 `onlyPartner`로 잡는다).
3. ~~선재 플레이크 정리~~ → **`#334`·`#335`로 종결**(위 ③ — 플레이크가 아니라 실제 결함이었다).

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 항목 14 · 16·17 · 18·19 · 20 · **21·22**(업무 AI 표시 UX — 묶어서 여쭙는 게 효율적) · 23 · 24 · 25 · 26 · 27 · **28**.
**파트너 Phase B 완료 시** 산은·iM·농협 게이트 자동 점등 → 실기 1회(이때 **구매방식 전환 후 기간 상태** 확인).
실기 협조 2건(FCM 실기기·앱 #582 크로스)은 **애플 개발자 등록 후 재론** — 먼저 밀지 말 것.

## Boot

1. `AGENTS.md` → 이 파일 순으로 읽는다.
2. `git status --short --branch` · `git log --oneline --decorate --max-count=5`
3. 더 필요하면: 연락처 라우팅 = `ref/plans/2026-07-23-crm-assistant-contact-routing.md`(이행 결과·실측표 포함) / 배치 15 판정 = `ref/plans/2026-07-22-crm-refactor-batch-15.md` / 과거 세션 = `ref/session-archive.md` / 장기 상태 = `ref/current-working-state.md` / 설계 근거 = `ref/specs/*`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 그 이전 것은 `ref/session-archive.md` 맨 위로 옮긴다.
- 행위 변경이 생기면 `ref/director-pending-confirmations.md`에 등재한다(PR 본문 🟡와 병행).
- 지속되는 계약·함정은 `AGENTS.md`에, 설계 근거는 `ref/specs/*`에 — 여기 쌓지 않는다.
