# 견적 "추가 안내 사항" 저장 — 설계

Date: 2026-06-24
Status: Draft (리뷰 대기)
Topic: 견적 워크벤치 "추가 안내 사항"(출고시기/재고/서비스/추천이유 등)을 DB에 저장 + 워크벤치 입력 wiring
공유 대상: 이사님 · 송실장 · 유슨생 (git 커밋으로 공유)

## 배경

견적 워크벤치 하단 **"추가 안내 사항"** 섹션(`quoteDetailFormRef` 안, `kim-app-guidance-grid`)은 고객 앱 견적카드에 노출될 안내 문구(출고시기 코멘트·재고여부·예상출고·고객지역·핵심포인트·추천이유·서비스 1~4)인데, **전부 하드코딩 `defaultValue`/`<select>` mock이고 DB에 저장되지 않는다**. 워크벤치에서 바꿔도 새로고침하면 사라지고, 견적별로 다른 안내를 유지할 수 없다.

(같은 영역의 "기존 세부 견적 수기 입력"은 비교카드와 중복된 죽은 mock이라 PR #100에서 이미 제거됨. 이번은 남은 "추가 안내 사항"만 다룬다.)

## 범위 결정 (합의)

- **(A) DB 저장 + 워크벤치 입력 wiring만** 이번 슬라이스로 한다.
- **비범위(별도 슬라이스)**:
  - 앱카드 미리보기(`kim-app-card-preview`, line 5010)·실제 고객 앱(Flutter) 노출 — 미리보기 카드 자체가 차량명·가격까지 거의 전부 mock이라 별도 데이터화 필요.
  - select 옵션의 enum/lookup화 — 이미 별도 사이클로 합의됨(이사님 제품 결정 선행). 이번엔 프론트 상수 + jsonb 안 string으로 저장하고 그 결정을 미룬다.
  - `stock_status`(견적함 행 운영 상태) 통합 — 아래 "재고여부 vs stock_status" 참고.

## 데이터 모델

### 컬럼 구조: `quotes.guidance` jsonb 1개

quotes에 이미 `options`·`discount_lines` jsonb 패턴이 있고, 추가 안내는 **표시 전용(필터·집계 안 함)** 이라 개별 컬럼 10개보다 jsonb 1개가 적합하다. 마이그레이션도 1컬럼(nullable·additive)으로 끝난다.

```
quotes.guidance jsonb  -- nullable, additive
```

구조(`null`이면 미입력):

```ts
type QuoteGuidance = {
  deliveryComment: string;   // 출고시기 코멘트 (select)
  stockNotice: string;       // 재고여부 (select)
  expectedDelivery: string;  // 예상 출고 기간 (select)
  customerRegion: string;    // 고객 지역 (select)
  keyPoint: string;          // 핵심포인트 (select)
  recommendReason: string;   // 추천이유 (textarea, 자유)
  services: string[];        // 서비스 1~4 (input, 자유) — 길이 4
};
```

### 재고여부 vs 기존 `stock_status`

- `stock_status`(line 155): CRM 내부 견적 운영 상태("재고확인중" 등), 견적함 행 칩에 표시. **그대로 유지.**
- `guidance.stockNotice`: 고객 앱 노출용 안내("재고 확인 필요"/"즉시 출고 가능"/"배정 대기"/"주문 필요"). 옵션 값 체계가 다르고 용도가 달라 **별개로 둔다.** (통합은 필요 시 후속.)

### select 옵션 / 기본값 (상수화: `client/src/data/quote-guidance.ts`)

| 필드 | 타입 | 옵션 / 기본값 |
|------|------|---------------|
| `deliveryComment` | select | 이 차량은 1주일 내 출고 가능해요 / 배정 확인 후 출고 일정을 안내드릴게요 / 주문 후 생산 일정 확인이 필요해요 / 색상 확정 후 출고 가능 시점을 안내드릴게요 |
| `stockNotice` | select | 재고 확인 필요 / 즉시 출고 가능 / 배정 대기 / 주문 필요 |
| `expectedDelivery` | select | 확인 후 안내 / 1주일 이내 / 2주 이내 / 1개월 이내 / 1개월 이상 |
| `customerRegion` | select | 서울 / 인천 / 경기 / 부산 / 대구 / 광주 / 대전 / 기타 |
| `keyPoint` | select | 잔존가치 최대 조건으로 월 납입금을 낮춘 조건입니다. / 초기 부담을 낮추는 조건입니다. / 월 납입금과 초기 비용 균형을 맞춘 조건입니다. / 인수 선택까지 고려한 안정적인 조건입니다. |
| `recommendReason` | textarea | (자유 입력, 신규 기본값 = 빈 문자열 `""`) |
| `services[0..3]` | input ×4 | (자유 입력, 신규 기본 제안값은 상수로: 썬팅/블랙박스/출고기념품/담당 카매니저 안내) |

신규 견적 작성 시 select는 각 옵션 첫 값을 기본 선택, services는 기본 제안값으로 시작(상담사가 수정). 수정 진입 시 저장된 guidance로 복원.

## 구현 설계

### 백엔드 (`src/db/queries/customer-quotes.ts`, `src/routes/customers.ts`, `src/db/schema.ts`)

- `schema.ts`: `quotes`에 `guidance: jsonb("guidance")` 추가.
- 마이그레이션: `bun run db:generate` → `db:migrate` (crm only, `drizzle/0004`). nullable·additive라 기존 행 영향 없음.
- `createQuote`(`QuoteCreateBody`)·`updateQuote`(`QuoteHeaderPatch`)에 `guidance?: QuoteGuidance | null` 추가 → insert/update set.
- `routes/customers.ts` zod(`quoteCreateBody`/`quotePatchBody`)에 `guidance` 객체 스키마:
  - 각 string 필드 + `services: z.array(z.string())`. 전체 `.nullable().optional()`.
- `getCustomer`(또는 quotes 조회 쿼리): select에 `guidance` 포함, 응답에 노출.

### 읽기 어댑터 (`client/src/lib/kim-quote.ts`)

- `CustomerDetailQuote`에 `guidance: QuoteGuidance | null` 추가.
- `KimQuoteItem`에 `guidance?: QuoteGuidance` 추가.
- `toKimQuoteItem`: `guidance: q.guidance ?? undefined`.
- `QuoteGuidance` 타입은 `client/src/data/quote-guidance.ts`에 정의(서버/프론트 공유 형태, 프론트는 이 파일 기준).

### 프론트 wiring (`client/src/pages/CustomerDetailPage.tsx`)

- **상수**(`client/src/data/quote-guidance.ts` 신규): `QUOTE_GUIDANCE_OPTIONS`(필드별 옵션 배열), `DEFAULT_QUOTE_GUIDANCE`(신규 기본값), `QuoteGuidance` 타입.
- **state**: `const [guidance, setGuidance] = useState<QuoteGuidance>(DEFAULT_QUOTE_GUIDANCE)`. 추가 안내 input/select를 **controlled**(value+onChange)로 전환.
- **추출**: `persistWorkbenchQuote`에서 `guidance` state를 snapshot에 포함 → createQuote/updateQuote payload/patch에 전달.
- **복원(수정 진입)**: `editPrefill`에 `guidance` 추가 → 수정 진입 시 `setGuidance(quote.guidance ?? DEFAULT_QUOTE_GUIDANCE)`.
- **리셋(신규 열기)**: 워크벤치 신규 열기 핸들러에서 `setGuidance(DEFAULT_QUOTE_GUIDANCE)`.
- **읽기 캐시 불변식**: createQuote/updateQuote는 lib에서 `invalidateCustomerDetail` 호출(기존 패턴) — 추가 조치 불필요.

## 엣지케이스 / 리스크

- **빈/부분 입력**: services 일부 빈 문자열 허용. guidance 전체 null 허용(미입력 견적).
- **하위호환**: 기존 견적은 guidance=null → 프론트에서 `?? DEFAULT_QUOTE_GUIDANCE`로 기본값 표시(수정 시 채워 저장).
- **마이그레이션 안전**: nullable·additive, crm only(`schemaFilter:["crm"]`). 팀 공유 master DB 변경이므로 generate→migrate만, push 금지.
- **검증 느슨함(의도)**: zod는 string만 검증(옵션 값 강제 안 함) — enum/lookup 사이클 전이라 자유값 허용. 프론트 select가 옵션 제한.

## 검증 전략

- `bun run typecheck` 0 · `bun run lint` 0 · `bun run build` OK.
- `bun run test:server`: createQuote/updateQuote에 guidance 라운드트립(insert→조회 일치, null 허용, 부분 입력).
- `bun run test:unit`: toKimQuoteItem guidance 매핑, quote-guidance 상수.
- 브라우저(카카오 세션): 워크벤치 추가 안내 입력 → "작성완료" → 리로드 시 복원, 수정 진입 시 저장값 표시.

## 슬라이스

단일 PR로 충분(한 도메인). 커밋 단위: ①schema+마이그레이션 ②백엔드 create/update/read + zod + 서버테스트 ③상수+읽기 어댑터 ④프론트 controlled wiring + 추출/복원/리셋.
