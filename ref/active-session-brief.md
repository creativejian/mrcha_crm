# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다 — 2026-07-21에 이 파일이
> 142k자까지 자라 세션 컨텍스트의 14%를 먹고 있었다. 지속되는 결정·계약은 `AGENTS.md`(불변 규칙),
> `ref/specs/*`(설계 근거), `ref/current-working-state.md`(장기 상태)가 각각 집이다.

Last updated: 2026-07-22

## 지금 상태

**배치 13 잔여 별건(②c) + 금융사 SSOT 드리프트 가드까지 머지 완료. 진행 중인 미완 작업 없음.** 그 전엔 배치 15 종결 + Topbar 팝오버 · CI 도입/위생 잠금 · 별건까지 완료된 상태였다.
최근 머지: `c11c439`(`#329` ②c controlled 전환) · `30f9272`(`#330` 금융사 드리프트 가드). main 검증 green — typecheck 0 · lint 0 · knip 0 · unit **1082** · build · format.

**①②c(`#329`):** 워크벤치 금융사·판매사 select를 uncontrolled DOM → **카드 controlled state**로 승격. 거울 `lenderByCard`·재동기화 `useLayoutEffect` 폐기(state가 진실). `lenderSeed` 신설(②b 회피 = 레거시 금융사 되돌아오기)·`manualQuoteCardsRef`(늦은 응답 stale 가드). **K1-c 신 정책**: 구매방식 전환으로 미취급이 된 금융사를 조용히 리셋하던 것 → **리셋+토스트**(🟡 행위 변경 = pending 항목 27). **변이 3종 RED 실증**(seed·D4·onInput). SSOT = `ref/plans/2026-07-22-crm-workbench-select-controlled.md`. ⚠️ 실 Safari 눈확인은 자동화 재현 불가라 유슨생 몫.

**②금융사 SSOT 드리프트 가드(`#330`):** `SOLUTION_LENDERS`는 파트너 목록의 **하드코딩 미러**인데 감지가 0이었다. **live fetch로 바꾸지 않는다**(컴파일타임 타입·저장 label 계약·CRM 상위집합·파트너 없이도 뜨는 드롭다운 — 근거는 `AGENTS.md`에 박제). 대신 그물 2겹: ⓐ런타임(매트릭스 수신 시 양방향 대조 → 콘솔 경고 1회, **화면 동작 불변**) ⓑ**`bun run check:lenders`**(파트너 직접 조회·exit 1). **제프에 새 API 요청 0** — 기존 support-matrix가 전량 반환이라 그 `lenderCode` 집합이 대조 원천. 실기 확인 = **파트너 8사 = 우리 8사 일치**, 변이로 양방향 드리프트·exit 1 재현 후 복원.

최근 머지: `2460d55`(PR1 `#320` 계약 근거절 정정·감사 관례 축소 박제) · `b8a12a8`(PR2 `#321` 회귀 그물 3건, 변이로 RED 실증) · `35c068b`(`#322` 상단바 팝오버 우측 잘림) · `342c70f`(`#323` **CI 도입**) · `e8ab97c`(`#324` Edge 배선·실 Gemini 호출 제거) · `e3adc14`(`#325` knip·format 잠금) · `490d63b`(`#326` stale 딜러 목록).
main 통합 검증 green — typecheck 0 · lint 0 · unit **1068** · server **651** · edge **26** · build · **knip 0 · format green** · 픽스처 잔재 0. **이제 push·PR마다 CI가 7단계(typecheck·lint·knip·format·unit·build·edge)를 자동 검증한다**(server만 로컬 — 공유 DB).
판정 14건 중 **이행 12 · 조치 불요 2**. SSOT = `ref/plans/2026-07-22-crm-refactor-batch-15.md`(종결 절 포함).
⚠️ **다음 배치부터 풀 감사는 트리거 기반 경량형**이다 — 근거·규칙은 `AGENTS.md` Verification Budget 절에 박제됐다.

## 직전 세션 요약 (2026-07-22 · 0722-new-start)

