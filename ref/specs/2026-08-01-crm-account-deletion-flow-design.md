# CRM 회원탈퇴 처리 플로우 — 구현 스펙 (2026-08-01)

> 정책 SSOT = `ref/2026-08-01-app-account-deletion-crm-reply.md`(회신)와 앱 원문
> `reference/operations/app-account-deletion-crm-handoff.md`. 이 문서는 그 정책의 **CRM 구현
> 순서·데이터 모델·UI 배선**만 다룬다. 이사님 확정(2026-08-01): 탈퇴 인지 큐(비활성·알림·
> 탈퇴확인 버튼) 필수 · 오늘 앱 UI/UX + 정책 반영 + CRM 구현 완결 목표.

## 1. 전체 플로우 (한눈에)

```
앱: 회원탈퇴 → 즉시 접근·FCM 차단 → CRM POST /api/app/account-deletion {appUserId}
                                          │
CRM: 연결 고객 없음 ──────────────→ 200 purged (잡 기록만, 큐 불요)
     연결 고객 있음 → 잡 생성(received) + 자동 분류 제안 → 202 review_pending
                      ├ 고객 행 "탈퇴 접수" 배지 + 대고객 액션 차단
                      ├ 담당자·관리자 알림(화면 + Discord)
                      ├ 탈퇴확인 버튼 → 분류 확정 → 즉시 실행
                      ├ D+3 미확인 → Discord 재촉
                      └ D+5 미확인 → 자동 실행(PURGE 제안=PURGE · B/C 후보=C-스켈레톤 폴백)
                                          │
앱: 폴링(POST 재호출 멱등) → 200 purged/retained 수신 → profiles·auth.users 삭제
```

- **확인 = 가속기**(전제조건 아님 — D+5 자동 실행이 SLA 방어선). **확인 = 인지+분류 확정**
  (삭제 거부권 아님).
- SLA 5일 = 표준 개인정보 보호지침 "5일 이내" 파기 기준(상한, 연장 불가).

## 2. 데이터 모델 (마이그레이션 4건)

### 2a. `crm.account_deletion_jobs` (신규)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `app_user_id` | uuid **UNIQUE** | 멱등 키. 실행 완료 + 30일 후 NULL화(잔존 PII 최소화 — §6 정리 잡에 편승) |
| `customer_id` | uuid nullable | 연결 고객(없으면 NULL — 즉시 종결 케이스) |
| `customer_code` | text nullable | 알림·감사 표시용(이름 저장 금지) |
| `proposed_classification` | text | `purge \| active_fulfillment \| settlement_reference`(자동 제안) |
| `confirmed_classification` | text nullable | 탈퇴확인에서 확정된 값 |
| `status` | text | `received \| executed`(+ `executed_via` = `confirm \| auto`) |
| `requested_at` / `confirmed_at` / `executed_at` | timestamptz | D+3/D+5 판정 기준 = `requested_at` |
| `confirmed_by` | uuid nullable | JWT sub(loose id 관례) |

- 자동 분류 제안 규칙(회신 §1): `customer_deliveries` 계약·출고 날짜 신호. 판정은 서버가
  잡 생성 시 1회 계산해 저장(화면·자동 실행이 같은 값을 봄).
- CHECK로 닫힌 어휘 잠금(레포 관례 `inListCheck`).

### 2b. 기존 테이블 변경

1. `customers` + `retention_basis` text · `retention_until` timestamptz (B 분류 전용).
2. `customer_deletions.name` → nullable (탈퇴발 삭제 = name·app_user_id 미기록).
3. `crm.settlement_references` 신규 — 회신 §2-C 컬럼 그대로(lender·product·settlement_no·
   contract_ref·amount·expected_date·settled_date·status·clawback_until). 고객명·연락처 금지.
   `status` = `pending \| settled \| review_required \| legal_hold`(CHECK).

⚠️ 마이그레이션은 `db:generate` → `db:migrate`만, `schemaFilter:["crm"]`(AGENTS.md — db:push 금지).

## 3. 서버 (라우트·SSOT)

### 3a. 엔드포인트 — `src/routes/app-account-deletion.ts` (신규)

- `POST /api/app/account-deletion` body `{ appUserId }` — 인증: **공유 시크릿 헤더**
  `X-Deletion-Secret`(env `APP_DELETION_SECRET` — CF 대시보드 + 앱 Edge secret 양쪽 등록.
  X-Push-Secret 선례의 역방향). JWT 게이트 아님(호출자가 앱 Edge Function).
- 멱등: `app_user_id` UNIQUE upsert — 재호출은 현재 상태 반환(202 또는 200).
- 응답 계약 = 회신 §4 표 그대로. 연결 고객 없음 = 즉시 `200 purged`.
- ⚠️ 이 라우트는 SSE 아님(스트리밍 3종 전제 불요). 트랜잭션은 `c.var.db.transaction()`.

### 3b. unlink SSOT — `applyAppUserUnlink` (`src/db/queries/app-user-link.ts`에 추가)

- 입력 `(appUserId, mode: 'purge' | 'materialize', ex)` / 반환
  `{ customerId, customerCode, materializedPhone } | null`(연결 고객 없음 = 멱등 no-op).
