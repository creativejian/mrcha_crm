# 어드민 차량관리 동작 명세 (CRM 차량 콘솔 재현 가이드) — 앱 팀 핸드오프

출처: 앱 팀 · 2026-06-16 · master `wmkbmlespgzkeekliwio`
용도: CRM이 catalog(차량) author를 인수할 때 재현해야 할 어드민 동작. **코드 체계(brand/model/trim_code·mc_code)는 전부 DB 트리거가 관리** → catalog 이관 후 같은 트리거가 secret/직결 write에도 발동하므로, CRM은 트리거 규칙에 맞춰 write만 하면 동일 동작.
연계: 표기·필드 규칙은 `2026-06-16-master-supabase-integration.md`의 "차량 입력 계약" 섹션.

## 1. 엔티티 × 작업 + 필드 권한

| 엔티티 | 조회 | 추가 | 수정 | 삭제 | 정렬 | 상태 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Brand | ✓ | ✗ | ✗ | ✗ | – | – |
| Model | ✓ | ✓ | ✓* | ✓(cascade) | ✓ RPC | ✓ |
| Trim | ✓ | ✓ | ✓* | ✓ | ✓ RPC | ✓ |
| TrimOption | ✓ | ✓ | ✓* | ✓ | – | – |

**필드별 수정가능 / 읽기전용 (CRM이 정확히 재현):**
- **Brand**: 전부 읽기전용(시드/마이그레이션 관리). CRM이 생성 UI를 새로 만들면 `brand_code` 자동부여(§2) 준수.
- **Model**: 수정가능 = `category`·`status`만. 읽기전용 = `name`·`model_code`·`sort_order`(정렬로만)·`brand_id`.
- **Trim**: 수정가능 = `trim_name`·`price`·`model_year`·`fuel_type`·`drive_system`·`displacement_cc`·`transmission_type`·`body_style`·`seating_capacity`·`status`·할인(`financial`/`partner`/`cash_discount`). 읽기전용 = `trim_code`·`mc_code`(불변)·`canonical_name`·`sort_order`. 추가 작업: `moveTrimsToModel`(다른 모델로 이동).
- **TrimOption**: 수정가능 = `name`·`price`. 읽기전용 = `type`(basic/tuning, 잠김). 관계(`trim_option_relations`)는 표시만, UI 편집 불가.

## 2. 코드 체계 — DB 트리거 SSOT (MC코드)

| 컬럼 | 테이블 | 자동/수동 | 불변 |
|---|---|---|:--:|
| `brand_code` smallint | brands | INSERT 자동(전체 MAX+1) | ✓ |
| `model_code` smallint | models | INSERT 자동(브랜드 내 MAX+1) | ✓ |
| `trim_code` smallint | trims | **수동**(고유번호 할당, §3) | ✓ |
| `mc_code` varchar(11) | trims | `trim_code` UPDATE 시 자동 생성 | ✓ |

**mc_code 형식(11자리)**: `'MC' + brand_code(2,0패딩) + model_code(2) + (model_year%100, 2) + trim_code(3)`. 예: 브랜드07·모델05·2026·001 → `MC070526001`.

**자동부여(BEFORE INSERT)**: brand_code NULL→MAX+1 / model_code NULL→브랜드 내 MAX+1(단 그 브랜드에 model_code NULL 모델이 이미 있으면 skip=국산 미정리 보호) / **trim_code는 자동 트리거 없음 — 항상 수동**(`auto_assign_trim_code()` 함수는 존재하나 미연결).

**불변(BEFORE UPDATE)**: brand/model/trim_code·mc_code 값→다른값 변경 시 RAISE EXCEPTION. NULL→값은 허용(최초 부여). 부득이 수정 시 `DISABLE TRIGGER` → 수정 → `ENABLE`.

**mc_code 생성 = BEFORE UPDATE만**(INSERT 시 생성 안 함). 흐름: INSERT(코드 NULL) → trim_code UPDATE → mc_code 자동.

## 3. MC코드 할당 워크플로우 ("고유번호 할당" 버튼)

1. 트림 추가 → `trim_code=NULL`·`mc_code=NULL`로 INSERT
2. [고유번호 할당] 버튼 노출 ← `mc_code=NULL` 트림 ≥1일 때만
3. 검증: mc_code 없는 트림에 `model_year` 누락 차단 / 모델의 brand_code·model_code 미부여 차단
4. `trim_code` 계산: `getMaxTrimCode(modelId) = MAX(활성 trims.trim_code, trim_code_history.trim_code)` ← **양쪽 비교**
5. 대상 트림을 `sort_order` 순 정렬 → 각 `trim_code = maxCode + i + 1` UPDATE (→ 트리거가 mc_code 자동 생성)

