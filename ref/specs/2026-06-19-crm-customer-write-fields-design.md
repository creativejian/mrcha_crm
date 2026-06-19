# CRM 고객 본체 필드 쓰기 (고객 쓰기 #1) 설계

작성일: 2026-06-19
상태: design (승인됨 2026-06-19). 다음 = writing-plans → 구현.
연계: 읽기 `2026-06-19-crm-customer-detail-read-design.md`(#51), 딥링크 `2026-06-19-crm-customer-detail-deeplink-design.md`(#53). "고객 쓰기"의 첫 서브프로젝트.

## 목표

고객 상세(드로어/페이지)와 목록의 인라인 수정을 **`crm.customers` 컬럼에 한해 DB에 저장**한다. 현재는 전부 프론트 `useState`로만 바뀌고 새로고침하면 사라진다. 읽기/딥링크 위에 본체 필드 CRUD 루프를 완성한다.

## 범위 (고객 본체 컬럼 전체)

**포함 — `PATCH /api/customers/:id`로 저장하는 컬럼**:
- 상태필드: `phone` · `residence` · `customerType` · `customerTypeDetail` · `source`
- 워크플로우: `statusGroup`(진행상태 1차) · `status`(2차) · `chance`(계약가능성)
- 니즈: `needModel` · `needTrim` · `needColors` · `needMethod` · `needMemo`
- 구매조건(컬럼 있는 것만): 구매방식→`needMethod`, 출고시기→`needTiming`

**제외(다음 서브프로젝트/제약)**:
- 메모/할일/일정 CRUD(#2), 서류 파일(#3), 견적(#4), advisor 배정·배정시간(#5, profiles).
- 관리상태(manage): 컬럼 없음(계산/프론트 파생) — 영속화 안 함.
- 비컬럼 구매조건(계약기간/초기비용/연간주행거리/인도방식/계약포커스/고객특이사항/심사특이사항): 고객 컬럼 없음(견적 시나리오 도메인). **편집은 되지만 저장 안 됨 → 새로고침 원복**(읽기 때 하드코딩이던 한계 유지, 견적 사이클에서 해소). 이번엔 그대로 둠.
- enum/lookup 제약: 값은 지금 UI-제약 text로 PATCH. DB enum/lookup 검증은 별도 사이클.

## 현재 구조 (조사 결과)

- 모든 편집은 `KimMinjunDetailContent`(및 목록)에서 `useState`만 바꾼다. API 쓰기 0(읽기 `fetchCustomerDetail`만).
- 워크플로우(진행상태/계약가능성)는 상세·목록 둘 다 `onWorkflowChange → App.updateCustomerWorkflow`를 거친다(상태/그룹은 customers 배열, chance는 `chanceOverrides` 맵, manage는 `manageStatusOverrides` 맵으로 갱신).
- 라운드트립 현황: `statusGroup`/`status`는 목록 읽기(`toCustomer`)로, `phone`/`residence`/니즈는 상세 읽기(`fetchCustomerDetail`)로 이미 표시됨. **`chance`만 읽기 경로 없음** — 프론트 `chanceOverrides[no] ?? chanceLabel(파생)`로만 표시.
- 새 항목 임시 id(`kim-*-${Date.now()}`)는 자식 CRUD(#2) 이슈 — 본 서브프로젝트(본체 필드)엔 해당 없음.

## 아키텍처 (3계층, 읽기와 동일)

### 1. 백엔드 query `src/db/queries/customers.ts`
- `updateCustomer(id, patch, executor)` — 쓰기 가능 컬럼 partial `set` + `updatedAt: new Date()`, `.where(eq(id)).returning()`. 결과 없으면 null.

### 2. 라우트 `src/routes/customers.ts`
- `PATCH /:id` — `zValidator("param", z.object({ id: z.uuid() }))` + `zValidator("json", customerWriteSchema)`. `updateCustomer` 호출, 200(갱신행) / 404(없음).
- `customerWriteSchema` (zod, 전부 `.optional()`, 문자열은 `.nullable()`): `phone, residence, customerType, customerTypeDetail, source, statusGroup, status, chance, needModel, needTrim, needColors, needMethod, needTiming, needMemo`. (값 enum 검증 없음 — 추후.)

### 3. 프론트 lib `client/src/lib/customers.ts`
- `updateCustomer(id, patch: CustomerWritePatch): Promise<void>` — `apiFetch("/api/customers/"+id, { method: "PATCH", body: JSON.stringify(patch) })`. **쓰기는 GET 5xx 재시도 대상 아님**(기존 정책). 실패 시 throw.
- `CustomerWritePatch` 타입(위 컬럼 partial).
- **chance 읽기 시드**: `CustomerRow`에 `chance: string | null` 추가, `toCustomer`가 `chance: row.chance ?? undefined`로 전달(`Customer`에 `chance?: string` 추가). 워크플로우는 **목록 customer 기준**(상세 Kim은 `chanceOverride` prop으로 받음)이라 **목록 read(`CustomerRow`)에만** 추가하면 됨 — `CustomerDetailResponse`는 불변.

### 4. 와이어링 (낙관 갱신 + 실패 롤백)

**Kim 상세 핸들러** — 저장 시 기존 setState(낙관) 유지 + `updateCustomer(customer.id, patch)`. 실패 시 이전값으로 setState 롤백 + `onToast("저장에 실패했습니다")`. 반복 축소용 헬퍼:
```
async function savePatch(patch, rollback) {
  try { await updateCustomer(customer.id, patch); }
  catch { rollback(); onToast("저장에 실패했습니다"); }
}
```
- 상태필드 저장: 연락처→`{phone}`, 직군→`{customerType, customerTypeDetail}`(분해), 거주지→`{residence}`, 상담경로→`{source}`.
- 니즈 저장: `{needModel, needTrim, needColors, needMethod, needMemo}`(객체 단위).
- 구매조건: 구매방식→`{needMethod}`, 출고시기→`{needTiming}`. (그 외 필드는 PATCH 없음 — 캐비엇.)

> 참고: `needMethod`는 **니즈.method와 구매조건.구매방식 두 화면**이 같은 컬럼을 쓴다(별도 useState). 한쪽 편집 시 다른 쪽 로컬 state는 즉시 안 바뀌지만 둘 다 같은 컬럼을 PATCH하므로 **새로고침 후 일치**. 기존 UI 구조 그대로 두고, 양쪽 저장 핸들러 모두 `needMethod`를 PATCH하면 됨.

**워크플로우(진행상태/계약가능성)** — Kim·목록 공통 경로라 **App.`updateCustomerWorkflow`에서 한 곳만 PATCH**:
- `customerNo → customers.find(no).id`로 uuid 확보(없으면 PATCH 생략).
- 변경분만 PATCH: `statusGroup`/`status`(있을 때), `chance`(`next.chance` 또는 계약완료 동기화로 `확정`). manage는 PATCH 안 함(컬럼 없음).
- 낙관: 기존 setState 유지. 실패 시 직전 customer/override 스냅샷으로 롤백 + `showToast`.
- chance 읽기 시드: `fetchCustomers` 로드 후 `setChanceOverrides`를 DB chance 있는 행으로 초기화 → chance 라운드트립.

## 매핑 표

| 화면 편집 | DB 컬럼 | 경로 |
|---|---|---|
| 연락처 | `phone` | Kim savePatch |
| 직군(개인·4대보험 등) | `customerType`+`customerTypeDetail` | Kim savePatch(분해) |
| 거주지 | `residence` | Kim savePatch |
| 상담경로 | `source` | Kim savePatch |
| 니즈 model/trim/colors/method/memo | `needModel/needTrim/needColors/needMethod/needMemo` | Kim savePatch |
| 구매방식 | `needMethod` | Kim savePatch |
| 출고 희망 시기 | `needTiming` | Kim savePatch |
| 진행상태 1차/2차 | `statusGroup`/`status` | App.updateCustomerWorkflow PATCH |
| 계약가능성 | `chance` | App.updateCustomerWorkflow PATCH (+읽기 시드) |
| 관리상태 | — | 컬럼 없음, 프론트만 |
| 담당자/배정시간 | (advisorId/assignedAt) | #5 보류 |
| 계약기간/초기비용/주행거리/인도/포커스/특이사항 | — | 컬럼 없음, 프론트만(캐비엇) |

## 검증

- `typecheck 0 · lint 0 · build`. `test:unit`: `customerWriteSchema` 파싱(유효/무효) 단위테스트 + 기존 유지.
- `test:server`: `PATCH /:id` 통합 — 필드 변경 200·반영 확인 후 **원복**(prod 데이터 보존), 잘못된 body 400, 없는 id 404. `--env-file=.env.local`.
- 수동(로그인 세션): 상세에서 연락처/거주지/니즈/구매방식·출고시기 수정 → 새로고침 → 유지. 진행상태/계약가능성 변경(상세·목록 양쪽) → 새로고침 → 유지. 계약완료 시 계약가능성 자동 확정 persist. 저장 실패(네트워크 차단) 시 롤백+토스트.

## 미결 (다음 서브프로젝트)

- #2 자식 CRUD(메모/할일/일정 POST/PATCH/DELETE, 임시 id→서버 uuid 교체).
- #3 서류 파일 업로드(스토리지 결정: Supabase Storage 등).
- #4 견적(quotes 쓰기 — 스키마/상태머신/파일, 큼).
- #5 advisor 배정 + profiles(담당자 실명·배정시간).
- 비컬럼 구매조건·관리상태 영속화(컬럼 추가 또는 견적 도메인 편입), enum/lookup 제약.
