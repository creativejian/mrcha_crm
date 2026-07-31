# 타깃 렌즈 배치 — fail-silent UI 경로 수색 (2026-07-31)

> 판정 SSOT. 발단 = PR `#414`(서류·일정 확인 팝오버가 좌표 없는 fixed로 뷰포트 밖에 렌더돼
> 07-26~07-31 조용히 불능). 같은 **계급**(에러 0·네트워크 0·사용자에겐 "눌러도 아무 일 없음")의
> 잔존 경로를 찾는 것이 목적이다.

## 규모 (감사 정책 기본형 — `AGENTS.md` 리팩토링 배치 감사 항목)

2앵글 + 실측 렌즈 1 · **적대 검증은 심각도 상/중에만** · 에이전트 7(수색 3 + 적대 검증 4).
전 에이전트 읽기 전용, 메인 워킹트리 무손상(배치 14 오염 재발 0).

## 결론

| 단계 | 상 | 중 | 하 |
|---|---|---|---|
| 수색 직후(앵글 주장) | 0 | 6 | 4 |
| **적대 검증 후(최종)** | **0** | **1** | **9** |

중 6건 중 **5건이 하로 강등**됐다(반증이 되돌린 과장). 유일한 중 1건은 실측으로 확증 후 이 배치에서
수리했다. **#414와 동일한 원형(앵커 미매칭 → 무경고 영구 hidden)의 잔존은 0건**이다 —
`useFixedPopoverPosition` 소비처 5곳(컴포넌트 7개) 전수와, fixed인데 CSS에 좌표가 없는 클래스 8개
전수가 모두 좌표 공급을 배선하고 있다.

---

## 수리 완료 — 중 1건

### 드로어 3카드 확인 팝오버가 스크롤·리사이즈에 닫히지 않는다

- **위치**: `useCustomerChecks`(완료·삭제) · `useCustomerSchedules`(완료·삭제) · `useCustomerDocuments`(삭제)의 dismiss effect 5지점
- **계약 위반**: `use-fixed-popover-position.ts` 주석이 "fixed는 스크롤·리사이즈를 따라가지 않으므로 **열림 상태의 닫기는 호출부 effect가 담당**한다"고 명시한다. 목록 4소비처는 `closeOnViewportShift: true`로 이행했으나 드로어 3카드는 `pointerdown`+`keydown`만 구독했다. 레포 전체에서 scroll/resize 리스너는 `CustomerManagementPage` 한 곳뿐이었다.
- **실측(로컬 dev · Chrome · 김민준 드로어, 쓰기 0건)**:

  | | 팝오버 top | 대상 행 top | 팝오버 열림 |
  |---|---|---|---|
  | 삭제 확인 연 직후 | 386 | 322 | true |
  | 드로어 휠 -400px | **386 (0px 이동)** | **722 (400px 이동)** | true |

  행 대비 오프셋 `+64 → -336`. 팝오버가 할일 카드를 떠나 **상세 구매조건 섹션 위에 떠 있었다**
  (`elementsFromPoint` = `section.kim-purchase-conditions`, 그 자리에 행은 없음). 리사이즈(800→620)도 동일하게 0px.
  대조군인 목록 진행상태 팝오버는 같은 조작에서 정상적으로 닫혔다(열림 true → false).
- **왜 중인가**: 파괴적 확정 버튼("삭제하시겠습니까?")이 무관한 섹션 위에 남아 대상 오인을 유발한다. 클릭 시 지워지는 것은 클로저가 잡은 원래 항목이라 데이터 오염은 아니다.
- **발현 폭**: 카드 내부 스크롤(할일 4건부터)이 필요조건이 아니다 — `.customer-detail-drawer{height:100vh;overflow:auto}`라 **드로어 자체가 항상 스크롤된다**(실측 max 645px). 항목 1건이어도 발현.
- **수리**: 목록에 있던 `closeOnViewportShift` 로직을 공용 훅 **`client/src/lib/use-popover-viewport-close.ts`**로 뽑아 목록·드로어가 **한 벌**을 쓰게 했다. scroll은 capture로 듣는다(내부 스크롤 컨테이너의 scroll은 버블하지 않는다).
- **회귀 그물**: `use-popover-viewport-close.test.ts` 5케이스. **변이 자가검증 완료** — capture 인자를 빼면 2건이 실패하고, 원복 후 5/5 통과·워킹트리 clean.
- **수리 후 실기 재확인**: 같은 스크립트에서 스크롤·리사이즈 모두 팝오버가 닫힘(`pop: null`).

---

## 후속 수리 (2026-07-31 밤 · 유슨생 지시로 하 등급도 착수)

아래 5건은 **후속 PR에서 수리 완료**했다. 각 항목의 원 서술은 그대로 두고 조치만 덧붙인다.

