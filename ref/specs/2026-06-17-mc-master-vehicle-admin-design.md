# mc-master 차량 관리 (CRM 편집) Design — A2 Phase 1: 핵심 CRUD

작성일: 2026-06-17
상태: design (brainstorming 합의 완료, 사용자 리뷰 대기 → writing-plans)
연계: `2026-06-17-crm-db-connection-migration-design.md`(A2, catalog 직결), `2026-06-16-vehicle-admin-handoff.md`(앱 Phase① catalog 이전), 앱 `mr-cha-app`의 `/admin/vehicles` 구현.

## 배경 / 결정

앱(`/admin/vehicles`, 차량 관리)의 차량 데이터 편집 기능을 CRM `/mc-master`로 가져온다. **이 작업 후 앱의 차량 관리는 read-only로 물러나고 CRM이 차량 catalog의 유일한 편집 주체가 된다**(앱 측 read-only 전환은 앱팀 별도 작업).

핵심 결정(사용자 합의):
- **쓰기 경로 = CRM 백엔드 직접 쓰기**(Hono + drizzle/postgres-js, 기존 `DATABASE_URL`=master, postgres superuser). master DB 트리거·제약이 비즈니스 로직을 그대로 처리한다(아래 §트리거). 신규 라이브러리/시크릿 없음.
- **범위 = Phase 1 핵심 CRUD**(아래 §범위). 재정렬·일괄삭제·이동·코드할당·아코디언 2뷰는 Phase 2.
- **테마** = CRM 라이트 콘솔 디자인(앱 다크 테마 복제 안 함).
- **편집 권한** = 최고관리자만, 그 외 읽기 전용(CRM UI 게이트).
- **색상** = Phase 1 읽기 전용(칩 표시만).

## 범위 (Phase 1)

**브라우징(전체):** 브랜드 사이드바(국산/수입 그룹, read-only) → 모델 테이블(모델명·카테고리·가격범위·상태·트림수) → 트림 리스트(테이블 1뷰) → 옵션(basic/tuning 탭).

**편집:**
- **모델**: 추가(이름·카테고리·상태), 수정(카테고리·상태 — 이름은 RO), 삭제(확인 다이얼로그).
- **트림**: 추가/수정(트림명·가격·연식·연료·구동방식·변속기·배기량·차체·인승·상태), 삭제.
- **옵션**: basic/tuning 추가·수정(이름·가격)·삭제.

**제외 (Phase 2 이후):** 드래그 재정렬(`batch_update_sort_order`), 일괄 선택삭제, 트림 모델 이동, `trim_code`/`mc_code` 할당, 국산 아코디언/순서 2뷰, 색상·이미지·`trim_option_relations`(옵션 포함/배타) 편집, 트림 할인 3종(자사/제휴/타사) 편집.

## 데이터 모델 & 쓰기 연산 (master `catalog` 직접)

CRM은 `catalog.*` 테이블에 직접 INSERT/UPDATE/DELETE 한다(public 호환 뷰가 아니라 테이블 직접 — 트리거는 catalog 테이블에 정의됨). 컬럼/연산은 앱 `admin_methods.dart` 기준:

| 연산 | 테이블 | 컬럼/비고 |
|---|---|---|
| 모델 추가 | `catalog.models` | `brand_id, name, category(nullable), status`. `model_code`·`sort_order`는 트리거 자동. |
| 모델 수정 | `catalog.models` | `category, status`만. (`name`/코드 불변) |
| 모델 삭제 | `catalog.models` | FK CASCADE로 하위 trims·options·colors 삭제. |
| 트림 추가 | `catalog.trims` | `model_id, name(=트림명), trim_name(=트림명), canonical_name(파생), price, model_year, fuel_type, drive_system, displacement_cc, transmission_type, body_style, seating_capacity, status`. `sort_order` 트리거 자동. |
| 트림 수정 | `catalog.trims` | 위 편집 필드(부분 업데이트). |
| 트림 삭제 | `catalog.trims` | FK CASCADE로 하위 options·relations·colors 삭제. |
| 옵션 추가 | `catalog.trim_options` | `trim_id, type('basic'\|'tuning'), name, price(nullable)`. |
| 옵션 수정 | `catalog.trim_options` | `name, price`만. (`type`/`trim_id` 불변) |
| 옵션 삭제 | `catalog.trim_options` | FK CASCADE로 relations 삭제. |

