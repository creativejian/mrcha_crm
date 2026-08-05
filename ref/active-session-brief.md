# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-05

## 지금 상태

main 전량 green(CI 8단계). unit **1403** · pure **290**. 정산 축(`#449`·`#450`) 종결에 이어
**팝오버 분리(`#451`)**·**모델 목록 행 클릭(`#452`)**·**대기열 전체 승인(`#453`)**까지 완료.
🔴 **앱 팀 답신 대기 1건 신설** — `catalog.trims` 유니크에 연식 추가
(`ref/2026-08-05-app-trim-model-year-unique-request.md`, 유슨생이 전달).

## ▶ 다음

- **잔여 2건(머지는 끝났다 — 실행·육안만)**: ⓐ**김지운(`jiandolce@gmail.com`) 탈퇴 테스트 미실행**
  (견적 20·**앱카드 19** — 카드 회수 경로 검증) ⓑ`#445` 배너 **육안 미확인**(대기 큐 0건이라 안
  뜬다). **ⓐ를 하면 ⓑ가 딸려 온다**(탈퇴 접수 = 큐 1건 → 배너 노출).
- **🔴 시범 고객·풀세트 시드 재지정**(상세 드로어 작업의 선행 — 김민준 삭제로 공백). 어느 고객으로
  옮길지는 **이사님 결정 영역**이라 임의로 정하지 않는다(AGENTS.md).
- **리팩토링 대기 후보는 없다**(`#451`로 마지막 유효 후보가 소진). 다음 큰 파일은 `useQuoteWorkbench`
  **1889줄** · `CustomerManagementPage` **1508줄**이지만 **트리거가 없어 착수하지 않는다**
  (AGENTS.md 트리거 3종 = 실 데이터 변형·외부 계약·무검증 머지).

## 직전 세션 (08-05 밤 · 유슨생)

- **`#451` 출고 정보 팝오버 분리** — `DeliveryInfoPopover`를 `components/DeliveryInfoPopover.tsx`로
  통째로 이동(951 → 719줄). **동작 변경 0을 diff로 입증**: 이동 전 원본과 본문 차이가 **2줄**뿐이고
  (`export` 추가 · 주석의 "위 DeliverySchedulePopover"에서 "위" 제거 — 다른 파일이 되어 거짓이 됐다)
  나머지는 바이트 동일, **테스트를 한 줄도 안 고쳤는데 unit 1395가 그대로 통과**했다.
  ⚠️ 분리 단위는 **팝오버 전체**다 — 출고 8필드와 정산은 `onSave` 한 번의 PUT을 공유해서 정산만
  떼면 저장 경로가 갈라진다. `usePopoverViewportClose`의 selfRef는 `CustomerManagementPage.tsx:116`
  래퍼 훅 소유라 이번 범위 밖이었다(`#448` 실버그 재발 여지 없음).
- **`#452` mc-master 모델 목록 행 전체 클릭** — 모델명 텍스트만 눌리던 것을 행으로 넓히고 링크
  색을 뺐다(`.va-link`는 사용처 0이 돼 CSS까지 제거). `SelectableRow`에 optional `onActivate`·
  `onHover`를 얹는 방식이라 **트림 테이블은 무접촉**(행 안 편집 컨트롤이 많아 충돌 면적이 다르다 —
  확장은 쓰임새를 보고). ⚠️ 프리페치를 **이름 hover → 행 hover**로 함께 옮겨야 한다(안 옮기면
  클릭 영역과 어긋나 진입이 느려진다). 그물 5건은 변이 주입 3종으로 확인.
- **`#453` 승인 대기열 고정 헤더 + 전체 승인**(검정 `.primary` 버튼 · `window.confirm`에 건수 명시).
  ⚠️ **건별 순차 호출**이다 — 한 트랜잭션에 묶으면 드리프트 1건에 전부 롤백되고, Workers 실행
  시간 상한도 걸린다. **실패해도 멈추지 않고** 끝에 "N건 승인 · M건 실패"로 요약한다. 실패 건은
  승인 1건 = 트랜잭션 1개라 **선점 스탬프까지 롤백돼 pending으로 남는다**(소실 없음 — 실측 확인).
- 🔴 **`catalog.trims` 유니크에 연식이 없다**(`trims_model_id_name_key = (model_id, name)`) →
  연식만 다른 동명 트림을 만들 수 없다. **08-05 대기 8건 중 6건이 이 사유로 승인 불가**.
  `canonical_name`은 수입차에서 연식을 포함하는데 **유니크는 `name`만 본다**(그 컬럼엔 유니크가
  없다 — 둘을 혼동하지 말 것). catalog는 master·앱 공유라 **우리가 못 고친다** → 요청문 전달함.
- 교훈 ①: **"큰 PR에 흡수시키자"는 계획은 그 PR이 얼마나 커질지 모르는 상태의 것**이라 깨진다
  (`#450`이 17파일 471줄이 돼 결국 빼고 단독 PR). 흡수 판단은 착수 후 실제 규모를 보고.
- 교훈 ②: **테스트 영향 조사에서 한 줄 grep 패턴만 보면 감싼 호출을 놓친다** — `#452` 착수 전
  `click(screen…)`만 훑어 "깨질 테스트 0"으로 오판했는데, `click(await screen.findByRole(…))`
  형태 **19건**이 실제로 깨졌다. 역할·라벨(`name: "그랜저"`)로도 함께 훑을 것.
- 08-05 낮 세션(`#449`·`#450`·김민준 삭제)은 archive 맨 위로.

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
