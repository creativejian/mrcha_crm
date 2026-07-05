# 견적 앱 발송 파이프라인 구현 계획 (2026-07-05)

> **For agentic workers:** subagent-driven-development로 태스크별 실행(구현자 + spec/quality 2단계 리뷰). spec = `ref/specs/2026-07-05-crm-quote-app-send-design.md` (확정 결정 9개 — 이 plan과 충돌 시 spec 우선). 앱 세션 인계문 = `ref/2026-07-05-app-advisor-quotes-handoff.md` (payload 계약 SSOT — 필드 추가/변경 시 양쪽 갱신).

**Goal:** 발송 트랜잭션에서 앱카드 라벨 완성본을 `public.advisor_quotes`에 upsert하고, 열람 상태를 read-through로 CRM 견적함에 표시한다.

**Architecture:** 서버 순수 조립기(`src/lib/app-card-payload.ts`)가 crm.quotes 행+대표 시나리오+guidance를 payload jsonb로 변환 → `updateQuote()` 발송 분기에서 같은 트랜잭션으로 upsert + `quote_requests.status='completed'` 전이 → `getCustomer()`가 advisor_quotes.viewed_at을 quotes.viewedAt 자리에 병합.

**게이트:** `public.advisor_quotes` 테이블은 앱 세션이 마이그레이션으로 생성(인계문 1절 DDL). **Task 1·4·5의 서버 테스트는 테이블 생성 후에만 실행 가능** — 테이블 전이면 Task 2·3(순수)부터 진행. 존재 확인: `psql "$DATABASE_URL" -c "\d public.advisor_quotes"`.

**브랜치:** `feature/quote-app-send` → PR → squash 머지(커밋에 [skip ci] 금지).

---

### Task 1: advisorQuotes drizzle 정의 + 쿼리 모듈

**Files:**
- Modify: `src/db/public-app.ts` (테이블 정의 추가 + 헤더 주석 갱신)
- Create: `src/db/queries/advisor-quotes.ts`
- Test: `src/db/queries/advisor-quotes.test.ts` (bun test:server, 실 master — **테이블 게이트**)

**Steps:**
- [ ] `public-app.ts` 헤더 주석의 "CRM은 read만" 원칙 서술을 갱신: advisor_quotes만 write 허용(이사님 승인 2026-07-05, spec 참조). 나머지 테이블 read 전용 원칙은 유지.
- [ ] `advisorQuotes` pgTable 정의 추가 — 인계문 DDL과 컬럼 파리티(관례: numeric 없음이라 mode 이슈 없음, timestamptz는 기존 `quoteRequests.createdAt`처럼 `{ withTimezone: true, mode: "string" }`):
```ts
export const advisorQuotes = pgTable("advisor_quotes", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  quoteRequestId: uuid("quote_request_id"),
  crmQuoteId: uuid("crm_quote_id").notNull(),
  quoteCode: text("quote_code").notNull(),
  revision: integer("revision").notNull(),
  vehicleLabel: text("vehicle_label").notNull(),
  monthlyPayment: bigint("monthly_payment", { mode: "number" }),
  payload: jsonb("payload").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true, mode: "string" }),
  viewedAt: timestamp("viewed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});
```
  주의: drizzle 마이그레이션 대상 아님(`schemaFilter:["crm"]` 밖) — 정의만. `id`/`createdAt`은 DB DEFAULT에 맡기고 insert 시 생략.
