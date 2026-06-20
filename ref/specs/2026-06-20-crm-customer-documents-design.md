# CRM 고객 서류 업로드(#3) 설계

작성일: 2026-06-20
상태: design (작성됨, 승인 대기). 다음 = writing-plans → 구현.
연계: `2026-06-19-crm-customer-write-fields-design.md`(#1 본체 쓰기), `2026-06-19-crm-customer-write-children-design.md`(#2 자식 CRUD), `2026-06-17-crm-customers-schema-design.md`(crm 8테이블·`customer_documents` 정의). 고객 쓰기 시리즈의 #3.

## 목표

김민준(`CU-2605-0020`) 상세 drawer의 **서류함**을 메모리(objectURL)에서 실제 영속 저장으로 전환한다. 파일(신분증·소득증명·사업자등록증 등 이미지/PDF 스캔본)을 Supabase **private 버킷**에 올리고, 메타를 `crm.customer_documents`에 기록한다. 업로드·분류수정·순서변경·삭제·미리보기/다운로드를 DB/Storage와 연동한다. CRM 도메인의 첫 **바이너리 영속(파일)** 경로를 세운다.

## 범위

**포함**: 김민준 서류함의 업로드/분류수정/순서변경/삭제/미리보기/다운로드 DB·Storage 연동. private 버킷 1개. 백엔드 multipart 수신 + secret key Storage 처리. signed URL 발급.

**제외(후속/별도 사이클)**:
- 김민준 외 고객 서류함 — 다른 고객 상세는 아직 구 일반 레이아웃(읽기). 서류함 UI 자체가 없어 레이아웃 작업이 선행돼야 함.
- OCR/AI 문서 판독 — 후속(라이브러리/서버 처리).
- (2026-06-20 반영) **이미지/PDF 병합 다운로드는 후속에서 구현됨** — 하단 "후속 반영" 참고.
- enum/lookup 정리 — 별도 사이클. `doc_type`은 이번엔 **text 유지**(프론트 자동분류 결과 문자열 그대로 저장).
- 프론트 직접 업로드(Storage RLS) — 백엔드 경유로 확정해 RLS 도입을 피함.

## 핵심 결정 (brainstorming 확정)

1. **업로드 경로 = 백엔드 경유.** Hono가 multipart로 파일을 받아 **secret key**(`sb_secret_…`, legacy service_role 대체)로 Storage 업로드 + `customer_documents` row 생성을 한 핸들러에서 처리. 이유: 기존 JWKS 인증 게이트 재사용(권한 일관), 업로드+메타 원자성, 프론트에 민감 버킷을 publishable key로 노출하지 않음, 새 RLS 정책 불필요(crm 도메인은 service가 직접 접근하는 기존 패턴과 일관).
2. **적용 범위 = 김민준 전용.** 쓰기 #1·#2와 동일하게 `KimDocumentContent` UI에만 실 연결. 단 백엔드 API/버킷/테이블은 고객 불문 일반적이라 다른 고객 확장 시 재사용 가능.
3. **파일 제약 = 이미지 + PDF만, 파일당 ≤ 20MB.** 허용 MIME: `image/*`, `application/pdf`. (2026-06-20 이사님 결정으로 오피스 허용 제거 — 미리보기/병합 대상이 이미지·PDF로 통일됨.)
4. **버킷 = private 신규 `customer-documents`** (master Supabase 프로젝트 = `DATABASE_URL`/`SUPABASE_URL`과 동일 프로젝트). 미리보기/다운로드는 **백엔드가 발급한 signed URL**(TTL 60s).

## Storage 버킷·경로

- 버킷명 `customer-documents`, **private**. 생성은 Supabase MCP(`apply_migration`/대시보드)로 1회.
- 객체 경로: `{customerId}/{objectId}-{safeName}`
  - `objectId` = 서버에서 `crypto.randomUUID()`로 선발급(경로 유일성용 — **row id와 별개여도 무방**). 따라서 upload를 insert보다 먼저 해도 되고 `addDocument` 시그니처에 id를 넣을 필요 없음(row id는 `defaultRandom`). 추적·삭제는 DB `file_path`로.
  - `safeName` = 원본 파일명에서 경로/제어문자 제거(공백→`_`, 비ASCII 허용하되 `/`·`..` 차단). 표시는 DB `file_name`(원본) 사용, 경로는 안전화본.
- DB `file_path`에 객체 경로 저장. 버킷명은 코드 상수(`CUSTOMER_DOCS_BUCKET`)로 분리.

## 자격증명 (유슨생 액션 필요)

- **secret key 발급/등록은 유슨생이 직접** 수행:
  - 로컬: `.env.local`에 `SUPABASE_SECRET_KEY=...` 추가(`.env.example`에도 키 이름만 추가).
  - CF: `wrangler secret put SUPABASE_SECRET_KEY` (production+preview). 변경 후 재배포 필요(기존 배포는 옛 값).
- `lib/storage.ts`는 키를 `c.env`(CF) → `process.env`(로컬/테스트) 순으로 읽음. 키 누락 시 업로드 라우트만 500(나머지 customers 경로는 영향 없음).

## 아키텍처

쓰기 #2(자식 CRUD)와 동일 3계층, 단 Storage 래퍼가 추가된다.

### 1. 백엔드 Storage 래퍼 `src/lib/storage.ts` (신규)
- `getServiceClient(env)` — `@supabase/supabase-js` `createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`. CF/로컬 키 해석.
- `uploadObject(env, path, bytes, contentType)` / `removeObject(env, path)` / `createSignedUrl(env, path, expiresIn)`.
- 버킷 상수 보유. 에러는 throw(라우트 onError가 500 처리).

### 2. 백엔드 쿼리 `src/db/queries/customer-documents.ts` (신규)
자식 CRUD와 동일 시그니처(`where = id AND customer_id` 가드, `executor` 일원화).
- `addDocument(customerId, { title, docType, fileName, fileSize, fileMime, filePath, sortOrder }, ex)` → `{ id, createdAt }`.
- `updateDocument(customerId, id, { docType }, ex)` → `{ id } | null` (분류 수정만).
- `deleteDocument(customerId, id, ex)` → `{ id, filePath } | null` (Storage remove에 path 필요해 path 반환).
- `reorderDocuments(customerId, [{ id, sortOrder }], ex)` → 영향 없음/개수. 한 트랜잭션 안에서 각 row sortOrder 업데이트(`customer_id` 가드).
- `nextSortOrder(customerId, ex)` — `max(sort_order)+1` (업로드 시 끝에 추가).

### 3. `getCustomer` 정렬 보강 `src/db/queries/customers.ts`
- documents 조회에 `orderBy(asc(customerDocuments.sortOrder), asc(customerDocuments.createdAt))` 추가(현재 무정렬). 응답에 `docType/fileName/fileSize/fileMime/sortOrder/createdAt` 포함(`filePath`는 비노출).

### 4. 라우트 `src/routes/customers.ts` (중첩 추가)
auth·db 미들웨어 자동 적용. 기존 자식 라우트 바로 아래 추가.
- `POST /:id/documents` — **multipart**. `c.req.parseBody()`로 `file`(File) 수신. 검증(MIME 화이트리스트·size≤20MB) → 실패 시 400/415/413. 통과 시: documentId 발급 → path 구성 → `uploadObject` → `addDocument`(sortOrder=`nextSortOrder`). insert 실패 시 `removeObject` 보상 삭제 후 throw. 성공 201 + 새 row(메타, path 제외).
- `PATCH /:id/documents/:childId` — `{ docType }` 수정. 404 가드.
- `PATCH /:id/documents/reorder` — `{ order: [{ id, sortOrder }] }` 배치. 200.
- `DELETE /:id/documents/:childId` — `deleteDocument`(path 회수) 성공 시 `removeObject`. row 없으면 404. (Storage remove 실패는 로그만, row 삭제는 성공으로 — 고아 객체는 추후 정리; row가 진실원본.)
- `GET /:id/documents/:childId/url` — 해당 row의 `file_path` 조회 → `createSignedUrl(60s)` → `{ url }`. 404 가드. (별도 query `getDocumentPath` 또는 deleteDocument와 공유.)

### 5. 프론트 lib `client/src/lib/customer-documents.ts` (신규)
- `uploadDocument(customerId, file, docType)` → `FormData` POST(apiFetch, **재시도 비대상** — 쓰기). 응답 row 반환.
- `updateDocumentType(customerId, id, docType)` / `deleteDocument(customerId, id)` / `reorderDocuments(customerId, order)` / `getDocumentUrl(customerId, id)`.
- 각 성공 시 `invalidateCustomerDetail(customerId)` 호출(상세 캐시 불변식 — 새 쓰기 경로 필수).

### 6. 프론트 타입 `client/src/lib/customers.ts`
- `CustomerDetailDocument`에 `sortOrder: number | null`·`createdAt: string | null` 추가. `filePath`는 두지 않음(서버 비노출). `toCustomerDetail`/`detail.documents` 매핑 보강.

### 7. 프론트 UI `client/src/pages/CustomerDetailPage.tsx`
`KimDocumentContent`(서류함) 핸들러를 DB 연결:
- **드롭/선택 업로드**: 자동분류(`classifyKimDocumentFile`)로 docType 결정 → 낙관 항목 추가(임시 id `kim-doc-...`) → `uploadDocument` → 성공 시 서버 uuid·메타로 교체, 실패 시 롤백(자식 CRUD #2 패턴 동일). 추가 직후 임시 id 항목 조작은 `id.startsWith("kim-")` 가드로 API 생략.
- **분류 수정**: select 변경 → 낙관 반영 + `updateDocumentType` PATCH.
- **순서 변경**: 드래그앤드롭 재정렬 → 낙관 reorder + `reorderDocuments` 배치 PATCH.
- **삭제**: 확인 후 낙관 제거 + `deleteDocument` DELETE.
- **미리보기/다운로드**: objectURL 제거. 미리보기/다운로드 시 `getDocumentUrl`로 signed URL 받아 `<img>`/`<iframe>`(이미지·PDF) 또는 anchor 다운로드.
- 자동분류(`classifyKimDocumentFile`)·분류 옵션(`kimDocumentTypeOptions`)은 **유지**.

## 데이터 흐름 (업로드)

```
[프론트] 파일 드롭 → classifyKimDocumentFile(name)=docType → 낙관 항목(임시 id)
   → FormData(file, docType) POST /:id/documents
[Hono] auth 게이트 → MIME/size 검증
   → objectId=randomUUID → path = {customerId}/{objectId}-{safeName}
   → uploadObject(secret key) → addDocument(row, sortOrder=max+1)
   → (insert 실패 시 removeObject 보상)
   → 201 { id, docType, fileName, fileSize, fileMime, sortOrder, createdAt }
[프론트] 임시 id → 서버 uuid 교체, invalidateCustomerDetail
```

## 매핑 (서류 항목 ↔ DB)

| 프론트 KimDocumentItem | DB customer_documents | 비고 |
|---|---|---|
| id | id | 서버 uuid(낙관 시 임시 `kim-doc-*`) |
| status(분류) | doc_type | text(자동분류 문자열) |
| fileName | file_name | 원본 파일명(표시용) |
| (size) | file_size | bytes |
| (mime) | file_mime | 검증·미리보기 분기 |
| (순서) | sort_order | 드래그 재정렬 |
| — | file_path | 서버 전용(비노출) |

## 에러 처리·불변식

- 업로드 검증 실패: 415(MIME)·413(size)·400(파일 없음).
- 원자성: 업로드 후 insert 실패 → Storage 보상 삭제. 삭제는 row delete 성공 후 Storage remove(remove 실패는 로그만 — row가 진실원본).
- **상세 캐시 불변식**: 모든 쓰기 lib 함수에서 `invalidateCustomerDetail(customerId)` 필수(Caveats 규약).
- secret key는 **백엔드 전용**. 프론트 번들·응답에 절대 노출 금지. signed URL만 프론트로.
- private 버킷 — 공개 URL 사용 안 함. 항상 signed URL(짧은 TTL).

## 검증·테스트

- 서버 테스트(`bun test --env-file=.env.local`): Storage 래퍼는 **목/스텁**(주입형 client 또는 fetch 목)으로 대체. 업로드 라운드트립(검증 통과→addDocument 호출), MIME/size 거부(415/413/400), docType PATCH, reorder, 삭제(+path 회수), 404. multipart는 `app.request`에 `FormData` 전달.
- 단위 테스트: `safeName` 정규화 순수함수, MIME 화이트리스트 판정.
- 마이그레이션 **불필요** — `customer_documents` 테이블·`sort_order` 컬럼 이미 존재(drizzle 0000). 버킷 생성만 1회.
- `typecheck` 0 · `lint` 0 · `test:unit` · `test:server` · `build`. 브라우저 업로드/미리보기는 인증 세션 필요라 **수동 확인**(로그인 후 dev 또는 배포본).

## 의존 순서

1. 버킷 생성 + secret key 등록(유슨생).
2. 백엔드: `lib/storage.ts` → `queries/customer-documents.ts` → `getCustomer` 정렬 → 라우트 + 서버 테스트.
3. 프론트: `lib/customer-documents.ts` → `customers.ts` 타입 → `CustomerDetailPage` 핸들러.
4. 검증 4종 + 수동 확인.

## 후속 반영 (2026-06-20) — 오피스 제거 + 이미지/PDF 병합 다운로드

이사님 결정으로 2가지를 반영한다.

### 1. 오피스 허용 제거 (이미지/PDF만)

- `lib/document-validation.ts`: `ALLOWED_MIME` = `{ "application/pdf" }`만(+ `image/*`). 오피스 6종(xlsx/docx/pptx·구형 xls/doc/ppt) 제거.
- `routes/customers.test.ts`: 오피스(xlsx) 업로드 → 415 거부 테스트 추가.
- `CustomerDetailPage.tsx`: `addDocumentFiles`의 `officeExt` 필터·토스트 문구·업로드 `<input accept>`에서 오피스 확장자 제거.

### 2. 서류함 ⬇️ 버튼 = 이미지/PDF 병합 다운로드 (금융사 제출용)

기존 `exportDocumentBundleAsPdf`/`downloadTextAsPdf`(서류 "목록 텍스트"만 PDF로 내보냄)를 **여러 서류를 하나의 PDF로 병합**하는 동작으로 대체한다. 금융사에 서류를 따로 보내는 번거로움을 없애려는 목적.

- **라이브러리 = `pdf-lib`** (순수 JS, 브라우저/CF Workers 호환). 오피스→PDF 변환 인프라 불필요(1번으로 이미지/PDF만 남음).
- **프론트에서 병합**: 서류함 **표시 순서대로** 각 서류의 원본 바이트를 모아 한 PDF 생성.
  - **소스**: 업로드 직후(임시 id) 항목은 메모리 `File`, 저장된 항목은 `getDocumentUrlApi`의 **원본**(`downloadUrl`)을 fetch → ArrayBuffer.
  - **PDF 서류**: `PDFDocument.load` → `copyPages`로 모든 페이지를 결과 문서에 이어붙임.
  - **이미지 서류**: A4 세로(595×842pt) 페이지에 비율 유지(contain)로 배치. 견고성을 위해 **canvas로 JPEG 재인코딩 후** `embedJpg`(progressive JPEG·webp·heic 등 pdf-lib 미지원 포맷도 브라우저 디코딩을 거쳐 안전). 재인코딩 실패 시 해당 항목은 건너뛰고 경고.
  - 빈 서류함·전부 실패 시 토스트 안내, 다운로드 없음.
- **결과**: `김민준-서류.pdf` blob 다운로드. 병합 중 버튼 비활성 + 진행 표시.
- 제거: `exportDocumentBundleAsPdf`·`downloadTextAsPdf`·`escapePdfText`(목록 텍스트 PDF 유틸).
