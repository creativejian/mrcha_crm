# crm 견적 스키마 설계 (crm.quotes + 최소 crm.customers)

작성일: 2026-06-17
상태: **design 확정. 구현(drizzle migration) 대기 — Phase ① catalog adopt 후 적용.**
성격: ⓐ 트랙(crm 운영 스키마) 첫 타겟 = 견적 저장. 워크벤치(김민준) 견적을 DB화.
연계: `2026-06-16-master-supabase-integration.md`(schema 3분할·대원칙), `2026-06-17-phase1-go-and-verification.md`(Phase ①/adopt 선행).

## 배경 / 범위

master 통합 후 CRM 운영 데이터는 `crm` 스키마(CRM 소유, drizzle 관리)에 둔다. 첫 타겟은 견적 저장. 현재 워크벤치 견적은 React 상태 mock일 뿐 DB 미저장이고, 작성자가 고객이 아니라 **상담사**다.

**이 spec의 범위:** `crm.quotes` + `crm.quote_scenarios` + `crm.customers`의 **최소 골격**(견적이 의존하는 만큼만).
**범위 밖(다음 라운드):** `crm.customers` 전체 운영 모델(진행상태·status_group·담당배정·유입경로·메모·계약/출고), `consultations` 운영 모델, 리스 계산(`lease_calc.ts` 포팅).

## 대원칙 (이 스키마 전반)

1. **snapshot 원칙** — 견적은 "발송 시점 제시값 기록". 차량가·옵션가·색상·할인·계산값을 작성 시점 값으로 저장. catalog/app은 **id 참조(추적) + 값 snapshot 병행** → 원본 가격이 바뀌어도 발송한 견적은 불변. (app `quote_request_options.price_at_request`와 같은 철학)
2. **가변 소품은 JSONB** — 선택 옵션·할인 행은 기록성이고 개별 쿼리 불필요 → 별도 테이블 없이 JSONB snapshot.
3. **금융 시나리오만 정규화** — 견적 1건은 금융 조건 1~3개 비교(각자 독립 lock 상태) → 별도 row.
4. **app 견적은 nullable 출처 참조** — `public` write 안 함(read·link만). 솔루션 조회/원본 인식으로 가져온 경우만 출처 id link.
5. **외부/카탈로그 참조 FK는 전부 nullable + ON DELETE SET NULL** — snapshot이 견적을 성립시키므로 참조가 사라져도 견적 보존.
6. **business code** — 고객 `CU-YYMM-####`, 견적 `QT-YYMM-####` (`ref/business-code-system.md`).

## 테이블 1: crm.customers (최소 골격)

```
crm.customers
├ id              uuid        PK (uuidv7)
├ customer_code   text        UNIQUE  -- CU-YYMM-####
├ app_user_id     uuid        NULL → public.profiles.id (ON DELETE SET NULL)
├ name            text        NOT NULL
├ phone           text
├ created_at      timestamptz NOT NULL default now()
└ updated_at      timestamptz NOT NULL default now()
```

**핵심 가정: CRM 고객 ⊋ app 고객.** 전화·소개 유입 고객은 앱 미가입이라 `profiles`가 없다(app `consultations.user_id` nullable이 근거). 그래서 `crm.customers`를 **자체 마스터**로 두고 app `profiles`를 **선택적 link**(`app_user_id` nullable). 앱 가입 고객은 link, 비가입 상담 고객도 CRM에 존재 가능.

> 운영 필드(진행상태·담당·유입·메모·계약/출고)는 다음 라운드에서 이 테이블에 확장.

## 테이블 2: crm.quotes (견적 1건 = 공유 본체 + 운영상태)

견적함 1 row = 견적 1건(시나리오 1~3 묶음). 견적함 표시는 대표 시나리오(`primary_scenario_id`) 기준.

```
crm.quotes
-- 식별 / 메타
├ id                    uuid        PK (uuidv7)
├ quote_code            text        UNIQUE  -- QT-YYMM-####
├ customer_id           uuid        NOT NULL → crm.customers.id (ON DELETE RESTRICT)
├ entry_mode            text        -- manual | solution | original
├ quote_round           text        -- 1차/2차... (표시용 차수)
-- app 출처 (nullable, ON DELETE SET NULL)
├ source_quote_request_id  uuid     NULL → public.quote_requests.id
├ source_ai_estimate_id    uuid     NULL → public.ai_estimates.id
-- 차량 (id 참조 + snapshot)
├ trim_id               bigint      NULL → catalog.trims.id (ON DELETE SET NULL)
├ brand_name            text        -- snapshot
├ model_name            text        -- snapshot
├ trim_name             text        -- snapshot
├ base_price            numeric     -- snapshot (작성 시점 기본가)
-- 색상 (id 참조 + snapshot)
├ exterior_color_id     bigint      NULL → catalog.colors.id (ON DELETE SET NULL)
├ exterior_color_name   text        -- snapshot
├ exterior_color_hex    text        -- snapshot
├ interior_color_id     bigint      NULL → catalog.colors.id (ON DELETE SET NULL)
├ interior_color_name   text        -- snapshot
├ interior_color_hex    text        -- snapshot
-- 옵션 (JSONB snapshot)
├ options               jsonb       -- [{trim_option_id, name, price}]
├ option_total          numeric     -- snapshot 합계
-- 할인 (JSONB snapshot)
├ discount_lines        jsonb       -- [{label, amount, unit}]  unit: amount|percent
├ final_discount        numeric     -- snapshot 합계
-- 취득원가 (snapshot)
├ acquisition_tax       numeric
├ acquisition_tax_mode  text        -- normal | hybrid | electric | manual
├ bond                  numeric     -- 공채
├ delivery              numeric     -- 탁송료
├ incidental            numeric     -- 부대비용
├ final_vehicle_price   numeric     -- = base + option_total - final_discount (snapshot)
├ acquisition_cost      numeric     -- = final_vehicle_price + 등록비용 (snapshot)
-- 운영 상태
├ status                text        -- 작성중/발송대기/... (CRM 내부)
├ app_status            text        -- draft | queued | sent | viewed
├ decision_status       text        -- none | considering | confirmed | contracting
├ stock_status          text
├ valid_until           timestamptz NULL  -- 유효기간(=화면 D-day 산출원)
├ note                  text
├ primary_scenario_id   uuid        NULL → crm.quote_scenarios.id  -- 견적함 대표 표시
-- 원본 파일 (entry_mode=original)
├ file_name             text        NULL
├ file_size             integer     NULL
├ file_mime             text        NULL
├ file_path             text        NULL  -- 저장소 참조(Supabase Storage 등)
-- 이력
├ revision              integer     NOT NULL default 0
├ sent_at               timestamptz NULL
├ viewed_at             timestamptz NULL
├ created_at            timestamptz NOT NULL default now()
└ updated_at            timestamptz NOT NULL default now()
```

