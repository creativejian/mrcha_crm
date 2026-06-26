# CRM 서류 doc_type 정리 + lookup 검증 설계

- 날짜: 2026-06-26
- 상태: 설계 합의 (구현 전)
- 슬라이스: enum/lookup 정리 🅳 — 서류 `title`/`doc_type` 중복 정리 (#69 후속)

## 배경 / 동기

#69에서 서류 분류의 진실원본이 `customer_documents.doc_type`으로 확정됐고, `title`
컬럼은 죽은 레거시로 남았다(새 업로드는 docType만 채우고 화면도 docType 우선). enum/lookup
트랙에서 이 중복을 정리한다.

또한 `doc_type`은 닫힌 집합(22종)인데 **두 곳에 하드코딩**돼 있다:
- 자동 분류 `classifyKimDocumentFile`(파일명→종류, `client/src/lib/kim-detail-utils.ts`)
- 수동 변경 select `kimDocumentTypeOptions`(`client/src/pages/CustomerDetailPage.tsx`)

확인 결과 **두 목록의 값이 정확히 일치**한다(순서만 다름). 그래서 doc_type을 lookup으로
적재하고 닫힌 집합 검증을 추가하면, 자동 분류 결과도 항상 목록 안이라 검증이 막지 않는다.

## 핵심 결정

1. **범위 = `title` 정리 + `doc_type` 백엔드 검증.** 프론트 select를 lookup에서 동적
   소비하는 전환은 🅱(프론트 소비)와 같은 비동기 비용이라 이번엔 제외(상수 유지).
2. **`title` 컬럼 DROP.** 무의미 중복(docType이 진실원본)이라 손실 무해. plan에서
   `title IS NOT NULL` 건수 확인 후 실행(destructive·비가역).
3. **doc_type 정식 목록 = `DOC_TYPE_OPTIONS`(22종).** `kimDocumentTypeOptions`를
   `client/src/data/customers.ts`로 이동·export해 상수 1곳으로(SSOT). classify는 함수라
   별개지만 반환 값이 이 목록과 동일.
4. **`validateLookupValue("doc_type", …)` 재사용**(chance 슬라이스에서 도입), 서류
   POST(업로드)·PATCH(분류 변경) 둘 다 검증.

## 설계

### 1. `title` 정리

코드 참조 제거:
- `src/db/queries/customer-documents.ts` `addDocument` — `title` 파라미터·저장 제거(docType만).
- `src/db/queries/customers.ts` `getCustomer` — documents select에서 `title` 제거 +
  `CustomerDetail` documents 타입에서 `title` 제거.
- `client/src/pages/CustomerDetailPage.tsx` #69 폴백 `title: d.docType ?? d.title` →
  `d.docType`(title 참조 제거).
- `client/src/lib/customer-documents.ts` 문서 타입에 `title` 있으면 제거.

DB:
- `src/db/schema.ts` `customerDocuments`에서 `title` 컬럼 제거 → `bun run db:generate`로
  `drizzle/0006`(ALTER TABLE … DROP COLUMN "title", crm only). plan에서 건수 확인 후 migrate.

### 2. `doc_type` lookup (백엔드 검증)

- `kimDocumentTypeOptions`(CustomerDetailPage 내부 22종) → `client/src/data/customers.ts`
  `DOC_TYPE_OPTIONS`로 이동·export. `CustomerDetailPage`는 import해서 사용(동작 불변).
- `scripts/seed-lookups.ts`: `category="doc_type"` 22행 시드(`DOC_TYPE_OPTIONS`, parentValue
  null, sortOrder 인덱스). 멱등 delete 카테고리에 `"doc_type"` 추가.
- `src/routes/customers.ts` 서류 라우트:
  - POST(업로드, multipart의 docType)·PATCH(분류 변경) 처리에서 `validateLookupValue("doc_type", docType, c.var.db)` 호출, 위반 400.
  - docType이 없거나 null인 업로드는 통과(value null → 왕복 0). 자동 분류는 항상 유효 값.

## SSOT 전략 / Caveat

- 검증 SSOT = DB lookup. `DOC_TYPE_OPTIONS` 상수 = 시드 입력. classify 함수는 별개지만
  반환 값이 목록과 동일(불일치 시 자동분류가 400날 수 있으니 둘을 함께 유지). 상수 변경 시
  `seed:lookups` 재실행.
- ⚠️ `title` DROP은 **비가역**. plan에서 `SELECT count(*) ... WHERE title IS NOT NULL`
  확인 후 진행(현재 무의미 중복이라 손실 무해 예상).

## perf

docType이 올 때만 1쿼리(category+value 1행). 없으면 왕복 0. 진행상태/chance 검증과 독립.

## 검증 계획

- `bun run typecheck` 0 · `bun run lint` 0.
- 서버 테스트: 서류 doc_type 라운드트립 — 유효 docType 업로드/PATCH 200, 없는 docType
  PATCH 400. 기존 서류 테스트(업로드·미리보기·삭제) 그대로 통과.
- `bun run test:unit`(DOC_TYPE_OPTIONS 이동·CustomerDetailPage import 변경 — 동작 불변 확인) · `bun run build`.
- 시드 멱등(doc_type 22행 추가, 2회 동일).

## 파일 변경 목록(예정)

- `src/db/schema.ts` — `customerDocuments.title` 제거.
- `drizzle/0006_*.sql` — title DROP COLUMN.
- `client/src/data/customers.ts` — `DOC_TYPE_OPTIONS` export.
- `client/src/pages/CustomerDetailPage.tsx` — `kimDocumentTypeOptions` 제거·import, #69 폴백 정리.
- `src/db/queries/customer-documents.ts` — `addDocument` title 제거.
- `src/db/queries/customers.ts` — `getCustomer` title 제거 + 타입.
- `client/src/lib/customer-documents.ts` — 문서 타입 title 제거(있으면).
- `scripts/seed-lookups.ts` — doc_type 시드.
- `src/routes/customers.ts` — POST·PATCH docType 검증.
- `src/routes/customers.test.ts` — doc_type 라운드트립 테스트.

## 관례 준수

- 브랜치 → PR → squash 머지. 커밋 메시지에 skip-ci 토큰 금지.
- `any` 금지. 마이그레이션은 `db:generate`→`db:migrate`만, crm only(title DROP).
