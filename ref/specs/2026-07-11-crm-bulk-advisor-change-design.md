# 일괄 담당자 변경 설계 (2026-07-11)

## 배경

고객 목록 헤드바 액션 3개 중 마지막 목업. `[🔄 담당자 변경]` 버튼은 `disabled={selected.length===0}`만
있고 `onClick`이 없다(`CustomerManagementPage.tsx:910`). 삭제(#212)·등록(#215)은 실동작 완료.
개별 담당자 배정은 고객 상세 팝오버(#177)로 이미 동작하므로, 이 슬라이스는 **여러 고객을 한 번에**
같은 담당자로 바꾸는 관리 동작만 다룬다.

## 확정 결정 (유슨생, 2026-07-11)

1. **A안 — 클라 오케스트레이션, 서버 변경 0**: 선택 고객마다 기존 `PATCH /api/customers/:id`를
   순차 호출(`customer-bulk-delete.ts` 미러). 건별 독립 — 한 건 실패가 나머지를 되돌리지 않는다
   (일괄 삭제와 같은 결정 축). 서버 일괄 라우트 신설은 기각(원자성·묶음 알림 요구 없음).
2. **배정 알림은 N개 수용**: 개별 PATCH 의미론 그대로 — 대상 상담사에게 고객당 1개 푸시.
   근거: 현재 실수신 디바이스가 사실상 없음(실기기 e2e 미완·웹 토큰은 이사님 브라우저).
   실사용에서 시끄러우면 그때 묶음 알림(서버 일괄 라우트 동반)을 도입 — follow-up 기록.
3. **버튼 노출 = 관리자/팀장만**: `담당` 컬럼 노출 기준(`shouldShowAdvisorColumn` — 최고관리자·팀장)과
   정합. 상담사/딜러 화면엔 담당 개념 자체가 숨겨져 있다. 서버는 개별 PATCH를 그대로 타므로
   **추가 게이트 없음** — 개별 배정과 동일 권한 의미(숨김은 UX 보조).
4. **완료 후 서버 리로드**: 로컬 낙관 패치 대신 `reloadCustomers`(App) 재사용 —
   `assignedAt` 등 서버 스탬프가 진실. 성공 ≥1건이면 리로드 + 선택 해제.

## 서버가 이미 갖고 있는 것 (변경 0의 근거)

`PATCH /api/customers/:id`의 배정 규칙(#176·#193)이 일괄에서도 건별로 그대로 성립한다:

- **실변경 시만 `assignedAt` 스탬프** — 같은 담당자 재배정은 스탬프·알림 모두 no-op(서버가 이름 비교).
- **advisorId 동봉 규칙** — 이름만 오면 id를 비우는 방어선. 클라는 항상 `{advisorName, advisorId}` 동봉.
- **배정 알림** — `advisorId ≠ 배정 실행자`일 때만 발송(자기 배정 skip). 일괄도 건별 발송(결정 2).
- `team`은 보내지 않는다(팀 개념 없음 확정 — 개별 편집기의 팀 select는 표시 잔존일 뿐).

## 클라이언트

### 1. 오케스트레이션 lib — `client/src/lib/customer-bulk-advisor.ts` (신규, TDD)

`customer-bulk-delete.ts` 미러(순수·주입형):

```
changeAdvisorBulk(
  targets: readonly { id?: string; name: string }[],
  advisor: { id: string; name: string },
  updateOne = (id, patch) => updateCustomer(id, patch),
): Promise<{ changedIds: string[]; failed: { name: string; reason: string }[] }>
```

- 건별 `updateOne(id, { advisorName: advisor.name, advisorId: advisor.id })` 순차 호출.
- `id` 없는 목업/미저장 행은 호출 자체를 스킵하고 failed에 사유 기록(삭제와 동일).
- 실패는 서버 한글 사유(`httpError`의 `body.error`)를 그대로 수집.

### 2. 대상 이름 미리보기 공유

`customer-bulk-delete.ts`의 `formatDeleteTargetNames`를 **`formatBulkTargetNames`로 리네임**해
삭제·배정 확인창이 공유한다(파일 잔류 — 규칙이 동일: 선택은 페이지·필터를 넘어 유지되므로
"누구를" 조작하는지 확인창에 보여야 한다).

### 3. 폼 팝오버 — `CustomerManagementPage.tsx`

등록/삭제와 같은 팝오버 문법(`advisor-change-wrap`/`advisor-change-confirm`, CSS는 bulk-delete 블록 미러):

- 노출: `showAdvisorColumn`(관리자/팀장)일 때만 버튼 렌더(결정 3).
- 내용: `고객 N명 담당자 변경` + 대상 이름(`formatBulkTargetNames`) + 담당자 select + 취소/변경.
- 담당자 select: `useStaffDirectory()` 후보(전 직원 — `liveReceiving`은 채팅 배정용이라 무시,
  개별 배정 편집기와 동일), **controlled + `bindSelect`**(Safari 규칙), 디렉토리 미로드 시
  select·변경 버튼 disabled(개별 편집기와 동일).
- 적용 중(`changing`) 토글·취소·변경 버튼 전부 disabled(등록 폼의 제출 잠금 관례).
- 닫기 경로(성공·취소·토글-닫기) 공통 리셋(등록 폼 `resetCreateForm` 관례).

### 4. 완료 흐름

- `changeAdvisorBulk` 완료 → 성공 ≥1건이면 `onCustomerListChanged?.()`(App `reloadCustomers` 배선,
  AppRequestsPage 선례) + `setSelected([])` + 팝오버 닫기.
- 실패 있으면 notice(`N명 변경 실패 — 이름: 사유 …`, 삭제의 `bulk-delete-notice` 문법 —
  자동으로 사라지지 않음). 전건 실패면 리로드 생략.
- `updateCustomer`가 건별로 `invalidateCustomerDetail`을 이미 호출 — 상세 캐시 정합 공짜.

## 에러 처리

- 건별 실패(네트워크·404 등)는 이름+사유 목록으로 표면화, 나머지 건은 계속 진행.
- 서버 코드 변경이 없으므로 새 에러 표면 없음 — PATCH의 기존 400/404 계약 그대로.

## 테스트 · 검증

- **lib 유닛(TDD, vitest)**: 전건 성공 / 일부 실패(사유 수집·순서 유지) / `id` 없는 행 스킵 /
  updateOne에 전달되는 페이로드가 정확히 `{advisorName, advisorId}` 두 필드인지(“team 미포함” 잠금).
- **리네임 회귀**: 삭제 확인창의 기존 동작은 기존 유닛(`customer-bulk-delete.test.ts`)이 잠근다 —
  리네임만 반영.
- **서버 테스트 신규 없음**(서버 변경 0 — PATCH 배정 규칙은 기존 테스트가 잠금).
- 검증 세트: typecheck 0 · lint 0 · test:unit · test:server · build + **격리 스택 브라우저 스모크**
  (API는 `PUSH_NOTIFY=off`로 띄운다 — 배정 알림은 CRM 앱 코드 경로(push-notify.ts)라 이 게이트가 막는다.
  고객 2명 선택 → 담당자 변경 → 목록 담당 셀 갱신 확인 → psql `advisor_id`/`advisor_name`/`assigned_at`
  대조 → **원복**). 스모크 대상은 실고객이라 원복 필수인데, **원복 재배정도 "실변경"이라
  `assigned_at`이 새로 찍힌다** → 스모크 전에 대상 고객의 `advisor_id`/`advisor_name`/`assigned_at`
  원값을 기록해두고, UI 재배정 대신 **psql로 세 컬럼 원값 복원**(선례: #202 검증 배정 원복).

## 범위 밖

- 일괄 미배정(해제) — 개별 팝오버에도 없는 동작.
- 묶음 알림·서버 일괄 라우트 — 실사용에서 알림 과다가 확인되면 도입(follow-up).
- 담당자 필터·개별 배정 팝오버(기존 동작 불변).
- 팀 필드(미전송 — 팀 개념 없음 확정).
