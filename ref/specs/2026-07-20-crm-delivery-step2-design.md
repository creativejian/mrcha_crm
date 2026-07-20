# 출고 관리 2단계 — 출고 도메인 얇은 테이블 `customer_deliveries` (2026-07-20)

상태: 유슨생 브레인스토밍 확정(2026-07-20). 1단계(#288)와 동일 거버넌스 — 이사님 브레인스토밍 대기를 유슨생 결정으로 해제하고 주도 구현, **이사님 결정 대체 가정은 §7에 전량 명시**, 머지 후 `ref/director-pending-confirmations.md` **항목 15**로 사후 공유(계산엔진 #241·출고 1단계 #288 선례).

## 0. 배경

- 1단계 spec §10 예고 재료(계약일·금융사·출고 실측일·탁송/정비 메모·체크리스트) + (B) 목업 어휘(고객/차량/금융사/계약일/출고 예정/상태/메모)가 출발점. 합의 구조(브리프 박제) = "②2단계 명백 필드만 얇은 테이블 ③DV 채번은 이사님 확인 전 미개봉·정산(ST)은 별도 슬라이스".
- **브레인스토밍 중 발견(2026-07-20, 파이프 신설의 근거)**: 견적함 "계약 진행" 액션은 `crm.quotes.decision_status='contracting'`을 영속하지만 **소비처가 견적함 안에서 끝난다**(카드 배지 + 수정/삭제 가드 문구 — "계약 관리 창에서 수정" 문구는 실체 없는 프로토타입 언급). 고객 상태·출고 콘솔·AI 어디로도 안 흐름. 즉 "이 견적으로 계약"이라는 **마킹은 이미 존재하는데 받는 쪽이 없다** — 2단계가 그 받는 쪽.
- 출고 콘솔의 차량 컬럼은 니즈 파생(`vehicle: row.needModel`, `customers.ts:69`) = **관심 차종**이지 계약 차량이 아니다. 계약 차량 필드가 필요한 이유.

## 1. 확정 결정 (브레인스토밍 Q&A)

| # | 질문 | 결정 |
|---|---|---|
| S1 | 필드 범위 | **코어 5종** — 계약 차량·계약일·금융사·출고 실측일·탁송/정비 메모(+`source_quote_id` provenance). 체크리스트는 항목별 상태 모델이 필요해 "명백 필드"보다 무겁고 이사님 취향 영역 — 제외(§8) |
| S2 | 테이블 모델 | **고객당 1행** — `customer_id` UNIQUE + upsert. 조인·편집 문법 최단순. 한계 = 재구매(2회차 출고) 이력 미보존 — CT(계약 상위 식별자)·DV 정식 모델 설계 때 재론(§8). 1:N 전환은 unique drop만으로 가능(additive) |
| S3 | 편집 표면 | **출고 콘솔 행 팝오버 단일** — 출고 큐가 작업 표면이라는 1단계 의미론 유지. 드로어 무접촉(§8) |
| S4 | 금융사 입력 | **자유 텍스트 + datalist 제안**(솔루션 8사 라벨은 제안만, 강제 아님). 솔루션 어휘는 "계산 지원 8사"지 "계약 가능 금융사 전집"이 아니라 select 강제는 강결합 |
| S5 | 견적→출고 파이프 | **소프트 파이프** — 팝오버 오픈 시 contracting 견적에서 차량·금융사 프리필(수기 수정 가능), 저장은 텍스트 스냅샷(견적 사후 수정이 출고 기록을 소급 변경하지 않음). 하드 파이프(FK 파생 표시)는 수기 계약 미수용·발송본 고정 원칙 상충으로 기각 |
| S6 | 전이↔실측일 | **완전 독립** — 출고완료 전이는 실측일을 건드리지 않는다(1단계 "결합 없음 원칙"). 자동 스탬프는 전이일≠실제 인도일 케이스에서 오정보 영속이라 기각, 전이 후 팝오버 자동 오픈은 실사용 관찰 후 넛지 후보(§8) |

## 2. 범위

**포함**: 마이그 0036(`crm.customer_deliveries`) · `PUT /api/customers/:id/delivery` upsert · `listCustomers` 서브쿼리 2개(delivery·contractingQuote) · 콘솔 "출고 정보" 컬럼+팝오버 · 차량 컬럼 계약 차량 폴백(delivery mode 한정) · 순수 lib(`delivery-info.ts`) · pending 항목 15 등재.

**제외(§8 박제)**: DV 채번 · 정산(ST)·settlement mode 불변 · 체크리스트 · 드로어 출고 섹션 · AI 코퍼스/힌트 재료 편입 · 견적함 stale 문구 정리.

## 3. 스키마 (마이그 0036)

```
crm.customer_deliveries
├ id uuid PK defaultRandom
├ customer_id uuid NOT NULL UNIQUE → crm.customers.id (ON DELETE CASCADE)
├ contract_vehicle text     -- 계약 차량 스냅샷(자유 텍스트)
├ contract_date date        -- 계약일
├ lender text               -- 금융사 스냅샷(자유 텍스트)
├ delivered_date date       -- 출고 실측일
├ delivery_memo text        -- 탁송/정비 메모
├ source_quote_id uuid → crm.quotes.id (ON DELETE SET NULL)  -- 프리필 참조 견적(provenance)
└ created_at / updated_at timestamptz defaultNow
```

- 닫힌 어휘 없음 → CHECK 0. 전 필드 nullable(빈 폼 저장 = null 저장 허용 — 행 삭제 경로 없음, §5.3).
- `db:generate` → 0036 → `db:migrate`(`schemaFilter:["crm"]`, `db:push` 금지). 스모크 전 실 DB 적용.
- 고객 하드삭제(#212)는 CASCADE로 자연 정리 — Storage·앱 카드 무관이라 삭제 순서 제약 없음. 임베딩 미보유(코퍼스 미편입 §8)라 고아 경로도 없음.

## 4. 서버

### 4.1 읽기 — `listCustomers` 상관 서브쿼리 2개 (1단계 D7 미러)

- ①`delivery: { contractVehicle, contractDate, lender, deliveredDate, deliveryMemo, sourceQuoteId } | null` — 고객당 1행이라 단순 조회.
- ②`contractingQuote: { id, brandName, modelName, trimName, lender } | null` — `crm.quotes` 중 `decision_status='contracting'` **`updated_at` 최신 1건**(복수 마킹 엣지 해소). `lender`는 그 견적의 대표 시나리오(`primary_scenario_id` → `quote_scenarios.lender`), 대표 시나리오 없으면 null. confirmed/considering은 소스 아님 — 명시 마킹(contracting)만 신뢰.
- ⚠️ **drizzle 상관 서브쿼리 함정(#154 박제)**: 외부 참조는 `crm.customers.id` 완전정규화 필수. 구현 형태는 plan에서 확정.
- 소비는 delivery mode만이나 파생을 mode로 왜곡하지 않는다(1단계 nextDeliverySchedule과 동일 원칙). `getCustomer`(드로어)는 무변경.

### 4.2 쓰기 — `PUT /api/customers/:id/delivery` (upsert·전체 교체)

- 팝오버가 전체 폼이라 전체 교체 의미론(PUT). body zod: 5필드 + `sourceQuoteId` 전부 nullable, **날짜 2필드는 `YYYY-MM-DD` 포맷 게이트**(배치 10 A#1 일정 CRUD 미러 — text 축 경계 봉쇄), 빈 문자열 → null 정규화.
- `sourceQuoteId`는 **그 고객 소유 견적인지 검증**(불일치 400 fail-loud — 타 고객 견적 id 주입으로 provenance가 오염되는 경로 차단). FK는 존재·삭제 시 SET NULL만 담당.
- upsert = `INSERT … ON CONFLICT (customer_id) DO UPDATE`(+`updated_at` 스탬프). 고객 미존재 404. 응답 = 저장된 행.
- dealer 쓰기는 전역 `dealerWriteGate`(#220)가 자동 403 — 라우트 추가 게이트 불필요.
- **embed-on-write·AI 힌트 훅 없음**(재료↔트리거 정합 원칙 — 코퍼스에 안 넣으므로 훅도 안 단다. 편입 시 훅 콜사이트 동반, §8).

## 5. UI 상세

### 5.1 콘솔 컬럼

`선택 | 고객 | 차량 | 출고 단계 | 출고 예정 | 출고 정보(신설) | 인도 방식 | 담당 | 관리`

- 출고 정보 셀 = 컴팩트 요약: 계약 줄(`계약 7/15 · iM캐피탈` — 있는 값만 조합) + 실측 줄(`출고 7/20`, 있을 때만). 전부 미입력 = `+ 미입력` 버튼형(출고 예정 셀 문법 미러). 메모는 셀 미표시(팝오버에서만 — 폭 절약).
- 헤더=바디 정합 테스트 유지(#248 부류). 1440px 폭 리듬은 plan에서 실측(#288 툴바 겹침 전례).

### 5.2 차량 컬럼 폴백 (delivery mode 한정)

- `delivery.contractVehicle` 저장값 있으면 차량 셀 상단(모델·트림 줄)을 그 텍스트로 대체(원문 `title`), 구매방식 줄은 니즈 파생 유지. 없으면 현행 니즈 파생 그대로.
- 전체보기 등 타 mode 차량 컬럼은 불변 — 거긴 "관심 차종" 의미론이 맞다.

### 5.3 출고 정보 팝오버

- **폼형** — 명시 저장·취소(담당자 변경·고객 등록·삭제 확인 관례 정합. 출고 예정 팝오버의 무취소·외부닫기와 다른 분류 — B#10 각주의 폼형/경량형 구분). fixed+flip-up(`useFixedPopoverPosition`)·외부닫기 suppress(`useTablePopoverDismiss` #294)·스크롤 닫기.
- 필드: 계약 차량 text / 계약일 `DateTextField` / 금융사 text+datalist(솔루션 8사 라벨) / 출고 실측일 `DateTextField` / 메모 textarea.
- **프리필(소프트 파이프)**: 오픈 시 저장값이 **비어 있는 필드만** contracting 견적에서 시드 — 계약 차량 ← `dedupedModelTrim(brandName·modelName·trimName)` 라벨, 금융사 ← `contractingQuote.lender`. 저장값 있으면 프리필 안 함(수기 우선). contracting 견적 없으면 빈 폼.
- 저장 payload에 프리필 시드에 쓴 견적 id를 `sourceQuoteId`로 동봉(수기 수정해도 유지 — "이 저장이 참조한 계약 진행 견적" 의미. 시드 없었으면 기존 저장값 유지, 그것도 없으면 null).
- 저장 성공 → **서버 리로드 규약**(#234 `reloadCustomers`). 리로드 false 반환 시 팝오버 유지+안내(배치 10 B#1 미러 — 무음 stale 금지). 저장 실패(4xx/5xx) → 팝오버 내 에러 문구.
- 빈 폼 저장 = 전 필드 null 저장(값 지우기 경로). 행 삭제 라우트는 없다 — null 행은 무해(§3).
- DB 자동 변경 경로 없음 — 저장 버튼을 눌러야만 영속(S6 결합 없음 원칙 정합).

## 6. 어휘·문구

- 컬럼 헤더 "출고 정보". 팝오버 타이틀 "출고 정보"(고객명 병기). 서브타이틀 등 1단계 문구 불변.

## 7. 이사님 결정 대체 가정 (pending 항목 15 — 사후 공유·전부 가역)

1. 출고 도메인 = `crm.customer_deliveries` **고객당 1행 얇은 테이블** 신설(재구매 2회차 출고 이력 미보존 — CT/DV 정식 모델 설계 때 재론).
2. 필드 = 계약 차량·계약일·금융사·실측일·탁송/정비 메모 5종(체크리스트 제외).
3. **소프트 파이프** — 견적함 "계약 진행" 마킹이 출고 정보 프리필 소스가 됨(자동 반영 아님·수기 우선).
4. 편집 = 출고 콘솔 팝오버 단일 표면 + 차량 컬럼이 delivery mode에서 계약 차량 우선 표시.
5. DV 채번 **계속 미개봉**(합의 경계 유지 — `business-code-system.md` "인도 완료 시 발급" 규칙과 함께 정식 설계 때 개봉).

## 8. 범위 밖 박제 (재제안 방지·후속 트리거)

- **DV 채번·CT 계약 테이블**: 이사님 브레인스토밍 후. `business-code-system.md`상 정식 모델 = 계약(CT)이 심사·출고·정산의 상위 식별자 — 이번 테이블은 그 전까지의 과도기 구조(가역).
- **정산(ST)·settlement mode**: 불변(settlementStatus는 여전히 mock 파생 공집합).
- **출고 체크리스트**(목업 6종): 후속 후보 — 할일 카테고리 어휘 확장으로 표현 가능(1단계 D3 각주 유지).
- **AI 코퍼스·AI 힌트 재료 편입**: 미편입. "계약일 언제야" 류 질문 대응은 후속 — 편입 시 청크 빌더+훅 콜사이트+백필 동반(재료↔트리거 정합 원칙).
- **전이 후 팝오버 자동 오픈 넛지**(S6 기각 B안): 실측일 입력 누락이 실사용에서 관찰되면 재론.
- **마킹 시 계약완료 전이 확인 넛지**(2026-07-20 유슨생 실기 관찰): 견적함 "계약 진행" 마킹과 고객 계약완료 전이는 실무상 한 이벤트의 두 기록인데 물리적으로 분리돼 있다 — 마킹만 하면 출고 큐 미진입(비계약완료 고객 = 유슨생이 김지안으로 걸린 케이스), 전이만 하면 프리필 없는 큐. **확인창 기반 넛지**("진행 상태도 계약완료로 바꿀까요?")는 결합 없음 원칙과 양립(자동 전이 아님·확인 기반 — S6 기각은 "몰래 바뀌는 자동 조작"이지 확인창이 아님). 단 **넛지가 전이시킬 기본 2차 상태(딜러사계약중 vs 발주 경로별 선택)가 상담사 워크플로우 정책 = 이사님 판단 영역** — pending 항목 15 질의 + 실사용 관찰(마킹 먼저 vs 전이 먼저) 후 재론.
- **견적함 "계약 관리 창에서 수정할 수 있습니다" stale 문구**: 실체 없는 화면 언급 — 이번 범위 밖(관찰 기록). 출고 정보 팝오버가 자리 잡으면 문구 재검토.
- **드로어 출고 정보 섹션**: 표면 2벌 회피(S3). 상세에서 출고 정보 열람 요구가 생기면 재론.
- **contractingQuote 요약의 타 mode 활용**(예: 전체보기 배지): 파생은 전 mode에 실리지만 소비는 delivery만 — 확장은 별도 결정.

## 9. 테스트·검증

- **순수 lib 신설** `client/src/lib/delivery-info.ts`(TDD 유닛): 프리필 시드 규칙(저장값 우선·빈 필드만·소스 없음 빈 폼) · 제출 정규화(빈 문자열→null·날짜 포맷·sourceQuoteId 유지 규칙) · 셀 요약 라벨(계약/실측 조합·전부 미입력).
- **서버**(실 master, `test:server`): upsert 생성→갱신 왕복 · zod 날짜 게이트 400 · 빈 문자열 정규화 · sourceQuoteId 타 고객 견적 400 · listCustomers 파생(delivery 동봉·contracting 최신 1건 선택·non-contracting 제외·대표 시나리오 lender·시나리오 없음 null). 픽스처 코드는 registry(`fixture-codes.ts`) **선등록**(#214 규칙). 알림 트리거 4테이블 무접촉(crm 스키마만) — notify 가드 불필요.
- **페이지 테스트**: delivery mode 헤더=바디 컬럼 정합 · 차량 셀 계약 차량 폴백 · 출고 정보 셀 요약/미입력.
- **검증**: `typecheck`/`lint` 0 · `test:unit` · `test:server` · `build` + **격리 스택 브라우저 스모크**(계약 진행 견적 마킹 → 팝오버 프리필 실증 → 저장 → psql `customer_deliveries` 대조 → 차량 컬럼 폴백·셀 요약 확인 → 수정 왕복 → byte-exact 원복). 마이그 0036은 스모크 전 실 DB 적용(롤백 = DROP TABLE 마이그).
