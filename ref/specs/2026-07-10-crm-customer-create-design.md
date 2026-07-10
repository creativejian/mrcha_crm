# 고객 수기 등록 설계 (2026-07-10)

## 배경

고객 목록 헤드바의 `[+ 고객 등록]` 버튼(`CustomerManagementPage.tsx:899`)은 `onClick`조차 없는 목업이다.
지금 CRM에서 고객을 만드는 경로는 앱 유입 승격 둘뿐이다(견적요청 `createCustomerFromRequest` ·
상담신청 `createCustomerFromConsultation`). **전화·소개로 들어온 고객을 상담사가 직접 넣을 방법이 없다.**
서버에도 `POST /api/customers` 라우트 자체가 없다(실측). 채번 `nextCustomerCode`는 기존재
(`src/db/queries/quote-requests.ts:258`).

## 확정 결정 (유슨생, 2026-07-10)

1. **최소 폼 → 상세 드로어**: 폼은 이름(필수)·연락처·유입 경로 3필드만. 저장 즉시 새 고객의 상세
   드로어를 자동으로 열어 나머지(직군·거주지·니즈·메모…)는 기존 편집 UI로 입력한다. 폼 중복 제로.
2. **등록자 본인 자동 배정**: 전화 받은 상담사가 등록하면 본인 담당이 실무 기본값. 업무 AI staff
   scope가 `advisor_id` 매칭이라 미배정이면 등록한 상담사의 AI 조회에서 빠지는 것도 근거.
   변경은 드로어의 개별 배정 팝오버(#177)로.
3. **연락처 중복은 소프트 경고**: 같은 번호 기존 고객이 있으면 폼 안에 경고를 보여주되 등록은
   허용(가족 공유 번호·법인 대표번호 등 실무 예외 존재). 목록 데이터가 클라에 이미 전체 로드돼
   있어 추가 서버 왕복 0.
4. **접근안 A — 얇은 신설, 승격 패턴 미러**: 승격 쿼리와 코드를 공유하지 않고 나란히 둔다.
   겹치는 게 채번+시드 3필드뿐인데 각 경로의 입력 해석(카탈로그 조인·profiles 폴백·수기 입력)이
   전부 달라 공통 헬퍼는 시그니처만 비대해진다(배치 3 "게이트 3규칙 2벌 추출 비권장"과 같은 판단 축).

## 역할 게이트

- **dealer는 403 fail-closed.** staff·manager·admin 허용 — 상담사 직접 등록이 이 기능의 존재 이유라
  admin 전용으로 좁히지 않는다. 게이트는 고객 삭제 라우트의 인라인 문법 미러
  (서버가 진짜 게이트, 프론트 버튼 숨김은 UX 보조).
- 클라: `roleTab === "딜러"`면 버튼 자체를 숨긴다(삭제 버튼의 `canDeleteCustomers` 문법).

## API

`POST /api/customers` (`src/routes/customers.ts`, `GET /` 옆):

```
body: {
  name: string,            // 필수 — trim 후 1자 이상, 아니면 400
  phone?: string | null,   // 클라가 숫자만 전송(DB 규칙). 서버는 PATCH와 동일하게 정규화 없이 저장
  source?: string | null,  // 값이 오면 SOURCE_MANUAL_OPTIONS만 허용, 아니면 400
}
→ 201 + 생성 행 전체(customers.$inferSelect — 클라는 customerCode만 소비)
→ 400 이름 공백 / source 비허용
→ 403 dealer
```

- **source는 수동 어휘만**: `SOURCE_MANUAL_OPTIONS`(대표전화·카카오·소개·추천·재구매·유튜브·검색·기타).
  자동 어휘("앱 견적요청" 등)를 수기 등록이 쓰면 앱 유입 통계가 오염된다. `validateLookupValue("source")`는
  전체 `SOURCE_OPTIONS`를 보므로 쓰지 않고 manual 부분집합을 라우트에서 검사한다.
  (서버의 `client/src/data/customers` 상수 import는 기존 확립 경계 — schema.ts가 이미 쓴다.)

## 서버 쿼리 — `createCustomerManual`

`src/db/queries/customers.ts`에 신설. 라우트가 `c.var.db.transaction()`으로 감싸 호출(채번+INSERT
원자성 — 승격 라우트 동일).

- `nextCustomerCode(ex)` import(consultations.ts 선례) + INSERT.
- 시드는 승격과 같은 값: `statusGroup: "신규"` · `status: "상담접수"` · `receivedAt: now`.
  코드 공유는 하지 않는다(확정 결정 4).
- **자동 배정**: 라우트가 `getStaffName(c.var.user.id)`으로 등록자 이름을 해석해
  `advisorId` + `advisorName` + `assignedAt`을 함께 세팅한다(PATCH의 "이름과 id 동반" 규칙 —
  이름만 갈리고 구 id가 남는 스테일 방지 규칙과 정합). **이름 해석 실패(프로필 없음·공란)면
  미배정으로 생성한다(fail-open)** — 등록이 프로필 이름 부재로 막히는 게 더 나쁘다.
  `team`은 건드리지 않음(팀 개념 없음 확정, 2026-07-03). 자기 배정이라 배정 알림 경로는 아예 없다
  (PATCH의 알림 조건 `advisorId ≠ 배정자`가 항상 거짓 — 코드 0줄).
- **임베딩 훅**: 커밋 후 `scheduleEmbedOnWrite(c, { sourceType: "customer_profile", sourceId: row.id })`.
  source·advisorName이 프로필 청크 구성 필드(`CUSTOMER_PROFILE_EMBED_KEYS`)다. 구성 필드가 전부
  비면 빌더가 빈 텍스트를 내 행을 안 만드는 기존 경로가 흡수.
- **채번 race 수용**: 동시 등록 2건이면 같은 코드 → `customer_code` UNIQUE 충돌 → 500. 승격 경로와
  동일 특성(max+1 채번, 낙관). 상담사 수기 등록의 동시성은 실무상 무시 가능 — 실패 시 재시도로 해소.

## 클라이언트

- **lib**: `client/src/lib/customers.ts`에 `createCustomer(input)`(`sendJson` POST, 반환에서 `customerCode`만 소비).
  신규 `client/src/lib/customer-create.ts`에 순수 함수 2개 — TDD 유닛:
  - `sanitizePhoneDigits(raw)`: 제출용 숫자만 추출(DB 규칙 준수).
  - `findPhoneDuplicate(customers, phone)`: 양쪽 숫자 정규화 비교, 첫 일치 `{ name, customerId }` 반환.
    빈/불완전 입력(숫자 10자리 미만)은 null — 타이핑 중 조기 경고 방지.
- **폼 팝오버**: 헤드바 버튼 onClick → 옆자리 `bulk-delete-confirm`과 같은 팝오버 문법
  (`.customer-create-*` 신규 클래스, CSS는 목록 도메인 파일). 필드: 이름(text)·연락처(text)·
  유입 경로(select, 기본 "대표전화"). **select는 controlled + `bindSelect`**(Safari 규칙 — CLAUDE.md).
- **중복 소프트 경고**: 연락처 입력 변화 시 `findPhoneDuplicate`로 검사 →
  "김민준(CU-2605-0020)과 연락처가 같습니다" 인라인 경고. 등록 버튼은 막지 않는다.
- **App 배선**: `App.tsx`에 `handleCustomerCreated(customerCode)` —
  `reloadCustomers()` + `navigate(/customers?customer=<code>)` + 토스트.
  드로어는 URL이 single source(`/customers?customer=code`)라 목록 도착 시 자동 오픈
  (`isDrawerOpen`이 `selectedCustomer` 발견 시점에 성립) — 새 상태 0, 기존 메커니즘 그대로.
  `CustomerManagementPage`에 `onCustomerCreated?: (customerCode: string) => void` prop 추가.
- **에러 처리**: 서버 한글 문구(`body.error`)를 폼 안에 그대로 표시하고 폼 유지. 제출 중 버튼
  disabled. 성공 시 폼 닫기 + 입력 리셋.

## 테스트 — 잔재 tripwire와의 교차점

- **쿼리 함수**: 실 master + **트랜잭션 롤백** 패턴(잔재 0)으로 채번 형식(`CU-YYMM-####`)·시드 3필드·
  배정 필드 동반 세팅·미배정 폴백을 검증.
- **라우트 통합**: 400(이름 공백·source 자동 어휘)·403(dealer)은 INSERT 없음. **성공 1건은 실 INSERT +
  try/finally 삭제.** ⚠️ 서버가 실채번하므로 이 행은 픽스처 접두사가 없어 **기존 잔재 tripwire
  (코드 접두사 registry)가 못 잡는다** → `fixture-codes.ts`에 `TEST_CUSTOMER_NAMES = ["수기등록테스트"]`
  (이름 리터럴 registry)를 추가하고 `check-test-residue`가 이름도 조회하도록 소폭 확장한다
  (2겹 철학 유지 — 실행이 끊겨 남으면 다음 `test:server`가 잡는다).
- **유닛**: `customer-create.ts` 순수 함수 TDD(중복 판정·숫자 정규화·불완전 입력).
  폼 팝오버는 거대 페이지 관례대로 수동/스모크 검증.
- **검증 세트**: typecheck 0 · lint 0 · test:unit · test:server · build + 격리 스택 브라우저 스모크
  (등록 → 드로어 자동 오픈 → psql 대조(시드·배정·receivedAt) → 중복 경고 표시 → 원복 삭제).
  스모크 고객 코드는 실채번이라 반드시 즉시 삭제(공유 master).

## 범위 밖

- 일괄 담당자 변경(남은 목업 버튼 — 별도 슬라이스).
- `requireRole` 헬퍼 추출·확산(고객 삭제 follow-up과 합류).
- 중복 문의 표시 인박스 UI(`ref/pending-tasks.md` 기존 항목).
- 목록/상세 화면(비 AI) 역할 scope.
- 등록 직후 드로어에서 이어 입력하는 필드들의 UX 개선(기존 드로어 그대로 사용).