### CRM이 복제해야 하는 파생 로직 (트리거 아님 = 앱 클라이언트가 하던 것)
- **`canonical_name`**: 앱이 caller에서 brand+model+trim_name 패턴으로 계산해 전달한다(트리거 없음). CRM도 트림 추가 시 동일하게 계산해 넣어야 한다. **정확한 파생식은 plan 단계에서 앱 caller(`vehicle_admin_provider`/`trim_add` 콜백 → `category_detector`/패턴 헬퍼)를 읽어 핀.** 검색(`canonical_name.ilike`)·표시에 쓰이므로 비우면 안 됨.
- **`name` = `trim_name` = 입력 트림명** (앱은 둘 다 같은 값으로 넣음).
- **카테고리 분류**: 모델 카테고리는 자유 텍스트(`"중형 세단"` 형태). 앱의 그룹 분류(경차/소형/준중형/중형/준대형/대형/스포츠카/버스 × 세단/해치백/SUV/RV/MPV/쿠페/컨버터블/트럭/밴)를 named const(`client/src/data/`)로 복제해 드롭다운 제공.
- **`status` enum SSOT** (DB 저장값, `public.car_status`): `판매중 / 출시예정 / 사전예약 / 단종 / 블라인드`. CRM은 이 값을 저장하고 표시 라벨/색상은 presentation에서 매핑(앱 라벨: 사전예약→"예약판매", 블라인드→"숨김" 가능).
- **집계 표시**: `가격 범위`=하위 trims `min~max price`, `트림 수`=trims count. 모델 목록 쿼리에서 LEFT JOIN/집계로 계산.

### master DB 트리거 (CRM이 의존, 재구현 안 함 — DB 레벨이라 앱이 안 써도 유지)
brand/model/trim 코드 자동 부여, `sort_order` 자동(model/brand 내 MAX+1), `mc_code` 생성(trim UPDATE 시 trim_code 설정될 때), 코드 변경 방지, **모델 단종 → 하위 트림 단종 cascade**, 모델 하위 트림 status 강제(단종 모델의 트림은 단종/블라인드만), 국산차 `trim_name` 형식 검증(`' - '` 포함). → CRM은 같은 INSERT/UPDATE만 하면 동일 동작.

## 아키텍처

### 백엔드 (Hono, `src/`)
- 쓰기/관리 쿼리: `src/db/queries/catalog-admin.ts`(신설) — drizzle `db.insert/update/delete(modelsInCatalog 등)`. `src/db/catalog.ts`의 "READ-ONLY" 관례를 "차량 관리 admin 쓰기 경로 한정 write 허용"으로 갱신(테이블 객체는 그대로, write 함수만 admin 쿼리에 둠).
- 라우트: `src/routes/catalog.ts` 확장(기존 `GET /counts` 유지):
  ```
  GET    /api/catalog/models?brandId=     # 목록 + 가격범위·트림수 집계
  POST   /api/catalog/models
  PATCH  /api/catalog/models/:id          # category, status
  DELETE /api/catalog/models/:id
  GET    /api/catalog/trims?modelId=      # 목록 + 옵션수·색상칩
  POST   /api/catalog/trims
  PATCH  /api/catalog/trims/:id
  DELETE /api/catalog/trims/:id
  GET    /api/catalog/trims/:id/options
  POST   /api/catalog/trims/:id/options
  PATCH  /api/catalog/options/:id
  DELETE /api/catalog/options/:id
  GET    /api/catalog/brands              # 사이드바용(국산/수입)
  ```
  zod 검증(필드·enum·정수). 기존 견적용 읽기 API(`/api/vehicles`)는 변경 없음 — 편집은 `/api/catalog/*`로 분리.

