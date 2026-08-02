# 경영 리포트(/admin-dashboard) 실데이터화 — 구현 스펙 (2026-08-02)

> 조사·설계 결정은 2026-07-30 세션에서 승인까지 끝났고(유슨생), 착수만 보류돼 있었다. 이 문서는
> 그 설계를 실측으로 재검증해 확정한 것이다. **화면 전체를 실데이터로 바꾸는 문서가 아니다** —
> 원천이 확실한 3영역만 갈고, 나머지는 목업으로 남기되 **"샘플" 배지로 구분**한다.

## 1. 범위

| 영역 | 이번 | 근거 |
|---|---|---|
| 전체 운영 5칩(신규 유입·상담 진행중·견적 발송·계약 완료·출고 예정) | ✅ 실데이터 | 원천 전부 존재 |
| 브랜드별 문의 현황 | ✅ 실데이터 | `quote_requests` × `catalog` 조인 실측 성공 |
| 견적/계약 퍼널(작성→송출→열람→계약진행) | ✅ 실데이터 | `crm.quotes` + `advisor_quotes` |
| 히어로(전체 출고·리스 실적·렌트 실적) | ❌ 목업 유지 | **실적 기준 시점(견적/계약/출고/입금) 미합의** — 어설픈 실데이터가 더 위험 |
| 상단바 요약(86대·48.7억·29.9억) | ❌ 목업 유지 | 히어로와 같은 값 계통 |
| 나머지 6탭(상담 전환·매출/지출·직원 생산성·유입 채널·견적/계약·출고/정산) | ❌ 목업 유지 | 아래 §6 |
| 담당자 관점·확인 포인트 | ❌ 목업 유지 | 응답시간 원천 없음 / 서술형 콘텐츠 |

## 2. 지표 정의 (2026-08-02 실측 기준)

기간은 **KST 월 경계**로 자른다. 전월 대비 델타는 신규 유입에만 붙인다(나머지는 스냅샷이거나
코호트라 전월 비교의 의미가 다르다).

| 지표 | 정의 | 월 스코프 |
|---|---|---|
| 신규 유입 | `crm.customers.received_at` ∈ 월 | ✅ |
| 상담 진행중 | `status_group` ∈ 진행 6그룹(신규·상담중·견적·차량체크·심사서류·관리중) | ❌ **스냅샷** |
| 견적 발송 | `crm.quotes.sent_at` ∈ 월 · 열람 = 그 코호트 중 `advisor_quotes.viewed_at IS NOT NULL` | ✅ |
| 계약 완료 | `status_group = '계약완료'` | ❌ **스냅샷** |
| 출고 예정 | 미완료 `customer_schedules.type = '출고'` · 지난 날짜는 `overdue`로 분리 | ❌ 스냅샷(미래분) |
| 브랜드별 문의 | `quote_requests.created_at` ∈ 월 × `trims→models→brands` | ✅ |
| 퍼널 | 작성(`created_at`∈월) / 송출(`sent_at`∈월) / 열람(송출 코호트 내) / 계약진행(작성 코호트 중 `decision_status='contracting'`) | ✅ |

퍼널의 비율 기준은 **작성**이다(월 코호트의 출발점). 계약진행만 상태값이 스냅샷이라 "그 달에 작성된
견적 중 지금 계약 진행인 것"이라는 혼합 의미를 갖는다 — 월이 지날수록 늘어날 수 있다.

### 2a. 박제할 한계 — 스냅샷 지표는 월을 못 가린다

`상담 진행중`·`계약 완료`는 **전이 시각 컬럼이 없다.** `customers`에는 `status_group`의
현재 값만 있고 "언제 계약완료가 됐는지"가 없어서, 과거 월을 선택해도 **오늘 기준 값이 나온다.**
UI에 그대로 두면 "5월을 봤는데 8월 숫자"가 되므로 **해당 칩에 "현재 기준" 표기를 붙인다.**
근본 해소는 상태 전이 이력 테이블이 필요하고, 그건 별도 슬라이스다.

`status_group` 어휘는 `client/src/data/customers.ts`의 `customerStatusGroups` 키가 SSOT다 —
리터럴을 서버에 복사하지 않고 그 상수를 import한다(서버→클라 순수 모듈 import 경계, AGENTS.md).

### 2b. 열람 SSOT = `public.advisor_quotes.viewed_at`

`crm.quotes.viewed_at`은 **전 행 0건**(2026-08-02 실측: 32행 중 0). 앱이 열람을 찍는 곳은
`advisor_quotes`뿐이고 연결키는 `advisor_quotes.crm_quote_id`다. 실측 22행 중 21행 열람.

## 3. API 계약

```
GET /api/reports/admin?month=YYYY-MM   (month 생략 시 현재 월 KST)
  auth → dealerWriteGate → db → requireRoles(["admin"])
```

