# master Supabase 직접 통합 (CRM 데이터 아키텍처 전환) — 합의 기록

작성일: 2026-06-16
상태: **앱 팀과 합의 완료. Phase ① 적용 대기 (CRM 설계 먼저 = A안).**
성격: 아키텍처 결정 + 앱 팀 합의 스냅샷. (구현 spec/plan은 CRM 설계 brainstorming에서 별도 작성)

## 배경 / 큰 결정

master service_role(secret) 키를 확보하면서, CRM이 master Supabase(`wmkbmlespgzkeekliwio`)를 **직접 사용**하기로 결정했다. 별도 CRM Supabase + 차량 거울 + 동기화 방식을 폐기한다.

- **이유**: profiles/consultations/quote_requests/ai_estimates 등 운영 데이터가 이미 master에 있고, secret 키로 직접 read 가능 → 동기화 불필요(단일 소스).
- **폐기 예정**: 차량 `catalog` 거울(CRM Supabase), sync 코어(PR #18)·sync UI(PR #19). secret 키가 일찍 있었으면 안 만들었을 작업. 매몰비용으로 처리하고 더 나은 구조로 전환.
- master를 **차선생(우리)이 통제**(schema 추가·migration 가능)한다고 확인 → 1개 통합 가능.

## schema 3분할

| schema | author(write) | drizzle 관리 | 내용 |
|--------|---|:---:|---|
| `public` | 앱 팀 | ❌ (CRM은 read만) | profiles·consultations·quote_requests·quote_request_options·ai_estimates·chat_sessions·chat_messages 등 앱 도메인 + AI 채팅 검색용 alias/keyword |
| `catalog` | **CRM** | ✅ | 차량(코어 + author·크롤링·트림코드) |
| `crm` | **CRM** | ✅ | CRM 운영 데이터(진행상태·담당배정·메모·계약/출고 등) — 신설 |

- **drizzle은 `catalog` + `crm`만 관리**(`schemaFilter: ["catalog","crm"]`), `db:push` 금지(generate→migrate만). `public`은 절대 안 건드림 → 앱 테이블 보호.
- **`catalog`는 PostgREST 비노출**(exposed schemas = public, graphql_public 유지). CRM은 secret/직결로 catalog write, 앱은 `public` 호환 view로 read.

## 차량 이관 — `catalog`

**이관 대상(CRM 소유)**: `brands` · `models` · `trims` · `trim_options` · `trim_option_relations` · `colors` · `trim_no_options` · `trim_code_history` · `source_vehicle_map` (+ 코드생성 트리거/함수 12개).

**`public` 유지(절대 안 옮김 — 채팅 검색 전용)**: `brand_aliases` · `model_aliases` · `trim_aliases` · `category_keywords` · `common_words` · `synonyms`. (옮기면 앱 채팅 깨짐)

- 차량 데이터 author를 앱 어드민 → **CRM 전담**(전부: 크롤링·트림코드 포함). `source_vehicle_map` 테이블·데이터는 catalog로, **크롤러 인프라(Edge Function/서버) 이관은 별도 단계**.
- 앱 어드민 차량 화면은 **read-only 전환**(write 차단 = CRM 단일 writer). 제거는 CRM 차량 콘솔 안정화 후.
- 차량 author 트리거 가드(`auto_generate_mc_code`/`prevent_*_code_change`/`auto_assign_*_code`)가 **secret write에도 발동** → CRM 차량 콘솔은 "mc_code 자동생성·코드 불변" 불변식을 그대로 따라야 함.

## 차량 입력 계약 (CRM 차량 콘솔 제약) — 앱 팀 핸드오프 2026-06-16

CRM이 catalog(차량) author를 인수할 때 앱이 의존하는 trim 표기·필드 규칙. **DB로 강제되지 않음 — 어기면 견적·채팅 UI가 에러 없이 조용히 깨짐.** CRM 차량 콘솔 설계의 핵심 제약.

> **차량 콘솔 구현의 두 축**: ① 이 "차량 입력 계약"(표기·필드·정합성) + ② `ref/specs/2026-06-16-vehicle-admin-handoff.md`(어드민 동작 명세 — 엔티티×작업 권한, MC코드 트리거 체계, 고유번호 할당 워크플로우, 정렬·상태·옵션·권한). 차량 콘솔 brainstorming 때 둘 다 입력으로.

### 코드 트리거 (secret write에도 발동) — CRM은 코드 컬럼을 만지지 않음
- **INSERT**: `brand_code`·`model_code`·`mc_code`·`sort_order` **자동 생성** → 직접 입력 금지
- **UPDATE**: `*_code` 변경 시도 **거부**(불변) → 콘솔에서 코드 필드 편집 불가
- **DELETE**: trim 삭제 시 `trim_code_history` **자동 아카이브**
- `price_updated_at`·`updated_at` 자동 갱신
→ 콘솔은 코드·순서·이력을 안 건드리고 **데이터(가격·이름·옵션 등)만** 다룸. 트리거가 나머지를 처리하므로 오히려 단순.

### 필드 채움 규칙
- `trim_name`: 표시·그룹핑 SSOT. 국산은 **모든 구분정보 포함**(자동 접미사 없음)
- `name`: **국산은 trim_name과 동일**(수입은 name(풀명)≠trim_name(단축명) 정상 — 수입 정정 대상 아님)
- `canonical_name`: 브랜드 모델 + trim_name
- `price`·`model_year`·`fuel_type`·`drive_system`: 메타 표시 동시 필수
- `sort_order`: 서브라인 묶음 + 내부 등급 순서, 같은 서브라인끼리 연속

### 국산 서브라인 표기법 (`trim_name`)
- `is_domestic=true`만. `trim_name = "<서브라인> - <등급>"`, 구분자 **정확히 ` - `**(공백+하이픈+공백). `–`/`—`/`-`(공백없음) 금지
- 첫 ` - ` 기준 분리. 서브라인엔 ` - ` 없음, 등급엔 괄호·공백 OK
- **검증(2026-06-16, 실데이터)**: 국산 1090/1090 100% 준수, 수입 579 전부 flat, 변형대시 0
- **그룹핑 표시 UI는 앱 몫(CRM 불필요).** 단 **차량 수정/author 시 표기법은 준수 필수**.
- ⏳ **앱 팀 추가 정보 대기**: ① 차량 **수정 시 그룹핑 입력 방식**(수정 UI엔 서브라인/등급 분리가 필요할 것으로 봄) ② 표기법 준수 책임이 **크롤러 자동 vs 운영자 수동** 중 어디인지. 답 오면 콘솔 입력/검증 수준 확정.

### 정합성
- 결함 정정 완료(앱 팀 migration `20260616174610`): 국산 name≠trim_name 4건(레이 시그니처, GV80 Coupe BLACK 오타×2, 캐스퍼 II) → **잔여 0**. CRM 인수 시 1회 점검 쿼리(앱 spec §6) 재확인.
- `name=trim_name`은 국산 전용 가드. 코드 컬럼 직접 입력/수정 금지.

## profiles.role 프로비저닝 — RPC 경유

`private.prevent_profile_role_change()` 트리거(권한상승 방지)는 secret/service_role로도 우회 안 됨. CRM은 직접 `UPDATE profiles SET role` 불가. 대신:

- 앱 팀이 **`public.provision_staff_role(p_user_id uuid, p_role user_role, p_actor uuid DEFAULT NULL, p_source text DEFAULT 'crm')`** RPC 제공(SECURITY DEFINER, GUC 통로, service_role 전용 EXECUTE).
- **admin 차단**: CRM은 {customer, staff, manager}만 부여, admin은 앱 팀 admin이 직접.
- **감사로그 v1 포함**: `private.role_audit`. CRM은 인증 전 `actor=null`/`source='crm'`, master `profiles` 기반 로그인 붙인 뒤 actor 채움(단계적).

## 마이그레이션 — expand-contract

master 소유 = 앱 팀. **Phase ①은 앱 팀이 supabase CLI로 적용**, 이후 catalog DDL은 drizzle이 introspect baseline으로 인수.

- **Phase ①** (앱 팀): `CREATE SCHEMA catalog` → 9테이블 `ALTER ... SET SCHEMA catalog`(FK·트리거·RLS 자동 승계, OID 참조 무손실) → 트리거 함수 12개 catalog 이동 + 본문 `public.*`→`catalog.*` 재한정 → `public`에 `security_invoker` 호환 view → 권한(anon/authenticated SELECT) → catalog PostgREST 비노출 유지.
  - FK(`quote_requests.trim_id`, `quote_request_options.trim_option_id`, `source_vehicle_map.internal_trim_id`, `trim_code_history.model_id`, alias.* 등)는 cross-schema로 자동 승계. **실테이블 `catalog.*` 참조**(view엔 FK 불가).
- **Phase ②**: 앱 어드민 차량 화면 read-only(별도 PR) + CRM이 catalog write 시작. **CRM은 catalog를 drizzle introspect baseline으로 adopt**(새 CREATE 금지). provision_staff_role 배포 → CRM 프로비저닝 연결.
- **Phase ③** (선택): public 호환 view 정리 검토. view 유지 비용 낮아 영구 유지 가능.

## 도구 경계 / 보안

- 마이그레이션 history 분리: `supabase_migrations.schema_migrations`(앱) vs drizzle 자체 테이블(catalog·crm).
- supabase CLI 소유: public·private·auth·storage·extensions·roles·grants. drizzle 소유: catalog·crm DDL만.
- catalog DROP/재구축은 public FK 의존 때문에 막힘 → **앱 팀 사전 조율 필수**.
- **동시성**: 앱이 능동 write하는 공유 컬럼(consultations.status, quote_requests.status, ai_estimates.status, chat_sessions.assigned_staff_id)은 **컬럼 화이트리스트 + 낙관적 잠금(조건부 atomic update)** 합의 후 CRM write 허용. 양쪽 정책 동기화.
- **secret 키**: 서버 전용, 클라 비노출(비협상).

## 정정 (이전 조사 오류)

- `chat_sessions`는 **RLS 정책 5개 있음**(앱 팀 확인). 내 secret 키 조사가 RLS를 우회해 "정책 없음"으로 잘못 봤음. 배정 충돌은 RLS가 아니라 낙관적 잠금으로 별도 처리.
- 견적 "공식": 취득세·공채·탁송·취득원가는 **공식이 아니라 Gemini가 견적서 이미지에서 추출**(master에도 계산식 없음). 계산하는 건 리스 금융(금리 Newton-Raphson RATE·월납입금 PMT·잔가/보증금 비율·시장금리 테이블) — 앱 `supabase/functions/ai-analyst/utils/lease_calc.ts`. CRM이 포팅 재사용 가능(별개 작업).

## CRM 쪽 작업 (다음 brainstorming에서 설계)

1. **DB 연결 전환**: `DATABASE_URL`을 master 직결(secret)로, 차량 조회 API(`/api/vehicles`)를 catalog 직접 read로. 기존 거울·sync 폐기.
2. **catalog adopt**: prod 적용 알림 후 `db:pull`로 introspect baseline.
3. **`crm` 운영 스키마 설계**: customers/consultations 운영(진행상태·status_group·담당배정·유입경로·메모·계약/출고) — app `public` 도메인과 중복 없이, `public.*` id 참조로 연결.
4. **차량 관리 콘솔**(mc-master): sync 도구 → 차량 CRUD(트리거 가드 준수).
5. **CRM 인증**: master `profiles`(staff/manager) 기반 로그인 → provision_staff_role 연결, actor 채움.
6. 앱 admin dashboard ↔ CRM 역할 분담 정리.

## 상태 / 다음

- ✅ 앱 팀 합의 완료(admin 차단·감사로그 v1·도구경계·FK조율·동시성·secret).
- ✅ 차량 입력 계약 수신·검증(위 섹션). 결함 4건 앱 팀 정정 완료(잔여 0).
- ⏳ 차량 **수정 시 그룹핑 입력 방식** + 표기법 책임(크롤러 자동 vs 수동)은 **앱 팀 추가 정보 대기** → 받으면 차량 콘솔 설계에 반영.
- ⏳ **A안**: CRM 설계 먼저 → 준비되면 Phase ① 적용 일정 공유. CRM baseline은 prod 적용 알림 후.
- 다음: **CRM 데이터 아키텍처 brainstorming**(연결 전환·`crm` 스키마·차량 콘솔·인증).
- 참고: 앱 작업폴더 `/Users/tobedoit/Documents/Flutter/mr-cha-app` (read-only 확인 가능 — `supabase/migrations`, `lease_calc.ts`, `lib/data/repositories`).