### 프론트 (`client/src`)
- `client/src/pages/MCMasterPage.tsx` 재구성: 메인 콘텐츠를 차량 관리로 전환. 기존 counts는 상단 컴팩트 요약으로 축소(또는 제거 — plan에서 결정).
- 구조: 좌 브랜드 사이드바(국산/수입 그룹) · 중앙 모델 테이블(연필 → 우측 360px 편집 패널) · 모델 클릭 → 트림 리스트(테이블) · 트림 연필 → 트림 편집 패널 · 옵션 아이콘 → 옵션 패널(basic/tuning 탭).
- 데이터: `client/src/lib/catalog.ts` 확장(fetch 함수 + 타입). 컴포넌트는 CRM 라이트 콘솔 디자인 토큰 사용(`index.css`).
- 편집 컨트롤은 `roleTab === "최고관리자"`일 때만 노출. 그 외 읽기 전용.

## 권한 & 안전
- **편집 = 최고관리자만**(UI 게이트). 서버는 superuser로 쓰지만, 편집 엔드포인트는 CRM이 admin 전용으로 노출하는 화면에서만 호출. (Phase 1은 UI 게이트; 서버측 인증은 CRM 전반 인증 도입 시 함께.)
- **삭제 확인 다이얼로그** 필수. 모델 삭제 시 "하위 트림·옵션·색상이 모두 삭제됩니다" 경고.
- **라이브 데이터 경고**: 편집 즉시 master에 반영되어 앱 사용자에게 노출됨을 UI에 명시.

## 에러 처리
서버는 트리거/제약 위반을 잡아 한글 메시지로 변환:
- 국산차 trim_name 형식 위반(`' - '` 필요), 단종 모델 하위 트림 status 위반, 코드 변경 방지 위반 등 → 사용자 친화 메시지.
- **FK 상호작용**: 모델/트림 삭제 시 — CRM `crm.quotes.trim_id/color_id`는 **ON DELETE SET NULL**(견적 데이터 보존, 삭제 비차단). 단 **앱의 `public.quote_requests` 등이 trims를 RESTRICT로 참조하면 삭제가 차단**될 수 있음(앱 `deleteModel`도 "견적이 있어 삭제 불가" 처리) → 그 에러를 한글로 표면화.

## 테스트
- **순수 로직 단위테스트(우선)**: 가격범위 집계 포맷, 폼/zod 검증, `canonical_name` 파생, status 라벨 매핑, 카테고리 const.
- **서버 write**: 라이브 master 데이터라 자동 write 테스트는 신중. → 트랜잭션 롤백 기반 통합테스트 또는 수동 검증(soft 환경 없음). zod 스키마는 단위테스트.
- **클라이언트**: fetch mock 단위테스트(목록 렌더·편집 패널·권한 게이트) + 수동/스크린샷.
- 회귀: 기존 `/api/vehicles` 읽기·견적 UI 무영향 확인.

## 파일 (예상)
- 신설: `src/db/queries/catalog-admin.ts`, `client/src/data/vehicle-taxonomy.ts`(카테고리·status·연료·구동·변속 const), 트림/모델/옵션 편집 패널 컴포넌트(`client/src/pages/mc-master/` 또는 `components/`).
- 수정: `src/routes/catalog.ts`(write 라우트), `src/db/catalog.ts`(write 관례 주석), `client/src/lib/catalog.ts`(fetch), `client/src/pages/MCMasterPage.tsx`(재구성), `client/src/index.css`(차량관리 스타일).

## Phase 2 (이번 범위 밖, 메모)
드래그 재정렬(`batch_update_sort_order` RPC), 일괄 선택삭제, 트림 모델 이동, `trim_code`/`mc_code` 할당 버튼, 국산 아코디언/순서 2뷰, 색상 CRUD, 이미지 업로드(Supabase Storage), `trim_option_relations`(포함/배타) 편집, 트림 할인 3종 편집, 서버측 인증/권한 강제.

## 미결 / 리스크
- `canonical_name` 파생식 정확화(plan에서 앱 caller 정독).
- counts 요약을 유지할지 제거할지(plan에서 UI 확정).
- 라이브 master 편집의 운영 안전(staging 없음) — 삭제 확인·라이브 경고로 완화.
- 서버측 권한은 Phase 1에서 UI 게이트만(CRM 전반 인증 도입 시 보강).
</content>
