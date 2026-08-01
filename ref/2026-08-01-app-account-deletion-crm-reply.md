# 앱 회원탈퇴 CRM 처리 계약 — CRM 회신 (2026-08-01)

> **상태: 초안 — 유슨생·이사님 검토 전(발신 금지).** 정책성 항목은 전부 **원문(이사님 문서)의
> 정책에서 도출한 기본값으로 확정**해 두었습니다 — 이견이 있는 항목만 말씀주시면 됩니다
> (기본값 + 거부권, 말미 §11 모음). 나머지는 코드·스키마 실측 기반 기술 회신.
>
> 원문: 앱 레포 `reference/operations/app-account-deletion-crm-handoff.md` (2026-08-01)

## 결론 요약

**4분류 체계와 "CRM 성공 → profile 삭제" 선행 순서 모두 CRM 구조에서 수용 가능합니다.**
기존 고객 하드 삭제 SSOT(#212 `deleteCustomer`)가 PURGE의 8할을 이미 구현하고 있고,
전화번호 소유권 계약(#276)의 CHECK 불변식도 B 분류의 phone materialize와 충돌하지 않습니다
(단일 UPDATE로 순서 문제 없음). 신규 작업은 ①unlink SSOT ②탈퇴 엔드포인트 ③retention
컬럼·정산 테이블 마이그레이션 ④업무 AI provenance·rolling 삭제 ⑤**탈퇴 인지 큐 UI**(§1 —
이사님 결정 2026-08-01: 즉시 삭제 대신 배지·알림·탈퇴확인 경유) — 전부 CRM 몫으로 수용합니다.

DB project 일치 여부(§말미 질문)는 **실측으로 일치 확인 완료** — 아래 §9.

---

## 1. 분류 수용 여부 — 수용

`PURGE` · `ACTIVE_FULFILLMENT` · `SETTLEMENT_REFERENCE` 3분류 수용. `LEGAL_HOLD`는 별도
저장소가 아니라 **정산 레코드의 상태값**(`status = 'legal_hold'`)으로 구현합니다 — 원문
§2-C "실제 환수·분쟁이 생긴 건만 전환"과 정합하고, 4번째 데이터 모델을 만들 이유가 없습니다.

**분류 판정 주체 제안** (원문에 미정의 — CRM 안):

| 신호 (실측 가능 데이터) | 자동 판정 |
|---|---|
| `customer_deliveries` 행 없음, 또는 `contract_date`·`delivered_date` 모두 NULL | **PURGE 제안** (다수 케이스 예상) |
| `contract_date` 있음 · `delivered_date` NULL | **B 후보** |
| `delivered_date` 있음 | **C 후보** |

자동 판정은 **제안값**이고, 실행은 분류와 무관하게 아래 인지 큐를 경유합니다.

B/C 후보를 자동 확정하지 않는 이유: 원문 §2-B "금융사·판매사가 출고 연락을 전부 인수했다면
B를 쓰지 않는다"는 데이터로 판정 불가(사람 판단). 이 규칙은 새 정책이 아니라 **원문 §2
"계약 전 = PURGE"의 기계적 번역**입니다 — 계약·출고 흔적이 하나라도 있으면 자동으로 지우지
않고 사람 확인으로 넘기므로 오삭제 위험이 없습니다(별도 확정 불요, 보고로 갈음).

### 탈퇴 인지 큐 — 즉시 삭제하지 않는다 (이사님 결정 2026-08-01 · 내부정책)

앱 탈퇴가 CRM 고객 데이터를 담당자 인지 없이 곧바로 지우는 일방향을 막기 위해, **분류와
무관하게 모든 탈퇴 건은 인지 큐를 경유**합니다:

1. **탈퇴 접수(D+0)**: 고객 행에 "탈퇴 접수" 배지(목록 비활성 표시) + 앱 발송·채팅 등 대고객
   액션 차단 + 담당자·관리자 알림(CRM 화면 + Discord).
2. **탈퇴확인 버튼**: 담당자 또는 관리자가 자동 분류 제안(PURGE/B/C)을 보고 확정 → 그
   자리에서 실행 → 앱에 성공 상태 전달.
3. **미확인 시**: D+3 Discord 재촉 → **D+5 자동 실행**(PURGE 제안 건은 PURGE, B/C 후보 건은
   §4 폴백).

원칙 2가지:
- **확인은 삭제의 전제조건이 아니라 가속기** — 전체 SLA 5일은 확인 없이도 지켜진다(담당자
  부재가 계약 위반으로 이어지지 않는다).
- **확인 버튼의 의미는 "인지 + 분류 확정"이지 삭제 거부권이 아니다** — 원문 §2-A "향후 영업
  목적은 보존 근거가 아니다"는 인지 큐에서도 그대로 유효하다.

## 2. 분류별 남길 필드·삭제 목록

### PURGE — 기존 #212 `deleteCustomer` 재사용 + 탈퇴 전용 차이 2가지

`crm.customers` 행 삭제 시 FK CASCADE로 자식 7종이 함께 삭제됩니다(스키마 실측):
`customer_tasks` · `customer_schedules` · `customer_documents` · `customer_memos` ·
`consultations`(crm) · `embeddings`(customer_profile 포함 전 source type) · `customer_deliveries`.

견적은 견적당 `deleteQuote()` SSOT 호출 — `quote_scenarios` CASCADE, 견적 임베딩,
**`public.advisor_quotes` 카드 회수 + 견적요청 completed→open 복원**까지 한 함수가 처리합니다.
→ **앱은 `advisor_quotes`를 선삭제할 필요 없습니다**(CRM 탈퇴 경로가 회수. 이후 앱의 profile
CASCADE와 겹쳐도 무해).

Storage: `customer-documents` 버킷 단일(서류 `file_path`·`thumb_path` + 견적 원본
`file_path`) — 트랜잭션 안에서 경로 수집, 커밋 후 `removeObjects` 일괄 삭제(기존 구현 그대로).

원문 §3 정리 대상별 처리:

| 항목 | 처리 |
|---|---|
| `customers.app_user_id`·`featured_request_id`·`source_consultation_id` | 행 삭제로 소멸 |
| `quotes.source_quote_request_id`·`source_ai_estimate_id` | 견적 행 삭제로 소멸 |
| `consultation_dismissals` | 해당 유저의 `public.consultations` id를 **read로 조회**(read-only 경계 준수) 후 그 id의 dismissal 행 삭제 — 탈퇴 경로에 추가 |
| quote-request source 임베딩 | `embeddings.source_type='quote_request'`는 고객 CASCADE에 포함(`customer_id` FK) — 자동 소멸 |
| customer_profile 임베딩·`ai_summary`·hash | 위와 동일 CASCADE / 컬럼은 행과 소멸 |
| 업무 AI 메시지 | §7 참조(현 구조 한계 포함) |
| `customer_deletions` 감사행 | §6 참조 |
| `phone_secondary`·need 스냅샷·메모·문서·일정 | 행·CASCADE로 소멸 |

**기존 #212와의 차이(탈퇴 전용 경로에서만)**:
1. **발송 카드 409 가드 생략** — 기존 가드는 "상담사 실수로 앱 카드 연쇄 삭제" 방지용인데,
   탈퇴에서는 카드 회수가 의도 그 자체입니다. 탈퇴 고객일수록 발송 카드 보유가 일반적이라
   가드를 유지하면 PURGE가 항상 409로 죽습니다.
2. **감사행 익명 기록** — §6.

### ACTIVE_FULFILLMENT — `customers` 행 유지 + 화이트리스트 스크럽

| 구분 | 내용 |
|---|---|
| **유지** | `name` · `phone`(materialize — §3) · `advisor_id`/`advisor_name`/`team` · `customer_deliveries`(차량·금융사·계약일) · `customer_schedules`(출고 일정) |
| **삭제/NULL** | 서류·메모·상담·견적(+카드 회수)·임베딩 전량 · `ai_summary`/hash · need 스냅샷 전 필드 · `app_user_id`·`featured_request_id`·`source_consultation_id` · **`phone_secondary`**(원문 §3 "필요성 없는" 목록 준수 — 기본 삭제) |
| **신규 컬럼** | `retention_basis` text · `retention_until` timestamptz (원문 §2-B 필수 요건) — 마이그레이션 1건 |

`featured_request_id` NULL화 부수효과: need 파생 필드 read-only 판정 기준이 이 컬럼이라(설계
D2) 보존 고객의 니즈 필드가 수기 입력 가능으로 풀립니다 — 스크럽 후 상태와 정합(문제 없음).
`retention_until` 도래 시 처리는 §4의 잡이 담당(연락처·개인정보 파기 = PURGE로 수렴).

### SETTLEMENT_REFERENCE — 신규 테이블 `crm.settlement_references`

고객 행은 PURGE와 동일하게 삭제하고, 원문 §2-C 목록 그대로 분리 저장:

```
lender(금융사) · product(상품) · settlement_no(정산번호) · contract_ref(계약 참조번호)
· amount(정산금액) · expected_date(정산 예정일) · settled_date(정산일)
· status(pending | settled | review_required | legal_hold) · clawback_until
```

고객명·전화·이메일·앱 user ID·상담·AI 요약 **미포함**. `review_required` = `clawback_until`
미확정 상태(무기한 보존 아님 — 원문 §2-C 준수). 이 테이블은 업무 AI corpus source type에
**추가하지 않습니다**(원문 §4 "legal hold·회계 자료 임베딩 제외" — source type이 닫힌
목록이라 미등록 = 구조적 제외, fail-closed).

세금계산서·입금 증빙의 B2B 회계 보관소 소유 원칙 동의 — CRM은 그 원본을 저장하지 않습니다.

## 3. unlink SSOT — `applyAppUserUnlink` 신규 (link와 같은 파일)

| 항목 | 내용 |
|---|---|
| 위치 | `src/db/queries/app-user-link.ts` — `applyAppUserLink`와 한 파일(대칭 SSOT, 드리프트 방지) |
| 입력 | `appUserId` + `mode: 'purge' \| 'materialize'` + `Executor`(트랜잭션 합류 — 기존 관례) |
| 반환 | `{ customerId, customerCode, materializedPhone: string \| null } \| null`(연결 고객 없음) |
| 멱등성 | `app_user_id`로 조회, 없으면 **성공 no-op**(null 반환) — 재시도·재호출 안전 |

`materialize` 모드는 **단일 UPDATE**로 `app_user_id = NULL, phone = profiles.phone_number`를
동시에 씁니다 — CHECK `customers_phone_app_exclusive_check`는 행 단위 평가라 같은 statement
안에서 둘 다 바뀌면 통과합니다(순서 문제 없음). 단 **`profiles`가 살아 있는 동안 호출**되어야
번호를 읽을 수 있습니다 → "CRM 성공 → profile 삭제" 순서 계약과 정합(이 순서가 기술적으로도
필수라는 뜻).

## 4. 성공 상태·오류 계약 — 동기 우선 + 후보 건만 비동기

같은 master DB이므로 CRM은 자기 몫을 **한 트랜잭션**으로 처리합니다(원자성 보장).
앱↔CRM 경계는 HTTP로 제안합니다(트리거·직접 SQL보다 계약이 명시적):

**`POST /api/app/account-deletion`** — body `{ appUserId }`, 인증 = 공유 시크릿 헤더
(`X-Push-Secret` 선례의 역방향, 시크릿은 양쪽 env). 멱등 키 = `appUserId`.

| 응답 | 의미 | 앱 행동 |
|---|---|---|
| `202 { status: "review_pending" }` | 접수 완료 — **모든 건의 D+0 기본 응답**(§1 인지 큐 경유) | 폴링(같은 POST 재호출 — 멱등) 또는 `GET /api/app/account-deletion/status?appUserId=` |
| `200 { status: "purged" }` | PURGE 실행 완료(탈퇴확인 또는 D+5 자동) | profile/Auth 삭제 진행 |
| `200 { status: "retained", classification }` | B/C 확정·unlink 완료 | profile/Auth 삭제 진행 |
| `5xx` / timeout | 일시 오류 | **재시도 안전**(멱등) — backoff 재시도 |

**SLA(최대 5 calendar days) 내 타임라인**: D+0 접수 — 배지·대고객 액션 차단·담당자 알림(§1
인지 큐) → **탈퇴확인 시 그 자리에서 실행** → D+3 미확인 시 Discord 운영 escalation →
**D+5 자동 실행**(PURGE 제안 건은 PURGE 그대로, B/C 후보 건은 폴백 = "C-스켈레톤 보존 +
나머지 PURGE" — 개인정보 0인 정산 참조만 남기고 파기). 폴백 방향은 원문 원칙("기간 미확정은
무기한 보존이 아니다")을 그대로 따른 것으로, 반대 방향(미결정 시 계속 보유)은 원문 정책
위반이라 대안이 아닙니다 — 기본값으로 확정.

**SLA 5일의 근거(2026-08-01 확인)**: 임의 수치가 아니라 개인정보보호법 제21조 "지체 없이
파기"를 개인정보보호위원회 **표준 개인정보 보호지침**이 "처리가 불필요한 것으로 인정되는
날로부터 **5일 이내**"로 구체화한 실무 기준입니다. 따라서 5일은 연장 가능한 협의값이 아니라
**상한**으로 취급합니다(여유가 필요해지면 레버는 SLA 연장이 아니라 앱 쪽 탈퇴 유예기간 —
유예 만료일이 파기 시계의 기산점이 됨. 현행 앱 정책은 즉시형이라 해당 없음).
상태 영속·감사용으로 `crm.account_deletion_jobs` 얇은 테이블 1개를 둡니다(요청·판정·처리
시각·처리자 — PII 없음).

## 5. `clawback_until` 원천 — CRM에 데이터 없음, 건별 수동 입력 제안

실측: CRM이 가진 금융사 정보는 `customer_deliveries.lender`(자유 텍스트 스냅샷)뿐이고
금융사·상품별 환수 기간 데이터는 0입니다. 금융사별 기간 마스터 테이블을 새로 만들지 않고
**건별 수동 입력**으로 합니다(정산 건 자체가 저빈도). 별도 입력 책임자 임명은 불필요 —
조직 결정이 아니라 화면 흐름으로 흡수합니다:

- **C로 확정하는 그 담당자가 확정 화면에서 함께 입력**(금융사 계약 기준)
- 모르면 비워두고 `review_required` 상태로 남음(원문 §2-C "기간 미확정은 무기한 보존이
  아니라 review_required" 그대로)

## 6. `customer_deletions` PII 감사행 — 수용, 마이그레이션 1건

실측: 현 스키마는 `name` **NOT NULL** + `app_user_id` 기록. 조치:

1. 마이그레이션: `name` nullable화.
2. **탈퇴발 삭제는 `name`·`app_user_id` 미기록** — 감사 목적("누가·언제·무엇을")은
   `customer_id`·`customer_code`·`deleted_by`·`deleted_at`으로 충분.
3. 기존 행은 **전체 익명화 backfill**(name·app_user_id 전 행 NULL)로 확정. 감사 기능은
   고객코드·처리자·시각으로 온전히 유지되고 이름은 감사에 필요 없습니다. 앱 연결분만
   반쪽 소급하면 "왜 이 행엔 이름이 남았나"를 계속 설명해야 해서 규칙 하나가 더 쌉니다.

## 7. 업무 AI — 권고 4건 모두 수용, 구조 한계 1건은 계약에 명시 필요

원문 §4의 진단(고객 FK 없음·content 내 고객명 추적 불가)은 실측과 정확히 일치합니다.
보강: `sources` jsonb에 `customerId`가 있어 **assistant 턴의 RAG 근거는 부분 추적 가능**하나
user 턴·도구 결과 본문은 불가.

| 권고 | 수용 | CRM 구현 |
|---|---|---|
| 출시 전 기존 메시지 일괄 정리 | ✅ | 전량 삭제(내부 도구·현재 100행 수준). 원문 §4가 직접 권고한 항목이라 별도 승인 불요 — 실행 시점만 직원(송실장·유슨생)에게 사전 공지 |
| 30일 rolling retention | ✅ | 일 1회 삭제 잡 — CF Workers cron trigger 제안(Workers 전환 완료라 가능. pg_cron 대안) |
| turn ID·subject provenance | ✅ | `assistant_messages`에 `turn_id` uuid + `subject_customer_ids` uuid[] 추가. 도구 호출 인자·RAG sources에서 수집(계측 신규) |
| 탈퇴·파기 시 관련 turn 삭제 | ✅ | provenance 도입 후 = `subject_customer_ids @> [고객id]` turn 삭제. **도입 전 과거분·user 턴 자유 텍스트는 구조적으로 완전 추적 불가 → 30일 rolling이 상한 방어선** — 이 한계를 계약에 명시하는 게 정직합니다 |
| legal hold·회계자료 임베딩 제외 | ✅ | §2-C — corpus source type 미등록으로 구조적 제외 |

## 8. 재가입 수동 연결 — 수용 (현행 설계와 이미 일치)

- 자동 연결 경로는 지금도 없습니다: phone 매칭 후보 = **앱 미연결 고객만**, 연결은 스태프의
  명시 조작(`applyAppUserLink`)뿐.
- PURGE 고객은 행이 소멸해 매칭 대상 자체가 없음. B 보존 고객은 phone이 materialize돼 매칭
  후보에 뜰 수 있으나 **후보 표시까지만** — 직원이 본인·거래 확인 후 수동 연결(원문 §6
  "본인·거래 확인 뒤 수동 연결"과 동일).
- 원문 §6 "재가입해도 과거 앱 기록 미복원"(앱 몫) 인지·동의.

## 9. DB project 일치 확인 — ✅ 일치 (실측 2026-08-01)

| 항목 | project ref |
|---|---|
| CRM `.env.local` `DATABASE_URL`(pooler 사용자명) | `wmkbmlespgzkeekliwio` |
| CRM `SUPABASE_URL` · `VITE_SUPABASE_URL` | `wmkbmlespgzkeekliwio` |
| CRM `supabase/.temp/project-ref` (linked) | `wmkbmlespgzkeekliwio` |
| 앱 `supabase/.temp/project-ref` (linked) | `wmkbmlespgzkeekliwio` |

**불일치 정황의 실체**: CRM `.env.local` 9행에 **주석 처리된 구 `DATABASE_URL`**(다른
project — master 통합 A2 이전 CRM 전용 DB 잔재)이 남아 있었습니다. 활성 변수는 전부 앱과
같은 master project입니다. 혼동 방지를 위해 주석 줄 삭제를 권고합니다(회신과 별개 정리).

## 10. CRM 신규 작업 목록 (구현 단계 견적용)

> 구현 스펙(데이터 모델·라우트·UI·PR 분할·테스트 주의) =
> `ref/specs/2026-08-01-crm-account-deletion-flow-design.md`

1. 마이그레이션 4건 — `retention_basis`/`retention_until` · `settlement_references` ·
   `customer_deletions.name` nullable · `assistant_messages` provenance 2컬럼
2. `applyAppUserUnlink` SSOT + 테스트
3. 탈퇴 엔드포인트(`/api/app/account-deletion`) + `account_deletion_jobs` + 시크릿 배선
4. 탈퇴 전용 삭제 경로(#212 변형 — 가드 생략·감사 익명화·dismissals 정리)
5. **탈퇴 인지 큐 UI** — 목록 "탈퇴 접수" 배지·담당자/관리자 알림(화면 + Discord)·탈퇴확인
   버튼·대고객 액션 차단 게이트 + D+3 재촉·D+5 자동 실행 잡
6. 업무 AI: 일괄 정리 스크립트 · 30일 rolling cron · 도구 계측
7. 기존 `customer_deletions` backfill

## 11. CRM 결정 사항 모음 (기본값 + 거부권)

아래 5건은 전부 **원문(이사님 문서)의 정책에서 도출한 기본값으로 CRM이 확정**했습니다.
별도 판단을 요청드리지 않습니다 — 훑어보시고 **이견이 있는 항목만** 말씀주시면 그 항목만
되돌립니다.

1. **B/C 자동 판정 규칙**(§1) — 원문 §2 "계약 전 = PURGE"의 기계적 번역. 계약·출고 흔적이
   있으면 자동 삭제하지 않고 사람 확인으로 넘기므로 오삭제 위험 없음.
2. **D+5 자동 폴백 = C-스켈레톤 + 나머지 PURGE**(§4) — 원문 원칙 "기간 미확정은 무기한
   보존이 아니다"를 따른 유일한 방향(미결정 시 계속 보유는 원문 정책 위반).
3. **`clawback_until`은 C 확정 담당자가 그 자리에서 입력**(§5) — 모르면 `review_required`.
   별도 책임자 임명 불요(화면 흐름으로 흡수).
4. **업무 AI 기존 메시지 전량 삭제**(§7) — 원문 §4가 직접 권고한 항목. 실행 시점만 직원에게
   사전 공지.
5. **`customer_deletions` 기존 행 전체 익명화**(§6) — 감사 기능(고객코드·처리자·시각)은
   유지, 이름은 감사에 불필요. 규칙 하나가 반쪽 소급보다 단순.

## 12. 추가 합의(2026-08-01 오후) — retained 응답 확장 + 미해결 질문 1건

앱 오케스트레이터 구현 중 추가 계약 수신: **200 retained 응답에 classification 외에 비어 있지
않은 `retentionBasis`와 미래 시각 `retentionUntil` 필수** — 누락 시 앱이 완료로 인정하지 않고
잠금 상태로 재시도.

CRM 반영(PR `#423`): retained 응답이 다음을 싣는다.

| 분류 | retentionBasis | retentionUntil |
|---|---|---|
| active_fulfillment | `customers.retention_basis`(기본 "출고 연락·조율" — 항상 비어 있지 않음) | `customers.retention_until`(확정 시 미래 검증 — 항상 충족) |
| settlement_reference | 고정 "출고 후 정산·환수 참조 보존(개인정보 파기 완료)" | `clawback_until` 확정 시 그 값(그날 23:59:59 KST). **미확정이면 null** |

**✅ 종결(2026-08-01 오후 영실 2차 회신 → PR `#424` 반영)** — "null 허용 + 안전장치" 합의:

- C의 clawback 미확정 건은 `retentionUntil: null` 유지(임의 기한 조작 없음 — 양측 동일 판단).
- 대신 retained/settlement_reference 응답에 **`reviewStatus`**(settlement status 그대로 —
  legal_hold도 같은 문법 공유)와 **`reviewDueAt`**(다음 의무 재검토일)을 동봉한다. null
  retentionUntil의 앱 완료 인정 조건 = `reviewStatus: "review_required"` + 미래 `reviewDueAt`.
- **30일 재검토 주기**(영실 권장 채택): `settlement_references.review_due_at`(마이그 0048, 생성
  기본 +30일) — 크론이 도래 건을 Discord 재알림 후 +30일 갱신(무기한 방치 방지). clawback 확정
  (pending 승격) 시 주기 해제(NULL).
- **헤더 통일**: CRM 수신 헤더를 앱 병합 계약의 **`X-App-Deletion-Secret`**으로 개명(구
  `x-deletion-secret` 폐기). 배포 후 202 handshake 실측 확인.

**앱 확정(2026-08-01 저녁)**: ①classification 대소문자는 **앱이 정규화** — CRM은 이 표의 소문자
유지 ②reviewStatus/reviewDueAt **앱 수용은 후속**(이전 작업본 폐기 — 추가 필드는 무해하게 무시됨)
③`CRM_ACCOUNT_DELETION_URL` 앱 secrets 등록 완료.
**🟡 열린 리스크**: 앱 현 파서는 null `retentionUntil`을 여전히 거부한다(logic.ts crm_contract_error)
— 후속 수용 배포 전까지 **C-미확정(review_required) 건은 앱 완료 인정이 안 돼 잠금 재시도**(앱
DB·Auth 삭제 중단 = 앱 쪽 SLA 위험. 재시도 루프라 후속 배포 시 자동 회복). **null 수용을 앱 출시
게이트에 포함할 것을 권고**(탈퇴 셀프서비스 차단 해제 전 필수 — CRM 전달 완료).

**✅ 위 리스크 종결(2026-08-01 밤 — 앱 배포 완료)**: 앱 PR `#787` 머지·운영 반영(파서 + jobs CHECK
완화 + RPC 시그니처 교체 migration + `account-deletion` v4). 인정 조건은 위 계약 그대로 구현
(`reviewStatus "review_required"` + 미래 `reviewDueAt`, classification 선례처럼 대소문자·공백
정규화). 기잠금 C-미확정 건은 다음 재시도 사이클(백오프 최대 6h)에 자동 회복. CRM 측 추가 조치 불요.
