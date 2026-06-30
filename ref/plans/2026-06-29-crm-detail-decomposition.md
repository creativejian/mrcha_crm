# 고객 상세 거대 컴포넌트 분해 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `client/src/pages/CustomerDetailPage.tsx`의 거대 `KimMinjunDetailContent`(~4686줄, useState 92)를 영역별 커스텀 훅 + 프레젠테이션 컴포넌트로 분해하고 `kim`→범용 리네임한다(동작 보존).

**Architecture:** (A) 영역별 훅 + 프레젠테이션 컴포넌트. 부모는 데이터 fetch·게이팅 + orchestrator(조립 + cross-cutting state) 만 남긴다. cross-cutting(`openEditor`·overlay 잠금·`recentUpdate`)은 부모 직접 보유. 영역 간 연결(워크벤치 prefill)은 견적 훅 소유 + 콜백 노출. 영역=1 브랜치, 훅+컴포넌트 함께.

**Tech Stack:** React + TypeScript 6.0.3, Bun, ESLint(typescript-eslint strict). 검증=typecheck/lint/build + 수동 브라우저(단위테스트 없는 고위험 컴포넌트).

설계 근거: `ref/specs/2026-06-29-crm-detail-decomposition-design.md`

---

## ⚠️ 실행 순서 (2026-06-29 조정)

아래 `## Task N` 번호는 **영역 식별자일 뿐**, 실제 실행은 이 순서로 한다. 니즈(Task 2)는 워크벤치와 양방향 얽힘(`openWorkbenchForQuoteRequest`·`reloadAppRequests` cross-call)이라 '깨끗한 첫 영역'이 아니어서 워크벤치 직전으로 미뤘다.

1. 헤더 리네임 ✅ (Task 1)
2. 고객 메모 (Task 3) — 첫 닫힌 영역, 추출 패턴 확립
3. 해야 할 일 (Task 4)
4. 예정 일정 (Task 5)
5. 서류함 (Task 6)
6. 상태+워크플로우 (Task 7)
7. 구매조건 (Task 8)
8. 니즈 (Task 2) — 워크벤치 연결 콜백
9. 견적함+워크벤치 (Task 9) — 마지막·최대·하위분해

## 전제 — 실행 전 매번 확인

