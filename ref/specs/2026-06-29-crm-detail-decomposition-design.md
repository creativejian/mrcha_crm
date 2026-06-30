# 고객 상세 거대 컴포넌트 분해 설계 (spec)

작성일: 2026-06-29
대상: `client/src/pages/CustomerDetailPage.tsx`의 `KimMinjunDetailContent`
사전 지도: `ref/plans/2026-06-29-crm-detail-decomposition-brief.md`(영역 인벤토리·순서·검증)

## 1. 배경 / 왜 지금

- `KimMinjunDetailContent`는 전 고객 표준 상세(레이아웃 일반화 PR #120 완료)인데 거대 모놀리식이다. 2026-06-29 실측: 파일 5437줄, 컴포넌트 ~4686줄, **`useState` 92 + `useRef` 21 + `useEffect` 30**, `kim` 식별자 866곳.
- 분해를 미뤘던 이유("김민준 전용인 채 쪼개면 일반화 때 이중작업")는 #120으로 해소됨. 지금 쪼개도 무효화되지 않는다.
- 안전한 리팩토링(#61~#78)은 소진. 남은 핵심이 이 컴포넌트 하나.

## 2. 목표 / 비범위

**목표**
- 영역 컴포넌트 + 영역 커스텀 훅으로 분해. 부모는 데이터 fetch·게이팅 + 조립(orchestrator)만 남긴다(수백 줄 목표).
- `kim`→범용 리네임을 각 영역 추출에 흡수(영역분만 누적).
- 동작 보존(고객 상세 회귀 0).

**비범위(후속 슬라이스)**
- 데이터화 잔여(비교카드 round-1 mock·구매조건 일부 mock).
- "옵션 없음" 숨김 등 잔손질.
- CSS 죽은클래스 정리(동적클래스 위험, 별 트랙).
- lib `kim-*.ts` 파일명 리네임(선택, 마지막 별 PR).

## 3. 확정 아키텍처 — (A) 영역별 커스텀 훅 + 프레젠테이션 컴포넌트

근거: state 분포가 극단적으로 비대칭이라 영역 격리가 자연스럽다.

| 영역 | state 수 | 닫힘 정도 |
|---|---|---|
| 헤더 | 0 (props만) | 리네임만 |
| 니즈 | 3 | 거의 닫힘(워크벤치 트리거만 외부) |
| 고객 메모 | 6 | 완전히 닫힘 |
| 해야 할 일 | 9 | 완전히 닫힘 |
| 예정 일정 | 8 | 완전히 닫힘 |
| 서류함 | 11 | 닫힘(overlay 잠금만 외부) |
| 상태+워크플로우 | 8 | 닫힘(부모 override 동기화) |
| 구매조건 | 10 | 닫힘 |
| **견적함+워크벤치** | **~50** | 거대·자체 하위분해 필요 |

견적 1개를 빼면 나머지 8개 영역은 대부분 자기 영역에서 닫힌다. (B) 프롭드릴링은 견적 50개에서 props 폭증으로 붕괴, (C) Context는 단일 페이지에 과함.

**확정 결정 2건 (2026-06-29 brainstorming):**
1. **cross-cutting state는 부모 orchestrator가 직접 보유**(전용 chrome 훅으로 빼지 않음). 추가 추상화 없이 가장 단순. 영역 훅은 cross-cutting을 인자로만 받는다.
2. **추출 단위 = 영역 1개당 브랜치 1개**, 그 브랜치 안에서 훅 추출 + 프레젠테이션 컴포넌트 추출을 함께 수행(작은 영역=1커밋, 견적함=하위분해 다커밋). 영역 단위로 회귀 검증 후 머지.

## 4. state 3계층 분류

### 계층 1 — 영역-로컬 (영역 훅이 소유, 부모는 모름)
각 영역의 데이터 배열 + adding/editing/confirming 토글 + 자기 영역 ref/effect.
- 메모: `customerMemos`, `addingCustomerMemo`, `editingCustomerMemoId`, `confirmingCustomerMemoDeleteId`, `customerMemo{Body,Delete,Edit}Ref`.
- 해야 할 일: `checkItems`, `completedCheckItems`, `addingCheckItem`, `editingCheckItemId`, `selectedCheckDue`, `selectedEditingCheckDue`, `confirmingCheckItemTitle`, `confirmingCheckItemDeleteId`, `check{Confirm,Delete,Edit,Body}Ref`.
- 예정 일정: `schedules`, `completedScheduleKeys`, `addingScheduleItem`, `editingScheduleId`, `confirmingScheduleCompleteId`, `confirmingScheduleDeleteId`, `schedule{Complete,Delete,Edit,Body}Ref`.
- 서류함: `documents`, `isDocumentDragActive`, `draggedDocumentId`, `documentDropTargetId`, `previewDocumentId`, `previewDocumentUrl`, `previewDownloadUrl`, `loadedPreviewUrl`, `confirmingDocumentDeleteId`, `isMergingDocuments`, `document{Delete,Body}Ref`.
- 구매조건: `purchaseFields`, `initialCost{Kind,Unit,Amount}`, `showTimingMonths`, `purchasePopoverFrame`.
- 니즈: `needs`, `appRequests`, (관련 effect/콜백).
- 상태+워크플로우: `statusValues`, `stageGroup`, `stageStatus`, `chance`, `manage`.

### 계층 2 — cross-cutting (부모 orchestrator 소유, 영역에 내려줌)
- `openEditor` — 전 영역 에디터 상호배제 락. 각 영역 훅에 `openEditor` + `requestOpenEditor`(또는 set)를 인자로 내려 상호배제 유지.
- overlay 잠금 — body 스크롤 락(파생값). 각 영역 훅이 `overlayOpen: boolean` 한 개를 반환 → 부모가 OR로 합쳐 `kim-detail-overlay-open` 토글. preview state 자체는 영역 소유.
- `recentUpdate` / `recentUpdateNow` — 1분 타이머. 부모 소유. 각 영역이 변경 시 `markRecentUpdate(section)` 콜백 호출.
- `onEditorOpenChange` 연결 effect — 부모.

### 계층 3 — 영역 간 연결 (소유 영역이 갖고 함수만 노출)
- 워크벤치 prefill 4종 `editingQuoteId`/`editPrefill`/`quoteRequestPrefill`/`sourceQuoteRequestId` — **견적 훅 소유**. 니즈는 `openWorkbenchForQuoteRequest(reqId)` 콜백만 호출. `?quoteRequest=` URL effect도 견적 훅에 둔다.

## 5. 공유 난점 5개 처리 방침

- **A (prefill ↔ 니즈)**: 견적 훅 소유 + `openWorkbenchForQuoteRequest` 콜백 노출. URL effect도 견적 훅. 니즈는 함수 호출만.
- **B (가격 ↔ 카드 시나리오)**: `pricing`/`pricingInputs`/`cardScenario`/`savedManualQuoteConditionIds` 전부 견적 영역 내부 → 견적 훅 안에서 닫힘.
- **C (토스트/리로드)**: `onToast`·`onQuotesPersisted`는 props 그대로 각 훅 인자로. `reloadAppRequests`는 니즈 훅 소유 → 견적 훅이 승격 성공 시 호출하도록 콜백 전달.
- **D (openEditor 락)**: 부모 소유(계층 2). 긴 deps effect는 부모로.
- **E (overlay 잠금)**: 각 영역 훅이 `overlayOpen: boolean` 반환 → 부모 OR(계층 2).

## 6. 산출 구조

- 컴포넌트: `client/src/components/customer-detail/`(신규 디렉터리).
- 영역 훅: `client/src/components/customer-detail/hooks/`.
- 부모 `CustomerDetailPage.tsx` = 데이터 fetch·로딩 게이팅 + orchestrator(조립 + cross-cutting) 만.
- 명명: 추출하며 `Kim*` → 범용(`CustomerDetail*` 또는 영역명). 각 영역분만.

## 7. 영역 추출 순서 + granularity

순서(격리 쉬운 것 → 어려운 것, 브리프 그대로):
1. 헤더 리네임(워밍업)
2. 니즈(최근 #122 정리됨, 깨끗)
3. 고객 메모
4. 해야 할 일
5. 예정 일정
6. 서류함
7. 상태+워크플로우
8. 구매조건
9. **견적함 + 솔루션 워크벤치(마지막·최대·자체 하위분해)**

granularity: 영역마다 브랜치 → 훅 추출 + 컴포넌트 추출(같은 브랜치) → 검증 → 머지 → 다음 영역.
- 작은 영역(메모/할일/일정)은 훅+컴포넌트 1커밋 가능.
- 견적함은 하위분해: 워크벤치 셸 / pricing / 비교카드(manual) / 앱카드 프리뷰 / 견적 액션·미리보기. (VehiclePicker·OptionPicker·ColorPicker·KimAppCardPreview는 이미 별도 컴포넌트.)

`kim` 리네임은 각 영역 추출 시 그 영역분만 누적(866곳 일괄 sweep 금지 — 거대 diff·리뷰 불가).

## 8. 검증 (필수·고위험)

⚠️ 이 컴포넌트는 **단위 테스트가 없다**(거대 페이지). 동작 보존이 typecheck + lint + build + 수동 브라우저 검증에만 의존 → #74~#78(테스트 보호) 분해보다 위험.

- 영역마다: 브랜치 → 추출 → `bun run typecheck`(0) → `bun run lint`(0) → `bun run build`(OK) → **브라우저 회귀 3종**:
  - 김지안(`CU-2606-0001`) = 앱 견적요청 카드(앱 분기)
  - 제임스 = 다요청
  - 김민준(`CU-2605-0020`) = 풀데이터(수기 분기)
- 그 영역 OK 확인 후에만 다음 영역. 한 번에 다 쪼개지 않는다.
- (A) 채택으로 추출한 영역 훅의 순수 가능한 부분은 **단위테스트 신설**(분해하며 커버리지 확보).
- 거대파일 분해는 **브랜치 먼저**(2026 #75 main 직접커밋 사고 교훈).

## 9. 부록 — 영역 인벤토리 앵커 (2026-06-29 실측, ⚠️drift 주의)

실행 시 줄번호는 변동될 수 있으니 grep으로 재확인. 참고용 앵커:
- props 694~712, useState 713~868, useRef 809~887, useEffect 30개(898~2239 사이).
- renderXxx 헬퍼(에디터/popover): 상태 `renderStatusEditor`3116·`renderWorkflowEditor`3163·`renderTimelinePanel`3230 / 니즈 `renderNeedsEditor`3267 / 구매조건 `renderPurchase*Editor` 3304~3593(11개+`renderFloatingPurchaseEditor`) / 일정 `renderScheduleInlineForm`2946 / 체크 `renderCheckItemEditForm`3039.
- 렌더 영역: `.kim-status-dashboard`·`.kim-needs-dashboard`·`.kim-purchase-conditions`·`.kim-customer-memo-section`·`.kim-mvp-ops-grid`(할일/일정/서류/견적, 가장 큼).
- 이미 추출됨: 컴포넌트 `KimMinjunDetailHeader`·`VehiclePicker`·`OptionPicker`·`ColorPicker`·`KimAppCardPreview`. lib `kim-{quote,app-card,status-fields,schedule,detail-utils,popover-frames}.ts`·`quote-pricing.ts`·`customer-{quotes,documents,children}.ts`·`vehicles.ts`.

### 분해 시 가장 얽힌 지점 3가지 (실행 주의)
1. **견적 신규 vs 수정의 `persistedQuoteIdRef` 역할** — 신규 첫 INSERT 후 서버 id를 ref에 저장해 이후 UPDATE 대상으로(=비교카드 key 리마운트 회피). `editingQuoteId`와 역할이 다름.
2. **`quoteRequestPrefill` ↔ `editPrefill` ↔ `workbenchVehicle` 동기화** — 같은 워크벤치를 승격(trimId/optionIds만, 가격은 catalog 계산)과 수정(가격/할인/시나리오 복원)이 공유. prefill effect의 부작용 체인(trim→color→pricing) 주의.
3. **`openEditor` ↔ 각 영역 adding/editing/confirming 불일치** — 닫을 때 둘 다 리셋 필요. `onEditorOpenChange` deps array 누락 위험. 영역 추출 시 락 동기화 보존이 핵심.
