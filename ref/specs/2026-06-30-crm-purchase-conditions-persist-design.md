# 상세 구매조건 7필드 영속 — 설계

Date: 2026-06-30
Branch: `feat/crm-purchase-conditions-persist`
Status: 설계 확정 (구현 전)

## 배경 / 문제

고객 상세 "상세 구매조건" 영역(`useCustomerPurchase` + `PurchaseConditions`)은 9개 필드를 편집한다.
현재 **구매방식(`needMethod`)·출고 희망 시기(`needTiming`) 2개만 `savePatch`로 DB 영속**되고,
나머지 7개 — 계약기간·초기비용·연간 주행거리·인도 방식·계약 포커스·고객 특이사항·심사 특이사항 —
은 `crm.customers`에 대응 컬럼이 없어 **UI 상태(`purchaseFields`)로만 편집**되고 새로고침 시 원복된다.

현 `crm.customers` 니즈 컬럼: `needModel/needTrim/needMethod/needTiming/needColors/needCompare/needMemo`.

## 데이터 모델 결정

### 핵심 판단: 고객 단위 니즈 (견적 단위 아님)

이 영역은 "발행한 견적 1건의 금융 조건"이 아니라, 상담사가 견적 작성 **전에** 기록하는
**이 고객의 희망/선호/특이사항(=니즈)** 이다. 견적이 0건인 신규 고객도 존재하고, 견적별로
달라지지 않는 고객당 단일 선호 세트다. 이미 `customers`에 있는 `needMethod`/`needTiming`과
같은 차원이다.

`quote_scenarios`에 `termMonths`/`depositMode`/`mileageMode` 등 동차원 컬럼이 이미 있지만,
그것은 "발행한 견적의 조건"이지 "고객의 희망"이 아니다 → **견적 도메인(③)은 의미가 어긋나 제외.**

### 모델: `crm.customers`에 7개 nullable text 컬럼 추가 (①)

`jsonb 묶음(②)` 대비: 기존 니즈가 전부 평면 text 컬럼이라 일관성이 높고, 현재 UI 값이 이미
문자열로 직렬화돼 있어 1:1 매핑·최소 변경이다. `savePatch`(PATCH /api/customers/:id) 인프라를
`needMethod`처럼 그대로 재사용한다.

### 무결성: 단일선택 닫힌집합 3개만 DB CHECK

이 저장소는 #107~#112에서 enum 도메인을 정리해 **pg enum type 대신 "DB CHECK 제약 + `client/src/data` 코드 상수 SSOT"** 로 통일했다(`schema.ts`의 `inListCheck`).

| 필드 | 컬럼 | 저장 형식 | CHECK |
|---|---|---|---|
| 계약기간 | `need_contract_term` | 단일 (`"36개월"`) | ✅ |
| 연간 주행거리 | `need_annual_mileage` | 단일 (`"20,000km"`) | ✅ |
| 인도 방식 | `need_delivery_method` | 단일 (`"탁송 요청"`) | ✅ |
| 초기비용 | `need_initial_cost` | 자유 숫자 조합 (`"보증금 30%"`) | ❌ |
| 계약 포커스 | `need_contract_focus` | 다중 `#` (`"#월 납입 최소 #총 비용 최소"`) | ❌ |
| 고객 특이사항 | `need_customer_note` | 다중 `#` | ❌ |
| 심사 특이사항 | `need_review_note` | 다중 `#` | ❌ |

- 다중선택(`·`/`#` 직렬화)·자유숫자 4개는 단일 컬럼 CHECK가 불가능(조합 폭발). 선례로 `needMethod`
  (다중 직렬화)도 CHECK 없이 text다. 정규화(`text[]`/자식 테이블)는 현재 문자열 UI 로직 전면
  개편이라 범위 밖.
- CHECK 집합 = `[...옵션 상수, "확인 필요"]`. (선택 해제 시 핸들러가 `"확인 필요"` sentinel을
  값으로 넣으므로 반드시 포함.) `IS NULL OR IN (...)` 형태라 빈 신규 고객(null)도 허용.

### UI 변경: 계약기간 다중→단일선택

계약기간은 같은 상품 내 기간이라 보통 하나로 좁혀진다(여러 기간 비교는 `quote_scenarios`에서).
구매방식이 다중인 건 상품 종류(렌트/리스/할부)가 달라서지만 계약기간은 다르다. 현재 다중선택은
김민준 시범 mock의 잔재로, 기획 근거가 없다.

→ `togglePurchaseTerm`(Set/`·`join) → `selectPurchaseTerm`(연간 주행거리 `selectPurchaseAnnualMileage`와
동일 단일 토글) 패턴으로 교체. `renderPurchaseTermEditor`의 `aria-pressed`도 `selectedTerms.has`
→ `currentValue === option`으로 변경.

## 변경 범위

### DB / 스키마

1. `client/src/data/customers.ts` — 상수 SSOT 3개 추가 (기존 `SOURCE_OPTIONS` 패턴):
   - `CONTRACT_TERM_OPTIONS = ["12개월","24개월","36개월","48개월","60개월"]`
   - `ANNUAL_MILEAGE_OPTIONS = ["10,000km","15,000km",...,"40,000km","무제한"]`
   - `DELIVERY_METHOD_OPTIONS = ["탁송 요청","매장 출고","직접 수령","협의 필요"]`
2. `src/db/schema.ts` `customers` — 7컬럼(전부 `text(...)` nullable) + 3 CHECK
   (`inListCheck(t.needContractTerm, [...CONTRACT_TERM_OPTIONS, "확인 필요"])` 등).
