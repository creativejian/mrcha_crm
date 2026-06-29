# 고객 상세 거대 컴포넌트 분해 브리프 (새 세션용)

작성일: 2026-06-29
성격: `client/src/pages/CustomerDetailPage.tsx`의 `KimMinjunDetailContent`(전 고객 표준 상세, 거대 모놀리식)를 **영역 컴포넌트로 분해 + `kim`→범용 리네임**. 새 세션이 brainstorming(설계 1건만) → plan → subagent-driven으로 진행하기 위한 사전 지도.

## 왜 지금

- 분해를 미뤘던 2026-06-20 합의 이유("김민준 전용인 채 쪼개면 일반화 때 또 건드려 이중작업")는 **PR #120 레이아웃 일반화로 해소**됨(이제 전 고객이 이 컴포넌트 사용). 지금 쪼개도 일반화로 무효화 안 됨.
- 남은 "일반화"(데이터화 mock→DB, kim 리네임)는 분해와 별개 트랙이 아니라 **분해에 흡수**해서 같이 한다.
- 안전한 리팩토링(#61~#78: 죽은코드·도메인상수·lib/http·CSS 토큰화·다른 거대파일 분해)은 이미 소진. 남은 핵심이 이 컴포넌트 하나.

## 규모 (2026-06-29 실측)

- `CustomerDetailPage.tsx` **5428줄**. `KimMinjunDetailContent` ≈ **685~5371줄(~4686)**.
- 컴포넌트 내 **`useState` 92개** ← 분해의 핵심 난점(공유 state).
- `kim`/`Kim` 식별자 **708곳**(리네임 대상).
- 컴포넌트 내 `renderXxx()` 헬퍼 ~30개(에디터/popover, 2937~3603).
- 이미 분리된 순수 lib: `client/src/lib/kim-{detail-utils,schedule,status-fields,popover-frames,quote,app-card}.ts`(+테스트). → 순수 로직은 상당수 이미 밖. **남은 건 JSX 렌더 + state + 핸들러.**

## 영역 인벤토리 (분해 단위, 렌더 구조 기준)

`.kim-customer-dashboard`(3607) 아래:
1. **헤더** — `KimMinjunDetailHeader`(286, **이미 별도 함수**). 리네임만.
2. **상태+워크플로우** — `.kim-status-dashboard`(3610~3778): 상태그리드(연락처/직군/거주지/상담경로/담당자/배정시간) + 워크플로우(진행/계약가능성/관리/타임라인). 에디터: `renderStatusEditor`·`renderWorkflowEditor`·`renderTimelinePanel` + 이미 별도인 `Kim{Phone,Job,Location,Source,Advisor}StatusEditor`.
3. **니즈** — `.kim-needs-dashboard`(3699~3778): 앱요청 카드/수기 need + `renderNeedsEditor` + `appRequests` state/effect + `openWorkbenchForQuoteRequest`. (최근 #122에서 정리됨.)
4. **구매조건** — `.kim-purchase-conditions`(3781~3859) + `renderPurchase*Editor` 약 15개(3295~3603) + `renderFloatingPurchaseEditor`.
5. **고객 메모** — `.kim-customer-memo-section`(3860~3979).
6. **운영 그리드** — `.kim-mvp-ops-grid`(3980~5371, **가장 큼 ~1400줄**):
   - 해야 할 일(checks) + `renderCheckItemEditForm`.
   - 예정 일정(schedules) + `renderScheduleInlineForm`.
   - 서류함(documents, drag/drop/preview).
   - **견적함 + 솔루션 워크벤치**(4924 `kim-jeff-top-panel` pricing, 5008 `kim-app-quote-builder`, 5016 manual-compare) — 사실상 미니앱. **자체 하위 분해 필요**(VehiclePicker/OptionPicker/ColorPicker는 이미 별도 컴포넌트, 워크벤치 셸·pricing·비교카드·앱카드 프리뷰가 인라인).

## ⚠️ 핵심 설계 결정 (새 세션 brainstorming 1건 — 실행 전 확정)

**92개 useState를 영역 컴포넌트로 어떻게 나눌지.** 후보:
- **(A) 영역별 커스텀 훅 + 프레젠테이션 컴포넌트** (추천): `useNeedsArea`/`useQuotesWorkbench` 등으로 state+핸들러를 영역별 훅에 묶고, 얇은 `<NeedsArea …/>` 컴포넌트가 소비. state 응집↑, 파일 작아짐, 테스트 가능해짐(훅 단위테스트 추가 기회).
- **(B) 프롭 드릴링**: state는 부모 유지, 영역 컴포넌트에 props로 다 내림. 가장 단순하나 props 폭증(영역당 수십 개).
- **(C) Context**: 과함(단일 페이지). 비추천.
- 권장 = **(A)**. 단 영역 간 얽힌 state(예: 워크벤치 prefill ↔ 니즈 카드 `openWorkbenchForQuoteRequest`, `editingQuoteId`/`persistedQuoteIdRef`)는 경계 신중히. 새 세션이 (A) 확정 + 경계 한 번 그리고 시작.

## 순서 (격리 쉬운 것 → 어려운 것)

1. 헤더 리네임(워밍업) → 2. 니즈(최근 정리됨, 깨끗) → 3. 고객 메모 → 4. 해야 할 일 → 5. 예정 일정 → 6. 서류함 → 7. 상태+워크플로우 → 8. 구매조건 → 9. **견적함+워크벤치(마지막, 최대, 자체 하위분해)**. `kim`→범용 리네임은 **각 영역 추출 시 그 영역분만** 바꿔 누적(708곳 일괄 sweep 금지 — 거대 diff·리뷰불가). 마지막에 lib `kim-*.ts` 파일명 리네임은 선택(별 PR).

## 검증 (필수)

- ⚠️ **이 컴포넌트는 단위 테스트 없음**(거대 페이지 = 수동/스크린샷). 동작 보존 = **typecheck0 + lint0 + build + 브라우저 회귀**에만 의존 → #74~#78(테스트 보호) 분해보다 위험.
- **영역마다**: 브랜치 → subagent 추출 → typecheck0/lint0 → **브라우저 회귀 3종**(김지안=앱 카드/제임스=다요청/김민준=풀데이터) → 그 영역 OK 후 다음. 한 번에 다 쪼개지 말 것.
- (A) 채택 시 추출한 영역 훅에 **단위테스트 신설**(가능한 순수 부분) — 분해하며 테스트 커버리지도 확보.
- 거대파일 분해는 **브랜치 먼저**(2026 #75 main 직접커밋 사고 교훈).

## 산출물

- 영역별 컴포넌트: `client/src/components/customer-detail/`(신규 디렉터리) 권장. 영역 훅: 같은 디렉터리 또는 `client/src/lib/`.
- 최종: `CustomerDetailPage.tsx`는 영역 컴포넌트 조립 + 라우팅/데이터fetch 게이팅만(수백 줄 수준 목표).

## 비범위 / 후속

- 데이터화(mock→DB) 잔여(비교카드 round-1 mock·구매조건 일부)는 분해 후 작은 파일에서 별도 슬라이스.
- "옵션 없음" 숨김 등 잔손질도 분해 후.
- CSS 죽은클래스 정리(동적클래스 위험)는 별 트랙.
