# CRM AI — crm-analyst 서류 자동분류 (첫 슬라이스) Design

Date: 2026-07-01
Status: 승인 대기 (brainstorming 완료, spec 리뷰 전)
관련: `ref/active-session-brief.md` "다음 작업 예정 — crm-analyst" · 인증 #36

## 배경 / 목적

앱(고객용)에는 이미 Gemini 기반 AI가 있다(`ai-analyst` Edge Function — 업무 채팅·리스 견적서 vision 추출). 이 AI 역량을 CRM(상담사용)에도 도입한다. 전체 CRM AI는 두 슬라이스로 분해된다.

- **슬라이스 A — 서류 자동분류** (본 문서, 첫 슬라이스): 고객 상세 서류함에 이미지/PDF를 드롭할 때, 현재 **파일명 regex**로 하던 22종 분류를 **Gemini vision**으로 격상.
- **슬라이스 B — 업무 AI 채팅** (후속): CRM Topbar 하드코딩 mock을 실제 Gemini 채팅으로. pgvector 지식베이스·RAG·tools는 이 슬라이스에서.

첫 슬라이스로 서류 자동분류를 고른 이유: **작고 저위험**. 기존 업로드 경로(CF Workers)·22종 enum·regex 테스트를 전부 재사용하고, 분류 진입점 한 곳(`useCustomerDocuments.ts:103`)만 교체하면 된다. 동시에 **공통기반**(함수 스캐폴드 + staff 인증 게이트 + Gemini 유틸)을 이 슬라이스에서 세워, 슬라이스 B가 얹힐 토대를 만든다.

## 현재 지형 (코드 실측)

