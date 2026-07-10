# 고객 삭제 설계 (2026-07-10)

## 배경

이사님 실기 지적: 고객 목록에서 `1명 고객 삭제`를 눌러도 리로딩하면 되살아난다.

원인은 버그가 아니라 **미구현**이다.

```ts
// client/src/pages/CustomerManagementPage.tsx:443
function deleteSelected() {
  updateCustomers((current) => current.filter((c) => !selected.includes(c.no)));
  setSelected([]);   // 프론트 배열에서만 제거. API 호출 없음.
}
```

서버에 `DELETE /api/customers/:id` 라우트가 **존재한 적이 없다**. 자식 리소스(메모·할일·일정·견적·서류)만 있다. 옆의 `담당자 변경`은 `disabled` 목업이고 `고객 등록`은 `onClick`이 없다 — 세 버튼 모두 레이아웃 자리표시자였다.

발단이 된 유령 행 `CU-EMBRT-f551d4e2 / 배선테스트`는 `src/routes/customers.embed.test.ts:27`의 픽스처가 2026-07-09 07:04 UTC에 남긴 잔재다(공유 master, `afterAll` 미실행). 별건으로 정리한다.

## 확정 결정 (이사님, 2026-07-10)

| # | 결정 | 근거 |
|---|---|---|
| 1 | **하드 삭제** (소프트 삭제 채택 안 함) | 진행 상태 `불발`과 사이드바 `보류/이탈`이 이미 "감추기"를 담당한다. `deleted_at`을 얹으면 안 보이게 하는 축이 둘이 되고, 그 드리프트가 이번 주에 두 번 사고를 냈다(#180 목록 배지 ↔ AI 리포트 집합) |
| 2 | **앱 수신함 카드가 1건이라도 있으면 삭제 거부(409)** | 아래 "왜 회수가 아니라 거부인가" 참조 |
| 3 | **앱 계정 연결 고객도 삭제 가능** | `public.profiles`는 앱 소유라 그대로 남는다. 그 유저가 다음에 견적요청/상담신청을 넣으면 인박스에 승격 대기로 다시 뜬다 |
| 4 | **감사 기록 남김** | 되돌릴 수 없는 조작 |
| 5 | **`admin` 전용 (403 fail-closed)** | 파괴적이고 앱 사용자 화면까지 바꾼다 |
| 6 | **다건 삭제는 건별 트랜잭션 + 실패 목록 반환** | 20명 중 1명이 막혔다고 19명을 되돌리는 건 실무에서 더 나쁘다 |

## 소유권 경계 — "스키마"가 아니라 "저작자"

`public` 스키마가 `crm.customers`를 참조하는 FK는 **0개다**(실측). 고객을 지워도 앱 데이터는 DB 차원에서 아무 일도 일어나지 않는다. 앱 데이터가 건드려지는 건 **오직 우리 코드가 그러기로 결정했을 때**뿐이다.

> **CRM이 쓴 것만 CRM이 거둔다. 앱과 고객이 만든 것은 읽기만 한다.**

| 앱 소유 데이터 | 저작자 | 처리 |
|---|---|---|
| `public.profiles` | 앱/고객 | **불가침.** `profiles-write-guard.test.ts`가 기계로 막는다 |
| `public.quote_requests` (행) | 고객 | 행 삭제 없음. `status`만 `completed→open` 복원(전이는 원래 CRM 소관) |
| `public.consultations` (행) | 고객 | **불가침** |
| `public.chat_sessions` / `chat_messages` | 앱/상담사 | **불가침** (`crm.customers`와 연결 없음 — `profiles.id` 기준) |
| `public.advisor_quotes` | **CRM** (발송 시 upsert) | **고객 삭제는 이 행이 있으면 거부.** 견적 삭제 경로(#159)에서만 회수 |

## 왜 회수가 아니라 거부인가 (2026-07-10 이사님 결정)

처음엔 "CRM이 쓴 행이니 CRM이 거둔다"로 잡았다가 뒤집었다. 이사님 판단: **고객이 앱에서 받아본 견적은 남아 있어야 한다.**

여기서 원칙을 정확히 짚을 필요가 있다. "앱 카드 불멸"이 원칙인 것은 **아니다** — CRM 견적함에서 발송된 견적을 삭제하면 지금도 앱 카드가 사라진다(`deleteQuote()` → `deleteAdvisorQuoteByCrmQuoteId`, 발송 파이프라인 스펙 확정 결정 7, 이미 배포됨). 진짜 원칙은 이것이다.

> **고객 삭제가 앱 카드를 조용히 연쇄 삭제해서는 안 된다.**

- 상담사가 "이 **견적**을 지운다"고 누르면 → 앱에서 그 견적이 사라진다. **의도한 행동의 직접 결과.**
- 상담사가 "이 **고객**을 지운다"고 누르면 → 앱에서 견적 2건이 사라진다. **본인도 모르는 부작용.**

409 거부는 두 번째만 막는다. 첫 번째는 그대로 둔다.

지우려면 명시적 2단계를 밟는다: **견적함에서 견적 삭제(앱 카드 회수) → 고객 삭제.**

**편의 경로(삭제 창에서 회수될 카드를 나열하고 한 번에 처리)는 채택하지 않는다.** 발송 이력 있는 고객을 지우는 일은 매우 드물고(아래 실측), 되돌릴 수 없는 조작에 편의 경로를 미리 뚫어둘 이유가 없다. 2단계의 번거로움은 기능이지 결함이 아니다. 필요해지면 그때 붙이는 게 쉽고, 한 번 뚫린 경로를 나중에 막는 건 어렵다.

**실측(2026-07-10, 전체 23명)** — 지우고 싶어지는 고객은 애초에 앱에 뭘 보낸 적이 없다.

```
견적 없음          20명  ← 오입력·중복·테스트 잔재(배선테스트 포함). 그대로 삭제됨
미발송 견적만       1명  ← 앱에 아무것도 안 갔으니 삭제됨
앱 카드 보유        2명  ← 김지안(1건)·제임스(2건). 실제 고객이고 지울 이유가 없다
```

## 삭제 대상 인벤토리 (실측)

```
crm.customer_memos      CASCADE
crm.customer_tasks      CASCADE
crm.customer_schedules  CASCADE
crm.customer_documents  CASCADE
crm.consultations       CASCADE
crm.embeddings          CASCADE   ← customer_id NULL 행 0건(전 소스타입) = 코퍼스 완전 정리
crm.quotes              NO ACTION ← ⚠️ DB가 삭제를 막는다. 코드가 먼저 치운다
```

`crm.embeddings.customer_id`는 모든 행에 채워져 있다(`quote`·`quote_request`·`customer_profile` 포함). 따라서 **업무 AI 코퍼스는 DB CASCADE만으로 완전히 사라진다.** 코드가 할 일이 없다.

### Storage는 DB로 묶을 수 없다

| 컬럼 | 현재 행 수 |
|---|---:|
| `crm.customer_documents.file_path` | 4 |
| `crm.customer_documents.thumb_path` | 1 |
| `crm.quotes.file_path` (견적 원본) | 1 |

**동시에 수정할 기존 결함**: 서류 삭제 라우트는 `removeOrphanObject`로 원본·썸네일을 지우는데, **견적 삭제 라우트는 Storage를 전혀 지우지 않는다.** `crm.quotes.file_path`가 지금도 고아로 남고 있다. 고객 삭제를 구현하면 이 구멍이 그대로 확대되므로 함께 막는다.

## 순서 — Storage가 트랜잭션 밖인 이유

```
BEGIN
  1. 가드: 그 고객의 견적을 참조하는 public.advisor_quotes 행 수 > 0 → ConflictError(409)
  2. Storage 경로 수집 (documents.file_path·thumb_path, quotes.file_path)
  3. 견적별 deleteQuote(customerId, quoteId, tx)   (FK NO ACTION을 코드가 먼저 해소)
  4. DELETE crm.customers                          (자식 6종 CASCADE)
  5. INSERT crm.customer_deletions                 (감사)
COMMIT
  6. Storage 객체 제거 (best-effort)
```

**가드는 트랜잭션 안에 있어야 한다.** 밖에서 확인하면 가드 통과와 견적 삭제 사이에 다른 세션이 발송해(`advisor_quotes` INSERT) 유령 카드가 생긴다. 같은 트랜잭션 안에서 읽고 지워야 그 창이 닫힌다.

**견적은 일괄 `DELETE`가 아니라 `deleteQuote()`를 견적당 호출한다.** 가드를 통과했으니 회수할 카드는 0건이고 `reopenQuoteRequestIfUndelivered`도 no-op일 **것으로 보이지만**, 그 등가성은 "`completed`인 요청에는 반드시 카드가 있다"는 불변식에 의존한다. 그 불변식은 회수 경로(`deleteQuote`)로만 유지되며, 과거 psql 직접 삭제 같은 우회로 깨져 있을 수 있다(#169에서 실제로 고아 임베딩이 그렇게 생겼다). `deleteQuote()`가 견적 해체의 SSOT이므로 그대로 쓴다 — 고객당 견적은 한 자릿수라 성능 논거가 성립하지 않고, 가드를 나중에 완화해도 자동으로 옳다.

Storage 삭제는 **롤백되지 않는다.** 커밋 전에 지우면 트랜잭션이 실패했을 때 **DB 행은 살아 있는데 파일만 증발**한다 — 복구 불가능한 데이터 손실이다. 커밋 후에 지우다 실패하면 고아 파일이 남는데, 이건 아무도 조회할 수 없는 바이트일 뿐이다. `removeOrphanObject`가 이미 그 계약이다(실패해도 throw하지 않고 로그만).

경로 수집은 **삭제 전 트랜잭션 안에서** 해야 한다. CASCADE로 행이 사라진 뒤엔 경로를 알 수 없다.

### `advisor_quotes`에 FK를 걸지 않는 이유

기술적으로는 cross-schema FK가 가능하다(`crm.quotes → catalog.trims`가 이미 그렇다). 그러나 회수에는 "마지막 카드면 견적요청을 `completed→open`으로 되돌린다"는 도메인 규칙이 붙어 있고 **FK CASCADE는 그걸 표현하지 못한다.** 게다가 `public` 스키마 DDL은 앱 관할이다. 코드 훅(`deleteQuote`)을 그대로 재사용한다.

## 역할 게이트

인증 미들웨어는 `CRM_ROLES`(`staff·manager·admin·dealer`) 중 하나면 통과시킨다. **라우트별 역할 검사가 아직 없다.** 버튼만 숨기면 `curl` 한 번에 뚫린다 — 오늘 앱 팀의 `profiles` 사고가 정확히 그 모양이었다(권한은 넓고 가드는 얇음).

- `DELETE /api/customers/:id` : `c.var.user.role !== "admin"` → **403 fail-closed**
- 프론트 버튼 숨김은 **UX 보조일 뿐** 보안 경계가 아니다.
- 이 게이트는 앞으로의 파괴적 조작에 재사용할 첫 조각이다(`requireRole("admin")`).

## API

```
DELETE /api/customers/:id
  200 { id }
  403 { error: "권한이 없습니다." }                              role !== admin
  404 { error: "고객을 찾을 수 없습니다." }
  409 { error: "앱으로 발송한 견적이 N건 있습니다. 먼저 견적을 회수하거나 진행 상태를 '불발'로 바꾸세요." }
```

409는 `ConflictError`를 던지면 `run()`이 매핑한다(`routes/shared.ts:26`).

다건은 클라가 순차 호출한다. 별도 bulk 라우트를 두지 않는다 — 건별 독립 트랜잭션이 결정이므로 서버 bulk 엔드포인트는 실패 목록을 되돌려주는 얇은 래퍼일 뿐이고, 클라가 이미 진행률을 보여줘야 한다. (재검토 트리거: 100명 단위 삭제 요구가 생기면 bulk 라우트로 승격.)

## 감사 테이블

```sql
CREATE TABLE crm.customer_deletions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL,          -- 삭제된 고객의 원 id (FK 없음 — 대상이 사라진다)
  customer_code text NOT NULL,
  name          text NOT NULL,
  app_user_id   uuid,                   -- 앱 연결 고객이었나
  quote_count   int  NOT NULL DEFAULT 0,-- 함께 회수된 견적 수
  deleted_by    uuid NOT NULL,          -- JWT sub (loose id, public FK 보류 관례)
  deleted_at    timestamptz NOT NULL DEFAULT now()
);
```

스냅샷(jsonb 전체 복원)은 **채택하지 않는다.** 복원은 인박스 재승격으로 충분하고, 개인정보 파기 요구가 오면 스냅샷이 파기 대상으로 남는다.

마이그레이션: `drizzle/0027` (`db:generate` → `db:migrate`, `schemaFilter:["crm"]`).

## 클라이언트

- `deleteSelected`를 실제 API 호출로 교체. 낙관 제거 금지 — **성공한 건만** 목록에서 뺀다.
- 확인 UX: 되돌릴 수 없음 + 앱 카드가 회수됨을 명시. 다건이면 대상 수를 보여준다.
- `admin`이 아니면 버튼 자체를 렌더하지 않는다.
- 실패 건은 토스트로 사유 표시.

## 검증

- `bun run test:server`
  - `403` — staff/manager/dealer 토큰
  - `404` — 없는 uuid
  - `409` — 앱 카드 있는 고객(**가드가 실제로 막는지**). 카드 시드는 `advisor_quotes` INSERT라 알림 트리거가 물려 있다 → **`withNotifyGuard` 또는 `setTestDb(guardedDb(db))` 필수**(PR #209). 안 그러면 실 고객 FCM이 나간다
  - `200` — 견적(미발송)·메모·할일·일정·서류·임베딩이 있는 고객 → 전부 0건, 감사 행 1건, 고객 0건
  - 임베딩 CASCADE는 DB가 하지만 **테스트로 잠근다** — 나중에 FK가 바뀌면 AI가 유령 고객을 기억한다
- Storage는 `mock.module("../lib/storage")`로 `removeObject` 호출 인자 단언(`routes/customers.test.ts` 상단 관례). **견적 원본 경로도 포함되는지** 단언(기존 결함 동시 수정분)
- `bun run test:unit` — admin이 아니면 버튼 미렌더, 확인 UX, 성공한 건만 목록에서 제거
- 브라우저 스모크: 격리 스택에서 **스모크 전용 고객을 새로 만들어** 삭제(원복 불가). psql로 자식·임베딩 0건, 감사 행 1건 대조. 김지안·제임스는 절대 건드리지 않는다

## 같은 PR에 함께 넣은 것 (이사님 지시)

### 1. 견적 삭제 경고 강화 — 409 가드가 안내하는 "먼저 회수하세요"의 안전한 길

409는 "견적함에서 견적을 먼저 삭제하라"고 안내한다. 그 첫 단계가 안전해야 2단계 전체가 안전하다.

확인창 자체는 이미 있었다(`QuoteList.tsx` 인라인 confirm, `quote-meta.ts` 분기 3종). 그런데 **그 문구를 잠그는 테스트가 0건**이었다 — 되돌릴 수 없는 조작을 막는 유일한 안전장치인데 누가 지워도 아무것도 실패하지 않는다.

- `quote-meta.test.ts` 신설: 계약 진행 불가 / 발송됨 앱 경고 / 미발송 세 분기 고정. `appStatus==="sent"` 문구에 `"고객 앱"`·`"되돌릴 수 없"`·`"새 견적"`이 반드시 들어간다.
- 문구 보강(이사님 승인): `"고객 앱 견적함에 있는 견적도 함께 삭제됩니다."` → **`"고객 앱 견적함에서도 사라지며, 되돌릴 수 없습니다. 다시 보내려면 새 견적을 발송해야 합니다."`**
  - 구 문구는 "함께 삭제됩니다"만 읽고 *"다시 발송하면 되겠지"* 로 오해할 여지가 있었다. 회수된 카드는 복구 경로가 없고, 재발송은 새 카드라 열람 여부·발송 시각을 잃는다.

### 2. 견적 삭제 Storage 고아 (기존 결함)

서류 삭제 라우트는 `removeOrphanObject`로 원본·썸네일을 지우는데 **견적 삭제 라우트는 Storage를 전혀 지우지 않았다.** `crm.quotes.file_path`가 계속 고아로 쌓이고 있었다(실측 1건). 고객 삭제를 구현하면 그대로 확대되므로 함께 막았다. 회귀 테스트 2종(원본 있음/없음) + 변이 검증(정리 코드를 빼면 정확히 그 테스트가 실패).

## 열린 항목 (범위 밖)

- `담당자 변경`·`고객 등록` 버튼 목업은 그대로 둔다.
- 테스트 픽스처 잔재 tripwire(`CU-EMBRT-`·`CU-ROUTE-`·`CU-SEND-`·`CU-RSEND-`)는 별도 슬라이스.
- `requireRole` 게이트를 다른 라우트로 확산하는 것은 후속.
