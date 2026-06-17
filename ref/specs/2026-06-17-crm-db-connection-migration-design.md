# A2 DB 연결 master 직결 전환 설계

작성일: 2026-06-17
상태: **design. ⓪ db:push 즉시 제거 완료.** 나머지는 순서대로 — crm 연결(Phase ① 독립) / catalog adopt·거울 폐기(Phase ① 적용·V검증 후).
성격: ⓐ 트랙의 인프라 전환(코드를 옛 모델 → master 직결 새 모델). 앱 팀이 우리 코드 검증 후 전달한 master 보호 가드레일 반영(2026-06-17).
연계: `2026-06-16-master-supabase-integration.md`(§100 CRM 작업), `2026-06-17-phase1-go-and-verification.md`(Phase ①/adopt), `2026-06-17-crm-quotes-schema-design.md`(crm 스키마 내용).

## 배경 / 검증된 현재 상태

협상 문서는 새 모델 합의를 반영하지만 **코드는 아직 옛 모델**(거울 + sync). 앱 팀이 우리 프로젝트를 확인하고 전환 가드레일을 전달, CRM에서 실측 검증 완료:

| 측면 | 현재 (코드, 검증됨) | 목표 (합의) |
|---|---|---|
| DB 연결 | 자체 Supabase (`DATABASE_URL`) | master 직접 |
| 차량 | 거울 + sync (`src/sync/`, `ref/db_import/`, `MRCHA_MASTER_PUBLISHABLE_KEY`) | master catalog 직접 read |
| CRM 운영 | drizzle가 자체 db `public`에 `customers`/`consultations`(`pgTable`) | master `crm` 스키마 |
| drizzle | `schemaFilter:["public"]` + `db:push` 존재 | `schemaFilter:["crm","catalog"]` + migrate(push 금지) |

## ⚠️ 최重 가드레일 (앱 팀 전달, 코드로 검증)

`DATABASE_URL`을 master로 repoint하는 순간, 옛 config(`schemaFilter:["public"]` + `db:push`)는 치명적이다. `db:push` 실행 시 drizzle은 "public엔 `customers`·`consultations`만 있어야 함"으로 보고 **master public의 앱 테이블 26개(`profiles`·`quote_requests`·`ai_estimates`·`chat_*`...)를 DROP** + `consultations`를 schema.ts 정의대로 ALTER 시도.

→ **방어: `db:push` 제거(완료) + repoint 이전에 schemaFilter를 `crm`으로. 순서 역전(repoint 먼저) 절대 금지.**

## 전환 순서 (역순 금지)

### ⓪ [완료] db:push 스크립트 제거
`package.json`에서 `"db:push"` 삭제. CLAUDE.md `db:push 금지` 정책과 일치, generate→migrate만 쓰므로 워크플로우 영향 0. 가장 직접적인 자동 파괴 경로 선차단.

### Phase A — crm 연결 (Phase ① 독립, 지금 가능)
1. `schema.ts`: `customers`/`consultations` + ⓐ(`quotes`/`quote_scenarios`/`customers` 확장)를 **`pgSchema("crm")`** 기반으로 정의. `drizzle.config.ts` `schemaFilter:["crm"]`.
2. `DATABASE_URL` → master repoint(`.env.local`). 이제 `schemaFilter:["crm"]`라 generate/migrate가 master `crm`만 대상 → `public`(앱) 불가침.
3. `db:generate` → `db:migrate`: master에 `crm` 스키마 + 테이블 생성.

### Phase B — catalog adopt + 거울 폐기 (Phase ① 적용·V1~V8 통과 후)
4. `db:pull:catalog`: master catalog introspect baseline(`drizzle.config.catalog.ts`, `DATABASE_URL`=master 그대로 — 합의 F단계 메커니즘과 일치 ✓).
5. 차량 조회 API 전환: `src/db/client.ts`·`src/db/queries/vehicles.ts`·`src/routes/vehicles.ts`를 master catalog 직접 read로.
6. 거울 폐기: `src/sync/*` 삭제, `ref/db_import/` 덤프, `MRCHA_MASTER_*` 키, `sync` 스크립트, mc-master sync UI(PR #19) 정리.

## 영향 파일

- `drizzle.config.ts`(schemaFilter `["crm"]`로) / `drizzle.config.catalog.ts`(그대로 사용)
- `src/db/schema.ts`(crm pgSchema + ⓐ 테이블)
- `package.json`(db:push 제거 완료, `sync` 제거 예정)
- `.env.local`(DATABASE_URL repoint)
- `src/db/client.ts`·`src/db/queries/vehicles.ts`·`src/routes/vehicles.ts`(catalog read 전환)
- `src/sync/*`·`ref/db_import/`(삭제)

## 미결 / 주의

- **catalog FK 타이밍**: `crm.quotes.trim_id → catalog.trims` 등 catalog FK는 catalog가 drizzle에 adopt된 **Phase B 후**라야 정의 가능. 선택지 — (가) Phase A에서 crm 테이블 생성(catalog FK 보류) → Phase B adopt 후 FK 추가 마이그레이션, (나) crm 생성 자체를 Phase ① 후로 미뤄 catalog와 일괄 정합. plan에서 결정.
- 운영 데이터를 빨리 다루려면 Phase A 선행이 유리, 단순함은 (나).
- 구매방식별 할인·취득세(Gemini 추출)·리스 계산(`lease_calc.ts` 포팅)은 별개.
- 실제 구현 단계는 writing-plans로.