## 테이블 3: crm.quote_scenarios (금융 비교 1~3)

```
crm.quote_scenarios
├ id                    uuid        PK (uuidv7)
├ quote_id              uuid        NOT NULL → crm.quotes.id (ON DELETE CASCADE)
├ scenario_no           smallint    -- 1 | 2 | 3
├ is_saved              boolean     NOT NULL default false  -- "n번 조건 저장" lock
├ saved_at             timestamptz  NULL
-- 금융 조건
├ purchase_method       text        -- 운용리스/장기렌트/금융리스/할부/일시불...
├ lender                text        -- 금융사
├ term_months           smallint    -- 12/24/36/48/60
├ deposit_mode          text        -- none | amount | percent
├ deposit_value         numeric
├ down_payment_mode     text        -- none | amount | percent  (선수금)
├ down_payment_value    numeric
├ residual_mode         text        -- max | amount | percent   (잔존가치)
├ residual_value        numeric
├ mileage_mode          text        -- basic | custom           (약정거리)
├ mileage_value         text        -- 예: "20,000km / 년"
├ car_tax_included      boolean     -- 자동차세 포함 여부
├ subsidy_applicable    boolean     -- 보조금 해당 여부
├ subsidy_amount        numeric
-- 계산값 (snapshot; 실제 계산은 lease_calc 포팅 후 — 현재 입력/외부수신값 보관)
├ monthly_payment       numeric
├ total_return_cost     numeric
├ total_takeover_cost   numeric
├ due_at_delivery       numeric
├ interest_rate         numeric     -- 금리(%)
├ created_at            timestamptz NOT NULL default now()
└ updated_at            timestamptz NOT NULL default now()
   UNIQUE (quote_id, scenario_no)
```

## 관계도

```
public.profiles ◄┄(nullable)┄ crm.customers ◄── crm.quotes ──► crm.quote_scenarios (1~3)
                                                  │  ▲ primary_scenario_id
                                                  ├─(nullable)─► public.quote_requests
                                                  ├─(nullable)─► public.ai_estimates
                                                  ├─(nullable)─► catalog.trims
                                                  └─(nullable)─► catalog.colors (외장/내장)
```

## FK 도구 경계 주의

- `crm.* → catalog.*` FK: 둘 다 drizzle 관리 → 정상.
- `crm.* → public.*` FK(profiles/quote_requests/ai_estimates): cross-schema, public은 앱 소유. **실테이블 참조**(view 아님), 전부 nullable + ON DELETE SET NULL. drizzle은 public을 관리하지 않으므로 이 FK는 introspect/수동 정의로 추가(public 테이블을 drizzle이 CREATE/DROP하지 않도록 주의).
- **순환 참조**: `quotes.primary_scenario_id → quote_scenarios.id`와 `quote_scenarios.quote_id → quotes.id`는 순환. `primary_scenario_id`는 nullable로 두고 시나리오 INSERT 후 UPDATE로 지정(또는 DEFERRABLE FK).

## 미결 / 다음

- **계산값**: `monthly_payment`·총비용·금리는 현재 mock/외부수신. `lease_calc.ts` 포팅 후 실제 계산(별개 작업). 지금은 snapshot 컬럼만 확보.
- **customers 전체 운영 모델**(진행상태·담당·유입·메모·계약/출고) = A1 다음 라운드에서 customers 확장.
- **워크벤치 ↔ DB 연결**: 현재 mock 저장(`saveQuoteFromWorkbench`)을 이 스키마에 매핑하는 작업은 구현 plan에서.
- **구현 순서**: Phase ① 적용 + catalog adopt(introspect baseline) → `crm` 스키마 drizzle generate/migrate → 워크벤치 저장 연결.
- **drizzle 주의**: `schemaFilter ["catalog","crm"]`, `db:push` 금지(generate→migrate). public 테이블은 절대 CREATE/DROP 대상에 포함하지 않음.
