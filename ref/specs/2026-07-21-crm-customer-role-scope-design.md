# 고객 목록/상세 화면 role scope 설계 (2026-07-21)

세션 0721-role-scope(유슨생). 이사님 A-3 원칙("staff는 본인 담당만 보는 전제")의 나머지 반쪽 —
견적 쓰기 게이트(#300, spec `2026-07-21-crm-quote-write-access-design.md`)가 "보여도 못 건드리는"
상태를 선확보했고, 이 슬라이스가 "애초에 안 보이는" 상태를 만든다.

## 1. 현행 실측 (2026-07-21)

- `GET /api/customers`(목록)는 `listCustomers(db)` 무조건 전체 반환. `/:id` 하위 전 라우트(#301 당시 26개 — 구 서술 "28"은 라우터 등록 전체 수(루트 GET/POST 2 포함)의 오라벨, 배치 12 C#3 정정. K1 이사로 +2)
  (상세·메모·할일·일정·서류·견적·출고·quote-requests·consultations)도 role 무관 전부 접근 가능.
  staff JWT만 있으면 타 담당 고객의 모든 것을 읽고 쓸 수 있다(견적 쓰기만 #300이 403).
- scope SSOT는 기존재: `resolveCustomerScope`(`src/lib/assistant-scope.ts`, #176 — AI 전용 소비).
  admin·manager = `"all"` / staff = `{ advisorId: 본인 }` / dealer 등 그 외 = staff와 동일 규칙
  fail-closed(매칭 0건).
- 클라 표면(통합검색·출고 콘솔·업무함 카운트)은 전부 `fetchCustomers` 파생 — 서버 목록만
  스코프되면 자동 추종. 클라는 이미 roleTab으로 담당 컬럼(`shouldShowAdvisorColumn`)·삭제
  (admin)·등록(딜러 제외) 노출을 제어하고 있어 **클라 변경 0**.

## 2. 결정 (유슨생 2026-07-21 "진행해")

| # | 결정 | 근거 |
|---|------|------|
| S-1 | 목록 = `listCustomers(executor, scope)` 파라미터 — staff면 `advisor_id = 본인` WHERE | scope SSOT `resolveCustomerScope` 재사용 → AI(#176)와 화면의 고객 집합 자동 정합 |
| S-2 | 상세+자식 = **customers 라우터 미들웨어 한 겹**(`/:id`·`/:id/*`) — 라우트별 게이트 없음 | 수십 라우트 개별 배선은 드리프트 표면. 한 곳이면 신규 라우트도 자동 커버 |
| S-3 | 차단 응답 = **404 + 미존재와 byte-동일 문구**("고객을 찾을 수 없습니다.") — 403 아님 | 존재 비노출. 목록에서 안 보이는 고객이 URL 추측에 403을 받으면 "존재는 한다"가 샌다. AI 선례(#176 조회 결과 없음) 미러 |
| S-4 | 미배정 고객 = staff에게 비노출(404·목록 제외) | D-3① 미러(상담사는 본인 배정부터). 부작용: staff의 "상담필요" 업무함(미배정 큐)은 항상 빈다 — 의도 |
| S-5 | dealer 등 그 외 role = fail-closed(빈 목록·전 상세 404) | resolveCustomerScope 기존 의미론 그대로. dealer 화면 미설계·실계정 0 — #220(쓰기 차단)의 읽기 확장이지만 안전 기본값 |
| S-6 | 불변: 수기 등록 POST /(staff = 본인 자동 배정 #215라 스코프 정합)·고객 DELETE(admin 기존)·일괄 담당자 변경(admin/manager 기존) | 기존 게이트와 모순 없음. ⚠️각주(배치 12 A#4): 자동 배정은 조건부다 — `getStaffName` null(full_name 공란)이면 fail-open으로 **미배정 생성**되고, 그 고객은 등록한 staff에게 무음 미오픈(목록에 없어 드로어 fetch 자체 미발생). 실 DB CRM 롤 전원 full_name 보유(2026-07-21 실측)라 현재 도달 0. 해소 재료: 스코프 키는 advisorId(이름 아님)라 `advisor = { id: 등록자, name: staffName ?? 대체표기 }`로 분리하면 fail-open과 정합 동시 충족 — 대체표기 어휘는 제품 판단이라 도달 사례 발생 시 이행 |
| S-7 | #300 견적 403 게이트는 **안쪽 그물로 잔존** — staff 타담당은 이제 스코프 404가 선행해 403 도달 불가 | 스코프 게이트가 회귀(제거)되면 견적 라우트는 403이 받아준다(fail-closed 이중 겹). quote-access 테스트는 기대값 403→404로 개정(주석 박제) |

## 3. 구현

- `src/db/queries/customers.ts` — `listCustomers(executor, scope: CustomerScope = "all")`.
  scope가 advisorId면 `where(eq(customers.advisorId, scope.advisorId))`. 기본값 "all"이라
  기존 호출부(테스트 등) 무영향.
- `src/routes/customers.ts` — `customerScopeGate` 미들웨어:
  1. `resolveCustomerScope(c.var.user)` — `"all"`이면 통과(admin·manager는 조회 0회).
  2. `:id`가 uuid가 아니면 통과 — 각 라우트 zValidator가 400(미들웨어에서 22P02 방지).
  3. `getCustomerAdvisorId`(#300 재사용) — 미존재 **또는** advisor 불일치 → 404
     `"고객을 찾을 수 없습니다."`(byte-동일 = 존재 비노출).
  - 등록: `customers.use("/:id", gate)` + `customers.use("/:id/*", gate)` — 라우트 선언보다 앞.
  - `GET /` = `listCustomers(c.var.db, resolveCustomerScope(c.var.user))`.
- `src/lib/assistant-scope.ts` — 주석에 화면 라우트 소비 편입 명시(본문 불변).
- 테스트: `src/routes/customers.role-scope.test.ts` 신설(`CU-RSCOPE-` registry 선등록) +
  `customers.quote-access.test.ts` staff 타담당·미배정 4건 기대값 403→404 개정.

## 4. 범위 밖 (박제)

- **인박스 2종(상담 신청 DB `/consultation-requests`·앱 견적요청 `/app-requests`)**: role 게이트
  0 — staff도 전 유저 요청·전화번호 열람 가능. "미배정 신규 유입 큐를 상담사가 봐야 하는가"는
  제품 판단(이사님 영역)이라 이 슬라이스에서 손대지 않는다. **⚠️ 상호작용 1건**: 상담 인박스
  매칭은 클라 파생(`consultation-inbox.ts` — customers 목록 대조)이라, staff가 열면 스코프된
  목록 때문에 타 담당 고객과 연결된 유저를 "신규(미연결)"로 오판해 [고객 생성] 중복 위험이
  생긴다(견적요청 인박스는 서버 파생이라 무관). staff 실계정 0이라 현재 실영향 0 — staff에게
  인박스를 열 거면 게이트 or 매칭 서버화가 선행돼야 한다. pending 항목으로 이사님 질문 동봉.
  **→ 해소(#302, 같은 날 유슨생 결정)**: 인박스 2종 admin·manager 전용 게이트(서버 requireRoles
  403 fail-closed + 메뉴/라우트/배지). 이 상호작용은 도달 불가가 됐다(이사님 사후 공유 — 항목 16).
- **채팅 콘솔(/chat)**: supabase-js 직결 + 앱 소유 RLS(staff 전체 열람) — 서버 경유가 아니라
  이 게이트가 못 잡는다. 상담 배정 흐름 자체가 "전 상담사가 큐를 보는" 설계라 별 축.
- **전체화면 상세(/customer-detail/:code)·드로어**: 데이터가 전부 위 API 경유라 자동 커버 —
  클라 라우트 게이트 추가 없음.
- **staff 시점 브라우저 실기**: `상담사테스트`(crm-staff-test@example.com,
  66c638b6-b2a8-4c69-b990-ae75e10a0036 — 2026-07-21 GoTrue admin 생성, 유슨생이 앱 어드민
  화면에서 role 상담사 전환) magiclink로 수행. 단 실 고객에 이 계정을 배정하면 실데이터
  오염이라, 실기는 스모크 고객(CU-SMOKE) 배정 → 확인 → 원복 절차.

## 5. 행위 변경 (🟡 이사님 사후 공유 — pending 등재)

1. staff: 고객 목록/상세/자식 전부 본인 담당만(타 담당·미배정 = 404 비노출). — A-3 원칙의
   화면 이행이라 방향은 기승인, 적용 사실 공유.
2. dealer: 고객 목록이 빈 목록으로(기존엔 읽기 전체 노출). 실계정 0·화면 미설계.
3. staff 인박스 노출 질문(§4 상호작용) 동봉.

## 6. 후속 — staff 실기 감사 (2026-07-21 심야)

staff 실계정으로 고객 관리 전역을 훑었다(격리 스택·읽기 위주·원복 완료). **기존 게이트는 전부 정상**: 목록 스코프(22명 중 본인 1건)·타 담당 상세 404·인박스 2종 403·고객 삭제 403(본인 담당도)·사이드바 admin 전용 메뉴 6종 비노출·담당 컬럼 숨김·통합검색/업무 AI 타 담당 미검출·5 mode 전량 스코프 적용.

### 발견 — 담당자 재배정에 게이트가 없었다 (수정: 이 슬라이스)

**실측**: staff 토큰으로 `PATCH advisorId=타상담사` → **200** → DB 반영 → **본인 목록 0건**. 그 시점부터 상세도 404라 **staff 혼자서는 되돌릴 수 없다**(admin 개입 필요).

되돌릴 수 없는 조작이라는 점에서 **고객 하드 삭제(#212 admin 전용)와 같은 급**인데 게이트만 없었다. 실무 흐름도 상담사가 임의로 넘기는 게 아니라 **관리자·팀장에게 요청**하는 쪽이 맞다(유슨생 2026-07-21).

**조치**
- **서버 = 진짜 게이트**: `advisorId`·`advisorName`·`team` 중 하나라도 오면 admin·manager만(403). ⚠️ **필드 단위**다 — 라우트 자체는 staff에게 열려 있어야 한다(진행 상태·메모 등 일상 수정이 같은 PATCH로 온다). 판정 SSOT = `client/src/lib/advisor-assign-access.ts`(서버·클라 물리 공유 — `quote-write-access` 선례).
- **클라 = UX 보조**: 드로어 담당자 배지를 staff에게 읽기 전용(`.is-readonly` — `disabled` 속성은 전역 물빠짐이 담당자 이름까지 흐려 쓰지 않는다) + 목록 담당자 필터를 담당 컬럼과 같은 노출 축(`showAdvisorColumn`)으로 편입.

### 기각 — `GET /api/staff`(전 직원 디렉토리)를 staff에게 막기

담당자 필터·배정 편집기가 이 API로 전 직원 이름을 보여주는 게 눈에 띄어 검토했으나 **막을 수 없다**: `ChatPage.tsx`가 같은 디렉토리를 **실시간 상담 콘솔의 채팅 세션 배정**에 쓰고 있고 거기엔 role 게이트가 없다(`roleTab` 검사는 운영 배지 전용). 채팅 세션 배정은 **고객 담당자 배정과 다른 축**이고 staff의 정당한 업무라, 막으면 실기능이 깨진다.

→ UI 노출 표면만 줄이고(필터 숨김) API는 유지. 직원 이름 노출을 정말 닫으려면 채팅 배정 권한부터 정해야 하므로 **별건**이다.