**① 배치 15 감사.** 48 에이전트·5.39M 토큰·68분·에러 0. 4앵글 22건 → 트리아지 14 → 적대 검증 42표 → 스팟. 판정 = **전건 생존(기각 0) · 상 0 · 중 5 · 하 9 · 행위 변경 0**. SSOT = **`ref/plans/2026-07-22-crm-refactor-batch-15.md`**(상세·정정문·한계 전부 거기).

**② 스팟이 잡은 결정적 사실 3가지.** ⓐ**실기 골든 4종이 모델 상향을 판별하지 못한다** — 현행 `3.5-flash-lite` 4/4 통과·인자 날조 0인데 **구 `3.1-flash-lite`도 4/4 동일**. `AGENTS.md`가 이 4종을 모델 교체 검증 수단으로 지정해 둔 상태 ⓑ**`test:server` 1회가 실 Gemini에 라우팅 9콜을 발사한다**(계측 확인) — "페이크 주입"은 사실과 다름. 단 업스트림을 죽여도 29/29 통과라 **불안정이 아니라 무기록 외부 의존·비용** 문제 ⓒ이사님께 약속한 **구 힌트 22건 백업이 휘발성 스크래치패드에만** 있었다 → **✅ 이관 완료**(`~/Documents/TypeScript/mrcha-crm-local-backups/2026-07-22-ai-hint-319/`, before/after 22행 + 원복 README).

**③ 감사의 자정 3건.** M11(Edge 테스트 "안 돌아감") **DISPROVEN** — Deno로 26/26 green, 남는 건 CI 배선 0뿐 · M10(`#317` "표식 없음") **DISPROVEN** — 표식이 이미 있어 **조치 불요** · M8은 결함이 아니라 **주어 모호**로 격하. M2·M12·M13은 **원인이 이 배치가 아니라 선재**임이 밝혀져 귀속 정정.

**④ 실 데이터 기준선(읽기 전용).** `crm.embeddings` **161행 전량 현행 스킴 일치**(구 모델 혼입 0) · AI 힌트 **20/20 신 스킴 정착**(앱 연결 2명은 알림 트리거 회피로 미검사) · 생성 산출물 영속 저장처 **2종 122행** · Edge 배포는 **대상 함수만** 갱신(슬러그 명시가 실효).

**⑤ 감사 관례 축소 결정(유슨생 승인) — `AGENTS.md` 박제 완료.** **배치 15를 마지막 풀 감사로** 한다. 근거 = 배치 14·15 연속 **사용자 가시 오작동 0건**이고 ADJUSTED 비중이 압도적(= 앵글 과장을 검증이 되돌린 횟수). 다음부터 ⓐ**트리거 기반**(실데이터 변형·외부계약·무검증 머지 중 1건 포함 시에만) ⓑ**경량 2앵글 + 실측 렌즈 1개**, 적대 검증은 상/중만 ⓒ**CI 도입이 감사보다 값어치**(`.github`·`.husky` 부재 = 자동 그물 0). 규칙 전문 = `AGENTS.md` Verification Budget 절.

**⑥ PR1·PR2 이행 완료.** PR1(`#320`) = 계약 근거절 정정 9건 — 핵심은 **`AGENTS.md`의 "생성은 저장물이 없다"가 거짓**이었다는 것(실측 122행). 결론은 맞았지만 근거가 틀려 **모델 교체 시 힌트 재생성 절차가 계약에서 통째로 빠져 있었다**. PR2(`#321`) = 회귀 그물 3건, **각각 변이로 RED 실증**. M9에서 실제 사각 발견 — `appStatus:"sent"`에만 뜨는 **"발송 견적 보기"**가 `OPENERS` 미등재였고 draft 1프레임만 보던 기존 테스트는 영원히 못 봤다.