- `materialize` = **단일 UPDATE**로 `app_user_id=NULL, phone=profiles.phone_number` 동시
  기록(CHECK `customers_phone_app_exclusive_check`는 행 단위 평가라 통과). `updated_at`은
  `sql\`now()\``(#334 DB 시계 규칙).
- **profiles 생존 중 호출 필수**(번호 read) — 앱이 CRM 성공 전 profile을 안 지우는 계약이 보장.

### 3c. 실행 경로 — `src/db/queries/account-deletion.ts` (신규, #212 변형)

| 분류 | 동작 |
|---|---|
| PURGE | `deleteCustomer` 로직 재사용하되 ①**발송 카드 409 가드 생략**(카드 회수가 의도 — `deleteQuote`가 advisor_quotes 회수까지 SSOT) ②감사행 **익명 기록**(name·app_user_id NULL) ③`consultation_dismissals` 정리(public.consultations를 **read로** user_id 조회 → 해당 id 행 삭제) |
| B (active_fulfillment) | `applyAppUserUnlink('materialize')` → 필드 스크럽(니즈 전 필드·ai_summary·hash·phone_secondary·source id류 NULL) → 자식 중 **서류·메모·상담·견적(+카드 회수)·임베딩 삭제**, deliveries·schedules 유지 → `retention_basis`·`retention_until` 기록 |
| C (settlement_reference) | deliveries 데이터로 `settlement_references` 행 생성(개인정보 0) → PURGE와 동일 삭제 |

- Storage 삭제는 기존 관례: 트랜잭션 안 경로 수집 → 커밋 후 `removeObjects`(단일 버킷
  `customer-documents`).
- ⚠️ `deleteQuote`의 advisor_quotes DELETE는 운영 알림 트리거 대상 아님(트리거는
  INSERT/`sent_at` UPDATE만 — AGENTS.md 표). 추가 가드 불요.

### 3d. D+3/D+5 잡 — CF Workers cron trigger (`wrangler.jsonc` `triggers.crons`, 일 1회)

- `received` 잡 중 `requested_at` 경과 D+3 → Discord 재촉 1회 / D+5 → 자동 실행
  (`proposed_classification` purge → PURGE, b/c 후보 → **C-스켈레톤 폴백**).
- ⚠️ Discord/외부 fetch는 **plain call**(Workers Illegal invocation 함정 — AGENTS.md).
- Discord 웹훅 URL은 신규 env(`DELETION_DISCORD_WEBHOOK`) — **이사님에게 채널·웹훅 수령 필요**
  (미수령 시 화면 알림만으로 1차 출시, Discord는 배선만 준비).

### 3e. 대고객 액션 서버 차단

- 견적 발송(`customers.send`)·채팅 개입 등 대고객 경로에 "탈퇴 접수 고객" 409 게이트
  (`account_deletion_jobs.status='received'` 조회). 클라 숨김만으로는 불충분(직접 호출 방어).

## 4. UI (클라)

1. **목록·드로어 배지** — "탈퇴 접수"(비활성 톤). 목록 행 흐림 + 드로어 상단 배너.
2. **알림** — 고객 목록 상단 인박스 패턴 재사용(앱 상담신청 인박스 선례): "회원탈퇴 N건 확인
   대기". 클릭 → 해당 고객 필터.
3. **탈퇴확인 버튼**(드로어 배너 안) — 자동 분류 제안 + 근거(계약일·출고일) 표시, 담당자/
   관리자가 분류 확정 → 실행. C 확정 화면에서 `clawback_until` 입력(모르면 비움 =
   review_required). 권한: admin + 담당자(`advisor-assign-access` 선례 참조해 SSOT lib로).
4. ConfirmPopover·`use-popover-viewport-close` 등 기존 공용 컴포넌트 사용(신규 팝오버 금지 관례).

## 5. 구현 순서 (오늘 — PR 분할 제안)

| 순서 | 내용 | 완결 조건 |
|---|---|---|
| PR-1 | 마이그레이션 4건 + `applyAppUserUnlink` + 실행 경로 3분류 + 단위·실DB 테스트 | `test:unit`·`test:server` green |
| PR-2 | 엔드포인트 + 잡 상태기계 + 시크릿 배선 + cron(D+3/D+5) | 라우트 테스트 + 로컬 curl 실측 |
| PR-3 | UI(배지·인박스·탈퇴확인) + 대고객 액션 차단 | 실기 스모크(magiclink) |
| 후속(오늘 밖 허용) | 업무 AI 일괄 정리·30일 rolling·provenance 계측 / `customer_deletions` 기존 행 backfill | 앱 **출시 게이트**는 일괄 정리만(원문 §4) — rolling·계측은 30일 내 후속 가능 |

## 6. 테스트 주의 (공유 master — 반드시)

- 새 픽스처 접두사(`CU-…` 등)는 **`src/test-utils/fixture-codes.ts` registry 선등록**.
- DB 의존 테스트는 **`src/test-utils/db-bound-tests.ts` 등록**(test:pure fail-closed).
- advisor_quotes를 만드는 픽스처는 `withNotifyGuard`/`guardedDb`(AGENTS.md 표 참조).
- 스탬프 전진 단언은 DB 안 비교(`updated_at > created_at`) — JS Date 금지(#334).

## 7. 앱 쪽 의존성 (이사님·영실 확인 필요)

1. 앱 탈퇴 오케스트레이터가 이 엔드포인트를 호출하고 **200 수신 전 profile 미삭제** 준수.
2. `APP_DELETION_SECRET` 값 교환(양쪽 env 등록).
3. Discord 재촉 채널·웹훅 URL.
4. 폴링 주기·중단 조건(권장: 1시간 간격, `200` 수신 시 종료).