| 건 | 조치 | 회귀 그물 |
|---|---|---|
| 1 계산기 "조회 완료" 오표시 | 재조회 분기 진입 전 `isVehicleReady` 가드 + `blockReason` 안내 | — (실기 경로) |
| 2 견적 CREATE 발송 실패 미원복 | `.catch`에서 `appStatus: "draft"` 롤백(UPDATE 분기와 대칭) | — |
| 3 견적 temp id 무음 스킵 6함수 | `blockedWhileQuoteSaving`로 조기 반환 — API도 로컬 변경도 없이 "저장하는 중" 안내 | `useQuoteList.temp-id-guard.test.tsx` 4케이스(변이 자가검증 통과) |
| 4 메모 삭제 팝오버 absolute | `ConfirmPopover`(`.kim-customer-memo-row`)로 이주 + fixed CSS + 뷰포트 시프트 닫기 배선 | 실기 3행 계측 |
| 6 `heightDep={Boolean(notice)}` | `notice` 문자열 자체를 전달(메시지→메시지 전환 포착) | — |

### 5 `.va-disc-pop` — **하 → 중 승격 후 수리 완료**(같은 날 밤, 유슨생이 실데이터 투입)

원 판정은 "오늘 피해 0(제안 1건이 13행 표의 **첫 행**)"이라 하였다. 유슨생이 딜러 계정으로
**5 Series 마지막 트림(550e, sort_order 13)에 제안을 넣자 prod에서 즉시 재현**됐다.

| | 팝오버 top | 화면에 보이는 높이 | [채택] 버튼 |
|---|---|---|---|
| 수정 전(prod) | 781 (버튼 727 아래) | **0 / 130px** | y=872 → 스크롤러 하단 777·뷰포트 800 초과, `elementFromPoint` 미검출 = **클릭 불가** |
| 수정 후(로컬) | **578 (위로 열림)** | **130 / 130px** | y=669 → `button.tiny-btn` 검출 = 클릭 가능 |

즉 "잘려서 스크롤하면 보인다"가 아니라 **클릭 순간 아무것도 안 보이는** #414 계급이 맞았다.
수리 = `useFixedPopoverPosition`(앵커 `.va-disc-cell` · `align: "end"` = 구 `right: 0` 정렬)로
fixed 전환 + `max-height: 60vh; overflow-y: auto` + `usePopoverViewportClose`.
`popoverPosFromRect`(형제 팝오버용)가 아니라 이 훅을 쓴 이유는 **표 하단 행에서는 아래 공간이
없어 flip-up이 필수**이기 때문이다(그 함수는 아래로만 연다).
회귀 실측: 첫 행은 아래로(y 258→314) · 마지막 행은 위로(y 727→578) · 둘 다 [채택] 클릭 가능 ·
표 120px 스크롤 시 정상 종료.

**의도적으로 남긴 것**:
- **7 죽은 상태 modifier 4종** — CSS·JS 참조 모두 0건인 완전한 no-op으로 재확인했다. 다만 "제거"와 "누락된 CSS 복구" 중 어느 쪽이 원 의도인지 확증이 없어, 지워서 흔적을 없애는 대신 이 문서에만 남긴다.
- **8 도달 불가 저장 핸들러 2건** — 코드에 **경고 주석을 박았다**(`savePurchaseConditions` · `saveStatusField`의 text 분기). 지금 고치면 도달 불가 경로에 미검증 코드를 넣는 셈이라, 되살릴 사람이 `savePatch`를 먼저 배선하도록 지시만 남긴다.
- **9 `.kim-edit-popover.schedule`** — 사소한 CSS 잔존물.

## 보류 — 하 9건 (조치 없음, 근거만 박제)

우선순위 순. 전부 "오늘 사용자 피해가 없거나 조건이 매우 좁다"로 강등된 건이다.

1. **계산기 "조회 완료" 오표시** (`CalculatorModal:handleCalculate` / `ConditionCards:handleQueryClick`) — `buildScenarioPayload`가 null이면 조용히 return하는데 호출부가 `setQuerySnapshot`·`setShowResults`를 **먼저 커밋**해, 주황 "변경된 조건으로 다시 조회하기"가 회색 "○○으로 조회 완료"로 뒤집힌다. 계산은 안 돈다. **fail-silent 계급 일치**(경계선 중)이나, 버튼 아래 "차량을 먼저 선택하세요"가 상시 표시되고 다음 자연 행동(트림 선택)으로 자동 복구되며 잘못된 데이터가 저장·전송되는 경로가 0이라 하. 수정은 재조회 분기에 `isVehicleReady` 가드 한 줄.
2. **견적 CREATE 분기 발송 실패 미원복** (`useQuoteWorkbench:persistWorkbenchQuote`) — 낙관 카드가 `appStatus:"sent"`로 박히고 후속 `apiUpdateQuote(...).catch(toast)`에 롤백이 없다. **같은 함수의 UPDATE 분기는 롤백한다**(비대칭이 명백하고 근거 문서 없음 — 도입 `#99` 설계 문서부터 그 형태). 실패 토스트가 뜨고 "견적 수정 → 수정 후 발송" 우회로가 살아 있으며 드로어 재개시 진실이 복원돼 하.
3. **견적 temp id 무음 스킵 6함수** (`useQuoteList`의 삭제·앱발송·결정상태·primary·파일첨부·원본제거) — `!id.startsWith("kim-")` 가드 **밖에서** 성공 토스트가 나간다. 삭제의 경우 확인창이 "고객 앱 견적함에서도 사라지며, 되돌릴 수 없습니다"를 띄우는데 API 호출은 0건. 서류 훅에는 이 레이스의 보상(`removedTempIdsRef` → 업로드 취소/보상 삭제)이 **이미 구현돼 있어** 부재는 의도가 아니라 누락이다. 다만 창이 "INSERT 왕복 안의 3클릭"이라 좁고 드로어 재개시 회복돼 하.
   - 공통 뿌리: `useQuoteList`의 `quotes`가 `detail.quotes`를 **초기화 함수로만** 읽고 재동기화하지 않는다(`key={customer.id}`라 리마운트도 없음). 2·3을 함께 해소하려면 개별 롤백보다 이 동기화가 근본 지점.