**⑦ Topbar 팝오버 우측 잘림 해소(`#322` `35c068b`).** 검색·업무 AI가 뷰포트를 **항상 15px씩** 넘고 있었다(상단바가 우측 정렬이라 트리거 우측 여유는 창 크기와 무관 — 즉 상시 결함). **정답 레퍼런스는 레포 안에 있었다**: `.notifications-panel`만 원래부터 올바르게 동작(우측이 뷰포트에서 22px 안쪽 + `max-width: calc(100vw - 32px)`)해서 거기 정렬했다. 실브라우저 검증 = 4패널 전부 우측 22px·잘림 0·화살표 오차 0. ⚠️ **트리거 우측 여유는 CSS가 계산 불가**(아이콘 수·구분선 폭 의존)라 실측값을 박았다 — **상단바 아이콘 구성이 바뀌면 세 패널 오프셋 재실측**(지시는 `theme.css` 주석). ⚠️ **시행착오 기록**: 먼저 `right: 0`(트리거 우측 정렬)을 넣었다가 디자인 의도를 깨 유슨생이 실화면으로 잡았다 — 레포에 이미 있던 정상 사례를 먼저 보지 않은 것이 원인이다.

**⑧ CI 도입(`#323` `342c70f`) — 레포 최초의 자동 검증 그물.** push(main)·PR마다 **typecheck·lint·test:unit·build** 4종. ⚠️ **`test:server`는 CI 금지**(공유 master DB 실접속 = 픽스처 행·운영 알림·실 Gemini 9콜) · **knip·format:check도 제외**(도입 시점부터 red인 선재 상태 — 기준선 0으로 만든 뒤에 넣는다). env는 `VITE_*` 더미만(시크릿 0).
**도입 첫날 실제 결함 2건을 잡았다.** ⓐ**내 실측 오류**: `env -i`는 환경변수만 지우고 `.env.local`은 남겨 vite가 읽는다 → "env 없이 통과"가 거짓이었다. **CI 조건 재현은 깨끗한 worktree로** 할 것 ⓑ**날짜 테스트 3건이 실행 환경 타임존에 의존**(UTC 러너에서 9시간 어긋남 — 팀 로컬이 전원 KST라 아무도 몰랐다). → **`vitest.config.ts`의 `test.env.TZ`가 타임존 고정의 단독 소유자**(CI에 중복 금지 — 그래야 로컬도 결정론적). 🚫 앱이 뷰어 로컬 타임존으로 표시하는 것(층 2)은 **제품 동작 문제이고 고치지 않기로 결정**(전원 KST·재제안 금지, 근거는 `vitest.config.ts` 주석).

**⑨ 별건 2종 종결(`#324` `e8ab97c`).** ⓐ**Edge(Deno) 테스트 26건을 배선**(`test:edge` 스크립트 + CI 단계 + 로컬 `test`) — 실행은 되는데 어디에도 안 걸려 수동 의존이었다(M11). 외부 호출 0(전부 `fetchImpl` 페이크)이라 권한 플래그도 불필요. **CI 로그에서 26 passed 실측 확인** ⓑ**`test:server`의 실 Gemini 9콜 제거**(M7) — 원인은 **한 줄**이었다: `ragFakes`가 다른 dep은 "실 조회 차단" 주석까지 달아 막아두고 **`routeAssistantTool`만 빠뜨려** override 없는 테스트가 실 라우터를 탔다. 격리 worktree 전/후 대조 = **7.39s → 181ms(41배), 결과는 41 tests·104 expect·0 fail로 완전 동일** = 외부 호출 소멸의 증거.

