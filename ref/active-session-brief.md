# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-05

## 지금 상태

main 전량 green(CI 8단계). unit **1430** · pure **290**. 정산 축(`#449`·`#450`) 종결 후
`#451`~`#458` 완료(팝오버 분리 · mc-master UX 2 · 배지 축 5).
✅ **앱 팀 회신·제약 적용 완료** — `catalog.trims`가 `(model_id, name, model_year)` UNIQUE NULLS
NOT DISTINCT다(막혀 있던 트림 등록이 열렸다). 상세 = `ref/2026-08-05-app-trim-model-year-unique-request.md`.

## ▶ 다음

- **잔여 2건(머지는 끝났다 — 실행·육안만)**: ⓐ**김지운(`jiandolce@gmail.com`) 탈퇴 테스트 미실행**
  (견적 20·**앱카드 19** — 카드 회수 경로 검증) ⓑ`#445` 배너 **육안 미확인**. **ⓐ를 하면 ⓑ가 딸려 온다**.
- **🔴 시범 고객·풀세트 시드 재지정**(상세 드로어 작업의 선행 — 김민준 삭제로 공백). **이사님 결정 영역**.
- ⚠️ **트림 등록 후 "고유번호 할당" 실행**이 운영 절차다(`auto_mc_code`가 BEFORE UPDATE 전용 —
  INSERT만으론 mc_code가 NULL이고 파트너 비교에서 빠진다). 현재 미부여 **148/1811**.
- 리팩토링 대기 후보 없음(`#451`로 소진). 다음 큰 파일은 트리거가 없어 착수하지 않는다.

## 직전 세션 (08-05 밤 · 유슨생)

- **`#451` 팝오버 분리**(951→719줄, 순수 이동) · **`#452` 모델 목록 행 전체 클릭** · **`#453` 대기열
  고정 헤더 + 전체 승인**. `#453`은 **건별 순차**다(한 트랜잭션이면 드리프트 1건에 전부 롤백·Workers
  시간 상한). 실패해도 계속하고 실패 건은 **선점까지 롤백돼 pending 유지**.
- **배지 축 5연타(`#454`~`#458`)** — 브랜드·모델·사이드바에 **빨강(승인 대기)·파랑(고유번호 미부여)**.
  빨강은 큐 응답의 `targetBrandId`/`targetModelId`로 **서버 변경 0**, 파랑은 새 집계 라우트
  (`GET /models/mc-code-gaps`, admin 게이트 = 부여 권한과 동일).
  ⚠️ 파랑은 **양방향**이다 — 승인하면 늘고(mc_code 없는 트림 생성) 할당하면 준다.
- 🔴 **이 축에서 같은 결함이 세 번 났다**: 훅 인스턴스를 늘리거나 새 소비처를 만들 때마다 **신호를
  일부만 골라 들어** 배지가 서로 다른 숫자를 보였다. `#457`이 계기 넷을 `catalog-queue-signals`로
  모아 끝냈다(소비처 다섯이 `useCatalogQueueTick` 하나만 쓴다). **훅을 늘릴 땐 갱신 전파 전제부터
  확인할 것.** `#458`은 배지 렌더·클래스까지 `CountBadge` 한 부품으로.
- SSOT 3층 = 크기(`--count-badge-*`) / 형태·톤(`.count-badge`) / 신호(`useCatalogQueueTick`).
- 교훈: ①**"큰 PR에 흡수" 계획은 그 PR 규모를 모르는 상태의 것**이라 깨진다. ②**한 줄 grep만으론
  감싼 호출을 놓친다**(19건 놓쳐 "깨질 테스트 0" 오판). ③**정적 스텁은 갱신 결함을 원리적으로 못
  잡는다** — 승인 mock이 큐를 안 줄여 `#454` 회귀가 테스트를 통과했다(지금은 실제로 뺀다).
  08-05 낮 세션(`#449`·`#450`·김민준 삭제)은 archive 맨 위로 옮겼다.

## 대기

**이사님** = `ref/director-pending-confirmations.md` **18건**(항목 14·16~32 — **31·32 신설**:
정산 목록 대상 기준=계약 확정일 / 열 이름 "실입금액". 같은 화면이라 **묶어서** 여쭐 것) + Supabase
**"EXCEEDING USAGE LIMITS" 배지**(08-01) 플랜 + **D+5 최악 6일차** SLA 해석.
💡 회신 때 **🟡 하드 삭제 확장(`#440`)을 항목 28**(AI 기록에 번호 잔존)**과 묶을 것** — 같은 축·미등재.

## Boot

`AGENTS.md` → 이 파일 → `git status -sb` · `git log --oneline -5`. 상세: 정산 = spec §6a · 보존 계약 = AGENTS.md.

## 세션 마무리 규칙

**교체**(누적 금지 · 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인은 등재 없이 박제** · 이사님 확정
설계를 뒤집는 건만 등재 · 신설 시 그 파일 롤업 2곳도). 상세 규칙 = AGENTS.md "Handoff Documents".
