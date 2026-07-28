# 딜러 할인 제안 → 관리자 채택 설계 (2026-07-27)

요청: 이사님(브랜드 매칭·비고·채택 권한) · 설계 합의: 유슨생 · 작성: 송실장 세션

## 1. 요구 (원문 기준)

- MC 마스터에서 **딜러가 자사할인·제휴할인·타사할인만** insert/update 할 수 있게 한다.
- 딜러는 **자기 브랜드 전 트림만** 입력·수정 가능. 관리자가 딜러에게 브랜드를 매칭한다.
- **한 딜러 = 한 브랜드**, 그러나 **한 브랜드에 여러 딜러**가 각자 금액을 낼 수 있다.
- ⚠️ **딜러가 입력한 금액이 최종 컨펌된 catalog 할인금액으로 들어가면 안 된다.**
  관리자(이사님)가 제안들을 보고 **선택하면 그때 최종 금액에 반영**된다.
- 선택은 **자사·제휴·타사 각각 독립**이어야 한다.
- 딜러 행에 **비고 컬럼**(이사님 입력)이 있어야 한다 — 예: "동성모터스", "코오롱모터스", "바바리안".

## 2. 핵심 결정 — 2단 구조(제안 → 채택)

```
딜러 입력                        관리자 채택                  최종 소비
crm.dealer_trim_discounts  →  [필드별 채택]  →  catalog.trims(자사/제휴/타사)
(브랜드별 여러 딜러 병존)         crm.catalog_discount_adoptions   → 견적 워크벤치 · 차선생 앱
```

**딜러는 `catalog` 스키마를 한 글자도 건드리지 않는다.** `DEALER_WRITE_ALLOWLIST`에 여는 것은
신설 crm 라우트뿐이라, 트림명·기본가격·상태는 물론 **최종 할인 금액까지** 딜러 손이 닿지 않는다.
`catalog` 쓰기는 admin 전용 그대로다.

근거(실측): `catalog.trims`의 `financial_discount_amount`·`partner_discount_amount`·
`cash_discount_amount`는 `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts`가 읽어
**견적 계산에 실제로 반영**되고, `catalog`는 앱과 공유하는 스키마다. 즉 확정 할인은 고객 견적
금액을 바꾸는 값이라 딜러 제안이 직접 들어가면 안 된다.

⚠️ **정정(2026-07-27, 구현 중 실측)**: 위를 "확정 할인은 고객에게 **보이는** 값"으로 적었었는데
부정확하다. 고객이 그 숫자를 직접 보는 화면은 없다 — 앱에서 이 3필드를 쓰는 곳은
`lib/presentation/screens/admin/trim_list/` 2파일뿐이고(`trim_table.dart`·`trim_accordion.dart`)
**고객 화면 사용처는 0건**이다. 고객에게 가는 것은 그 값이 들어간 **계산 결과**(견적)다.
이 사실이 §7.1의 딜러 노출 정책을 뒤집었다(아래 참조).

## 3. 데이터 모델

### 3.1 신설 — `crm.dealer_profiles`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `dealer_user_id` | `uuid` PK | → `public.profiles.id` (loose id) |
| `brand_id` | `bigint` NOT NULL | → `catalog.brands.id` (loose id) |
| `note` | `text` | **비고 — 딜러사명**(동성모터스·코오롱모터스·바바리안). 관리자 입력 |
| `created_at` | `timestamptz` NOT NULL | `defaultNow()` |
| `updated_at` | `timestamptz` NOT NULL | `defaultNow()` / UPDATE는 `sql\`now()\`` |