**⑩ CI 위생 잠금(`#325`) + 배치 13 별건 2종(`#326`·`#327`) + 금융사 sentinel 상수화(`#328`).** ⓐ**knip 16 → 0 · format 20 → 0**으로 정리하고 CI에 추가 — 이제 7단계(`typecheck→lint→**knip**→**format**→unit→build→edge`)가 잠근다. knip 16건은 전부 "같은 파일에서만 쓰는데 export가 붙은" 경우라 키워드만 제거(기능 0). 예외 = **`DEALER_WRITE_ALLOWLIST`는 의도적 확장점이라 삭제 대신 내부화**(밖으로 열려 있으면 다른 모듈이 런타임에 딜러 게이트를 넓힐 수 있다 — 사유는 코드 주석) ⓑ**`dealerOptionsByCard` stale 수정** — 구매방식 전환이 이벤트 없이 금융사를 "미선택"으로 되돌리는데 딜러 목록은 이벤트 경로에서만 갱신돼 **이전 금융사 딜러가 계속 제시**됐다. K1 재동기화 effect를 딜러까지 확장해 닫았다. ⚠️ **배치 13 서술이 틀렸음을 재현 중 발견해 정정**(구 기록 "placeholder가 '금융사 먼저 선택' 거짓 표시" → 실제는 **반대**: stale 때문에 `hasChoices`가 참이라 placeholder는 "선택"인 채 딜러가 노출). 🟡 **pending 항목 25 등재**(사후 공유). ⓒ**초기화가 금융사 DOM을 안 지우던 것**도 닫았다(`#327`) — 실측으로 범위를 좁혔다: 보증금·선수금·잔존가치·보조금은 이미 정상 초기화되고 **금융사만** 살아남아, 카드 리마운트가 아니라 금융사 select만 DOM 클리어(거울은 K1-d 원칙대로 effect에 위임). ⚠️ 시행착오 = `key={`lender-${condition.lender}`}` 리마운트는 **무효**(uncontrolled라 사용자 선택이 state에 안 남아 key 불변). 🟡 **pending 항목 26**. ⓓ**금융사 `"미선택"` sentinel 상수화**(`#328`) — ⚠️**단순 치환은 위험했다**: 프로덕션 21건이 **세 도메인에 겹쳐** 있었다(금융사 sentinel / **색상 라벨 = 앱 payload 계약값** / 피커 UI 폴백). 금융사 축 12건만 `LENDER_UNSELECTED`로 모으고 색상은 무접촉. ⓔ**CI 허점 발견**: `bun run lint`가 warning에 exit 0이라 **불필요한 eslint-disable이 조용히 머지됐다**(#326). 레포 규칙은 "0 problems"이므로 `lint` 스크립트를 `--max-warnings 0`으로 강화 — 로컬·CI가 같은 기준을 쓴다.

## ▶ 다음 작업

1. ✅ **금융사 `lenderName` label 축 확장 — 완료(2026-07-23).** 제프가 요청 당일 수락·구현·**배포**까지 마쳐 실기로 확인됐다(`lenderName` 8건 탑재 · 표시명 전량 일치 · label 변이 시 `renamed` 축만 발화). 🔵 **예고 1건**: 파트너가 **하나캐피탈** 추가 검토 중(엔진 빌드 완료·배선 보류) — 배선 시 사전 통보 약속. 우리는 `code`가 컴파일타임 타입이라 **자동 반영 안 됨** → 통보 오면 `SOLUTION_LENDERS`에 한 줄 추가(가드도 `onlyPartner`로 잡는다).
2. **이사님 회신 대기** — pending **열린 13건**(항목 25·26·**27** 신설 — 27 = ②c의 K1-c 리셋+토스트), 특히 **21·22는 묶어서** 여쭙는 게 효율적. ⚠️ **NO_HITS 문구+sources 동시 렌더는 21·22 결정과 얽혀 보류 중**(지금 고치면 결정 후 두 번 고친다).
3. **실 Safari 눈확인(유슨생)** — ②c로 금융사·판매사가 controlled가 됐다. `bindSelect`(onInput+onChange 병행)를 썼으니 규칙상 안전하지만, Safari 유실 함정은 **자동화(Playwright webkit·jsdom)가 원리적으로 재현 못 한다** — 실 Safari에서 워크벤치 금융사·판매사 선택 1회만 눈으로 확인.
4. **CI 후속(선택)** — 남은 red 게이트 없음. 다음 후보는 `test:server`를 CI에 넣을 방법(전용 테스트 DB가 생기면). 지금은 공유 master라 불가.

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