> **⚠️ 갱신(2026-06-16): trim_code 할당 로직은 앱 Dart에만 있어 catalog 이관 시 안 넘어옴 → 앱 팀이 `catalog.assign_trim_codes(p_model_id bigint) RETURNS integer` RPC로 제공(SECURITY DEFINER, service_role, Phase ①).** mc_code *생성 공식*은 트리거라 자동 따라가지만, trim_code를 *몇 번 줄지 결정*하는 로직은 RPC로. **CRM은 트림 추가(코드 NULL) 후 `SELECT catalog.assign_trim_codes(:model_id)` 한 줄 호출만** — 검증·이력비교·sort_order순·mc_code 자동이 RPC 내부 SSOT. CRM이 직접 재구현 금지(history 비교 누락 시 코드 재발급 사고).

**비재발급 규칙(RPC가 보장)**: trim_code = "역대 최대+1" — 활성 + 삭제 이력(trim_code_history)까지 비교. 삭제 시 `archive_trim_code_on_delete`(BEFORE DELETE)가 `trim_code_history`(model_id, trim_code, mc_code, trim_name, model_year, original_trim_id, deleted_at)에 보존(ON CONFLICT DO NOTHING). 마지막 번호 삭제→이력에 남아 재발급 X / 중간 번호 삭제→영구 결번. **목적: mc_code/trim_code는 한 번 발급되면 영원히 같은 차를 가리킴(외부 추적성).**

## 4. 정렬(sort_order)

- 자동(INSERT): NULL/999면 부모 내 MAX+1, 없으면 1 (모델=브랜드 내, 트림=모델 내).
- 드래그 재배치: `batch_update_sort_order(p_table, p_ids[], p_sort_orders[])` RPC — 2-pass(임시값 10000+i로 옮겨 UNIQUE 충돌 회피 → 최종값). 모델·트림 공용. 1부터.
- **sort_order ↔ code는 완전 별개** — 정렬 바꿔도 trim_code/mc_code 불변.

## 5. 상태(status)

- 5종: 판매중(기본)·출시예정·사전예약·단종·블라인드.
- **⚠️ 갱신(2026-06-16): 단종 로직 2건은 앱 Dart에만 있던 것 → DB 트리거로 이전 확정(catalog SSOT, Phase ①).** CRM 콘솔 재구현 불필요, 앱·CRM 어느 쪽 write에도 일관 보장.
  - 모델 단종: status='단종' → 하위 트림 자동 단종(트리거).
  - 트림 status ⊂ 모델 status: 모델이 '단종'이면 트림은 단종/블라인드만 허용(트리거 검증, 위반 거부).
- 표시 규칙(별도): 채팅 라인업은 단종도 보이되 트림 있으면 활성 / 견적은 단종 비활성 / 블라인드는 전 경로 숨김.

## 6. 트림옵션

- **국산차(is_domestic=true)만** 옵션 관리(수입차 옵션 UI 숨김).
- add(type·name·price) / update(name·price, type 불변) / delete(관계 CASCADE).
- 관계(trim_option_relations excludes/includes)는 표시만, UI 편집 불가 — 자연어/SQL 관리.

## 7. 국산 트림 입력 (현재 어드민 → CRM 개선)

- 현재 어드민: 국산도 trim_name 통짜 입력(운영자가 `서브라인 - 등급` 직접 타이핑). 서브라인 분리는 표시(어코디언)만.
- 어드민 트림 탭: 탭0 목록(서브라인 어코디언, 국산만) / 탭1 순서관리(드래그).
- **CRM 개선 권장**: 통짜 타이핑은 오타·구분자 사고 위험(실제 결함 4건). **서브라인/등급 분리 입력 → 저장 시 ` - ` 자동 결합**(차량 입력 계약 참조).

## 8. 권한

- admin: 전부 편집(CRUD·코드 할당·상태·정렬).
- staff·manager: 읽기전용(편집 UI 숨김).
- CRM도 동일 정책 권장, 역할은 `provision_staff_role` RPC로.

## 9. CRM 재현 핵심 주의 (catalog 이관 연계)

1. 트리거 12개는 catalog 이관 시 함께 이동 → CRM secret/직결 write에도 발동. 코드 자동/불변/아카이브 자동 보장.
2. 코드 컬럼(brand/model/trim_code·mc_code) **직접 입력/수정 금지**. trim_code만 §3 흐름으로 명시 할당.
3. **mc_code 형식(MC+11자리) 절대 변경 금지** — 외부 추적성.
4. **trim_code 비재발급** — `getMaxTrimCode`가 trim_code_history까지 비교하는 로직 CRM 동일 구현.

## 앱 팀 Phase ① 산출물에 포함 (확정)

- catalog 이동 + 코드 트리거 12개 + public 호환 view
- **`catalog.assign_trim_codes(model_id)` RPC** (trim_code 할당 — CRM은 호출만)
- **단종 트리거 2건** (모델 단종 cascade + 트림 status ⊂ 모델 status 검증)
- `provision_staff_role` RPC

## CRM 구현 시 추가로 받을 것 (차량 콘솔 brainstorming/구현 때)

- `trim_option_relations`(excludes/includes) 구조 + 편집 정책(현재 SQL 관리)
- `moveTrimsToModel`(트림 모델 이동) 동작
- `batch_update_sort_order` RPC 시그니처
- 차량 **수정 시 그룹핑 입력 방식** + 표기법 책임(크롤러 자동 vs 수동) ← 입력 계약 pending과 동일