- [ ] 실패 테스트 작성(테이블 존재 전제): upsert 신규 insert → 같은 crmQuoteId 재-upsert 시 payload/revision 갱신+viewedAt NULL 리셋 → delete 회수. try/finally로 테스트 행 삭제.
- [ ] `src/db/queries/advisor-quotes.ts` 구현:
```ts
export type AdvisorQuoteUpsert = {
  userId: string; quoteRequestId: string | null; crmQuoteId: string;
  quoteCode: string; revision: number; vehicleLabel: string; monthlyPayment: number | null;
  payload: unknown; sentAt: string; validUntil: string | null;
};
export async function upsertAdvisorQuote(v: AdvisorQuoteUpsert, ex: Executor): Promise<void> {
  await ex.insert(advisorQuotes).values(v).onConflictDoUpdate({
    target: advisorQuotes.crmQuoteId,
    set: { userId: v.userId, quoteRequestId: v.quoteRequestId, quoteCode: v.quoteCode,
      revision: v.revision, vehicleLabel: v.vehicleLabel, monthlyPayment: v.monthlyPayment,
      payload: v.payload, sentAt: v.sentAt, validUntil: v.validUntil, viewedAt: null },
  });
}
export async function deleteAdvisorQuoteByCrmQuoteId(crmQuoteId: string, ex: Executor): Promise<void>;
export async function completeQuoteRequest(requestId: string, ex: Executor): Promise<void>; // UPDATE quote_requests SET status='completed' WHERE id=...
export async function listAdvisorViewedAt(crmQuoteIds: string[], ex: Executor): Promise<Map<string, string | null>>; // crmQuoteId → viewed_at
```
- [ ] 테스트 green 확인 후 커밋.

### Task 2: 서버 payload 조립기 (순수, TDD — 게이트 무관 선행 가능)

**Files:**
- Create: `src/lib/app-card-payload.ts` + `src/lib/app-card-payload.test.ts` (bun test:server)

**계약(인계문 2절과 동형):** 출력 payload = 클라 `AppCardModel`(client/src/lib/app-card.ts:39-93) 동형에서 `statusLabel`/`ddayLabel` 2필드 제외 + `payloadVersion: 1` 추가. **drizzle/클라 import 금지(순수 모듈)** — 입력은 평면 객체.

