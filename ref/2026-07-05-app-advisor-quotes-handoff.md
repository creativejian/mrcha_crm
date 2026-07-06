# [앱 세션 인계문] 상담사 견적 수신함 `public.advisor_quotes` (2026-07-05)

대상: mr-cha-app(Flutter) 레포에서 작업하는 AI 세션.
배경: CRM(mr-cha-crm 레포)이 상담사 견적을 앱 사용자에게 발송하는 파이프라인을 구현한다. **CRM이 발송 시 앱카드 "라벨 완성본"을 `public.advisor_quotes`에 넣고, 앱은 꺼내서 그대로 그리기만 한다**(앱에 계산 로직 불필요). 이사님 승인 완료(2026-07-05): ①public 테이블 신설 ②발송 시 `quote_requests.status→'completed'` 전이 ③딜러 입찰(bids) 폐기 — 단 bids DROP은 이번에 안 함(dormant 방치).
쌍문서: CRM 레포 `ref/specs/2026-07-05-crm-quote-app-send-design.md`. **payload 계약이나 DDL을 바꾸면 반드시 CRM 세션과 동기화할 것.**

## 순서 (병렬 게이트)

1. **[먼저·게이트] 아래 마이그레이션을 앱 레포 `supabase/migrations/`에 추가·적용**하고 유슨생에게 완료를 알린다 — CRM 세션의 서버 테스트가 이 테이블을 필요로 한다(같은 master DB).
2. 이후 앱 UI 작업(아래)은 CRM 구현과 **완전 병렬** 가능. 실데이터가 필요하면 CRM 세션이 스모크 발송 1건을 넣어줄 수 있다.
3. 통합 스모크: CRM 발송 → 앱 표시 → 앱 열람(viewed_at) → CRM 견적함 열람 배지. 공유 master이므로 스모크 데이터는 원복.

## 1) 마이그레이션 (파일명 예: `20260705090000_create_advisor_quotes.sql`)

```sql
-- 상담사 견적 수신함: CRM이 발송 시 앱카드 라벨 완성본(payload)을 upsert한다.
-- 앱은 SELECT(본인 것) + viewed_at UPDATE만. INSERT/DELETE는 CRM 백엔드(postgres role, RLS 미적용) 전담.
-- 승인: 이사님 2026-07-05 (public 신설 · completed 전이 · bids 폐기)
CREATE TABLE public.advisor_quotes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 원 견적요청. NULL 허용 = 요청 없이 상담사가 제안한 견적(수기 고객이 앱 연결된 경우).
  quote_request_id uuid REFERENCES public.quote_requests(id) ON DELETE SET NULL,
  -- crm.quotes.id (loose id, cross-schema FK 없음). 재발송 upsert 키.
  crm_quote_id uuid NOT NULL UNIQUE,
  quote_code text NOT NULL,          -- 견적 번호 "QT-2607-0012" (카드 푸터 No.)
  revision integer NOT NULL DEFAULT 0, -- 0=최초 발송, 1+=수정 발송
  vehicle_label text NOT NULL,       -- 목록 카드용 "BMW 5 Series 520i M Spt" (payload 파싱 없이 리스트 렌더)
  monthly_payment bigint,            -- 목록 카드용 월납입금(원). 미정이면 NULL
  payload jsonb NOT NULL,            -- 앱카드 라벨 완성본 스냅샷(계약은 인계문 2절)
  sent_at timestamptz NOT NULL,      -- CRM 서버가 확정한 발송 시각
  valid_until timestamptz,           -- 발송+7일. D-day는 앱이 이 값으로 계산
  viewed_at timestamptz,             -- 고객 최초 열람 시각(앱이 스탬프). 재발송 시 CRM이 NULL 리셋
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_advisor_quotes_user_id ON public.advisor_quotes(user_id);
CREATE INDEX idx_advisor_quotes_quote_request_id ON public.advisor_quotes(quote_request_id);

ALTER TABLE public.advisor_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own advisor quotes" ON public.advisor_quotes
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- 앱은 viewed_at 스탬프 용도로만 UPDATE한다(관례상 제한 없음 — chat_sessions "Users can update own sessions" 선례).
CREATE POLICY "Users can update own advisor quotes" ON public.advisor_quotes
  FOR UPDATE USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Staff can view all advisor quotes" ON public.advisor_quotes
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['staff'::user_role, 'manager'::user_role, 'admin'::user_role])
  ));
```

