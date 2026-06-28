# CRM 고객 상세 레이아웃 전체 고객 일반화 설계

작성일: 2026-06-28
상태: **design 확정(브레인스토밍 승인). 다음 = writing-plans → 구현.**
성격: 김민준(CU-2605-0020) 전용 시범 상세 레이아웃(`KimMinjunDetailContent`)을 **모든 고객**으로 일반화. `isKimMinjun` 하드코딩 게이트 제거 + 하드코딩 텍스트/mock 정리 + 빈 상태 처리 + legacy 레이아웃 제거.
연계: 리팩토링 로드맵의 "본체 일반화" 트랙(brief/메모리), 고객 읽기 #46/상세 #51, 견적 도메인 #4(구매조건/Maybach mock 출처).

## 배경

`client/src/pages/CustomerDetailPage.tsx`는 현재 `isKimMinjun = customer.customerId === "CU-2605-0020"`(약 5339줄)로 분기해, 김민준에게만 새 상세 레이아웃(`KimMinjunDetailContent`, 약 726~5320줄)을 보여주고 나머지 고객은 legacy 레이아웃(`customer-detail-summary`·`customer-detail-action-rail`, 약 5366~5414줄)을 보여준다. S2(앱 견적요청 고객 유입)로 생성된 신규 고객(예: 김지안 `CU-2606-0001`)을 클릭하면 legacy가 떠서, 사용자가 기대하는 새 레이아웃이 안 나온다.

`KimMinjunDetailContent`는 이미 대부분 `detail`(CustomerDetailData)·`customer` prop으로 데이터화돼 있어(니즈·상태·메모·할일·일정·서류·견적함 전부 `detail.*`) **빈 데이터 고객도 크래시 없이** 렌더된다(빈 배열 `.map`, `find ?? null` 안전 — 조사 확인). 남은 걸림돌은 ①하드코딩 텍스트 ②데이터 소스 없는 mock 값 ③빈 섹션 UX다.

## 결정 사항 (브레인스토밍 확정)

| 항목 | 결정 |
|---|---|
| 빈 섹션 UX | **섹션 유지 + 빈 안내("등록된 ~ 없음") + 추가(+) 버튼**(상담 콘솔 = 채워나가는 작업판) |
| mock 값(데이터 소스 없음) | **빈값/0으로 정리**(계약기간·보증금 등 "미정", Maybach 가격 → 0/빈값, 차량 선택 시 catalog) |
| legacy 레이아웃 | **제거**(게이트 + legacy JSX + 전용 CSS) |
| `kim` 리네임 | **후속 별도 슬라이스**(이번은 동작만, diff/리스크 분리) |

## 아키텍처

`isKimMinjun` 게이트를 완전히 제거한다. `CustomerDetailPage`는 **모든 고객**에 대해 detail을 fetch하고 `KimMinjunDetailContent`(= 사실상 표준 상세)를 단일 경로로 렌더한다. detail 로딩/에러 게이팅은 유지(모든 고객 공통). legacy 레이아웃은 삭제. 컴포넌트/상수/핸들러 이름(`KimMinjun*`·`kim*`)은 이번엔 그대로 두고 동작만 일반화한다.

## 변경 — `client/src/pages/CustomerDetailPage.tsx`

1. **게이트 제거**
   - `isKimMinjun` 상수 삭제.
   - detail fetch effect의 `if (!isKimMinjun || !customer.id) return;` → `if (!customer.id) return;`(모든 고객 fetch).
   - 렌더: legacy 분기(`isKimMinjun ? null : (<>...summary/action-rail...</>)`)와 그 JSX 블록 제거. `KimMinjunDetailContent`를 항상 렌더(detail 로딩/에러 게이팅 유지). 컨테이너 className의 `isKimMinjun ? "kim-detail-mode" : ""`는 항상 적용.

2. **하드코딩 텍스트 → `customer` prop** (조사로 식별된 9곳)
   - 워크벤치 헤더 고객명/코드(약 4714-4715): `김민준`/`CU-2605-0020` → `customer.name`/`customer.customerId`.
   - 발송 토스트(약 2552): `김민준 ... CU-2605-0020` → `${customer.name} ... ${customer.customerId}`.
   - 서류 병합 PDF 파일명(약 2762): `김민준-서류.pdf` → `${customer.name}-서류.pdf`.
   - aria-label(약 3691·3740·3741·3938): `김민준 업무 상태`·`김민준 실무 영역`·`김민준 구매조건과 고객 메모`·`김민준 고객 운영 기능` → `${customer.name} ...`.
   - 발송 확인 모달(약 4439): `김민준(CU-2605-0020) 고객에게 ...` → `${customer.name}(${customer.customerId}) 고객에게 ...`.
   - (착수 시 `grep "김민준\|CU-2605-0020"`로 누락 없는지 재확인.)