**Steps:**
- [ ] 입력 타입 정의 — DB 행 모양(numeric=string|null) 그대로 받는 구조적 타입:
```ts
export type AdvisorPayloadQuoteRow = { /* crm.quotes 행 중 조립에 필요한 필드: brandName, modelName, trimName, basePrice, optionTotal, options, discountLines, finalDiscount, finalVehiclePrice, acquisitionTax, acquisitionTaxMode, bond, delivery, incidental, acquisitionCost, exteriorColorName, interiorColorName, guidance, quoteCode, stockStatus ... — 구현 시 buildAppCardModel 입력 요구와 대조해 확정 */ };
export type AdvisorPayloadScenarioRow = { purchaseMethod, lender, termMonths, depositMode, depositValue, downPaymentMode, downPaymentValue, residualMode, residualValue, mileageValue, carTaxIncluded, subsidyApplicable, subsidyAmount, monthlyPayment, totalReturnCost, totalTakeoverCost, dueAtDelivery, interestRate ... };
export function buildAdvisorQuotePayload(q: AdvisorPayloadQuoteRow, sc: AdvisorPayloadScenarioRow | null, sentAtIso: string): { payload: Record<string, unknown>; vehicleLabel: string; monthlyPayment: number | null };
```
- [ ] **라벨 로직은 클라 `buildAppCardModel`(app-card.ts:168~끝)을 1:1 재현** — 구현 전 반드시 클라 원본 전체와 클라 입력 조립부(`useQuoteWorkbench.ts:195-223`, 특히 `registrationCost`·`modelYear`·`purchaseMethod`·guidance 정규화 출처)를 읽고 매핑표를 테스트 픽스처로 고정. 함정:
  - percent 병기 환산 기준 = `finalVehiclePrice`(#157 결정), 어순 percentFirst 규칙(app-card.ts:123-142).
  - `vehicleTitleOf` dedupe(트림명이 모델명 접두면 트림만), `downPaymentRowLabel` = 할부→"선납금".
  - guidance 구행 하위호환: 저장된 jsonb에 legacy `keyPoint`(단수)가 있으면 `keyPoints`로 승격(클라 `normalizeQuoteGuidance` 재현).
  - `footerStampLabel` = 발송 시각 고정(클라 `formatActivity` 포맷 "YY/MM/DD HH:mm" 재현), `statusLabel`/`ddayLabel`은 **생성하지 않는다**.
  - `vehicleLabel`(정규 컬럼용) = `${brand} ${vehicleTitle}` trim, `monthlyPayment` = 시나리오 monthly_payment 숫자 변환(null 허용).
- [ ] 실패 테스트(케이스 최소 6): 풀필드 운용리스(% 보증금) / 할부(선납금 라벨) / 시나리오 없음(hasScenario=false) / guidance legacy keyPoint / 빈 값 폴백("—"·"계산 후 안내") / vehicleTitle dedupe.
- [ ] 구현 → green → 커밋.

### Task 3: 클라↔서버 파리티 테스트 (vitest)

**Files:**
- Create: `client/src/lib/app-card-payload-parity.test.ts` (test:unit)

**Steps:**
- [ ] vitest에서 클라 `buildAppCardModel`과 서버 `buildAdvisorQuotePayload`(상대경로 `../../../src/lib/app-card-payload` — 순수 모듈이라 alias 불요)를 함께 import.
- [ ] 동일 의미 픽스처 2벌(클라 입력형/서버 행형)을 나란히 정의하고, **공유 라벨 필드 전부**를 loop 비교(제외: statusLabel/ddayLabel/payloadVersion). 운용리스·할부 2케이스.
- [ ] 드리프트 tripwire 주석: 한쪽 라벨 로직 수정 시 반드시 양쪽 갱신(doc-types 파리티 선례).

### Task 4: 발송 훅 통합 (updateQuote/deleteQuote)

**Files:**
- Modify: `src/db/queries/customer-quotes.ts`
- Test: `src/db/queries/customer-quotes.send.test.ts` (신규, 실 master try/finally — **테이블 게이트**)

**Steps:**
- [ ] 실패 테스트 5종: ①발송 PATCH(appStatus:"sent") → advisor_quotes 행 생성(payload·정규 컬럼·sent_at=quotes.sent_at 일치) ②재발송 → 행 교체+viewedAt NULL ③고객 app_user_id null → write 생략(내부 스탬프만) ④source_quote_request_id 연결 시 quote_requests.status='completed'(테스트 후 원상 복구) ⑤deleteQuote → advisor_quotes 회수.
- [ ] `updateQuote()` **끝부분**(scenarios 교체/대표 갱신 처리 이후 — 발송 patch에 scenarios 전체 교체가 동봉되는 워크벤치 경로 때문에 순서 필수)에 발송 분기:
```ts
if (patch.appStatus === "sent") {
  const appUserId = (await getAppUserId(customerId, ex))?.appUserId; // customers.ts 기존 헬퍼 재사용(경로 확인)
  if (appUserId) {
    const [q] = await ex.select().from(quotes).where(eq(quotes.id, quoteId)); // fresh read(스탬프·교체 반영본)
    const scs = await ex.select().from(quoteScenarios).where(eq(quoteScenarios.quoteId, quoteId)).orderBy(asc(quoteScenarios.scenarioNo));
    const primary = scs.find((s) => s.id === q.primaryScenarioId) ?? scs[0] ?? null;
    const { payload, vehicleLabel, monthlyPayment } = buildAdvisorQuotePayload(q, primary, q.sentAt!);
    await upsertAdvisorQuote({ userId: appUserId, quoteRequestId: q.sourceQuoteRequestId, crmQuoteId: q.id,
      quoteCode: q.quoteCode, revision: q.revision, vehicleLabel, monthlyPayment,
      payload, sentAt: q.sentAt!, validUntil: q.validUntil }, ex);
    if (q.sourceQuoteRequestId) await completeQuoteRequest(q.sourceQuoteRequestId, ex);
  }
}
```
  주의: `quotes.sentAt`의 drizzle mode(string/date) 실물을 확인해 타입 정합(AdvisorQuoteUpsert는 string). 라우트가 이미 `db.transaction()`으로 감싸므로 원자성은 기존 구조 그대로.
- [ ] `deleteQuote()` 성공 시 `deleteAdvisorQuoteByCrmQuoteId(quoteId, ex)` 호출(행 없으면 no-op).
- [ ] green → 커밋.

### Task 5: viewed_at read-through

**Files:**
- Modify: `src/db/queries/customers.ts` (`getCustomer`)
- Test: 기존 customers 서버 테스트 파일에 케이스 추가 — **테이블 게이트**

**Steps:**
- [ ] 실패 테스트: advisor_quotes에 viewed_at 있는 견적 → getCustomer 응답 quotes[].viewedAt에 그 값이 병합, 없으면 null 유지.
- [ ] `getCustomer()`의 scenarioRows 조회와 같은 단계에서 `listAdvisorViewedAt(quoteIds)` 병렬 호출 → `quotesWithScenarios` 매핑 시 `viewedAt: advisorViewed.get(id) ?? rest.viewedAt` 병합. **클라 타입 변경 0**(quotes.$inferSelect에 viewedAt 기존재).
- [ ] green → 커밋.

### Task 6: CRM 견적함 열람 배지 (클라)

**Files:**
- Modify: `client/src/lib/kim-quote.ts`(어댑터 — viewedAt 노출 여부 확인) · `client/src/components/customer-detail/QuoteList.tsx` · `client/src/styles/customer-detail-cards.css`(해당 도메인 파일 확인)

**Steps:**
- [ ] 어댑터에서 `viewedAt`이 QuoteItem까지 흐르는지 확인, 없으면 배선(기존 sentAt 배선과 동일 패턴).
- [ ] 발송됨(appStatus sent) 카드에 열람 상태 병기: viewedAt 있으면 "고객 열람"(+`formatActivity` 시각 title), 없으면 "미열람". 기존 "앱 요청" 배지(#158) 옆, 신규 클래스(kim-* 금지).
- [ ] `bun run test:unit` 기존 스위트 green + 시각 확인은 Task 7 스모크에서.

### Task 7: 검증·스모크·마무리

- [ ] 검증 4종 + build: `bun run typecheck` · `bun run lint`(0) · `bun run test:unit` · `bun run test:server` · `bun run build`.
- [ ] 로컬 스모크(격리 스택 — 사용자 dev 불가침, #158 방식: `PORT=8799 bun --env-file=.env.local run src/local-dev.ts` + 임시 vite config 5174): 앱 연결 고객(김지안 등) 견적 발송 → `psql`로 advisor_quotes 행 실측(payload 4섹션 키·sent_at 일치·completed 전이) → 재발송 viewedAt 리셋 실측 → **스모크 데이터 원복**(advisor_quotes 행·quote_requests.status·발송 스탬프 되돌리기, 신규 견적 만들었으면 삭제).
- [ ] 앱 세션에 실데이터 1건 제공 협의(통합 스모크는 앱 UI 완성 후 별도).
- [ ] PR 생성(본문에 follow-up: Realtime publication·알림 슬라이스, bids DROP, app_status "viewed" 컬럼 정리 판단) → 유슨생 확인 후 squash 머지 → brief 갱신.

---

## 구현 편차 노트 (실행 중 결정 기록 — 코드 블록보다 우선)

- **Task 1 완료(65358e8, 리뷰 2단계 통과).** drizzle 정의는 실 DDL 파리티로 plan 스케치보다 정확(`.unique()`·default 표기 = 타입 전용). quality 리뷰 Approve — 아래 2건은 후속 태스크 계약:
- **Task 4 주의(타입 경계)**: `crm.quotes.sentAt/validUntil`은 drizzle mode 미지정(=Date), `AdvisorQuoteUpsert`는 string(public-app.ts 관례) — 발송 훅에서 `q.sentAt.toISOString()` 변환 필수(plan 스케치의 `q.sentAt!` 그대로는 타입 에러).
- **Task 4 추가(modelYear)**: `crm.quotes`에 model_year 컬럼 없음 — 카드 sublineLabel "YYYY년식"은 `quotes.trimId → catalog.trims.model_year` 조인으로 조달(trimId null이면 null, 조립기는 null 허용). 클라 출처 = `useQuoteWorkbench.ts:199` `trimDetail?.modelYear`.
- **Task 5/6 주의(Map 시맨틱)**: `listAdvisorViewedAt`는 "행 없음(absent)=앱 미전달"과 "null=전달·미열람"을 구분한다. `get() ?? fallback` 병합은 이 구분을 접지만 SSOT상 fallback이 항상 null이라 무해. 단 **Task 6 배지는 `detail.appUserId` 있는 고객만 노출**(앱 미연결 고객의 내부 발송에 "미열람" 오표기 방지).