주의: INSERT 정책이 없는 것은 의도 — 쓰기는 CRM 백엔드(DATABASE_URL, RLS 우회)만 한다. Realtime publication 추가는 이번 범위 밖(알림은 후속 슬라이스, v1은 재조회 기반).

## 2) payload 계약 (payloadVersion: 1)

**모든 값은 CRM이 완성한 표시 문자열이다. 앱은 절대 재계산·재포맷하지 말고 그대로 렌더할 것**(발송본 고정 원칙 — CRM에서 견적을 고쳐도 이미 보낸 카드는 불변, 수정 발송 시 행이 통째로 교체되고 viewed_at이 리셋된다).

앱이 직접 계산해야 하는 것은 딱 2가지(스냅샷에서 의도적으로 제외됨):
- **상태 뱃지**: `viewed_at IS NULL` → "미확인 견적", 아니면 확인됨 (어휘는 앱 재량)
- **D-day**: `valid_until` 기준 D-n / 만료 계산

레이아웃 레퍼런스: CRM `client/src/components/AppCardPreview.tsx`(4섹션 카드 — 유슨생이 스크린샷 보유). 필드:

| 키 | 타입 | 설명(섹션 1 — 헤더·핵심 요약) |
|---|---|---|
| `payloadVersion` | number | 계약 버전 = 1 |
| `brand` | string | "BMW" |
| `vehicleTitle` | string | "5 Series 520i M Spt" (모델·트림 중복 제거된 표시명) |
| `purchaseMethod` | string | "운용리스" 등 배지 |
| `termLabel` | string | "60개월" 배지 |
| `sublineLabel` | string | "2026년식 ｜ 74,300,000원 ｜ 추가옵션 없음" 한 줄 |
| `monthlyLabel` | string | "2,398,000원" (월 납입금 큰 숫자) |
| `rateChipLabel` | string\|null | 금리 칩 "금리 5.3%" — null이면 미표시 |
| `residualLabel` | string | "잔존가치 최대" |
| `residualCondLabel` | string | 조건부 잔존 표기 |
| `totalCostLabel` | string | "총 비용 계산 후 안내" |
| `discountRowLabel` | string | 항상 고정 문구 "최대 할인 적용" — 할인 구성 내역 라벨은 병기하지 않음(2026-07-06부터, 이사님 결정: 고객 앱은 총액만·구성 내역은 CRM 전용) |
| `discountLabel` | string | **맨숫자** "0" · "1,000,000" — 앱이 `-{값}원`으로 렌더("-"·"원"은 정적 부착, CRM AppCardPreview 미러) |
| `depositLabel` | string | "(30%) 22,290,000원" (보증금/선수금/선납금 박스) |
| `mileageLabel` | string | "연 20,000km" |
| `keyPoints` | string[] | 견적 핵심 포인트 bullet 목록 |

| 키 | 타입 | 설명(섹션 2 — 출고 정보 + 취득원가 구성) |
|---|---|---|
| `deliveryComment` | string | "이 차량은 1주일 내 출고 가능해요" (파란 헤더 따옴표 문구) |
| `exteriorColorLabel` / `interiorColorLabel` | string | "미선택" 폴백 포함 |
| `optionSummaryLabel` | string | 옵션 요약 |
| `stockNotice` / `expectedDelivery` / `customerRegion` | string | 재고 안내·출고 예정·고객 지역(발송 시점 스냅샷) |
| `basePriceLabel` `optionTotalLabel` `finalVehiclePriceLabel` `acquisitionTaxLabel` `bondLabel` `deliveryFeeLabel` `incidentalLabel` `registrationCostLabel` `acquisitionCostLabel` | string | 취득원가 구성 아코디언 금액 9필드 — **맨숫자** "59,000,000"·"0" (콤마 포함, '원' 없음). 앱이 `{값}원`으로 정적 부착(CRM AppCardPreview 미러) |
| `acquisitionTaxModeLabel` | string | 세율 모드 텍스트 "일반/하이브리드 감면/전기차 감면/직접 입력" — 그대로 표기('원' 부착 대상 아님) |

| 키 | 타입 | 설명(섹션 3 — 추천 견적 조건) |
|---|---|---|
| `hasScenario` | boolean | false면 섹션 3 숨김 |
| `lenderLabel` | string | 금융사 |
| `downPaymentRowLabel` | string | **행 라벨 자체가 값** — "선수금" 또는 "선납금"(할부). 그대로 표기 |
| `downPaymentLabel` | string | 선수금/선납금 값 |
| `carTaxLabel` `subsidyLabel` `rateLabel` `totalReturnCostLabel` `totalTakeoverCostLabel` `dueAtDeliveryLabel` | string | 자동차세·보조금·금리·반납 총비용·인수 총비용·출고 전 납입 |

