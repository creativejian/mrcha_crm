# A1 crm 고객 운영 스키마 설계 (crm.customers + 자식 5테이블)

작성일: 2026-06-17
상태: **design 확정.** 구현은 A2 전환(master 연결) + `crm` 스키마 migrate 시.
성격: ⓐ 트랙 — `crm.quotes`의 `customer_id`가 종속하는 고객 마스터의 **전체 운영 모델**. `crm-quotes-schema-design.md`의 customers 최소 골격을 확장.
연계: `2026-06-17-crm-quotes-schema-design.md`(견적·최소 골격), `2026-06-16-master-supabase-integration.md`(대원칙), `2026-06-17-crm-db-connection-migration-design.md`(A2 전환).

## 배경 / 범위

현재 고객 데이터는 React mock(`client/src/data/customers.ts` + 상세 drawer). 이를 `crm` 운영 스키마로 DB화.

**범위:** `crm.customers`(마스터 + 니즈 1:1 인라인) + `customer_tasks`/`schedules`/`documents`/`memos` + `crm.consultations`(상담 이력).
**범위 밖:** 정산(fee/cost/margin/settlement → 계약·출고 라운드, `crm.quotes`/계약 연계), 고객 리스트·drawer UI ↔ DB 연결(구현 plan), 조직(team) 모델.

## 원칙

- app `public`(profiles/consultations)은 **read·nullable link만**(write 금지, ON DELETE SET NULL).
- **파생값은 앱 레이어**(저장 안 함): `chance` 자동규칙(계약완료→확정), `manage_status`(최종업데이트 일수 → 정상/확인필요/지연/장기방치).
- **진행상태 종속**(status_group→status)은 **앱 검증** — 차량처럼 DB 트리거 강제는 운영 유연성 해쳐 과함.
- business code `CU-YYMM-####` (`ref/business-code-system.md`).

## 테이블 1: crm.customers (마스터 + 운영 + 니즈 1:1 인라인)

```
crm.customers
-- 식별
├ id                    uuid        PK (uuidv7)
├ customer_code         text        UNIQUE  -- CU-YYMM-####
├ app_user_id           uuid        NULL → public.profiles.id (ON DELETE SET NULL)  -- 앱 가입 고객만
├ name                  text        NOT NULL
├ phone                 text
├ residence             text
-- 직군 (2단계)
├ customer_type         text        -- 개인 | 개인사업자 | 법인사업자
├ customer_type_detail  text        -- 개인: 4대보험/프리랜서/무직/주부/기타 · 사업자: 상호명
-- 진행상태 (Q4: 직접 저장, 종속은 앱 검증)
├ status_group          text        -- 1차 (신규/상담중/견적/차량체크/심사서류/관리중/상담완료/계약완료/불발)
├ status                text        -- 2차 (status_group 종속)
├ priority              text        -- 긴급/높음/중간/낮음/보류/완료
├ chance                text        -- 높음/중간/낮음/보류/확정 (계약완료→확정 동기화는 앱)
-- 담당/배정
├ advisor_id            uuid        NULL → public.profiles.id (staff/manager, ON DELETE SET NULL)
├ team                  text        -- 인천본사/상담팀/견적팀/계약팀/출고팀
├ assigned_at           timestamptz NULL
-- 유입 (Q1: 앱 상담 nullable link)
├ source                text        -- 디엘(견적서)/앱 AI상담/대표전화/카카오/추천/...
├ source_consultation_id uuid       NULL → public.consultations.id (ON DELETE SET NULL)
├ received_at           timestamptz
-- 활동 (manage_status는 파생)
├ last_activity_at      timestamptz
├ recontacted           boolean     NOT NULL default false
├ ai_summary            text
-- 니즈 (Q2: 1:1 인라인)
├ need_model            text
├ need_trim             text
├ need_method           text        -- 구매방식 희망
├ need_timing           text        -- 구매시기
├ need_colors           text        -- 외장/내장 희망
├ need_compare          text        -- 비교 차종
├ need_memo             text
-- 메타
├ created_at            timestamptz NOT NULL default now()
└ updated_at            timestamptz NOT NULL default now()
```

## 테이블 2~5: 자식 (1:N, FK→crm.customers ON DELETE CASCADE)

```
crm.customer_tasks      -- 해야할일
├ id uuid PK · customer_id uuid · category text · due text(오늘/내일/이번주/급함/지정)
├ body text · done boolean default false · created_at timestamptz

crm.customer_schedules  -- 예정일정
├ id uuid PK · customer_id uuid · scheduled_date date · scheduled_time text
├ type text(재연락/결정확인/견적/안내/...) · memo text · created_at timestamptz

crm.customer_documents  -- 서류함
├ id uuid PK · customer_id uuid · title text · doc_type text(운전면허증/사업자등록증/...)
├ file_name text · file_size integer · file_mime text · file_path text · sort_order integer · created_at timestamptz

crm.customer_memos      -- 상담메모
├ id uuid PK · customer_id uuid · body text · created_at timestamptz
```

## 테이블 6: crm.consultations (CRM 상담 이력/타임라인)

```
crm.consultations        -- ⚠️ app public.consultations(앱 유입 상담)와 별개. CRM 운영 상담 이력.
├ id uuid PK · customer_id uuid → crm.customers (ON DELETE CASCADE)
├ channel text(전화/카톡/방문/앱) · summary text · status text
├ occurred_at timestamptz · advisor_id uuid NULL → public.profiles.id · created_at timestamptz
```

## 관계도

```
public.profiles ◄┄(nullable: app_user_id, advisor_id)┄ crm.customers ──┬─► crm.customer_tasks
public.consultations ◄┄(nullable: source_consultation_id)┄┘            ├─► crm.customer_schedules
                                                  │                     ├─► crm.customer_documents
crm.quotes ──► crm.customers (customer_id)        │                     ├─► crm.customer_memos
                                                  └─────────────────────┴─► crm.consultations
```

## 진행상태 종속 (참고 — customers.ts 매핑 SSOT)

신규→[상담접수/1차부재중/지속적부재/연락해야함] · 상담중→[구매방식/차량/견적상담중] · 견적→[준비중/발송완료/추후안내예정] · 차량체크→[재고확인중/재고있음/재고없음/대기필요] · 심사서류→[서류상담중/서류안내함/서류대기중/서류받음] · 관리중→[부결후관리/구매시기미도래/추후재컨택/조건재확인] · 상담완료→[재상담대기/구매시기미도래/추후재컨택] · 계약완료→[딜러사계약중/대리점발주중/특판발주중/배정완료/출고완료] · 불발→[계약취소/지속적부재/추후재컨택/구매철회]

## 미결 / 다음

- **chance/manage_status 파생 로직**: 앱(`chanceLabel`/`finalUpdateStatus`)을 CRM 서버/클라로 포팅. 계약완료→확정 동기화 규칙 포함.
- **advisor_id ↔ profiles**: CRM 직원 = master `profiles`(staff/manager). 인증(B4)과 연계 — 직원 계정 매핑은 인증 라운드에서 확정. 그 전엔 nullable.
- **정산**(fee/cost/margin/settlement_status): 계약·출고 라운드에서 별도 테이블(`crm.quotes`/계약 연계).
- **고객번호 생성**: `customer_code` CU-YYMM-#### 채번 로직(시퀀스/RPC) — 구현 plan.
- **구현 순서**: A2 전환(master 연결 + crm migrate)으로 이 테이블들 생성 → 고객 mock ↔ DB 연결(plan).
