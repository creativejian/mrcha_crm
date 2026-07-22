# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다 — 2026-07-21에 이 파일이
> 142k자까지 자라 세션 컨텍스트의 14%를 먹고 있었다. 지속되는 결정·계약은 `AGENTS.md`(불변 규칙),
> `ref/specs/*`(설계 근거), `ref/current-working-state.md`(장기 상태)가 각각 집이다.

Last updated: 2026-07-22

## 지금 상태

**배치 15 전량 종결(감사 + PR1·PR2 이행). 진행 중인 미완 작업 없음.**

최근 머지: `2460d55`(PR1 `#320` 계약 근거절 정정·감사 관례 축소 박제) · `b8a12a8`(PR2 `#321` 회귀 그물 3건, 변이로 RED 실증).
main 통합 검증 green — typecheck 0 · lint 0 · unit **1067** · server **651** · build · knip 7/9 · 픽스처 잔재 0.
판정 14건 중 **이행 12 · 조치 불요 2**. SSOT = `ref/plans/2026-07-22-crm-refactor-batch-15.md`(종결 절 포함).
⚠️ **다음 배치부터 풀 감사는 트리거 기반 경량형**이다 — 근거·규칙은 `AGENTS.md` Verification Budget 절에 박제됐다.

## 직전 세션 요약 (2026-07-22 · 0722-new-start)

**① 배치 15 감사.** 48 에이전트·5.39M 토큰·68분·에러 0. 4앵글 22건 → 트리아지 14 → 적대 검증 42표 → 스팟. 판정 = **전건 생존(기각 0) · 상 0 · 중 5 · 하 9 · 행위 변경 0**. SSOT = **`ref/plans/2026-07-22-crm-refactor-batch-15.md`**(상세·정정문·한계 전부 거기).

**② 스팟이 잡은 결정적 사실 3가지.** ⓐ**실기 골든 4종이 모델 상향을 판별하지 못한다** — 현행 `3.5-flash-lite` 4/4 통과·인자 날조 0인데 **구 `3.1-flash-lite`도 4/4 동일**. `AGENTS.md`가 이 4종을 모델 교체 검증 수단으로 지정해 둔 상태 ⓑ**`test:server` 1회가 실 Gemini에 라우팅 9콜을 발사한다**(계측 확인) — "페이크 주입"은 사실과 다름. 단 업스트림을 죽여도 29/29 통과라 **불안정이 아니라 무기록 외부 의존·비용** 문제 ⓒ이사님께 약속한 **구 힌트 22건 백업이 휘발성 스크래치패드에만** 있었다 → **✅ 이관 완료**(`~/Documents/TypeScript/mrcha-crm-local-backups/2026-07-22-ai-hint-319/`, before/after 22행 + 원복 README).

**③ 감사의 자정 3건.** M11(Edge 테스트 "안 돌아감") **DISPROVEN** — Deno로 26/26 green, 남는 건 CI 배선 0뿐 · M10(`#317` "표식 없음") **DISPROVEN** — 표식이 이미 있어 **조치 불요** · M8은 결함이 아니라 **주어 모호**로 격하. M2·M12·M13은 **원인이 이 배치가 아니라 선재**임이 밝혀져 귀속 정정.

**④ 실 데이터 기준선(읽기 전용).** `crm.embeddings` **161행 전량 현행 스킴 일치**(구 모델 혼입 0) · AI 힌트 **20/20 신 스킴 정착**(앱 연결 2명은 알림 트리거 회피로 미검사) · 생성 산출물 영속 저장처 **2종 122행** · Edge 배포는 **대상 함수만** 갱신(슬러그 명시가 실효).

**⑤ 감사 관례 축소 결정(유슨생 승인) — `AGENTS.md` 박제 완료.** **배치 15를 마지막 풀 감사로** 한다. 근거 = 배치 14·15 연속 **사용자 가시 오작동 0건**이고 ADJUSTED 비중이 압도적(= 앵글 과장을 검증이 되돌린 횟수). 다음부터 ⓐ**트리거 기반**(실데이터 변형·외부계약·무검증 머지 중 1건 포함 시에만) ⓑ**경량 2앵글 + 실측 렌즈 1개**, 적대 검증은 상/중만 ⓒ**CI 도입이 감사보다 값어치**(`.github`·`.husky` 부재 = 자동 그물 0). 규칙 전문 = `AGENTS.md` Verification Budget 절.

**⑥ PR1·PR2 이행 완료.** PR1(`#320`) = 계약 근거절 정정 9건 — 핵심은 **`AGENTS.md`의 "생성은 저장물이 없다"가 거짓**이었다는 것(실측 122행). 결론은 맞았지만 근거가 틀려 **모델 교체 시 힌트 재생성 절차가 계약에서 통째로 빠져 있었다**. PR2(`#321`) = 회귀 그물 3건, **각각 변이로 RED 실증**. M9에서 실제 사각 발견 — `appStatus:"sent"`에만 뜨는 **"발송 견적 보기"**가 `OPENERS` 미등재였고 draft 1프레임만 보던 기존 테스트는 영원히 못 봤다.

## ▶ 다음 작업 (미확정 — 후보)

1. **CI 도입**(위 ⑤ⓒ · 가장 값어치 있는 후보) — Actions에 typecheck·lint·test:unit·build. ⚠️ `test:server`는 공유 master DB라 **CI 불가**(로컬 유지).
2. **🆕 Topbar 팝오버 우측 잘림**(아래 — 사용자 가시 결함이라 우선순위 높음)
3. **별건** — `test:server` 실 Gemini 9콜 위생(배치 15 M7) · Deno 테스트 배선(M11) · NO_HITS 문구+sources 동시 렌더(표시 정책과 함께) · 배치 13 별건 3종(`resetQuoteWorkbench` DOM 미청소 등)
4. **이사님 회신 대기** — pending 열린 10건, 특히 **21·22는 묶어서** 여쭙는 게 효율적

**🆕 Topbar 팝오버 우측 잘림**(유슨생 Safari 실화면 제보 · 미착수): 검색·업무 AI 팝오버가 뷰포트 오른쪽을 넘어 잘린다. 원인 = **음수 right 오프셋 하드코딩 + 뷰포트 클램프 부재** — `styles/topbar.css`의 `.global-search-panel`(`right: -281px`/`width: 430px`) 대표, `styles/sidebar-collapsed.css`(`right: -230px`)가 동일 결함 클래스, `styles/work-ai-panel.css`는 **폭만** 클램프됨. **3곳을 한 규약으로** 묶을 것(개별 픽셀 조정은 재발). 검증은 magiclink + 좁은 창 육안.

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