| 키 | 타입 | 설명(섹션 4 — 추천 이유 + 서비스 + 푸터) |
|---|---|---|
| `recommendReasons` | string[] | 추천 이유 bullet |
| `services` | {label,value}[] | "썬팅: 후퍼옵틱…" → {label:"썬팅", value:"후퍼옵틱…"}. label 빈 문자열 가능 |
| `footerStampLabel` | string | 발송 시각 표기(고정값) |
| `quoteCodeLabel` | string | **"QT-2607-0012"** — "No. " 접두는 payload에 없음, 앱 푸터가 `No. {값}`으로 정적 부착(CRM AppCardPreview:154 미러) |

값이 없는 항목은 CRM이 `"—"` 또는 `"계산 후 안내"` 같은 안내 문자열로 채워 보낸다(null 아님, 위 nullable 명시 필드 제외). 실제 행 샘플은 통합 시점에 CRM 세션이 스모크 발송으로 1건 제공한다.

## 3) 앱 UI 작업 (마이그레이션 적용 후, CRM과 병렬)

1. **모델/인프라**: `DbTables`에 `advisor_quotes` 추가, freezed 모델(`AdvisorQuote` — 정규 컬럼 + payload는 Map 또는 세부 freezed), 리포지토리(`getByUserId`, `getByQuoteRequestId`, `markViewed`), `FutureProvider.autoDispose` — 기존 `SupabaseQuoteRepository` 패턴(`.eq('user_id', uid)` + RLS 이중 방어) 그대로.
2. **내 견적함**(`my_quotes_screen.dart`): "상담사 견적" 섹션 추가(기존 AI견적서·견적요청 2섹션에 병렬). 목록 카드는 정규 컬럼만으로 렌더 가능(`vehicle_label`, `monthly_payment`, `sent_at`, `viewed_at` 미확인 뱃지, `valid_until` D-day). 리치 카드 레퍼런스 = `AiEstimateCard`.
3. **견적 상세 스텁 교체**(`quote_detail_screen.dart:202-233`): "딜러 입찰을 기다리는 중입니다" 정적 카드 → 해당 `quote_request_id`의 advisor_quotes 조회. 있으면 상담사 견적 카드(payload 4섹션 렌더), 없으면 대기 문구 유지하되 **딜러 입찰 어휘 제거**("상담사가 견적을 준비하고 있어요" 등 — 입찰 모델 폐기).
4. **열람 스탬프**: 상담사 견적 상세(또는 카드 펼침) 진입 시 `viewed_at IS NULL`이면 `UPDATE ... SET viewed_at = now()`(본인 행, RLS 허용). 이미 값 있으면 덮지 않기(최초 열람 시각 보존).
5. **status 라벨 참고**: CRM 발송 시 원 `quote_requests.status`가 `'completed'`로 바뀐다 — 기존 `quoteStatusLabel`(완료/초록)이 그대로 동작하므로 코드 변경 불요, 의미만 인지("완료 = 상담사 견적 도착"). **역연산(2026-07-05 앱 정책 제안 반영)**: CRM에서 견적을 삭제(회수)해 그 요청의 advisor 카드가 0이 되면 같은 트랜잭션에서 `status→'open'` 복원 — "완료인데 견적 없음" 모순이 안 남는다(잔여 카드 있으면 completed 유지, 어드민 수동 `closed`는 불가침).

## 하지 말 것

- payload 값 재계산·재포맷(콤마·% 병기는 전부 완성본). **정적 부착 예외 3종만 앱이 장식을 붙인다**: discountLabel(`-{값}원`)·quoteCodeLabel(`No. {값}`)·취득원가 금액 9필드(`{값}원`) — 전부 CRM AppCardPreview 미러.
- advisor_quotes에 앱이 INSERT/DELETE(쓰기는 CRM 전담).
- `statusLabel`/`ddayLabel`을 payload에서 찾기(의도적으로 없음 — 컬럼에서 계산).
- bids 테이블/Bid 모델 재활용(폐기 확정 — DB 컬럼명과 Dart 모델도 어긋나 있는 dormant 코드).
- 공유 master에 스모크 데이터 잔류(테스트 발송분은 원복 협의).
