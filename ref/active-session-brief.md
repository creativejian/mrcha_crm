# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다(2026-07-21에 142k자까지 자랐다).
> 지속 결정·계약은 `AGENTS.md`, 설계 근거는 `ref/specs/*`, 장기 상태는 `ref/current-working-state.md`.

Last updated: 2026-07-27

## 지금 상태

**main 전량 green · 브랜치 0 · 미완 작업 없음.** 07-27 머지 **3건**(`#372`~`#374`) · main `1bc0279` · 마이그 0건
(앱이 `public.quote_requests.confirmed_at` 추가 — 우리 마이그 아님). 검증: typecheck 0 · lint 0 · knip 0 ·
format 0 · unit **1193** · pure · build · 실 DB 2건(confirm 멱등·소유권).
**🔴 실기 미확인 1건** = 견적요청 confirmed 푸시(`#374`) — **실제 고객에게 푸시가 나간다.** 대상 신중히
(FCM 토큰 = 이사님 웹 2대 + 김지안 iOS). 확인법 = 앱 연결 고객 요청 카드 "견적 작성" 첫 클릭 →
앱 2단계 "담당자 확인 완료" 표시 + 푸시 1회 → 재클릭·"추가 작성"은 조용.

## 직전 세션 요약 (07-27 · 0726-mcMaster-scroll 연장)

**① 잔존 max 앱카드 라벨(`#372`).** 이사님 지적 — max면 payload가 `"최대"` 맨문자열로 나갔다(발송 7건
전부 실측). 제프는 금액·율을 정확히 줬고 `solution_raw`에 저장까지 됐는데 **라벨 경로만 안 읽었다**
(서버 `AdvisorPayloadScenarioRow`에 `solutionRaw` 부재 — 조달은 이미 `select()` 전체였다).
→ `residualLabelOf`(app-card-labels) 신설, 클라·서버 양쪽 배선 + 파리티 2케이스. 스냅샷 없는 max는 폴백 유지.
**② 파트너 차량가 대조 가드(`#373`).** iM이 520i M Spt(74,300,000)를 **기본 520i(69,800,000)로 resolve**해
월납·잔가가 전부 낮은 기준으로 계산된 견적이 **성공 응답으로** 왔다(에러 없음 → 사람 눈으로 못 잡음).
축은 **`majorInputs.vehiclePrice`(실계산값)** — `resolvedVehicle`(카탈로그가)로 보면 **산은 오탐**이 난다
(제프 F: 산은은 카탈로그가 불일치가 정상). 금융사 제한 없음. ⚠️ 제프 B 완료 후엔 이 축이 **조용해지는 게
정상**이고, 그때 링크 오배정을 잡으려면 D의 `catalogPrice`가 필요하다.
**③ 제프 왕복 3문서**(`ref/2026-07-27-jeff-im-capital-trim-resolve-{request,reply,followup}.md`).
제프 원인 = 수동 링크 오배정(`match_source="manual"`). **조치 A 머지·우리 재계산으로 실측 확인**
(잔가 44,580,000 / 월납 846,710). **B·C·D는 코드 미착수 실측**. 확인법은 로컬 메모리에 박제.
**④ 견적요청 "담당자 확인"(`#374`, 이사님 요청).** 견적 작성 첫 진입 → `confirmed_at` **최초 1회 전이**
→ 그 전이에서만 푸시. 멱등은 **SQL 조건절**(`confirmed_at IS NULL`)이라 "추가 작성"·URL 재진입 안전.
GET 프리필에 안 얹고 **별도 POST** — URL 진입으로 GET이 다시 돌아 "열지도 않았는데 확인됨"이 생긴다.
앱 협업 완결(요청문→회신, 앱 PR #765 머지) — 앱에 5단계가 문구까지 있는데 2·3·4가 **도달 불가**였던 것.

## ▶ 그 다음

1. **`#374` 실기 확인**(위 🔴). 2. **requireRole 확산(2/11)** — 이사님 항목 16 답 대기.
3. **항목 29 답** 오면 스누즈 트리거 조정. 4. 이월: 실기 1개(비admin URL·비긴급) · L2
   (createCustomerFromRequest 인라인 정리) · pending-tasks 4건(디자인 확정 대기).

## 대기 (우리 액션 없음)

**제프** = B(iM이 `quotedVehiclePrice`·할인·보조금 반영) · D(`catalogPrice` 형태 합의) · ⑦(우리카드 다중매칭
9건에 `MC070626003` 포함 여부). ⚠️ **B 완료 전까지 iM + 할인/전기차보조금 조합 견적 금지**(상수 0 무시).
확인은 로컬 메모리 `jeff-partner-action-verification` 절차대로(레포 grep + 파트너 API 실측).
**이사님** = `ref/director-pending-confirmations.md` 14 · 16~29. **앱** = 애플 개발자 등록 후 FCM 실기기.

## Boot

1. `AGENTS.md` → 이 파일 순. 2. `git status --short --branch` · `git log --oneline -5`
3. 더 필요하면: 과거 세션 = `ref/session-archive.md` / 제프 건 = `ref/2026-07-27-jeff-*` 3종 /
   confirmed 계약 = `ref/2026-07-27-app-quote-request-confirmed-{request,reply}.md`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 이전 것은 `ref/session-archive.md` 맨 위로.
- 행위 변경은 `ref/director-pending-confirmations.md`에 등재(PR 🟡와 병행). **단 유슨생이 그 자리에서 승인하면
  등재 없이 박제**. 단 이사님 확정 설계를 뒤집는 건은 승인 대신 등재(항목 29가 그 사례).
