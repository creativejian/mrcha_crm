# 고객 니즈(`need_*`) 스테일 문제 — 관측 기록·설계 착수 노트

작성 2026-07-24 (유슨생 실기 중 두 번 걸림) · 상태: **문제 정의만 · 설계 미착수**
다음 세션 1순위. 이 문서를 읽고 **정책을 정한 뒤** 구현한다.

## 한 줄 요약

**`crm.customers.need_*`는 최초 승격 때 한 번 시드되고 그 뒤 영원히 갱신되지 않는다.** 앱 연결 고객은
CRM에 편집 UI조차 없어서(니즈 카드가 앱 요청 목록으로 대체됨) 상담사가 고칠 방법도 없다.

## 실측 (2026-07-24)

**시드되는 것 — 승격 액션 2개(`createCustomerFromRequest`·`linkRequestToCustomer`)에서만**

| 컬럼 | 시드? |
|---|---|
| `need_model`·`need_trim` | ✅ 요청의 차량(catalog 조인) |
| `need_method` | ✅ 요청의 구매방식 |
| `need_timing` | ✅ 2026-07-24 `#341`부터(출고 희망 시기 절대화) |
| 나머지 10개(`need_colors`·`need_compare`·`need_memo`·`need_contract_term`·`need_initial_cost`·`need_annual_mileage`·`need_delivery_method`·`need_contract_focus`·`need_customer_note`·`need_review_note`) | ❌ 전부 수동 |

**갱신 경로가 없다**
- 승격 후에는 요청이 아무리 와도 자동 갱신 없음. **제임스는 요청 95건인데 니즈는 첫 요청 그대로.**
- ⚠️ **이미 연결된 고객은 승격 액션 자체를 안 탄다** — `app_user_id`가 붙어 있으면 인박스에 "신규 생성"·"연결" 버튼이 안 뜨므로 `#341` 시드도 발화하지 않는다(제임스의 `need_timing`이 지금도 빈 이유).

**편집 UI 유무**
| 영역 | 필드 | 앱 연결 고객 |
|---|---|---|
| 니즈 카드(`NeedsDashboard`) | `need_model`·`need_trim`·`need_colors`·`need_method`·`need_memo` | ❌ **없음** — `detail.appUserId` 분기(`NeedsDashboard.tsx:75`)로 앱 요청 카드 목록이 대신 렌더된다 |
| 상세 구매조건(`useCustomerPurchase`) | 9필드(method·timing·contractTerm·initialCost·annualMileage·deliveryMethod·contractFocus·customerNote·reviewNote) | ✅ 클릭 편집 가능(`PURCHASE_FIELD_KEY` 매핑) |

즉 **`need_model`·`need_trim`은 앱 연결 고객에서 읽기 전용으로 박제**된다.

## 실무에서 터진 지점 (오늘 2회)

1. **계약·출고 관리 목록에 "기아 레이"** — 제임스의 실제 계약은 **BMW 3 Series 운용리스**인데 목록엔 최초 관심 차종이 떴다. → `#346`에서 **표시만 우회**(계약 근거만 쓰고 니즈 폴백 제거). 근본은 안 고쳤다.
2. **상세 구매조건 9필드 중 7개가 "미정"** — 승격이 2개만 채우므로 나머지는 상담사가 손으로 채워야 하는데, 앱 요청엔 이미 그 정보가 상당수 있다(계약기간=`period`, 초기비용=`deposit_*`, 연간 주행거리=`annual_mileage_km`, 인도 방식=`delivery_method`(예약)).

⚠️ 앱 연결 고객은 현재 **2명뿐**(전체 22명)이라 체감이 작지만, 앱이 정식 출시되면 이 비율이 뒤집힌다.

## 정해야 할 것 (설계 논점)

1. **언제 갱신하나** — 새 요청이 올 때마다? 승격 액션 때만? 상담사가 "최신 요청으로 갱신" 버튼을 누를 때?
2. **무엇을 갱신하나** — 빈 칸만(비파괴, `#341` D5 선례)? 전부 덮어쓰기? 필드별로 다르게?
3. **상담사 수기 입력과의 우선순위** — 자동 갱신이 수기 값을 덮으면 안 된다는 게 D5 결론이었다. 같은 규칙을 니즈 전체에 적용할지.
4. **앱 연결 고객 편집 UI** — `need_model`류를 편집 가능하게 열지, 아니면 "앱 요청이 진실 원본"으로 두고 파생만 보여줄지.
5. **9필드 자동 채움** — 앱 요청의 금융조건(`period`·`deposit_*`·`annual_mileage_km`)을 계약기간·초기비용·연간 주행거리에 시드할지. **CRM은 이 컬럼들을 아직 안 읽는다**(회신 문서 §"기저장 필드" 참조).
6. **니즈의 의미 재정의** — "최초 관심"인가 "현재 관심"인가. 이걸 정하지 않으면 위 5개가 안 풀린다.

## 관련 자료

- `#346` PR 본문 — 계약 화면에서 니즈를 뺀 근거(입력 유도가 죽는다)
- `ref/2026-07-24-app-delivery-contract-reply.md` — V2 출고 계약(D5 비파괴 시드 선례)
- `src/db/queries/quote-requests.ts` — `createCustomerFromRequest`·`fillNeedTimingIfEmpty`
- `client/src/components/customer-detail/purchase-meta.ts` — 9필드 ↔ 컬럼 매핑 SSOT