- **분류 진입점**: `client/src/components/customer-detail/hooks/useCustomerDocuments.ts:103` — 드롭/선택한 파일마다 `classifyKimDocumentFile(file.name)`(파일명 regex, `client/src/lib/kim-detail-utils.ts:120`)로 `docType` 확정 → optimistic 카드(`status:"자동인식"`) → `uploadDocument(cid, file, docType)`(`client/src/lib/customer-documents.ts:19`, CF Workers multipart) → Supabase Storage 영속.
- **분류 대상**: `DOC_TYPE_OPTIONS` 22종 닫힌 집합(`client/src/data/customers.ts:40`). regex 반환값과 동일 SSOT. DB `doc_type` CHECK 제약(#109/#112)과도 일치.
- **앱 `ai-analyst`**: 앱 레포(`Flutter/mr-cha-app/supabase/functions/ai-analyst`)에 존재. Deno + Hono + Gemini(SDK 없이 `fetch`). 모델 `gemini-3.1-flash-lite`(`index.ts:37`). REST `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=…`. vision 입력 `inlineData: { data: <base64>, mimeType }`. `GEMINI_API_KEY` env. 에러분류/재시도 유틸 `gemini_error.ts`. **서류 '종류분류'는 앱에 없음**(리스 견적서 vision 추출만).
- **이 CRM 레포엔 `supabase/functions/` 자체가 없음.** 백엔드는 CF Workers(`src/routes/*`, Hono + Hyperdrive). 프론트엔 supabase-js 클라이언트가 이미 있음(`client/src/lib/supabase.ts`, S1.5 Realtime 도입 때).
- 앱·CRM은 **같은 master Supabase 1프로젝트** 공유(crm/catalog/public 스키마).

## 확정된 결정 (brainstorming 2026-07-01)

1. **함수 소스 위치 = CRM 레포 신설** (`mr-cha-crm/supabase/functions/crm-analyst/`). 이유: git 응집도 — CRM AI의 커밋·PR·핸드오프가 전부 CRM 레포 기준. 앱 레포에 두면 브랜치 흐름이 두 레포로 쪼개짐. 첫 슬라이스는 앱의 RAG·tools·streaming·pgvector가 전부 불필요해 복제 부담이 작다.
2. **분류 반영 = 자동확정 + 사후수정**. 드롭 → vision → docType 즉시 확정·업로드(현행 '파일 캐비닛' 흐름 유지). 틀리면 기존 분류 select로 수정. 매 파일 확인 클릭은 대량 드롭에 마찰이라 배제.
3. **regex와의 관계 = 폴백 체인**. vision이 주 분류기, 실패·불확실 시 regex 폴백 → 그것도 안 잡히면 "기타서류". 기존 regex·테스트 자산 유지, Gemini 장애에도 graceful.
4. **모델 = `gemini-3.1-flash-lite`** (앱 동일, `GEMINI_API_KEY` 재사용). 22종 세밀 구분 정확도가 부족하면 상수 한 줄로 상향(YAGNI).
5. **호출흐름 = A** (프론트가 crm-analyst 직접 invoke). 업로드 *전* 분류라 프론트가 파일을 들고 있음 → CF Workers 경유 없이 프론트→Edge 직접이 단순(파일 이중 전송 회피). 인증은 프론트 세션 JWT.

## 아키텍처

### ① 함수 스캐폴드 (공통기반)

- 신규 `supabase/functions/crm-analyst/` (Deno). 앱처럼 **Hono 골격** — 지금은 분류 라우트 1개, 슬라이스 B(채팅)가 같은 함수에 라우트로 얹힘. Hono 마운트 경로(함수명 prefix 포함 여부 등)는 앱 `ai-analyst`의 Hono 패턴을 그대로 따른다(구현 시 확인).
- 복제 최소 세트: `deno.json`/`import_map`(Hono·supabase-js), `gemini_error.ts`(에러분류·재시도), staff 인증 미들웨어. **RAG·pgvector·tools·streaming·prompts 빌더는 복제 안 함**(슬라이스 B 몫).
- Supabase 프로젝트 링크: CRM 레포에 `supabase/config.toml` + functions 디렉토리. master 프로젝트로 link.
- 모델 상수 `gemini-3.1-flash-lite`. REST `generateContent` **단건(non-streaming)** — 분류는 단일 JSON 응답이라 SSE 불필요.

### ② 입력 처리 (프론트에서 인코딩)

- 이미지(jpg/png) → **경량 리사이즈 썸네일** base64. 프론트에 이미 있는 `client/src/lib/image-thumbnail.ts`(`createImageBitmap` + canvas → JPEG) 재사용. 분류엔 고해상도 불필요 → 토큰·비용·속도 절감.
- PDF → **원본** base64 (`application/pdf` inlineData). 서류는 보통 1–2p이라 원본 그대로 전송. (썸네일 생성은 이미지 전용)
- 요청 body: `{ mimeType: string, dataBase64: string, fileName: string }`. `fileName`은 Edge에선 쓰지 않지만 로깅/디버깅용으로 전달(regex 폴백은 프론트에서 수행 — 아래 ④).

### ③ 분류 로직 — Edge Function 책임

- **Edge Function은 vision 분류만** 담당: 22종 중 하나 또는 `unknown` 반환. **regex 폴백은 프론트가 수행**(regex는 프론트 전용 유틸이고, Edge를 순수하게 유지). 책임 분리:
  - Edge: `{ mimeType, dataBase64 }` → Gemini vision → `{ docType: <22종 | "unknown"> }`
  - 프론트 lib: `unknown` 또는 invoke 실패 시 `classifyKimDocumentFile(fileName)`로 폴백.
- **프롬프트**:
  - 지시: "자동차 리스/할부 상담에 제출되는 고객 서류를 아래 22종 중 하나로 분류한다. 이미지/PDF 내용을 우선 판단하고, **확신이 서지 않으면 반드시 `unknown`을 반환**한다."
  - 22종 enum을 목록으로 명시 + 애매한 구분 짧은 설명(재무제표 당해/전기, 법인인감/개인인감, 자동차등록증/등록비영수증 등).
  - **structured output**: `generationConfig.responseMimeType: "application/json"` + `responseSchema`(enum = 22종 + `unknown`). enum 제약으로 파싱 안전 + 사전 밖 값 원천 차단. flash-lite 지원.
  - 출력: `{ "docType": "<enum>" }`.
- LLM self-reported confidence 숫자는 신뢰성이 낮아 **쓰지 않는다**. 불확실은 `unknown` 선택지로만 표현.

### ④ 프론트 통합 (호출흐름 A)

- 신규 `client/src/lib/document-classify.ts` — `classifyDocumentWithAI(file: File): Promise<string>`:
  1. 이미지면 썸네일, PDF면 원본 → base64 인코딩.
  2. `supabase.functions.invoke("crm-analyst", { body })` (세션 JWT 자동 첨부). 첫 슬라이스는 함수의 단일 동작이라 함수명 단독 호출로 충분. 슬라이스 B 추가 시 body의 `action` 필드 또는 서브패스로 라우트 분기.
  3. 응답 `docType`이 유효 22종(≠`unknown`) → 반환.
  4. `unknown` **또는** invoke 실패(네트워크/에러/타임아웃) → `classifyKimDocumentFile(file.name)`(regex) 반환. regex 최악값은 "기타서류".
  - **항상 유효한 22종 docType을 반환**(예외를 삼킴) → 호출부는 분기 없이 단순.
- `useCustomerDocuments.ts:103` 교체 — 흐름은 비동기 optimistic(현행 패턴 유지):
  1. 드롭 → optimistic 카드 즉시(`docType` placeholder, `status:"분류 중…"`)
  2. `await classifyDocumentWithAI(file)` → `docType`
  3. 카드 갱신(`status`: AI 성공 → `"AI분류"`, regex 폴백 → `"자동인식"`[기존 파일명 분류 라벨]) → 기존 `uploadDocument(cid, file, docType)`(**변경 없음**).
- 여러 장 드롭: 현행 순차 `for await` → **파일별 병렬**(`Promise.all` 또는 병렬 map). 각자 독립 폴백. 낙관 카드·업로드·롤백 로직은 기존 그대로.

### ⑤ 인증 게이트 (#36 재사용)

- Edge Function이 `Authorization: Bearer <JWT>` 검증 → JWT `user_role` claim(= `profiles.role`, #36 custom_access_token_hook 주입)이 **staff 이상**만 통과. customer/무토큰 차단.
- 앱 `_shared`의 supabase admin/JWT 검증 패턴 참고. supabase.functions.invoke가 세션 JWT를 자동 첨부하므로 프론트 추가 작업 없음.
- ⚠️ **배포는 항상 `supabase functions deploy crm-analyst`**(함수 명시). 앱·CRM이 같은 master 프로젝트로 link되므로, 인자 없는 전체 배포는 앱 함수를 덮어쓸 위험.

### ⑥ 에러 · 비용

- Gemini 5xx/타임아웃 → `gemini_error.ts` 분류 → **짧은 재시도 1회** → 여전히 실패면 Edge가 에러 응답 → 프론트가 regex 폴백. 상담사에겐 조용히 진행(실패 토스트 없음, 카드 `status`로만 AI/파일명 구분).
- 비용: flash-lite vision은 이미지당 극소액 + 상담사 서류는 소량. 썸네일 축소로 토큰 추가 절감. 무시 가능 수준 — 별도 rate limit·큐잉 없이 시작.

### ⑦ 테스트

- **Edge Function** (Deno test, 앱 `_test` 패턴): 프롬프트 파싱·`unknown` 처리·에러→재시도 경로. Gemini 호출은 mock(fetch stub). 인증 게이트(staff 통과 / customer·무토큰 차단).
- **프론트** (`document-classify.test.ts`): invoke 성공(22종) → 반환, invoke `unknown` → regex 폴백, invoke throw → regex 폴백. base64 인코딩(이미지 썸네일 / PDF 원본 분기). `classifyKimDocumentFile` 기존 테스트는 폴백 경로로 유지.
- 검증 예산: `bun run typecheck` 0 · `bun run lint` 0 · `bun run test:unit` · Edge는 `deno test`. Edge 실 배포 후 브라우저 검증(실제 서류 이미지/PDF 드롭 → AI분류 배지·정확도, staff JWT 실호출).

## 범위 밖 (후속)

- **슬라이스 B — 업무 AI 채팅**(Topbar mock → Gemini + pgvector RAG + tools). 별도 brainstorming→spec→plan.
- OCR 텍스트 추출/내용 파싱(분류만, 필드 추출 아님).
- 견적 원본(`quotes.file_*`) vision 분류(서류함 전용, 견적은 후속 후보).
- confidence 점수 노출·수동 재분류 학습·오분류 통계.

## Caveats

- **함수 지정 배포 필수**: `supabase functions deploy crm-analyst`(공유 master 프로젝트, 앱 함수 보호).
- **`GEMINI_API_KEY`는 Edge Function secret**(`supabase secrets set`). 프론트 노출 금지 — 프론트는 supabase.functions.invoke만.
- **staff 게이트 실검증 필수**: JWT `user_role` staff+ 통과·customer 차단을 브라우저 실호출로 확인(앱과 동일 Auth 훅이라 claim은 자동이지만, Edge 검증 로직은 신규).
- **regex 폴백 SSOT 유지**: `classifyKimDocumentFile`·`DOC_TYPE_OPTIONS`는 프론트 폴백 경로로 계속 살아있음 — 22종 enum 변경 시 프롬프트 responseSchema와 함께 갱신(둘 다 같은 22종을 참조하도록).
- **Edge Function은 CRM 프론트에서만 호출**되는 신규 경계 — CF Workers 백엔드(`src/routes/*`)와 무관. 업로드 경로(`uploadDocument`)는 손대지 않음.
