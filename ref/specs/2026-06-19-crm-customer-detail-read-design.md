# CRM 고객 상세 읽기 연결 설계

작성일: 2026-06-19
상태: design (승인됨 2026-06-19). 다음 = writing-plans → 구현.
연계: `2026-06-19-crm-customers-read-design.md`(목록/상세 읽기 1차, 완료 #46). 본 스펙은 그 "상세 drawer를 실데이터로" 미결을 잇는 후속 서브프로젝트.

## 목표

`CustomerDetailPage`의 김민준(`CU-2605-0020`) 시범 상세 화면을 **컴포넌트 내부 하드코딩 const**가 아니라 `GET /api/customers/:id`(=`getCustomer`)가 주는 **실제 DB 데이터**로 표시한다. 백엔드 읽기 경로는 #46에서 이미 준비됨 — 이번 작업은 **프론트 연결 + 김민준 시드 확장**이 핵심이다.

## 범위 (B안 = 깔끔한 경계만)

`getCustomer`는 고객 본체 + 자식(`tasks/schedules/memos/documents/consultations`)을 준다. 견적함·상세구매조건 대부분은 견적(quotes) 도메인이라 이번 읽기로는 못 채운다. 그래서 **customer 본체 + 자식테이블에 깔끔히 매핑되는 섹션만** DB로 연결한다.

**포함 (DB 연결)**:
- 헤더: 고객명/고객번호/접수시각
- 상태필드: 연락처/직군/거주지/상담경로/배정시간 (담당자는 "미배정" 유지)
- 니즈: model/trim/colors/method/memo
- 상세구매조건: 니즈와 겹치는 **구매방식·출고시기만**
- 고객 메모(`memos[]`) · 할일(`tasks[]`) · 일정(`schedules[]`) · 서류함(`documents[]`)
- 워크플로우 상태(stage/status/chance)는 이미 `customer` prop 연결됨 — 유지

**제외 (하드코딩 유지 → 다음 서브프로젝트)**:
- 견적함(`kimMinjunQuoteHistory` 3건) + pricing → `crm.quotes`(견적 서브프로젝트)
- 상세구매조건의 견적성 필드(계약기간/초기비용/연간주행거리/인도방식/계약포커스/고객특이사항/심사특이사항) — 고객 컬럼 없음(견적 시나리오 레벨)
- `vehicleDetailByName`(모델별 상세) — 카탈로그 파생, 보류
- 타임라인(`timelineRows`)·우측 사이드(`detailRows/vehicleRows`) — 이미 `customer` 파생, 유지. consultations 연결은 보류
- 레이아웃 일반화(김민준 외 고객도 리치 레이아웃) — `customerId === "CU-2605-0020"` 분기 유지

## 현재 구조 (조사 결과)

- `CustomerDetailPage.tsx`(5919줄)는 `customer.customerId === "CU-2605-0020"`일 때만 별도 컴포넌트 `KimMinjunDetailContent`(1390~3830줄)를 렌더. 다른 고객은 일반 `customer-detail-layout`.
- 김민준 컴포넌트의 실무 데이터는 거의 전부 **컴포넌트 내부 하드코딩 const를 초기값으로 쓰는 `useState`**:
  - 헤더 텍스트(고객명/번호/접수): inline JSX(558~560)
  - `kimMinjunInitialStatusValues`(328~335) — 상태필드
  - `kimInitialNeeds`(388~394) — 니즈
  - `kimMinjunPurchaseFields`(307~317) — 상세구매조건
  - `kimInitialCustomerMemos`(524~528) — 고객 메모
  - `kimMinjunCheckItems`(517~522) — 할일
  - `kimInitialSchedules`(530~532) — 일정
  - `kimMinjunDocumentVault`(467~484) — 서류함
- `customer` prop은 워크플로우 상태/타임라인/우측 사이드에만 쓰임. 김민준 컴포넌트는 자식 식별용 **uuid를 안 받음**(`Customer` 타입에 `id` 없음).

## 아키텍처 (3계층, catalog/#46 패턴 유지)

### 1. 백엔드 — 변경 없음
`getCustomer(id)` + `GET /api/customers/:id`는 #46에서 완성. 추가 쿼리/라우트 불필요.

### 2. 데이터 타입 `client/src/data/customers.ts`
- `Customer`에 `id?: string`(uuid) 추가 — 상세 fetch 키. 목록 행이 uuid를 운반.

### 3. 프론트 lib `client/src/lib/customers.ts`
- `CustomerRow`에 `residence·needTrim·needColors·needTiming·needMemo` 추가(`customerType/customerTypeDetail`는 이미 있음). (`needCompare`는 in-scope 읽는 섹션이 없어 제외.)
- `toCustomer`가 `row.id`를 `Customer.id`에 채움.
- `CustomerDetailData` 타입: 고객 본체 필드(헤더/상태/니즈/구매방식·출고시기) + `memos/tasks/schedules/documents` 배열. 배열은 **DB 충실 camelCase**(예: `{ id, body, createdAt }`, `{ id, category, due, body, done }`, `{ id, scheduledDate, scheduledTime, type, memo }`, `{ id, title, docType, fileName, fileSize, fileMime }`). UI 타입(`KimCheckItem` 등) 변환은 페이지가 담당 — lib는 UI 타입 미참조.
- `fetchCustomerDetail(id): Promise<CustomerDetailData>` — `GET /api/customers/:id` → 매핑. `apiFetch`(GET 5xx 재시도) 사용. **기존 `fetchCustomer`(느슨한 타입, 현재 미사용)는 이 타입드 버전으로 교체**(사용처 없으니 제거).

### 4. 페이지 `client/src/pages/CustomerDetailPage.tsx`
- `customer.id`로 상세를 **자체 fetch**(useEffect + 로딩/에러 상태). 페이지는 단일 고객이므로 GET 1회.
- 로드 전 가벼운 스켈레톤(로딩 UX 결정: (a) 스켈레톤 후 마운트). 로드되면 `<KimMinjunDetailContent detail={detail} key={customer.id} … />` — `key`로 고객 전환 시 상태 리셋, 마운트 시점에 `detail` 존재 → `useState` 초기값이 실데이터.
- `KimMinjunDetailContent`에 `detail: CustomerDetailData` prop 추가. **in-scope `useState` 초기값을 const → `detail` 파생으로 교체**:
  - 헤더 고객명/번호/접수 → `detail.name/customerCode/receivedAt`(`formatActivity`)
  - 상태필드 → `phone/customerType·Detail 조합/residence/source/assignedAt`(null→"미배정"), 담당자 "미배정" 고정
  - 니즈 → `detail.needModel/needTrim/needColors/needMethod/needMemo`
  - 상세구매조건 구매방식 ← `needMethod`, 출고희망시기 ← `needTiming`(나머지 행은 const 유지)
  - 고객 메모 ← `detail.memos`(→ `KimCustomerMemoItem`), 할일 ← `detail.tasks`(→ `KimCheckItem`), 일정 ← `detail.schedules`(→ `KimScheduleItem`), 서류 ← `detail.documents`(→ `KimDocumentItem`)
- out-of-scope const(견적함/pricing/vehicleDetailByName/견적성 구매조건)는 그대로.

## 시드 확장 `scripts/seed-customers.ts` (김민준 전용·멱등)

현행 시드는 `onConflictDoNothing + continue`라 **재실행 시 기존 고객은 자식 삽입까지 건너뜀**. 김민준 풀세트는 루프 뒤 **전용 블록**으로 처리:

1. `customerCode = "CU-2605-0020"`로 김민준 행 조회(id 확보).
2. `customers` 컬럼 명시적 update: `needTrim·needColors·needTiming·needMemo·residence`.
3. 자식 **delete-then-insert**(멱등): `customer_tasks/schedules/memos/documents`에서 김민준 행 삭제 후 풀세트 삽입.
   - tasks 4건(`kimMinjunCheckItems`: category/due/body, done=false) — 첫 시드 때 루프가 넣은 generic nextAction task도 이 delete로 정리됨.
   - memos 3건(`kimInitialCustomerMemos`: body + createdAt 타임스탬프). createdAt "오늘 HH:mm"는 기존 `toTimestamp`(기준일 2026-05-14)로 변환.
   - schedules 1건(`kimInitialSchedules`: scheduledDate/scheduledTime/type/memo).
   - documents 2건(`kimMinjunDocumentVault`: title/docType/fileName/fileSize/fileMime; filePath/sortOrder는 null/순번).
4. 다른 19명은 현행 generic 시드 유지(변경 없음).

**부수효과(허용)**: 김민준 **목록** "상담 메모"는 latest 미완료 task 기반이라, generic nextAction → 체크아이템으로 바뀜. (구매조건 데모상 무해.)

## 매핑 표

| 섹션(김민준 const) | DB 소스 | 비고 |
|---|---|---|
| 헤더 고객명 (inline) | `customers.name` | |
| 헤더 고객번호 (inline) | `customers.customer_code` | |
| 헤더 접수시각 (inline) | `customers.received_at` | `formatActivity` |
| 상태 연락처 (`…StatusValues.phone`) | `customers.phone` | |
| 상태 직군 (.job) | `customer_type` + " · " + `customer_type_detail` | |
| 상태 거주지 (.location) | `customers.residence` | 시드 확장 |
| 상태 상담경로 (.source) | `customers.source` | |
| 상태 배정시간 (.assignedAt) | `customers.assigned_at` | null→"미배정" |
| 상태 담당자 (.advisor) | — | "미배정" 유지(보류) |
| 니즈 model/trim/colors/method/memo (`kimInitialNeeds`) | `need_model/need_trim/need_colors/need_method/need_memo` | trim/colors 시드 확장 |
| 구매조건 구매방식 (`…PurchaseFields`) | `need_method` | |
| 구매조건 출고시기 | `need_timing` | 시드 확장 |
| 구매조건 그 외(계약기간 등) | — | 견적성, 하드코딩 유지 |
| 고객 메모 (`kimInitialCustomerMemos`) | `customer_memos[]` | 시드 확장 |
| 할일 (`kimMinjunCheckItems`) | `customer_tasks[]` | 시드 확장 |
| 일정 (`kimInitialSchedules`) | `customer_schedules[]` | 시드 확장 |
| 서류함 (`kimMinjunDocumentVault`) | `customer_documents[]` | 시드 확장 |
| 견적함 (`kimMinjunQuoteHistory`) | — | `crm.quotes`, 범위 외 |

## 검증

- `typecheck 0 · lint 0 · build` 통과. `test:unit`(현행 99 유지 — 상세 페이지는 단위테스트 없음, 수동/스크린샷).
- `bun run seed:customers` 재실행 멱등 확인(중복 자식 없음).
- 시드 후: 목록 20명 표시 + 김민준 drawer가 시드된 메모3/할일4/일정1/서류2/니즈상세로 표시.
- Playwright 김민준 drawer 스크린샷으로 기존 목업 대비 시각 패리티 확인.
- `test:server`(현행 customers 라우트 테스트 28, `--env-file=.env.local`) 유지.

## 미결 (다음 서브프로젝트)

- 고객 상세 **쓰기**(상태/니즈/메모/할일/일정 PATCH) — 현재는 프론트 상태만.
- advisor 배정 + profiles 연동(담당자 실명).
- 견적(quotes) 읽기/쓰기 → 견적함·pricing·상세구매조건 견적성 필드.
- 상담 타임라인을 consultations로, 우측 사이드 일반화, 레이아웃 일반화(김민준 외 고객).
