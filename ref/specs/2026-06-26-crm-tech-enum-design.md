# CRM 기술값 enum 강화 — customerType/purchaseMethod 설계

- 날짜: 2026-06-26
- 상태: 설계 합의 (구현 전)
- 슬라이스: enum/lookup 정리 🅲(기술 내부값) — 남은 z.string 기술값을 z.enum으로 좁히기

## 배경 / 동기

기술 내부값(코드가 생성/소비, 사용자 자유입력 아님)은 lookup 테이블이 아니라 **zod enum +
TS union**으로 타입 안전을 준다. 확인 결과 핵심 대부분은 **이미 z.enum**이다:
- ✅ `quotes.entry_mode`(manual/solution/original), `acquisition_tax_mode`(normal/hybrid/electric/manual),
  `app_status`(draft/queued/sent/viewed), `decision_status`(none/considering/confirmed/contracting)

아직 `z.string()`(검증 없음)인 건 둘뿐:
- `customers.customer_type` (개인/개인사업자/법인사업자)
- `quote_scenarios.purchase_method` (장기렌트/운용리스/금융리스/중고리스/할부/일시불)

이 둘을 z.enum으로 좁혀 백엔드 방어를 일관화한다. (실익은 작음 — 코드 생성값이라 방어용.
나머지 mode 4개는 값이 코드 분산 생성이라 위험해 이번 범위에서 제외.)

## 핵심 결정

1. **범위 = `customerType` + `purchaseMethod` z.string→z.enum.** mode 4개·customerTypeDetail 제외.
2. **선행: QT-2606-0003 잔재 정리.** DB `purchase_method`에 `"비교 견적"` 1건(김민준 견적함의
   개발 잔재 — draft·비정식 trim "재고 비교") 존재. 코드가 만드는 값이 아니라 일회성. z.enum 전
   이 견적을 삭제(quote + scenario cascade)해야 enum 적용 후 재저장 400을 피한다.
3. **`purchaseMethod` 옵션 SSOT화.** 이미 있는 TS union `KimQuotePurchaseMethod`(6종)와 zod
   목록을 `client/src/data/`의 `PURCHASE_METHOD_OPTIONS` 한 곳에서 공유.
4. **마이그레이션 없음.** zod 스키마 변경만(DB 컬럼은 text 유지 — drizzle은 zod와 별개).

## 데이터 확인 (적용 전 전제)

- `customer_type` distinct: 개인(12)/개인사업자(5)/법인사업자(3) — enum 3종과 **정확히 일치**(안전).
- `purchase_method` distinct: 운용리스(5)/중고리스(1)/**비교 견적(1)** — "비교 견적" 정리 후
  전부 6종 내(안전).

## 설계

### 0. 잔재 정리 (선행, plan 첫 step)

QT-2606-0003(김민준, 벤츠 GLC "재고 비교", draft) 견적을 삭제:
```sql
DELETE FROM crm.quotes WHERE quote_code = 'QT-2606-0003';  -- scenario는 ON DELETE CASCADE
```
공유 master DB라 실행 시 사용자 확인. (draft 잔재라 손실 무해.)

### 1. customerType z.enum

`src/routes/customers.ts` `customerWriteSchema`(25행):
```ts
  customerType: z.enum(["개인", "개인사업자", "법인사업자"]).nullable().optional(),
```
`customerTypeDetail`은 2단계(개인=닫힌 select / 사업자=자유 입력)라 **z.string 유지**.

### 2. purchaseMethod z.enum + SSOT

`client/src/data/` (예: `quote-options.ts` 또는 `customers.ts`)에 SSOT 상수:
```ts
export const PURCHASE_METHOD_OPTIONS = ["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"] as const;
export type PurchaseMethod = (typeof PURCHASE_METHOD_OPTIONS)[number];
```
- `CustomerDetailPage`의 `KimQuotePurchaseMethod`/`kimQuotePurchaseMethodOptions`를 이 상수 기반으로 정리(타입 일치).
- `src/routes/customers.ts` `quoteScenarioBody`(81행) `purchaseMethod`:
  ```ts
  purchaseMethod: z.enum(["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"]).nullable().optional(),
  ```
  (서버는 client/data를 import하지 않으므로 zod 목록은 직접 기재 — 값은 SSOT 상수와 동일하게 유지.)

### 3. 검증 테스트

- `customerWriteSchema`/`quoteScenarioBody` 단위: 잘못된 값 거부, 유효 값 통과(zod safeParse).
- 서버 라운드트립: customers PATCH 잘못된 customerType → 400, 유효 → 200(원복). 견적 생성/PATCH
  잘못된 purchaseMethod → 400.

## perf / 마이그레이션

zod 검증만 추가, DB 컬럼·마이그레이션 변경 없음. 런타임 비용 무시 가능.

## 검증 계획

- `bun run typecheck` 0 · `bun run lint` 0.
- `bun run test:server`: customerType·purchaseMethod 400/200 라운드트립.
- `bun run test:unit`: PURCHASE_METHOD_OPTIONS 타입 정리 동작 불변 · `bun run build`.

## 파일 변경 목록(예정)

- (잔재 정리) QT-2606-0003 삭제 — 데이터, 코드 변경 아님.
- `client/src/data/…` — `PURCHASE_METHOD_OPTIONS`·`PurchaseMethod` SSOT.
- `client/src/pages/CustomerDetailPage.tsx` — `KimQuotePurchaseMethod`/옵션을 SSOT 기반으로.
- `src/routes/customers.ts` — `customerType`·`purchaseMethod` z.enum.
- `src/routes/customers.test.ts` — 검증 라운드트립.

## 관례 준수

- 브랜치 → PR → squash 머지. skip-ci 토큰 금지. `any` 금지.