4. **메모 삭제 확인 팝오버만 absolute 잔존** (`.kim-customer-memo-delete-popover`) — 형제 3카드는 `#366`/`#414`에서 fixed로 이주했는데 이것만 남았고, 방향 결정이 실측이 아니라 인덱스 휴리스틱(마지막 행만 위로)이다. **버튼은 스크롤로 항상 도달 가능**하고(계산: 끝에서 두 번째 행도 87 ≥ 78.2), 마운트 시 바닥 정렬 effect가 있으며, 실 DB에 메모 4건 이상 고객이 0명이라 현재 발현 불가.
5. **`.va-disc-pop`(MC 마스터 할인 채택) absolute** — 실 Chrome 계측 결과 `overflow-y:auto`가 스크롤 영역을 늘려 **잘리지 않고 스크롤로 100% 복구**된다(버튼 히트테스트 통과). 다만 표 하단까지 내린 상태에서 마지막 행을 클릭하면 **클릭 순간 가시 0px** = "눌러도 아무 일 없음" 오인. 오늘은 제안이 1건뿐이고 그것이 13행 표의 **첫 행**이라 피해 0. **승격 조건**: 제안이 쌓여 긴 모델(트림 119개 존재)의 아래쪽 행에 걸리면 중.
6. **`heightDep={Boolean(notice)}`** (`DeliverySchedulePopover`·`DeliveryInfoPopover`) — `메시지 A → 메시지 B`는 `true→true`라 재계산이 없다. 검증 오류를 연속 2회 낼 때 높이만 ~15px 늘고 top이 고정돼 소폭 오배치.
7. **죽은 상태 modifier 4종** — `.is-locked`(PurchaseConditions) · `.is-pinned`(QuoteList) · `.is-original-input`·`.has-original-file`(QuoteWorkbench). JSX가 토글하는데 CSS 규칙이 0이라 시각 피드백만 조용히 소실.
8. **도달 불가 "저장하지 않는 저장 핸들러" 2건** — `useCustomerPurchase:savePurchaseConditions`(9필드 로컬 갱신 + 완료 토스트, `savePatch` 없음. `{kind:"purchase"}`를 만드는 코드가 레포에 0건) · `useCustomerWorkflow:saveStatusField`의 `text` 분기. 지금은 죽은 경로지만 **필드를 하나 추가하는 순간 조용히 살아난다** — knip·lint가 못 잡는 종류.
9. **`.kim-edit-popover.schedule`** — 이 변형을 붙이는 JSX가 0건(CSS 전용 잔존물).

## 미확증 1건

- **Topbar `suppressNotificationOutsideClickRef`가 구조적으로 해제 불가**: 해제가 click capture 안의 `setTimeout` 한 곳뿐인데 같은 pointerdown이 팝오버를 닫아 effect cleanup이 그 click 전에 리스너를 제거한다 → 한 번 켜지면 상단바 6개 액션이 전부 무시된다. **다만 트리거를 확증하지 못했다**(`.topbar-popover-shield`가 바깥 pointerdown을 전부 흡수). 같은 실패 모드가 `CustomerManagementPage:openCustomer`에는 **주석과 탈출구(가드에서 소비+리셋)와 함께 박제**돼 있는데 Topbar에만 없다 — 한 줄이면 닫힌다.

## 반증된 원 가설 1건

- 서류 훅 `deleteDocument`의 `kim-` temp id 삭제는 **이미 올바르다** — `removedTempIdsRef`로 표시해 분류 대기 중이면 업로드 취소, 완료 후면 보상 삭제한다. 유령 문서·Storage 고아 없음.

## 실측 렌즈 재현 절차

로컬 dev(`PUSH_NOTIFY=off EMBED_ON_WRITE=off AI_HINT_ON_WRITE=off bun dev`) + 자메스관리자 magiclink
해시 로그인 → `/customers` → 김민준 → 할일 삭제 팝오버 → 드로어 휠 → 팝오버/행 `boundingBox` 대조.
확정 버튼은 누르지 않아 **쓰기 0건**(계측에서 non-GET 0 확인). 스크립트는 세션 스크래치패드에만 두고
레포에 남기지 않았다(구 시각 하네스가 로그인 게이트로 두 달간 죽어 있던 전례 — `AGENTS.md` 참조).