3. 마이그레이션 `drizzle/0009` — `db:generate` → `db:migrate`, `schemaFilter:["crm"]`,
   additive nullable + 3 CHECK. master 적용. **`db:push` 금지.**

### 백엔드

4. `src/db/queries/customers.ts` `CustomerWritePatch`(Pick) — 7컬럼 추가.
   (`getCustomer`는 `select()` 전체 컬럼이라 응답에 자동 포함, SELECT 수정 불필요.)
5. `src/routes/customers.ts` `customerWriteSchema` — 7필드 `z.string().nullable().optional()` 추가.
   (단일선택 3개도 `z.string`: sentinel `"확인 필요"` 통과 + 무결성은 DB CHECK가 담당. 기존
   `chance`/`source`가 DB CHECK인데 zod는 `z.string`인 것과 동일 패턴.)

### 프론트

6. `client/src/lib/customers.ts` — `CustomerDetailResponse`·`CustomerDetailData`(Pick)·
   `toCustomerDetail` 매핑·`CustomerWritePatch` 4곳에 7필드(camelCase) 추가.
7. `client/src/components/customer-detail/purchase-meta.ts` — `kimContractTermOptions`·
   `kimAnnualMileageOptions`·`kimDeliveryMethodOptions`를 `data/customers.ts` SSOT에서 import 후
   기존 이름으로 re-export(소비처 호환). (`SOURCE_*`를 `kim-status-fields`가 re-export한 선례 동일.)
8. `client/src/components/customer-detail/hooks/useCustomerPurchase.ts`:
   - `purchaseFields` 초기화를 현재 2필드(needMethod/needTiming) → **9필드 전부** `detail.need*`에서
     매핑. label→detail키 매핑이 필요하므로 공유 맵(예: `purchase-meta`의 `PURCHASE_FIELD_KEY:
     Record<label, keyof CustomerWritePatch>`)을 두고 초기화·savePatch 양쪽에서 공유.
   - 7개 핸들러에 `togglePurchaseMethod` 패턴(optimistic + `savePatch({ need*: nextValue }, rollback)`)
     적용. rollback용 `prevPurchaseFields` 스냅샷이 없는 핸들러는 추가:
     `togglePurchaseTerm`→`selectPurchaseTerm`(단일·`needContractTerm`)·`applyPurchaseInitialCost`
     (`needInitialCost`)·`selectPurchaseAnnualMileage`(`needAnnualMileage`)·`selectPurchaseDeliveryMethod`
     (`needDeliveryMethod`)·`togglePurchaseCostFocus`(`needContractFocus`)·`togglePurchaseCustomerNote`
     (`needCustomerNote`)·`togglePurchaseReviewNote`(`needReviewNote`).
   - 인라인 폼 `savePurchaseConditions`(텍스트 일괄 폴백)도 7필드를 patch에 포함(+rollback).
9. `client/src/components/customer-detail/PurchaseConditions.tsx`:
   - `renderPurchaseTermEditor` 다중(Set)→단일(`currentValue === option`), `selectPurchaseTerm` 호출.
   - handlers 구조분해에서 `togglePurchaseTerm`→`selectPurchaseTerm` 이름 반영.

## 워크벤치 영향 분석 (무영향)

`useQuoteWorkbench`는 `purchaseFields`에서 `primaryKimQuotePurchaseMethod(purchaseFields)` =
**구매방식만** 읽는다(라인 131·862·921). 계약기간 등 다른 필드는 소비하지 않으므로, 계약기간
단일화·7필드 영속화는 워크벤치 prefill에 **무영향**. `purchase.fields` 배열 구조(`{label,value}[]`)도
그대로 유지된다.

## 범위 밖 (명시)

- 견적 작성 시 이 니즈를 워크벤치로 prefill하는 연결(고객 희망→견적 시나리오)은 별개 후속 기능.
- `quote_scenarios.termMonths` 등과의 동기화 없음 (고객 희망 ≠ 발행 견적).
- 다중선택 4개의 정규화(`text[]`/자식 테이블)·서버 zod 토큰 검증은 범위 밖(현행 닫힌 버튼 UI가
  유효값만 생성하고, DB CHECK가 안 닿는 영역).

## 검증 계획

- `bun run typecheck` 0 / `bun run lint` 0 / `bun run test:unit` / `bun run test:server` / `bun run build`.
- 마이그레이션: `db:generate`로 0009 생성 → 내용 리뷰(7 ADD COLUMN + 3 CHECK, crm only) → `db:migrate` master 적용 → 사전 밖 값 UPDATE 거부 1회 실측(psql).
- 브라우저(편집→새로고침 유지): 7필드 각각 값 변경 → 새로고침 → 유지 확인. 계약기간이 단일선택으로
  동작(이전 선택 해제 후 신규 선택)하는지. `"확인 필요"`(선택 해제) 저장·복원. 구매방식/출고시기 회귀 0.

## 마이그레이션 안전성

- additive nullable text 7컬럼 + 3 CHECK(`IS NULL OR IN`)이라 기존 행(전부 null)은 위반 없음.
- 배포 순서: 코드(zod 7필드 허용·프론트 매핑)가 먼저 배포돼도 DB 컬럼 없으면 PATCH가 실패하므로,
  **DB 마이그를 먼저 적용**(컬럼/CHECK 추가는 기존 경로 무해)한 뒤 코드 배포. (#112의 순서 함정 반대 케이스 — 여기선 DB 먼저가 안전.)