```jsonc
{
  "month": "2026-07", "prevMonth": "2026-06",
  "overview": {
    "newInflow":          { "count": 2,  "prevCount": 2 },
    "inProgress":         { "count": 11 },              // 스냅샷
    "quotesSent":         { "count": 22, "viewedCount": 21 },
    "contracted":         { "count": 8 },               // 스냅샷
    "upcomingDeliveries": { "count": 1,  "overdueCount": 0 }
  },
  "brandInquiries": { "total": 27, "rows": [{ "brand": "BMW", "count": 12 }] },
  "quoteFunnel":    { "created": 28, "sent": 22, "viewed": 21, "contracting": 2 }
}
```

- 게이트는 **admin 단독**. 화면이 `isAdmin`일 때만 노출되므로(App.tsx의 `/admin-dashboard`
  Navigate 가드) 서버도 같게 맞춘다 — 경영 지표는 fail-closed가 맞다(`staff.get("/org")` 선례).
- 월 파라미터가 `YYYY-MM` 형식이 아니면 **400**(fail-loud). 미래 월도 그대로 허용한다(빈 결과).

## 4. 파일

| 파일 | 역할 |
|---|---|
| `src/lib/report-month.ts` | 월 경계 순수함수(파싱·KST 경계→UTC·전월). **TDD·단위테스트** |
| `src/db/queries/reports.ts` | 집계 3종 |
| `src/routes/reports.ts` | 라우트 + zod 검증 |
| `src/app.ts` | `protect("/api/reports/*")` + `app.route` |
| `client/src/lib/reports.ts` | 타입 + `getJson` |
| `client/src/pages/DashboardPages.tsx` | `AdminDashboardPage` 배선 + 월 선택 |

실 DB 테스트를 추가하면 **`src/test-utils/db-bound-tests.ts` registry에 등록**해야 한다
(미등록 시 CI `test:pure`가 red).

## 5. 결정

1. **기간 = 월 선택 드롭다운 + 기본값 "데이터가 있는 최근 월"이 아니라 현재 월.**
   원래 설계는 "현재 월 자동, 월 선택 UI 없음(후속 PR)"이었으나 **2026-08-02 실측에서 8월
   데이터가 전 지표 0건**으로 확인됐다(7월 문의 27·발송 22 vs 8월 0). 현재 월 고정이면 이사님이
   처음 여는 화면이 전부 0이라 "고장"으로 읽힌다. API가 이미 `?month=`를 받으므로 클라에 select
   하나를 추가하는 비용으로 해소한다. 기본값은 **현재 월 유지**(리포트의 기본 프레임은 "이번 달"이
   맞고, 비어 있으면 직접 이전 달로 넘기면 된다).
   ⚠️ controlled `<select>`는 **`onChange`+`onInput` 병행 바인딩 필수**(Safari 선택 유실 —
   전역 CLAUDE.md 규칙).
2. **히어로·상단바 요약은 목업 유지.** 실적 기준 시점이 이사님 합의 사항이다(§1).
3. **브랜드별 문의는 선택 월 기준**(누적 아님) — 리포트의 월 프레임과 일치시킨다.
4. **목업 잔존부에 "샘플" 배지.** 실/목업이 한 화면에 섞이므로 구분이 없으면 이사님이 목업을
   실적으로 오인한다. 실데이터 영역에는 배지를 붙이지 않는다(기본이 실데이터라는 뜻).

## 6. 선행이 필요한 영역 (이번 비범위 사유)

- **매출/지출·출고/정산**: 원천 테이블이 DB에 아예 없다. 스키마 신설 + §1의 실적 기준 시점 합의 선행.
- **직원 생산성**: 응답시간 원천 없음. `crm.consultations` 0행.
- **상담 전환**: 원천은 있으나(`public.consultations` 83 · `chat_sessions` 11) **앱이
  `consultations.status` 전이를 쓰지 않아**(pending 82/83, completed 1) 퍼널이 성립하지 않는다.
  진짜 처리 신호는 CRM 승격 / `consultation_dismissals`(2건). 지표 재정의가 선행이다.
  ※ 같은 앱 테이블이라도 `quote_requests.status`는 전이가 실제로 돈다(open 105·completed 21·
  closed 1) — "앱은 status를 안 쓴다"는 일반화는 틀리고, **`consultations`에 국한된 성질**이다.
- **유입 채널**: `customers.source` 표본 24로 너무 작다(월 단위로 쪼개면 한 자릿수).

## 7. 함정

- 리스/렌트 어휘 2계통: 앱 `payment_method`(lease/rent/cash/installment) vs CRM
  `purchase_method`(운용리스 등 6종). 이번 범위엔 안 들어오지만 히어로 실데이터화 시 매핑 SSOT 필요.
- 화면에 `2026년 5월` 하드코딩이 다수 — 실데이터 섹션은 **응답 `month`로 라벨링**한다.
- 7월 실숫자가 목업보다 작아 허전해 보인다(신규 유입 목업 18 → 실 2). **의도된 정직함이지
  데이터 결함이 아니다.**
- `crm.quotes`와 `advisor_quotes`는 스키마가 다르다(crm ↔ public) — 조인은 `crm_quote_id`로.
