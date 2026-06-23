# crm 견적 원본 업로드 #4d 설계

작성일: 2026-06-23
상태: **design 확정. 구현(plan)은 writing-plans로.**
성격: 견적 도메인(#4) 네번째 사이클(#4d). #4a 읽기·#4b 쓰기·#4c 생성/시나리오 머지 후, **견적 원본 파일(금융사 견적서 이미지/PDF)을 Storage + DB 영속**.
연계: `2026-06-20-crm-customer-documents-design.md`(#3 서류 Storage 인프라 — 그대로 재사용), `2026-06-21-crm-quotes-create-design.md`·`2026-06-22-crm-quotes-write-design.md`(#4c·#4b quotes CRUD).

## 배경 / 현황

- 견적함 행에 원본을 드롭하는 UI가 이미 있다: `dropQuoteFile` → `attachQuoteFileToQuote`(`CustomerDetailPage.tsx`). 워크벤치/composer "원본 인식"(`recognizedQuoteFile`)도 별도 진입점.
- **현재는 메모리만 영속**: `attachQuoteFileToQuote`가 `fileName/fileSize/mimeType/objectUrl/file`을 `KimQuoteItem`에 세팅하고 status를 "발송대기"·appStatus "queued"로 바꾸지만, **Storage 업로드·DB 영속이 없어 새로고침 시 소실**된다.
- **`quotes.file_name/file_size/file_mime/file_path` 4컬럼이 이미 존재**(`src/db/schema.ts`, customer_documents와 동형). `getCustomer`는 `quotes` 전체를 `select()`해 응답에 `file_*`가 이미 포함된다(단 `file_path`는 비노출 처리 필요 — customer_documents의 `Omit` 패턴).
- 서류 #3 Storage 인프라가 검증돼 있다: `src/lib/storage.ts`(`uploadObject`/`removeObject`/`createSignedUrl`), private 버킷 `customer-documents`, secret key 백엔드, `src/lib/document-validation.ts`(`isAllowedMime`·`MAX_DOC_BYTES`·`safeFileName`), 프론트 `lib/customer-documents.ts`(`uploadDocument`/`deleteDocumentApi`/`getDocumentUrlApi`).

## 결정 (brainstorming 2026-06-23)

- **범위 = 원본 파일 영속만**: 저장 → 미리보기 → 다운로드 → 교체 → 삭제. **OCR 자동인식 제외**(financial-dolim-solution 연결이 선행인 후속 작업).
- **진입점 = 견적함 행 드롭만**(MVP). 워크벤치/composer "원본 인식" 영속은 생성 흐름에 엮여 복잡하므로 후속으로 분리.
- **미리보기 = 원본 직접**(signed URL). 썸네일을 만들지 않는다 → **마이그레이션 0**(`quotes.file_*` 4컬럼만으로 충분). Safari는 JPEG/PNG/PDF 원본을 직접 렌더한다(서류 #3 회귀는 render/image **WebP 변환** 때문이었고, 원본 직접 표시는 무관).
- **교체 = objectId per upload**: 재드롭 시 새 객체를 올리고 **이전 Storage 객체를 보상 삭제**(서류 #3 규약).
- **첨부 시 status "발송대기"·appStatus "queued" 기존 동작 유지**(원본 첨부 = 발송 준비 신호).

## 범위

- **안**: 견적함 행에 이미지/PDF 드롭 → Storage 업로드 + `quotes.file_*` 영속, 미리보기(signed URL)·다운로드·교체(재드롭)·삭제.
- **밖**: OCR/자동추출, 워크벤치·composer 원본인식 영속, 썸네일(`thumb_path`), 견적당 다중 원본(1견적 = 1파일, 스키마가 inline).

## 계층 변경

### 1. `src/db/queries/customers.ts` (읽기 — file_path 비노출)
- `CustomerDetail`의 quotes 타입에서 **`file_path` 비노출**(customer_documents의 `Omit<…, "filePath" | "thumbPath">` 패턴과 정합):
  - **타입**: `QuoteWithScenarios`를 `Omit<typeof quotes.$inferSelect, "filePath"> & { scenarios }`로.
  - **런타임**: `quotes`는 현재 `select()` 전체라 `file_path`가 JSON에 실린다. `quotesWithScenarios` map에서 `const { filePath: _filePath, ...rest } = q; return { ...rest, scenarios }`로 **filePath를 실제로 제거**(타입 Omit만으로는 런타임 JSON에서 빠지지 않음). `file_name/file_size/file_mime`는 노출(견적함 행 표시용).

### 2. `src/db/queries/customer-quotes.ts` (query 헬퍼 3)
- `setQuoteFile(customerId, quoteId, { fileName, fileSize, fileMime, filePath })` → `file_*` UPDATE, `id AND customer_id` 가드. **이전 `file_path`를 returning**(교체 시 보상 삭제용). 불일치/없으면 null.
- `clearQuoteFile(customerId, quoteId)` → `file_*` 전부 null UPDATE, 이전 `file_path` returning. 불일치/없으면 null.
- `getQuoteFilePath(customerId, quoteId)` → `{ filePath, fileMime }` (signed URL 발급용). null이면 파일 없음.

### 3. `src/routes/customers.ts` (라우트 3, 서류 라우트 동형)
- `POST /:id/quotes/:childId/original` (multipart `file`) → `isAllowedMime`·`MAX_DOC_BYTES` 검증(아니면 415/413) → `objectId = crypto.randomUUID()`, `path = {customerId}/quotes/{quoteId}-{objectId}-{safeFileName(name)}` → `uploadObject` → `setQuoteFile`(반환된 이전 `filePath` 있으면 `removeObject` 보상) → 201 `{ fileName, fileSize, fileMime }`. quote 없으면(`setQuoteFile` null) 업로드 객체 보상 삭제 후 404. 예외 시 새 객체 보상 삭제.
- `DELETE /:id/quotes/:childId/original` → `clearQuoteFile` → 반환된 `filePath` 있으면 `removeObject` → 200 `{ id }`. 없으면 404.
- `GET /:id/quotes/:childId/original/url` → `getQuoteFilePath` → `createSignedUrl`(미리보기 url + 다운로드 downloadUrl) → `{ url, downloadUrl, fileMime }`. 파일 없으면 404.

### 4. `client/src/lib/kim-quote.ts` (읽기 어댑터)
- `CustomerDetailQuote`에 `fileName: string | null`·`fileSize: number | null`·`fileMime: string | null` 추가.
- `toKimQuoteItem`이 `fileName`(→`fileName`)·`fileSize`·`fileMime`(→`mimeType`)를 DB 영속값에서 매핑(현재 mock/메모리 전용이던 필드). `originalNeedsReplacement`는 기존 로직 유지.

### 5. `client/src/lib/customer-quotes.ts` (프론트 lib 3)
- `uploadQuoteOriginal(cid, quoteId, file)` → multipart `POST …/original` → **성공 시 `invalidateCustomerDetail(cid)`**(상세 캐시 불변식) → `{ fileName, fileSize, fileMime }`.
- `deleteQuoteOriginal(cid, quoteId)` → `DELETE …/original` → `invalidate`.
- `getQuoteOriginalUrl(cid, quoteId)` → `GET …/original/url` → `{ url, downloadUrl, fileMime }`.

### 6. `client/src/pages/CustomerDetailPage.tsx`
- `attachQuoteFileToQuote` 재작성: 낙관(메모리 `objectUrl` 즉시 + status/appStatus 기존 변경) → `uploadQuoteOriginal` → 실패 롤백, `kim-` 임시 id 가드(저장 전 견적은 API 생략). 서류 `addDocumentFiles` 패턴.
- 미리보기(`previewQuote`): 메모리 `objectUrl` 우선 → 없으면 `getQuoteOriginalUrl`로 signed url fetch(서류 미리보기 effect 패턴). 다운로드 = 원본(downloadUrl/objectUrl).
- 원본 삭제 핸들러: `deleteQuoteOriginal` + 낙관(파일 필드 제거) + 롤백.

## 검증

- **test:server**: POST 업로드 → getCustomer `file_*` 반영 / DELETE → null / MIME 415 / 20MB 413 / 교차고객 404. storage는 `mock.module`(서류 테스트 패턴).
- **test:unit**: `toKimQuoteItem`이 `fileName/fileSize/mimeType`를 DB `file_*`에서 매핑.
- **브라우저(#4c 일괄, 인증 세션)**: 견적함 행 드롭 → 새로고침 유지 · 미리보기 · 다운로드 · 교체(재드롭) · 삭제.

## 미결 / 다음

- 워크벤치·composer "원본 인식" 파일 영속(#4d 후속 — 생성 흐름에 동봉).
- OCR 자동인식(financial-dolim-solution / 견적 파싱).
- 썸네일 필요 시 `thumb_path` 마이그레이션(서류 #3 `drizzle/0003` 동형). 현재는 원본 직접이라 불필요.
