# CRM Gemini Supabase Edge 프록시 — 리전 차단 우회 (A안)

- 작성일: 2026-07-03
- 상태: 설계 (사용자 승인됨 — 대화에서 설계 요약 승인)
- 선행: 업무 AI B1(#132)~SSE 스트리밍(#142)·SSE P0 hotfix(#143). 이 슬라이스는 prod Gemini 리전 차단(인프라)을 해소한다.
- 관련: `src/lib/gemini-embed.ts`, `src/lib/gemini-generate.ts`, `src/routes/assistant.ts`, `src/scripts/backfill-embeddings.ts`, `supabase/functions/crm-analyst/auth.ts`, 신설 `supabase/functions/crm-gemini-proxy/`.

## 배경

prod(CF Pages Functions)에서 Gemini 호출이 라우팅에 따라 `400 FAILED_PRECONDITION "User location is not supported"`로 실패한다. 원인은 billing이 아니라 **CF 콜로 라우팅**: cf-ray 실측 KIX 200 · **HKG 500** · NRT 200 — 홍콩은 유료 티어여도 Gemini 차단 지역이다. CF Workers는 egress 리전을 제어할 수 없으므로, Gemini 호출을 **리전을 고정할 수 있는 Supabase Edge Function 경유**로 옮긴다. 같은 master 프로젝트의 앱 `ai-analyst`가 Supabase Edge에서 Gemini SSE를 실사용 중이라 경로 자체는 실증됐다.

## 결정

1. **신설 Edge Function `crm-gemini-proxy` = 완전 투명 릴레이**: 역할은 staff 인증 + 호스트 교체 두 가지뿐. 경로·쿼리·바디를 그대로 `https://generativelanguage.googleapis.com`에 전달하고 응답(`Response(upstream.body)`)을 그대로 반환한다(스트림 자연 패스스루). Gemini 요청/응답 스키마를 전혀 모른다 — CRM 쪽 `classifyGeminiError`·재시도 로직이 무변경으로 동작한다.
2. **경로 allowlist**: `POST /v1beta/models/<model>:(batchEmbedContents|generateContent|streamGenerateContent)` 3개 메서드만 허용. 그 외 404. 오픈 프록시 방지 2중 방어(1차는 staff 인증).
3. **인증 = staff JWT 포워딩**: CRM 백엔드가 수신한 `Authorization`(staff JWT)을 릴레이에 그대로 전달 → 릴레이가 `verifyStaff`로 재검증(서명·issuer·audience·CRM_ROLES). `auth.ts`는 `../crm-analyst/auth.ts` **상대 import 재사용** — 복제본 3벌 방지, crm-analyst 재배포 불필요, 기존 패리티 테스트 불변. 배포는 verify_jwt 기본값 유지(게이트웨이 검증 + 함수 내 역할 게이트 이중).
4. **키 전달 = `x-goog-api-key` 헤더로 통일(직결·프록시 양 모드)**: 기존 `?key=` 쿼리를 제거해 프록시/게이트웨이 로그에 키가 남지 않게 한다. 릴레이는 이 헤더만 Google로 전달 — 릴레이에 GEMINI_API_KEY 시크릿 불필요.
5. **스위치 = `GEMINI_PROXY_URL` env**: 설정 시 프록시 경유, 미설정 시 기존 직결. CF Pages Production에만 설정. 로컬 dev·백필 스크립트는 미설정 → 직결(한국 IP 정상). **롤백 = env 제거**(함수는 남아도 무해).
6. **`x-region: ap-northeast-2` 핀 필수**: Supabase Edge는 기본이 호출자 최근접 리전 실행이라, HKG 콜로의 CF Worker가 부르면 함수도 홍콩에서 돌아 문제가 그대로 재현된다. 서울 핀이 이 설계의 존재 이유. 상수로 두고(env 아님) 필요 시 코드 변경.
7. **CRM lib 시그니처 = `GeminiTarget` 객체**: `apiKey: string` 인자를 `target: GeminiTarget`(baseUrl·apiKey·extraHeaders)으로 교체. 호출부가 라우트(2곳)·백필(1곳)·테스트뿐이라 churn이 작다.

## 범위 (IN / OUT)

**IN**

- `supabase/functions/crm-gemini-proxy/index.ts`(+ 테스트): 인증 게이트 → allowlist → 릴레이. 공용 `deno.json`/`import_map.json` 사용(신규 의존성 0 — jose 기존 핀).
- `src/lib/gemini-target.ts` 신설: `GeminiTarget` 타입 + `resolveGeminiTarget()`(직결/프록시 분기·헤더 구성).
- `src/lib/gemini-embed.ts`·`gemini-generate.ts`: URL 조립·헤더를 target 기반으로 교체(`?key=` → `x-goog-api-key`).
- `src/routes/assistant.ts`: env(`GEMINI_PROXY_URL`)와 수신 `Authorization`으로 target 구성해 lib에 전달.
- `src/scripts/backfill-embeddings.ts`: 직결 target 구성으로 갱신.
- 배포: `supabase functions deploy crm-gemini-proxy`(master, 함수명 지정) + CF Pages Production `GEMINI_PROXY_URL` 설정 + prod 실측(**#143 dbHold prod 스트리밍 검증 겸**).

**OUT (후속/불변)**

- `crm-analyst`(서류 분류): 이미 Supabase Edge에서 실행 — 리전 문제 없음, 무변경.
- 프론트: 변경 없음(백엔드 경유 호출만 영향).
- 유사도 임계값·히스토리 pruning 등 업무 AI 기존 follow-up.

## 아키텍처

### 1. Edge Function `crm-gemini-proxy` (신설)

plain `Deno.serve` 단일 핸들러(단일 라우트라 Hono 불필요):

```
POST {SUPABASE_URL}/functions/v1/crm-gemini-proxy/v1beta/models/<model>:<method>[?alt=sse]
```

처리 순서:

1. **인증**: `Authorization: Bearer <staff JWT>` → `verifyStaff`(`../crm-analyst/auth.ts`, JWKS 모듈 레벨 캐시). 실패 시 401/403 JSON.
2. **allowlist**: pathname에서 함수 프리픽스(`/crm-gemini-proxy`) 제거 후 `^/v1beta/models/[^/:]+:(batchEmbedContents|generateContent|streamGenerateContent)$` 매칭. 불일치 404, POST 외 405.
3. **릴레이**: `https://generativelanguage.googleapis.com` + 경로 + 원본 쿼리로 fetch. 전달 헤더는 **`content-type`·`x-goog-api-key` 딱 2개** — `Authorization`(supabase JWT)은 절대 전달하지 않는다(Google이 OAuth 토큰으로 오인해 401). 응답은 `new Response(upstream.body, { status, headers: content-type })`로 그대로 반환 — 버퍼링 금지(SSE 패스스루).

CORS 없음(서버→서버 전용, 브라우저 호출 없음).

### 2. CRM — `src/lib/gemini-target.ts` (신설)

```ts
export type GeminiTarget = {
  baseUrl: string;                        // 직결: https://generativelanguage.googleapis.com | 프록시: GEMINI_PROXY_URL
  apiKey: string;                         // 항상 x-goog-api-key 헤더로
  extraHeaders?: Record<string, string>;  // 프록시: Authorization(staff JWT)·x-region
};

export function resolveGeminiTarget(opts: {
  apiKey: string;
  proxyUrl?: string | null;    // GEMINI_PROXY_URL (미설정 → 직결)
  authHeader?: string | null;  // 수신 요청의 Authorization 원문 (프록시 인증 포워딩)
}): GeminiTarget;

export function geminiHeaders(target: GeminiTarget): Record<string, string>;
// { "Content-Type": "application/json", "x-goog-api-key": apiKey, ...extraHeaders }
```

- 프록시 모드 extraHeaders: `Authorization`(포워딩) + `x-region: "ap-northeast-2"`(상수).
- 프록시 URL은 설정됐는데 authHeader가 없으면 오설정 — throw(백필이 실수로 프록시를 타는 것 방지).

### 3. CRM — lib 3함수 시그니처 교체

- `embedTexts(texts, target, taskType, fetchImpl)` / `generateAnswer(sys, user, target, history, fetchImpl)` / `generateAnswerStream(...)`.
- URL 조립: `${target.baseUrl}/v1beta/models/${MODEL}:${method}`(+`?alt=sse`). `?key=` 쿼리 제거, 헤더는 `geminiHeaders(target)`.
- 재시도·에러 분류·SSE 파싱 로직 무변경.

### 4. 호출부

- `src/routes/assistant.ts` `/ask`: `GEMINI_PROXY_URL`(c.env ?? process.env)과 `c.req.header("Authorization")`로 target 구성. apiKey 유효성 체크 기존 유지.
- `src/scripts/backfill-embeddings.ts`: `resolveGeminiTarget({ apiKey })`(직결).

## 에러 처리

- 릴레이는 Gemini의 status·본문을 그대로 통과 → CRM `classifyGeminiError`가 기존대로 판별·재시도.
- 릴레이 자체 실패(401/403/404)는 CRM에서 generic 4xx로 분류돼 로그 본문에 남는다(기존 로그가 body 200자 포함).
- 프록시 오설정(URL만 있고 auth 없음)은 target 구성 시점 throw — 라우트 try/catch가 500으로 수용.

## 검증

- **Deno 테스트**(`crm-gemini-proxy/index_test.ts`): 인증 401/403 · allowlist(허용 3종 통과, 그 외 404, GET 405) · Google로 나가는 요청의 헤더 세척(Authorization 미전달·x-goog-api-key 전달) · 스트림 바디 패스스루(mock fetch).
- **CRM 유닛**: `gemini-target.test.ts`(분기·헤더·오설정 throw), `gemini-embed/generate.test.ts` 시그니처 갱신 + `x-goog-api-key` 헤더 검증(기존 mock fetch 활용).
- 기존 4종: `bun run typecheck` · `lint`(0) · `test:unit` · `test:server` + `bun run build`.
- **로컬 프록시 실측**: `.env.local`에 `GEMINI_PROXY_URL` 임시 설정 → 업무 AI 왕복(논스트리밍+스트리밍)으로 배포된 릴레이 경유 확인 → 제거.
- **prod 실측**: CF Pages Production `GEMINI_PROXY_URL` 설정 후 업무 AI 논스트리밍·스트리밍 왕복. **#143 dbHold prod 스트리밍 실측 검증을 여기서 같이 마무리**(중지 부분저장·유령 빈 말풍선 0 포함).

## 배포·롤백

- 배포: `supabase functions deploy crm-gemini-proxy`(공유 master `wmkbmlespgzkeekliwio`, 함수명 지정으로 앱 함수 불가침). 시크릿 추가 없음.
- CF Pages: Production 환경변수 `GEMINI_PROXY_URL=https://wmkbmlespgzkeekliwio.supabase.co/functions/v1/crm-gemini-proxy` 설정 → 재배포.
- 롤백: env 제거 후 재배포 → 직결 복귀. Edge 함수 잔존은 무해(staff 인증 게이트).

## 함정 (재발 방지 기록)

1. **x-region 핀 없으면 무의미** — Supabase Edge 기본 실행 리전은 호출자 최근접. HKG CF Worker → HKG Edge → 동일 차단.
2. **Authorization을 Google로 전달 금지** — supabase JWT를 OAuth로 오인해 유효한 API 키가 있어도 401.
3. **릴레이에서 바디를 읽거나 버퍼링 금지** — `upstream.body` 그대로 반환해야 SSE 첫 청크 지연이 없다.
4. **키는 헤더로** — `?key=` 쿼리는 게이트웨이/프록시 액세스 로그에 남는다.