- ⚠️ **줄번호 drift**: spec 부록 줄번호는 2026-06-29 실측이며 영역을 하나씩 빼면 뒤 영역 줄번호가 전부 당겨진다. **항상 grep으로 현재 위치를 재확인**한 뒤 작업한다(plan의 줄번호는 참고용 앵커).
- ⚠️ **단위테스트 없음**: `KimMinjunDetailContent`는 거대 페이지라 동작 보존이 typecheck+lint+build+브라우저에만 의존. 영역 1개 끝낼 때마다 반드시 회귀 검증 후 다음.
- ⚠️ **dev:api watch 없음**: 백엔드는 안 건드리지만, 브라우저 검증 시 `bun run dev`가 최신인지 확인(프론트는 HMR).
- **브랜치 먼저**: 영역마다 새 브랜치(2026 #75 main 직접커밋 사고 교훈). main에서 직접 분해 금지.

## 공통: 표준 영역 추출 절차 (모든 Task가 따름)

각 영역 Task는 아래 7단계를 따른다. Task별 본문은 이 절차에 끼울 **영역-specific 인벤토리**(이동 대상·훅 시그니처·리네임 대상·얽힘 주의·검증 포인트)만 정의한다.

- [ ] **A. 통합 브랜치에서 작업**: 모든 영역은 통합 브랜치 `refactor/crm-detail-decomposition`에 **순차 누적**한다(영역별 sub-브랜치 대신 — 2026-06-29 "로컬 누적→묶음 PR" 결정). main은 push/PR 전까지 불가침. 영역 시작 전 통합 브랜치에 체크아웃돼 있는지 확인.
- [ ] **B. 이동 대상 식별**: 해당 영역의 state/ref/effect/렌더 헬퍼/JSX 블록을 grep으로 현재 위치 확인(Task 본문 인벤토리 기준).
- [ ] **C. 영역 훅 생성** `client/src/components/customer-detail/hooks/use<Area>.ts`: 영역-로컬 state/ref/effect/핸들러를 옮긴다. cross-cutting(`openEditor`·`setOpenEditor`/`requestOpenEditor`·`markRecentUpdate`·overlay)은 **인자로 받고** `overlayOpen`(있으면)을 **반환**. 훅 반환 객체 시그니처는 Task 본문에 정의. **cross-cutting 래퍼가 부모에 아직 없으면**(`markRecentUpdate`/`requestOpenEditor`): 이 영역에서 부모에 `useCallback`으로 한 번 정의한 뒤(기존 `setRecentUpdate({section,updatedAt})`/`setOpenEditor` 동작 그대로 감쌈) 인자로 내려준다. 이미 있으면 재사용.
- [ ] **D. 프레젠테이션 컴포넌트 생성** `client/src/components/customer-detail/<Area>.tsx`: 해당 JSX 블록 + 영역 렌더 헬퍼를 옮긴다. props = 훅 반환 + cross-cutting 필요분.
- [ ] **E. 부모에서 교체**: `KimMinjunDetailContent`에서 옮긴 state/헬퍼/JSX를 제거하고 `const area = useArea({...})` + `<Area {...area} />`로 대체. cross-cutting 배선 연결.
- [ ] **F. kim 리네임(영역분만)**: 이 영역에서 옮긴 식별자·CSS 클래스 헬퍼의 `kim`/`Kim`을 범용으로. 다른 영역 식별자는 건드리지 않는다. (CSS 클래스 문자열 `.kim-*`는 index.css 연동이라 **이번 분해에서 변경 금지** — 식별자/함수/타입명만 리네임. CSS 클래스 리네임은 별 트랙.)
- [ ] **G. 검증 게이트**: `bun run typecheck`(0) → `bun run lint`(0) → `bun run build`(OK) → **브라우저 회귀 3종**:
  - 김지안(`CU-2606-0001`) = 앱 견적요청 카드(앱 분기) 정상
  - 제임스 = 다요청 정상
  - 김민준(`CU-2605-0020`) = 풀데이터(수기 분기) 회귀 0
  - 영역 동작(추가/수정/삭제/팝오버/스크롤) 직접 클릭 확인. OK 후 통합 브랜치에 커밋하고 다음 영역으로. (GitHub PR/prod 배포는 전체 또는 묶음으로 마지막에.)

### 영역 훅 표준 반환 패턴

```ts
// 예시 형태 (영역마다 필드는 다름)
export function useArea(args: {
  detail: CustomerDetailData;
  customerId: number;            // 또는 customer.id (string uuid) — 영역이 쓰는 식별자
  openEditor: OpenEditorState | null;
  requestOpenEditor: (next: OpenEditorState | null) => void;
  markRecentUpdate: (section: string) => void;
  onToast: (message: string) => void;
}) {
  // 영역-로컬 state/ref/effect/핸들러
  return {
    items,                       // 데이터
    handlers: { add, update, remove, toggle /* ... */ },
    refs: { bodyRef /* ... */ },
    overlayOpen,                 // 영역이 overlay를 띄우면(서류/견적), 없으면 생략
  };
}
```

cross-cutting 타입(`OpenEditorState` 등)은 Task 0에서 공유 타입으로 추출한다.

---

## Task 0: 디렉터리 + 공유 타입 추출 (동작 무변경 스캐폴드)

분해를 받을 그릇과 공유 타입만 먼저 만든다. **JSX/동작/state는 그대로** — 타입을 파일로 옮기고 부모가 import할 뿐. cross-cutting 헬퍼(`markRecentUpdate`/`requestOpenEditor`)는 큰 diff·동작보존 위험이 있어 Task 0에서 전체 교체하지 않고, **첫 영역 추출(Task 2/3)에서 그 영역이 처음 필요로 할 때 부모에 useCallback으로 도입**한다(공통 절차 C 참고).

**Files:**
- Create: `client/src/components/customer-detail/` (디렉터리)
- Create: `client/src/components/customer-detail/types.ts`
- Modify: `client/src/pages/CustomerDetailPage.tsx`(`KimMinjunDetailContent` 내부 — openEditor 타입 선언을 import로만 교체)

- [ ] **Step 1: 브랜치** `git switch -c refactor/crm-detail-scaffold`

- [ ] **Step 2: 공유 타입 추출** `types.ts` 생성. 현재 `KimMinjunDetailContent` 안 `openEditor` state의 타입을 grep `openEditor`/`setOpenEditor` 선언부에서 **정확히 확인**한 뒤 그 형태 그대로 export. (아래는 예시 — 실제 형태가 다르면 실제대로.)

```ts
// client/src/components/customer-detail/types.ts
// ⚠️ 실제 openEditor 선언부 형태를 확인 후 정확히 복제할 것
export type OpenEditorState = { kind: string; key?: string };
```

- [ ] **Step 3: 부모에서 타입 import 교체**: `KimMinjunDetailContent`의 `openEditor` 관련 인라인 타입 주석/제네릭을 `OpenEditorState` import로 교체(`useState<OpenEditorState | null>(null)` 형태). **로직·동작 변경 없음**. 타입이 한 군데서만 쓰여 추출 효과가 미미하면 이 step은 생략하고 types.ts에 타입만 정의해 둬도 됨(이후 영역 훅이 import). 단 lint unused 방지를 위해 어딘가 한 곳은 반드시 import해 사용.

- [ ] **Step 4: 검증** `bun run typecheck`(0) → `bun run lint`(0) → `bun run build`(OK). 동작 무변경이라 브라우저 검증은 생략 가능(다음 영역부터 회귀 3종).

- [ ] **Step 5: 커밋 + PR + 머지**

```bash
git add client/src/components/customer-detail/types.ts client/src/pages/CustomerDetailPage.tsx
git commit -m "refactor(crm): 고객 상세 분해 스캐폴드 — 디렉터리+공유 타입 추출"
```

---

## Task 1: 헤더 리네임 (워밍업)

`KimMinjunDetailHeader`는 이미 별도 컴포넌트(spec 부록). state 없음 → 추출 불필요, **리네임만**.

**Files:**
- Modify: `client/src/components/KimMinjunDetailHeader.tsx`(파일명 포함) → `CustomerDetailHeader.tsx`
- Modify: `client/src/pages/CustomerDetailPage.tsx`(import + 사용처)

- [ ] **Step 1: 통합 브랜치 확인**: `refactor/crm-detail-decomposition`에 체크아웃돼 있는지 확인(별도 sub-브랜치 만들지 않음).
- [ ] **Step 2: 파일/식별자 리네임**: `KimMinjunDetailHeader` → `CustomerDetailHeader`. 파일 `git mv client/src/components/KimMinjunDetailHeader.tsx client/src/components/customer-detail/CustomerDetailHeader.tsx`(신규 디렉터리로 이동). props 타입명에 `Kim`이 있으면 함께. **CSS 클래스 `.kim-*` 문자열은 변경 금지**.
- [ ] **Step 3: import 갱신**: `CustomerDetailPage.tsx`의 import 경로/이름과 JSX 사용처 갱신. 다른 import처 있으면 grep `KimMinjunDetailHeader`로 전수 확인.
- [ ] **Step 4: 검증 게이트**(공통 G): typecheck0/lint0/build + 브라우저 3종(헤더 이름/코드/수신시간/최근업데이트 정상 표시).
- [ ] **Step 5: 통합 브랜치에 커밋**

```bash
git commit -m "refactor(crm): 고객 상세 헤더 KimMinjunDetailHeader→CustomerDetailHeader 리네임+이동"
```

---

## Task 2: 니즈 영역

**영역 인벤토리** (grep으로 현재 위치 확인):
- state: `needs`, `appRequests`, `showTimingMonths`(니즈 출고시기 토글 — 구매조건과 공유 여부 grep `showTimingMonths` 확인. 구매조건 Task와 겹치면 소유를 한 곳으로 결정, 중복이면 니즈에 둠).
- effect: 앱 견적요청 카드 fetch(`[detail.appUserId]`), `?quoteRequest=` URL 처리(`[location.search]`).
- 렌더 헬퍼: `renderNeedsEditor`.
- JSX 블록: `.kim-needs-dashboard`.
- 콜백: `reloadAppRequests`(니즈 소유 — 견적 훅이 승격 후 호출하도록 부모가 중계), `openWorkbenchForQuoteRequest`(**견적 영역 소유** — 니즈는 호출만).

**⚠️ 얽힘**: `openWorkbenchForQuoteRequest`와 `?quoteRequest=` URL effect는 워크벤치(Task 9) 소유다. **Task 9 전이므로 지금은 워크벤치가 아직 부모에 있다** → 니즈 영역은 `openWorkbenchForQuoteRequest`를 **부모에서 prop으로 받아** 호출만 한다. URL effect도 부모 유지(워크벤치 state를 만지므로). 니즈 훅은 `needs`·`appRequests`·fetch·`reloadAppRequests`만 소유.

**훅 시그니처** `useCustomerNeeds`:
```ts
useCustomerNeeds(args: {
  detail; customerId;
  requestOpenEditor; openEditor; markRecentUpdate; onToast;
}) => {
  needs, setNeedsField, appRequests, reloadAppRequests, renderNeedsEditor 대체 JSX,
}
```

**리네임**: `renderNeedsEditor`·니즈 관련 핸들러/타입의 `kim` → `needs`/범용.

- [ ] 공통 절차 A~G 수행. 컴포넌트 `Needs.tsx`, 훅 `useCustomerNeeds.ts`.
- [ ] **검증 포인트**: 김지안=앱 카드 4건 렌더+"견적 작성" 클릭 시 워크벤치 오픈(부모 콜백 경유)·승격 후 배지. 김민준=수기 need 카드 회귀 0. 문의사항/색상 sentinel 숨김 유지.
- [ ] 커밋 메시지: `refactor(crm): 고객 상세 니즈 영역 컴포넌트+훅 추출`

---

## Task 3: 고객 메모 영역

**영역 인벤토리**:
- state: `customerMemos`, `addingCustomerMemo`, `editingCustomerMemoId`, `confirmingCustomerMemoDeleteId`.
- ref: `customerMemoBodyRef`, `customerMemoDeleteRef`, `customerMemoEditRef`.
- effect: 메모 추가 시 하단 자동 스크롤(`[customerMemos.length]`), 추가 폼 focus(`[addingCustomerMemo]`), 수정 폼 focus(`[editingCustomerMemoId]`).
- 계산: `sortedCustomerMemos`(`sortKimCustomerMemosByCreatedAt` lib 사용).
- JSX 블록: `.kim-customer-memo-section`.
- API: `addMemo`/`updateMemo`/`deleteMemo`(`customer-children.ts`). 성공 시 `invalidateCustomerDetail` 불변식 + `markRecentUpdate("고객 메모")` + `onToast`.

**⚠️ 얽힘**: 추가/수정 폼은 `openEditor` 락 + 자기 `adding*/editing*` 둘 다 리셋해야 함(spec 난점 3). 훅 안에서 닫을 때 `requestOpenEditor(null)`도 호출.

**훅 시그니처** `useCustomerMemos` → `{ memos: sortedCustomerMemos, adding, editingId, confirmingDeleteId, handlers:{startAdd, submitAdd, startEdit, submitEdit, remove, cancel}, refs:{bodyRef, deleteRef, editRef} }`.

**리네임**: `customerMemo*`·`sortKimCustomerMemos*` 호출부 등 영역 식별자 `kim`→범용.

- [ ] 공통 절차 A~G. 컴포넌트 `CustomerMemos.tsx`, 훅 `useCustomerMemos.ts`.
- [ ] **검증 포인트**: 메모 추가→하단 스크롤+최근업데이트 "방금 전", 수정/삭제, 빈 상태 안내(김지안). 김민준 메모 3건 정렬 유지.
- [ ] 커밋: `refactor(crm): 고객 상세 고객 메모 영역 컴포넌트+훅 추출`

---

## Task 4: 해야 할 일(checks) 영역

**영역 인벤토리**:
- state: `checkItems`, `completedCheckItems`, `addingCheckItem`, `editingCheckItemId`, `selectedCheckDue`, `selectedEditingCheckDue`, `confirmingCheckItemTitle`, `confirmingCheckItemDeleteId`.
- ref: `checkConfirmRef`, `checkDeleteRef`, `checkEditRef`, `checkBodyRef`.
- effect: 체크 수정 폼 focus(`[editingCheckItemId]`), 추가 폼 focus(`[addingCheckItem]`).
- 계산: `sortedCheckItems`(`sortKimCheckItemsByWorkRule`), `remainingCheckCount`.
- 렌더 헬퍼: `renderCheckItemEditForm`.
- JSX 블록: `.kim-mvp-ops-grid` 내 해야 할 일 섹션.
- API: `addTask`/`updateTask`/`deleteTask` + done 토글. `markRecentUpdate("해야 할 일")`.

**⚠️ 얽힘**: `.kim-mvp-ops-grid`는 할일/일정/서류/견적이 한 그리드. **그리드 컨테이너 div는 부모에 남기고**, 각 영역 컴포넌트가 그 자식으로 들어간다(Task 4~6, 9가 같은 그리드를 공유). 추출 시 자기 섹션 카드만 컴포넌트로.

**훅 시그니처** `useCustomerChecks` → `{ items: sortedCheckItems, completedIds, remainingCount, adding, editingId, selectedDue, selectedEditingDue, confirming:{title, deleteId}, handlers:{...}, refs:{...}, renderEditForm }`.

**리네임**: `renderCheckItemEditForm`·`check*`·`parseKimCheckDueDate` 호출 등 영역분 `kim`→범용.

- [ ] 공통 절차 A~G. 컴포넌트 `CustomerChecks.tsx`, 훅 `useCustomerChecks.ts`.
- [ ] **검증 포인트**: 체크 추가(기한 오늘/내일/이번주/급함/지정)·수정·완료토글·삭제확인. 정렬(완료상단→급함→오늘…) 유지. 빈 상태 안내.
- [ ] 커밋: `refactor(crm): 고객 상세 해야 할 일 영역 컴포넌트+훅 추출`

---

## Task 5: 예정 일정(schedules) 영역

**영역 인벤토리**:
- state: `schedules`, `completedScheduleKeys`, `addingScheduleItem`, `editingScheduleId`, `confirmingScheduleCompleteId`, `confirmingScheduleDeleteId`.
- ref: `scheduleCompleteRef`, `scheduleDeleteRef`, `scheduleEditRef`, `scheduleBodyRef`.
- effect: 수정 폼 focus(`[editingScheduleId]`), 추가 폼 focus(`[addingScheduleItem]`).
- 계산: `sortedSchedules`(`sortKimSchedulesByDateTime`).
- 렌더 헬퍼: `renderScheduleInlineForm`.
- JSX 블록: `.kim-mvp-ops-grid` 내 예정 일정 섹션(그리드 컨테이너는 부모 유지).
- API: `addSchedule`/`updateSchedule`/`deleteSchedule`(+done 토글, `customer_schedules.done`). `markRecentUpdate("예정 일정")`.

**훅 시그니처** `useCustomerSchedules` → `{ items: sortedSchedules, completedKeys, adding, editingId, confirming:{completeId, deleteId}, handlers:{...}, refs:{...}, renderInlineForm }`.

**리네임**: `renderScheduleInlineForm`·`schedule*`·`sortKimSchedules*` 영역분.

- [ ] 공통 절차 A~G. 컴포넌트 `CustomerSchedules.tsx`, 훅 `useCustomerSchedules.ts`.
- [ ] **검증 포인트**: 일정 추가(날짜+시간+유형+메모)·수정·완료확인·삭제. 날짜/시간 오름차순 정렬 유지.
- [ ] 커밋: `refactor(crm): 고객 상세 예정 일정 영역 컴포넌트+훅 추출`

---

## Task 6: 서류함 영역

**영역 인벤토리**:
- state: `documents`, `isDocumentDragActive`, `draggedDocumentId`, `documentDropTargetId`, `previewDocumentId`, `previewDocumentUrl`, `previewDownloadUrl`, `loadedPreviewUrl`, `confirmingDocumentDeleteId`, `isMergingDocuments`.
- ref: `documentDeleteRef`, `documentBodyRef`.
- effect: 서류 미리보기 URL 발급(`[previewDocumentId]`).
- 계산: `activePreviewDocumentUrl`, `activeDownloadUrl`.
- JSX 블록: `.kim-mvp-ops-grid` 내 서류함 섹션 + 미리보기 모달.
- API: `uploadDocument`/`updateDocumentTypeApi`/`reorderDocumentsApi`/삭제 + 병합(`document-merge.ts`, pdf-lib 동적 import). signed URL TTL 60s. `markRecentUpdate("서류함")`.

**⚠️ 얽힘 (overlay)**: 서류 미리보기 모달은 body 스크롤 잠금 대상(spec 난점 E). 훅이 `overlayOpen = previewDocumentId != null`을 **반환** → 부모가 OR로 합쳐 잠금. preview state는 훅 소유.

**훅 시그니처** `useCustomerDocuments` → `{ documents, dragState, preview:{id, url, downloadUrl, loadedUrl}, confirmingDeleteId, isMerging, handlers:{upload, changeType, reorder, openPreview, closePreview, remove, merge}, refs:{deleteRef, bodyRef}, overlayOpen }`.

**리네임**: `document*`·`isMergingDocuments` 등 영역분 `kim`→범용.

- [ ] 공통 절차 A~G. 컴포넌트 `CustomerDocuments.tsx`, 훅 `useCustomerDocuments.ts`.
- [ ] **검증 포인트**: 드롭 업로드→자동분류·분류 변경·드래그 재정렬·미리보기(이미지 JPEG 썸네일/PDF)·다운로드·삭제·병합(`고객명-서류.pdf`)·모달 열림 시 배경 스크롤 잠금(overlay OR 동작). Safari 미리보기 회귀 주의(#84).
- [ ] 커밋: `refactor(crm): 고객 상세 서류함 영역 컴포넌트+훅 추출`

---

## Task 7: 상태 + 워크플로우 영역

**영역 인벤토리**:
- state: `statusValues`, `stageGroup`, `stageStatus`, `chance`, `manage`.
- effect: customer 동기화(`[customer.status]`), chance 동기화(`[chanceOverride]`), manage 동기화(`[manageStatusOverride]`), timeline 에디터 열림 자동 스크롤(`[openEditor?.kind]`).
- 렌더 헬퍼: `renderStatusEditor`, `renderWorkflowEditor`, `renderTimelinePanel`.
- 이미 별도 에디터 컴포넌트: `Kim{Phone,Job,Location,Source,Advisor}StatusEditor`(리네임 대상).
- 계산: `timelineItems`.
- ref: `consultBodyRef`.
- JSX 블록: `.kim-status-dashboard`.
- 콜백: `onWorkflowChange`(부모 prop) — 진행/계약가능성/관리 변경 시. 계약완료→확정 동기화 규칙 보존.

**⚠️ 얽힘**: `stageGroup`/`stageStatus`/`chance`/`manage`는 부모 override(`chanceOverride`/`manageStatusOverride`)와 동기화 effect가 있고 `onWorkflowChange`로 부모에 보고. 훅이 override를 인자로 받고 변경을 콜백으로 올린다. `recentUpdate` 표시도 이 영역과 연동.

**훅 시그니처** `useCustomerWorkflow` → `{ statusValues, stageGroup, stageStatus, chance, manage, timelineItems, handlers:{changeStage, changeChance, changeManage, saveStatusField}, refs:{consultBodyRef}, renderStatusEditor, renderWorkflowEditor, renderTimelinePanel }`.

**리네임**: `Kim*StatusEditor` 5종·`renderStatusEditor`/`renderWorkflowEditor`/`renderTimelinePanel`·`statusValues` 관련 `kim`→범용. (이미 별 파일인 5 에디터는 파일 `git mv`로 `customer-detail/`로 이동 가능.)

- [ ] 공통 절차 A~G. 컴포넌트 `StatusDashboard.tsx`(또는 `StatusWorkflow.tsx`), 훅 `useCustomerWorkflow.ts`.
- [ ] **검증 포인트**: 연락처(010+8 규약)·직군 2단계·거주지·상담경로·담당자(팀별) 편집 저장. 진행상태 1차→2차 종속·계약가능성·관리상태·타임라인. 계약완료→확정 자동. 부모 override 반영.
- [ ] 커밋: `refactor(crm): 고객 상세 상태+워크플로우 영역 컴포넌트+훅 추출`

---

## Task 8: 구매조건 영역

**영역 인벤토리**:
- state: `purchaseFields`(9필드), `initialCostKind`, `initialCostUnit`, `initialCostAmount`, `showTimingMonths`(Task 2와 소유 조율), `purchasePopoverFrame`.
- 렌더 헬퍼: `renderPurchaseEditor`, `renderPurchaseMethodEditor`, `renderPurchaseTermEditor`, `renderPurchaseInitialCostEditor`, `renderPurchaseAnnualMileageEditor`, `renderPurchaseDeliveryMethodEditor`, `renderPurchaseTimingEditor`, `renderPurchaseCostFocusEditor`, `renderPurchaseCustomerNotesEditor`, `renderPurchaseReviewNotesEditor`, `renderFloatingPurchaseEditor`(popover 컨테이너).
- JSX 블록: `.kim-purchase-conditions`.
- popover 위치: `calculateKimPurchasePopoverFrame`(`kim-popover-frames.ts`).
- API: `savePatch`(본체 컬럼 PATCH) — 구매방식/출고시기는 저장, 비컬럼 조건(계약기간 등)은 미저장(현행 유지). `markRecentUpdate`.

**⚠️ 얽힘**: `primaryDiscountUnit`/`discountLines`/`acquisitionTaxMode`는 spec에서 가격(견적) 관련으로 분류됨 — **구매조건이 아니라 Task 9(워크벤치 pricing) 소유**. Task 8에서는 건드리지 않는다(grep으로 사용처 확인해 견적 영역 것이면 남겨둠).

**훅 시그니처** `useCustomerPurchase` → `{ fields: purchaseFields, initialCost:{kind, unit, amount}, showTimingMonths, popoverFrame, handlers:{setField, openEditor, save}, render* }`.

**리네임**: `renderPurchase*`·`purchase*`·`calculateKimPurchasePopoverFrame` 호출 영역분.

- [ ] 공통 절차 A~G. 컴포넌트 `PurchaseConditions.tsx`, 훅 `useCustomerPurchase.ts`.
- [ ] **검증 포인트**: 9필드 각 popover 편집·초기비용(무보증/보증금/선수금 × %/금액)·출고시기 월 선택·심사사항. 저장 컬럼 영속/비저장 필드 새로고침 원복 동작 유지.
- [ ] 커밋: `refactor(crm): 고객 상세 구매조건 영역 컴포넌트+훅 추출`

---

## Task 9: 견적함 + 솔루션 워크벤치 (마지막·최대·하위분해)

~50 state. 한 번에 옮기지 않고 **하위 task 9a~9e로 점진**. 각 하위 task는 자체 브랜치+검증 게이트(공통 G)를 거친다. 하위 task 사이에도 typecheck/build를 유지해 항상 동작하는 상태로 둔다.

**전체 영역 인벤토리** (grep으로 현재 위치 재확인):
- 견적 목록: `quotes`, `editingQuoteId`, `persistedQuoteIdRef`, `previewQuoteId`, `previewSentQuoteId`, `expandedQuoteId`, `previewQuoteUrl`, 견적 confirm 5종(`confirmingQuoteDeleteId`/`SendId`/`ContractId`/`ContractEditId`/`ContractDowngrade`), `openQuoteActionId`, `quoteActionFrame`, `hoveredQuoteStatus`, `pinnedQuoteStatus`, `quoteDropTargetId`, `quoteBodyRef`, `prevQuoteLenRef`.
- 워크벤치 UI: `isQuoteSolutionWorkbenchOpen`, `solutionWorkbenchPurchaseMethod`, `solutionWorkbenchEntryMode`, `solutionWorkbenchModeMenu`, `isQuoteDraftSaved`, `isQuoteDraftDirty`.
- 차량/옵션/색상: `workbenchVehicle`, `trimDetail`, `selectedWorkbenchOptionIds`, `exteriorColor`, `interiorColor`, `editPrefill`, `quoteRequestPrefill`, `sourceQuoteRequestId`, `quoteRequestPrefillRef`.
- pricing: `pricing`, `pricingInputs`, `primaryDiscountUnit`, `discountLines`, `acquisitionTaxMode`, `pricingPanelRef`.
- 수기 비교카드: `manualQuoteCards`, `manualTermMonths`, `manualDepositModes`, `manualDownPaymentModes`, `manualResidualModes`, `manualMileageModes`, `manualMileageValues`, `savedManualQuoteConditionIds`, `quoteDetailFormRef`, `cardScenario`.
- 앱카드: `isQuoteAppCardPreviewOpen`, `guidance`(+`appCardModel` 계산).
- PDF 원본: `recognizedQuoteFile`, `isQuoteWorkbenchOriginalDragActive`, `quoteWorkbenchOriginalInputRef`.
- effect: 견적 PDF URL(`[previewQuoteId]`), `?quoteRequest=`(`[location.search]`), 워크벤치 ESC/포인터(`[isQuoteSolutionWorkbenchOpen]`), solution 불가 fallback(`[solutionWorkbenchCanQuery]`), 견적 추가 스크롤(`[quotes.length]`), 수정 prefill(`[editingQuoteId]`), 견적요청 prefill(`[quoteRequestPrefill]`), PDF 인식(`[recognizedQuoteFile]`), 카드 시나리오 추출(`[savedManualQuoteConditionIds]`).
- 렌더: `renderQuoteActionMenu`, `renderQuoteAppCardPreview` 등. 이미 별 컴포넌트: `VehiclePicker`/`OptionPicker`/`ColorPicker`/`KimAppCardPreview`.
- JSX: `.kim-jeff-top-panel`(pricing), `.kim-app-quote-builder`, manual-compare, 견적함 목록.
- API: `createQuote`/`updateQuote`/`deleteQuote`/`uploadQuoteOriginal`. 콜백 `onQuotesPersisted`(저장 후 부모 detail refresh), `reloadAppRequests`(승격 후 — 부모 중계).

**⚠️ 얽힘 3종 (spec 난점)**: ①`persistedQuoteIdRef`(신규 INSERT→UPDATE 추적, key 리마운트 회피) ②`quoteRequestPrefill`↔`editPrefill`↔`workbenchVehicle` 동기화(승격 vs 수정 부작용 체인 trim→color→pricing) ③신규/수정 prefill effect. 이 셋은 한 훅(`useQuoteWorkbench`) 안에 응집시켜 경계 밖으로 새지 않게.

### 하위 task 순서

- [ ] **9a — 견적함 목록 + 액션/미리보기 추출**: `quotes` 목록 렌더, 견적 행 액션 메뉴(`openQuoteActionId`/`quoteActionFrame`/`renderQuoteActionMenu`), status tooltip(`hovered`/`pinned`), confirm 5종, 미리보기(`previewQuoteId`/`previewSentQuoteId`/`previewQuoteUrl` + effect), 드롭(`quoteDropTargetId`), `expandedQuoteId`, `quoteBodyRef`/`prevQuoteLenRef`. → `useQuoteList`. **워크벤치 오픈 트리거는 콜백으로 분리**(아직 워크벤치는 부모/다음 하위). overlay: 미리보기 모달 `overlayOpen` 반환.
- [ ] **9b — 워크벤치 셸 + 차량/옵션/색상 + prefill 추출**: `isQuoteSolutionWorkbenchOpen`, `solutionWorkbench*`, `workbenchVehicle`/`trimDetail`/`selectedWorkbenchOptionIds`/`exteriorColor`/`interiorColor`, `editPrefill`/`quoteRequestPrefill`/`sourceQuoteRequestId`/`quoteRequestPrefillRef`, prefill effect 2종 + `?quoteRequest=` URL effect + 워크벤치 ESC/포인터 effect. → `useQuoteWorkbench`. **여기서 `openWorkbenchForQuoteRequest`를 소유** → Task 2(니즈)·9a가 부모 통해 받던 콜백을 이 훅이 제공하도록 배선 정리. overlay: 워크벤치 `overlayOpen`.
- [ ] **9c — pricing 추출**: `pricing`/`pricingInputs`/`primaryDiscountUnit`/`discountLines`/`acquisitionTaxMode`/`pricingPanelRef` + `readPricingInputs`/`recomputePricing` + 가격 입력 핸들러. `quote-pricing.ts` 사용. → `useQuotePricing`(워크벤치 훅이 소비하거나 같은 컴포넌트 내).
- [ ] **9d — 수기 비교카드 추출**: `manualQuoteCards`/`manual*Modes`/`manualMileage*`/`manualTermMonths`/`savedManualQuoteConditionIds`/`quoteDetailFormRef`/`cardScenario` + `buildManualCardsFromScenarios`/`saveManualQuoteCondition`/`editManualQuoteCondition`/`extractWorkbenchScenarios` + 시나리오 추출 effect(`[savedManualQuoteConditionIds]`). → `useManualQuoteCards`.
- [ ] **9e — 앱카드 프리뷰 + PDF 원본 + 영속화 통합**: `isQuoteAppCardPreviewOpen`/`guidance`/`appCardModel`(`KimAppCardPreview` 컴포넌트 소비), `recognizedQuoteFile`/`isQuoteWorkbenchOriginalDragActive`/`quoteWorkbenchOriginalInputRef` + PDF 인식 effect, `persistWorkbenchQuote`/`isQuoteDraftSaved`/`isQuoteDraftDirty` + `onQuotesPersisted`/`reloadAppRequests` 배선. 최종 부모에서 워크벤치 JSX 제거하고 `<QuoteWorkbench {...}/>`로 완전 대체.

각 9x: 공통 절차 A~G(브랜치/추출/리네임 영역분/검증). 컴포넌트는 `customer-detail/quote/`(`QuoteList.tsx`/`QuoteWorkbench.tsx`/`QuotePricingPanel.tsx`/`ManualCompareCards.tsx`) 하위 디렉터리 권장.

**검증 포인트(9 전체, 마지막 9e 후 종합)**: 김민준으로 — 견적함 목록·`+`워크벤치 오픈·차량(VehiclePicker catalog)·옵션·색상·할인·작성완료(INSERT→재작성완료 UPDATE 중복없음)·수정 진입 prefill(prefetch/스켈레톤)·다중 시나리오 저장·대표 전환·앱카드 프리뷰(실데이터)·원본 업로드/미리보기/삭제·발송(`sent_at`)·계약 토글. 김지안=니즈 카드 "견적 작성"→워크벤치 prefill→승격 배지. `?quoteRequest=` 딥링크 진입. ⚠️회귀 위험 최고 — 하위 task마다 끊어 검증.

**리네임**: `quote*`/`workbench*`/`manual*`/`pricing*`/`renderQuote*` 영역분 `kim`→범용.

---

## 마무리 (Task 9 완료 후)

- [ ] **부모 슬림화 확인**: `KimMinjunDetailContent` → `CustomerDetailContent` 리네임. 남은 건 orchestrator(영역 훅 조립 + cross-cutting + JSX 그리드 컨테이너)인지 확인(수백 줄 목표).
- [ ] **잔여 kim 식별자 정리**: grep `Kim`/`kim`로 컴포넌트 내 잔여 확인. CSS 클래스 문자열(`.kim-*`)은 의도적 보존(별 트랙). 함수/타입/변수만.
- [ ] **brief/active-session-brief 갱신**: 분해 완료 기록.
- [ ] **(선택) lib `kim-*.ts` 파일명 리네임**: 별 PR.

---

## Self-Review (작성자 점검 결과)

- **Spec coverage**: spec §3(아키텍처 A) → Task 0 스캐폴드+전 영역 훅/컴포넌트. §4(3계층) → 계층1=영역 훅, 계층2=Task0 cross-cutting 부모 보유, 계층3=Task9 견적 훅 소유+콜백. §5(난점 5개) → A=Task2/9b 콜백, B=9c/9d 내부, C=각 Task onToast+9e reloadAppRequests, D=Task0 openEditor, E=Task6/9a/9b overlayOpen 반환. §6(구조) → `customer-detail/` 디렉터리. §7(순서/granularity) → Task 1~9 순서, 영역=1브랜치. §8(검증) → 공통 G + 각 Task 검증 포인트. ✅ 누락 없음.
- **Placeholder scan**: 코드 복붙 대신 "이동 인벤토리+grep 재확인"을 쓴 것은 거대 동작보존 리팩토링에서 의도적(소스가 이미 존재, plan에 4686줄 복붙 무의미). 각 Task에 옮길 식별자·훅 시그니처·검증 포인트는 구체적으로 명시. "적절히 처리" 류 모호 지시 없음.
- **Type consistency**: 훅 명명 일관 — `useCustomerNeeds`/`useCustomerMemos`/`useCustomerChecks`/`useCustomerSchedules`/`useCustomerDocuments`/`useCustomerWorkflow`/`useCustomerPurchase`/`useQuoteList`/`useQuoteWorkbench`/`useQuotePricing`/`useManualQuoteCards`. cross-cutting 헬퍼 `markRecentUpdate`/`requestOpenEditor`/`OpenEditorState` 전 Task 동일 사용. overlay 규약 `overlayOpen` 반환 통일(Task6/9a/9b).