`created_at`을 두는 이유는 감사(언제 처음 매칭했나)와 **테스트 가능성**이다 — 스탬프 전진을
DB 안에서 `updated_at > created_at`(timestamptz = 마이크로초)으로 검증할 수 있다. JS `Date`로 꺼내
비교하면 ms 절삭 때문에 빠른 연속 호출에서 거짓 실패하고, 더 나쁘게는 시계 스큐가 클수록 잘 통과해
결함을 가린다(#334·#335).

- **PK가 `dealer_user_id` 하나** = "한 딜러 = 한 브랜드"를 스키마가 강제한다.
- `brand_id`에 FK를 걸지 않는다: `NOT NULL`이라 `ON DELETE SET NULL`을 쓸 수 없고, `RESTRICT`는
  catalog(앱 공유) 삭제를 CRM이 가로막는 소유권 침범이 된다. `crm.quotes → catalog` FK(마이그 0001)는
  nullable이라 가능했던 선례이므로 여기 적용되지 않는다. 조회 시 조인 실패는 "브랜드 미지정"으로 처리.

### 3.2 신설 — `crm.dealer_trim_discounts` (제안)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | `uuid` PK | `defaultRandom()` |
| `trim_id` | `bigint` NOT NULL | → `catalog.trims.id` (loose id) |
| `dealer_user_id` | `uuid` NOT NULL | → `public.profiles.id` |
| `financial_amount` | `integer` | 자사할인 제안. **nullable = 미입력** |
| `partner_amount` | `integer` | 제휴할인 제안 |
| `cash_amount` | `integer` | 타사할인 제안 |
| `created_at` | `timestamptz` NOT NULL | `defaultNow()` (§3.1과 같은 이유) |
| `updated_at` | `timestamptz` NOT NULL | `defaultNow()` / UPDATE는 `sql\`now()\`` |

- `UNIQUE (trim_id, dealer_user_id)` — 딜러별·트림별 1행 upsert.
- 3금액이 각각 nullable인 이유: 딜러가 자사만 내고 제휴·타사는 비울 수 있다.

### 3.3 신설 — `crm.catalog_discount_adoptions` (채택 감사)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | `uuid` PK | |
| `trim_id` | `bigint` NOT NULL | |
| `field` | `text` NOT NULL | `'financial'` \| `'partner'` \| `'cash'` — CHECK 제약 |
| `amount` | `integer` | 채택된 금액. nullable = "비움"을 채택 |
| `previous_amount` | `integer` | 직전 catalog 값(되돌리기 근거) |
| `source_dealer_user_id` | `uuid` | **NULL = 관리자 직접 입력** |
| `adopted_by` | `uuid` NOT NULL | 채택한 관리자 `profiles.id` |
| `adopted_at` | `timestamptz` NOT NULL | `defaultNow()` |

**필드 단위 행**이라 "자사는 동성모터스 값, 제휴는 코오롱 값"이 자연스럽게 표현된다.

### 3.4 기존 — `catalog.trims` (변경 없음)

3할인 컬럼 + `discount_updated_at`이 **최종 확정값의 SSOT**다. 채택 시에만 갱신한다.
관리자 직접 입력(현행 `TrimEditPanel` 할인 3칸)은 **그대로 유지** — 제안이 없는 트림도 있다.
직접 입력도 감사 행을 남긴다(`source_dealer_user_id = NULL`).

## 4. 상태 파생 (컬럼 없이 조회 시 계산)

제안 1건 × 필드 1개의 상태는 **최신 adoption과 현재 제안 금액의 대조**로 파생한다.

| 상태 | 판정 | 화면 |
|---|---|---|
| **채택됨** | 최신 adoption(그 트림·필드)의 `source_dealer_user_id` = 이 딜러 **AND** `amount` = 이 딜러의 현재 제안 금액 | ✅ 표시 |
| **수정됨(재채택 필요)** | `source_dealer_user_id` = 이 딜러 **AND** `amount` ≠ 현재 제안 금액 | 🟡 "새 제안" 배지 · 최종값은 불변 |
| **미채택** | 그 외 | [채택] 버튼 |

금액 대조를 쓰는 이유: 제안 행 `updated_at` 비교는 **딜러가 다른 필드만 고쳐도 행 시각이 움직여**
오탐이 난다. 필드 단위 금액 비교가 정확하다.

**채택 후 딜러 수정 → 자동 재반영은 하지 않는다**(유슨생 결정). 자동 반영하면 채택이 멱목이 되고,
딜러가 사후에 숫자를 바꿔 실견적 기준을 움직일 수 있다.

## 5. 딜러 자격 상실 (dealer → customer)

실측: `user_role` enum = `customer`·`staff`·`manager`·`admin`·`dealer`
(현재 분포 customer 11 · admin 3 · dealer 1 · staff 1 · manager 1).

**⚠️ CRM은 role을 바꿀 수 없다** — `public.profiles`는 앱과 합의한 read 전용 계약이다. role 변경은
앱 Edge Function이나 Supabase 대시보드에서 일어나고, **CRM은 통보받지 못한다.**

| | 결과 |
|---|---|
| CRM 접근 | 즉시 끊긴다 — `roleTabFromClaim`이 `customer`를 매핑하지 않아 null = 접근 거부. 새 제안 불가 |
| crm 제안·프로필 행 | 그대로 남는다 (profiles FK 없음) |
| 이미 채택된 catalog 값 | **유지한다** — 채택은 관리자의 결정이었고 앱·견적에 이미 반영된 값이다. 되돌리면 고객에게 보이는 가격이 조용히 바뀐다 |
| 채택 팝오버 | **"현재 딜러 아님" 배지 + 채택 버튼 비활성**(유슨생 결정) |

**soft delete 컬럼을 두지 않는다.** `deactivated_at`을 두면 CRM이 role 변경을 감지하지 못하는 탓에
이사님이 앱에서 role을 내린 뒤 CRM에서 또 비활성 처리를 해야 하는 **이중 관리**가 되고, 잊으면
"컬럼은 활성인데 실제론 딜러 아님"이라는 **조용한 드리프트**가 남는다.

### 5.1 담당 브랜드 변경 (이직) — 2026-07-28 추가

딜러는 **이직·퇴사한다**(유슨생). 담당 브랜드가 바뀌면 옛 브랜드 제안을 확정으로 올릴 수 없어야
한다 — 관계가 끝난 딜러사의 조건을 쓰는 셈이다. 자격 상실(role)과 **같은 축**이지만 원인이 달라
화면 표기를 나눈다("채택 불가" vs "브랜드 변경됨").

⚠️ **구멍이었다(실측 확인 후 수정)**: 쓰기 경로(`PUT /api/dealer/discounts/:trimId`)는 브랜드 소유권을
403으로 막는데 **채택 경로에는 검증이 0건**이었다. 그래서 벤츠로 옮긴 딜러의 BMW 제안이 실제로
채택됐다(`catalog.trims`에 반영 + 감사까지 남음 — 롤백으로 확인). 이제 `adoptDealerProposal`이
쓰기 경로와 **같은 `brandIdOfTrim`**으로 대조한다(기준이 갈리면 같은 비대칭이 다시 생긴다).

| | 결과 |
|---|---|
| 제안 데이터 | **그대로 남는다** — 브랜드는 `dealer_profiles.brand_id` 한 컬럼이고 제안 행은 `(trim_id, dealer_user_id)`로만 저장된다 |
| 딜러 화면 | 새 브랜드만 보인다(`scopeBrandId`) → 자기 옛 제안을 못 보고 수정도 못 한다(403) |
| 채택 팝오버 | **"브랜드 변경됨" 배지 + 채택 버튼 없음**. 서버도 거부 |
| **브랜드 복귀 시** | **다시 채택 가능하다** — 차단은 조회 시점 대조뿐이라 되돌리면 예전 금액을 그대로 이어 쓴다(실 DB 테스트가 이 왕복을 잠근다) |

같은 원리로 role 축도 왕복한다(퇴사 → 재입사 시 부활). **어느 축이든 데이터를 지우지 않는다.**

대신 제안 목록 조회 시 `public.profiles.role`을 조인해 **현재 딜러인지 그 자리에서 파생 판정**한다.
항상 최신이고, role이 되돌아오면 자동 복구된다. 전화번호 소유권 모델의
read-through 합성(`coalesce(profiles.phone_number, phone)`, #276)과 같은 패턴이다.

## 6. 권한·게이트

### 6.1 딜러 쓰기 개방 (allowlist 1줄)

`src/middleware/role-gate.ts`의 `DEALER_WRITE_ALLOWLIST`에 **딜러 제안 upsert 라우트만** 등록한다.
정규식은 `^…$` 앵커 강제(테스트가 잠금).

```
{ method: "PUT", path: /^\/api\/dealer\/discounts\/\d+$/ }
```

### 6.2 브랜드 소유권 검증 (서버, fail-closed)

딜러가 `trim_id`에 쓸 때마다 2단 조인으로 브랜드를 확인한다.

```sql
select m.brand_id from catalog.trims t
  join catalog.models m on m.id = t.model_id
 where t.id = $1
```

`dealer_profiles.brand_id`와 다르면 **403**. 프로필이 없으면 **403**(fail-closed — 브랜드 미지정
딜러는 아무것도 못 쓴다). UI 숨김은 UX 보조일 뿐이고 서버가 진짜 게이트다(#212·#220 선례).

### 6.3 라우트

| 메서드·경로 | 역할 | 비고 |
|---|---|---|
| `GET /api/dealer/me` | dealer | 내 브랜드·비고 |
| `GET /api/dealer/discounts?modelId=` | dealer | **내 제안만**(타 딜러 제안 비노출) |
| `PUT /api/dealer/discounts/:trimId` | dealer | upsert — **allowlist 개방 지점** |
| `GET /api/catalog/trims/:id/discount-proposals` | admin | 전 딜러 제안 + 파생 상태 |
| `POST /api/catalog/trims/:id/discount-adoptions` | admin | **필드 단위 채택** |
| `GET /api/dealer-profiles` · `PUT /api/dealer-profiles/:userId` | admin | 브랜드 매칭 + 비고 |

관리자 채택은 **한 트랜잭션**으로 ① `catalog.trims`의 해당 할인 필드 UPDATE
② `crm.catalog_discount_adoptions` INSERT를 처리한다.

⚠️ **`discount_updated_at`은 직접 세팅하지 않는다**(2026-07-27 실측). `catalog.trims`에 트리거
`trims_discount_updated`(BEFORE UPDATE → `catalog.update_discount_timestamp()`)가 이미 걸려 있고,
**3할인 중 하나라도 `IS DISTINCT FROM`일 때만 `NOW()`로 찍는다**(DB 시계·값이 같으면 안 찍는 멱등).
우리가 직접 넣으면 트리거 조건을 못 채운 경우(같은 값 재채택) 그 값이 그대로 들어가 **거짓 스탬프**가
된다. 즉 여기서는 직접 찍는 쪽이 위험하다.

반면 **crm 소유 테이블(`dealer_profiles`·`dealer_trim_discounts`)의 `updated_at`은 우리 몫**이므로
UPDATE 시 반드시 인라인 `sql\`now()\`` — 앱 시계는 스탬프가 과거로 되돌아간다(#334·#335,
`src/db/updated-at-clock-guard.test.ts`가 스캔).

## 7. 화면

### 7.1 딜러 모드 (MC 마스터 재사용)

현재 `MCMasterPage`는 `canEdit = roleTab === "최고관리자"`이고, Topbar 설정 메뉴의 MC 마스터는
`isAdminRole` 게이트라 **딜러에게는 메뉴가 보이지 않는다**. 이를 다음으로 바꾼다.

- 사이드바: **자기 브랜드만** 표시(유슨생 결정 — 경쟁사 가격·할인 전략 비노출). 타 브랜드 URL 직접 진입도 차단.
- 트림 테이블: 트림명·기본가격·상태·연식은 **읽기 전용**. 할인 3열만 편집 가능.
- 편집 대상은 **자기 제안값**이다(확정값을 덮어쓰는 게 아니다).
- 🔴 **확정값은 딜러에게 보여주지 않는다**(2026-07-27 유슨생 결정 — 구현 후 변경).
  딜러가 보는 것은 **자기 제안뿐**이다. 관리자 확정 할인을 보면 ①다른 딜러의 제안이 채택된
  결과를 역산할 수 있고(경쟁사 할인 전략 노출 — 사이드바 브랜드 차단과 같은 축) ②관리자가
  얼마로 확정했는지 알고 제안을 맞추게 된다.
  - **차단은 서버가 한다**(`src/lib/dealer-visibility.ts` `visibleTrimsFor`/`visibleTrimFor`):
    화면에서만 감추면 응답에 실려 DevTools로 보인다. 새는 경로가 둘이었다 —
    `GET /api/catalog/trims`(3금액 + 할인변경일) · `GET /api/vehicles/trims/:trimId`(3금액).
  - **할인변경일도 비우고 열째 감춘다** — 금액을 감춰도 "언제 확정이 바뀌었다"가 남으면 경쟁
    딜러의 제안이 채택된 시점이 새고, 항상 빈 열은 감춘 의도가 아니라 고장으로 읽힌다.
  - 이 차단이 실효를 갖는 근거 = §2 정정(앱도 관리자 화면에서만 쓴다 → 딜러가 앱으로 우회할
    경로가 없다). 브랜드 스코프는 반대로 "앱 공개 정보"라 클라 차단으로 뒀다.

  ~~**확정값은 함께 보여준다** — 확정 할인은 차선생 앱에서 고객에게 이미 공개되는 값이라 숨길
  실익이 없다. 표시 방식: 할인 3열 각 셀 안에서 위=내 제안값, 아래=확정값 회색 보조표기.~~
  → **폐기.** 근거였던 "앱에서 고객에게 이미 공개되는 값"이 사실이 아니었다(§2 정정 참조).
  구현(B2b)은 이 서술대로 보조표기를 넣었고, 지금 제거했다.
- **다른 딜러의 제안과 그 소속은 딜러에게 노출하지 않는다**(위와 별개로 유지 — 서버가 자기 행만
  내린다: `listMyTrimDiscounts(dealerUserId, modelId)`).
- 제안 **비우기**는 허용한다 — 3금액이 nullable이므로 빈 값 저장 = "이 필드는 제안하지 않음". 비워도
  이미 채택된 확정값에는 영향이 없다(§4 "수정됨" 상태로 배지만 뜬다).
- admin 전용 기능(트림 추가·이동·삭제·옵션 패널·MC코드)은 딜러 모드에서 전부 숨김 + 서버 403.

### 7.2 관리자 채택 팝오버

트림 테이블의 자사·제휴·타사 셀을 누르면 그 필드의 제안 목록이 뜬다.

```
자사할인 — 520i (MC070526005)
현재 확정: 6,500,000원 (9.3%)  ← 출처: 동성모터스 · 2026-07-25 채택
─────────────────────────────────────────────
동성모터스   권지현   6,800,000원 (9.7%)  🟡 새 제안   [채택]
코오롱모터스 김ㅇㅇ   6,500,000원 (9.3%)  ✅ 채택됨
바바리안     박ㅇㅇ   6,200,000원 (8.9%)              [채택]
(현재 딜러 아님) 이ㅇㅇ 7,000,000원          ⛔ 채택 불가
```

- 맥락(모델·트림·기본가격)이 이미 화면에 있어 한 화면에서 비교·채택이 끝난다(유슨생 결정).
- 별도 "딜러 할인 제안" 화면은 **만들지 않는다** — 딜러가 늘어나 전수 조망이 필요해지면 별건.

### 7.3 딜러 브랜드 매칭 UI (2026-07-28 개정 — `#384`·`#385`·`#386`, 유슨생 현장 지시)

~~구성원 탭의 dealer 행에 브랜드 select + 비고~~ → **별도 「딜러」 테이블로 분리**했다. 한 표에
섞으면 딜러 행은 역할·담당 고객·접근 범위·상담 수신이 전부 무의미하고("해당 없음"·`—`), 반대로
브랜드·비고는 나머지 구성원에게 빈 칸이었다 — 두 표가 각자 자기 컬럼만 낸다.

- **명부 = 합집합**(`GET /api/dealer/roster`, admin): `role='dealer'` **OR** `dealer_profiles` 존재.
  role로만 잡으면 앱에서 role이 내려간 순간 행이 사라져 **그 딜러의 데이터를 정리할 방법이 없어진다.**
  role 내려간 행은 "현재 딜러 아님" 배지 + **폼 컨트롤 없이 텍스트 렌더**(disabled select는 화살표가
  남아 편집될 것처럼 읽힌다 — 실기 피드백). profiles에 없는 고아는 명부 대상이 아니다(`check:residue` 몫).
- **데이터 관리 2종**(admin·window.confirm): **입력값 삭제** = 제안 전부, 매칭 유지(재입력 가능) /
  **딜러 해제** = 제안+매칭 한 트랜잭션(앱 role은 그대로 — 팝업이 고지). 🔒 **어느 쪽도 채택된 확정
  할인(catalog.trims)·채택 감사(§5)는 건드리지 않는다** — 이미 고객 견적에 반영된 값이고, 감사를
  지우면 되돌리기 근거(`previous_amount`)가 사라진다.
- **대상 가드**: `PUT /api/dealer/profiles/:userId`는 대상 role이 dealer가 아니면 **409**
  (`isDealerRole` — §5 채택 가드와 같은 read-through 기준). 없으면 딜러였던 적 없는 uuid에도 매칭이
  생겨 명부에 유령 행이 뜬다(TDD RED로 실확인).
- **저장 UX**: 저장 버튼 없음 — 브랜드 = 선택 즉시 confirm(변경 시 "기존 제안 N건 채택 불가" 경고 포함),
  비고 = blur/Enter 자동 저장, 브랜드 미지정이면 비고 입력 잠금(`brand_id` NOT NULL — "브랜드 먼저 지정").
  ⚠️ confirm은 비멱등이라 Safari select 병행 바인딩 금지 — onInput은 ref 보관만, 실행은 onChange 1곳.

저장 대상은 `crm.dealer_profiles`이므로 **profiles read 전용 계약을 위반하지 않는다**(role은 읽기만).

## 8. 확정된 결정 (유슨생 답변)

1. 딜러 1명 = **브랜드 1개 고정**(컬럼 1개, PK로 강제)
2. 딜러는 **자기 브랜드만** 보인다
3. **감사 테이블을 남긴다**(`crm.catalog_discount_adoptions`)
4. 채택 후 딜러가 수정하면 **재채택 필요**(자동 재반영 없음)
5. 채택 UI = **MC 마스터 할인 셀 팝오버**
6. 딜러 입력 화면 = **MC 마스터 딜러 모드**
7. 자격 상실 제안 = **배지 + 채택 불가**(soft delete 컬럼 없음, role read-through 판정)

## 9. 검증 계획

- 마이그레이션: `db:generate` → `db:migrate`(0039 예정, `schemaFilter:["crm"]`). **`db:push` 금지.**
- 순수 판정 로직(상태 파생 · 브랜드 소유권 · 자격 판정)은 **단위테스트 우선**.
- 게이트 회귀: dealer가 ①`catalog` 쓰기 ②타 브랜드 트림 ③할인 외 필드에 접근 시 전부 403 — RED 확인 후 구현.
  ⚠️ **403 전제 픽스처 이름도 `TEST_CUSTOMER_NAMES` registry(`fixture-codes.ts`)에 선등록**한다
  ("어차피 403이라 안 만들어진다"는 가정은 정확히 게이트가 깨졌을 때 무너진다 — #214 실사고).
- `updated_at` tripwire(`src/db/updated-at-clock-guard.test.ts`)를 통과해야 한다 = 인라인 `sql\`now()\``.
- 4종(typecheck · lint · knip · format:check) + `test:unit` + `test:pure` + `build`.
- 실화면 눈 확인 1회: 관리자 채택 팝오버 · 딜러 모드(magiclink 스모크 — 딜러 계정 필요).

## 10. 미결·후속

- **딜러 실계정 1개**(`김지안수령님의개`, 담당 고객 0)뿐이라 실기 검증 폭이 좁다. 스모크용 딜러 계정의
  브랜드 매칭이 선행 조건.
- 딜러 제안 도착을 이사님에게 알리는 **배지·알림은 이번 범위에서 제외**. 필요해지면 별건
  (MC 마스터 메뉴에 "대기 N건" 형태).
- 채택 **되돌리기(undo)** 는 이번 범위 밖. `previous_amount`를 남겨두므로 필요할 때 구현 가능.
- 이 변경은 **행위 변경**이므로 `ref/director-pending-confirmations.md` 등재 대상이나, 이사님이
  직접 요구한 기능이라 등재 불필요(요구 자체가 승인).