3. **mock 값 빈값/0 정리**
   - `purchaseFields` 초기화(약 766-774, `kimMinjunPurchaseFields` 기반): 구매방식·출고시기는 `detail.needMethod`/`detail.needTiming`으로 채우는 현 로직 유지. **데이터 소스 없는 나머지 필드(계약기간·보증금·선납금 등)의 김민준 고정 기본값을 빈값/"미정"으로** 교체(`kimMinjunPurchaseFields` 상수의 해당 value를 비우거나, 초기화 시 빈값으로 매핑). 김민준도 동일(실데이터는 니즈/견적에서).
   - 견적 워크벤치 가격 mock(`pricing`/`pricingInputs` 초기 state 약 863-864 = `kimMaybachQuotePricingResult`/`kimMaybachQuotePricingMock`; 입력 `defaultValue` 약 4907·4928-4930·4944·4946-4948): **0/빈값으로 초기화**. 차량 선택 시 `applyTrimToPricing`이 catalog 값으로 채우므로 정상 흐름 유지(신규 워크벤치는 차량 선택부터). 사용하지 않게 된 `kimMaybach*` mock 상수는 제거.

4. **빈 섹션 안내**
   - 할일·메모·일정·서류·견적함 각 섹션에서 해당 배열이 0건일 때 "등록된 ~ 없음" 류 안내를 렌더(현재는 빈 배열 `.map`이라 아무것도 안 보임). 추가(+) 버튼은 이미 상시 노출이라 유지. 안내 문구/스타일은 plan에서 구체화(기존 톤과 일치).

## 변경 — `client/src/index.css`

- legacy 상세 전용 클래스 제거: `.customer-detail-summary`, `.customer-detail-identity`, `.customer-detail-avatar`, `.customer-detail-name-row`, `.customer-detail-contact-row`, `.customer-detail-status-strip`, `.detail-stage-pill`, `.detail-chance-pill`, `.detail-manage-pill`, `.customer-detail-action-rail`, `.customer-detail-panel-controls`, `.customer-detail-action-group` 등 legacy JSX에서만 쓰던 클래스. (착수 시 각 클래스가 legacy 외에서 안 쓰이는지 `grep`로 확인 후 제거 — 공유 클래스는 보존.)

## 검증

- `bun run typecheck`(참조 정합)·`bun run lint`(0 problems)·`bun run build`.
- `bun run test:unit`(회귀 가드 — 기존 단위테스트 그대로 통과해야).
- **브라우저 수동 검증(머지 게이트)**: 인증 세션 필요. 3종 고객 확인:
  - **김지안(CU-2606-0001, 빈 고객)**: 새 레이아웃 렌더, 크래시 없음, 빈 섹션 안내 표시, "김민준"/Maybach 등 오표시 없음.
  - **김민준(CU-2605-0020, 풀데이터)**: **회귀 없음** — 기존과 동일하게 니즈·메모·할일·일정·서류·견적 표시.
  - **중간 데이터 고객**(일부 섹션만 채워진 기존 고객): 채워진 섹션 정상 + 빈 섹션 안내 혼재.
- 거대 컴포넌트(~4500줄)라 컴포넌트 단위테스트는 제한적 → typecheck + 수동.

## 엣지 / 리스크

- ⚠️ **전체 고객(20명+)에 영향**: 현재 김민준 외는 legacy로 안전 작동 중. 일반화 후 모두 새 레이아웃 → **브라우저 검증이 머지 전제**. prod 배포 전 3종 고객 확인.
- 김민준 회귀 주의: mock 빈값화·게이트 제거가 김민준 표시를 깨지 않아야(detail 풀데이터라 기존과 동일해야).
- Maybach 0 초기화가 김민준 워크벤치에도 적용되나, 워크벤치는 원래 차량 선택부터 시작이라 회귀 아님(차량 선택 → catalog 가격).
- detail fetch가 모든 고객으로 확대 → 상세 진입마다 1회 fetch(캐시 #57로 재진입 즉시, perf 중립).
- legacy CSS 제거 시 공유 클래스 오삭제 주의(grep 확인).

## 범위 밖 (YAGNI / 다음)

- `kim`/`KimMinjun` → 범용 리네임(후속 슬라이스, 순수 기계적).
- 구매조건(계약기간·보증금 등) 데이터화(crm 컬럼 추가 + 쓰기 경로 — 견적 도메인 트랙).
- `KimMinjunDetailContent`(~4500줄) 영역 컴포넌트 분해(별도 리팩토링 트랙).
- 빈 상태의 고급 onboarding UX(가이드/추천 액션 등).

## 다음

- 이 일반화로 모든 고객이 표준 상세를 쓰게 됨 → 이후 `kim` 리네임 → 영역 분해 → 구매조건 데이터화 순으로 본체 표준화 트랙 진행.
