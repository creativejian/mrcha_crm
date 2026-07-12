# AI 힌트 실데이터화 구현 계획 (2026-07-12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 목록 "AI 힌트"(hover 보라 말풍선)를 목업 하드코딩 20문장에서 **실 고객 데이터 기반 Gemini 생성값**(`crm.customers.ai_summary`)으로 교체하고, 고객 데이터 실변경 시 자동 재생성한다.

**Architecture:** embed-on-write 사상 미러 — 쓰기 라우트 성공 직후 `scheduleAiHintRefresh(c, customerId)`가 응답 비차단으로 fresh read → 재료 조립 → 입력 hash 비교(skip) → Gemini 1콜(`gemini-3.1-flash-lite`) → `ai_summary` + `ai_summary_source_hash` 저장. 클라는 `ai_summary`의 `**…**` 인라인 마크다운을 parts로 파싱해 기존 굵게 렌더를 유지, 값 없으면 버튼째 숨긴다. 백필 스크립트가 전 고객(22명 규모) 1회 소급.

**Tech Stack:** Hono + drizzle(crm 스키마) + Gemini generateContent(기존 `generateAnswer` 재사용) + React(목록 셀), bun:test/vitest TDD.

**Spec:** `ref/specs/2026-07-12-crm-ai-hint-datafication-design.md` (확정 결정 3건 + 목업 역설계 스펙 표)

---

## Open Questions 해소 (spec → 이 plan에서 확정)

| OQ | 확정 |
|---|---|
| 프롬프트 톤·길이 상한 강제 | 시스템 프롬프트 규칙(1문장·60자 내외·`**` 1~2곳·지어내기 금지) + 목업 역설계 few-shot 4문장 + `sanitizeAiHint` 후처리(첫 줄만·공백 정규화·`**` 홀수면 서식 전체 제거). 길이 90자 초과는 **저장하되 관측 로그**(차단하면 갱신이 영구 막힘 — SIMILARITY_THRESHOLD 로그 기반 재조정과 같은 사상) |
| 재생성 폭주 가드 | ①라우트당 1콜(고객 단위 스케줄 — 니즈 3필드가 한 PATCH면 1회) ②**입력 재료 hash skip** — `crm.customers.ai_summary_source_hash` 컬럼 신설(마이그 0028). no-op 쓰기·백필 재실행이 Gemini 0콜. ⚠️ spec의 "스키마 변경 0"에서 유일하게 이탈(hash 저장처 필요 — embed의 content_hash 사상 재사용에 필연) |
| Gemini 실패 시 | **fail-open** — 로그만, 기존 값 유지(embed-on-write 미러). hash도 안 올려 다음 쓰기가 자연 재시도. 백필이 최종 보정 |
| 레거시 all 모드 셀(:791) | `aiHintPlainText`(마커 제거 평문)로 표시. 목록 검색 문자열(:176)도 같은 헬퍼(마커가 검색어 경계를 깨는 것 방지) |

**추가 확정:**
- **게이트 env = `AI_HINT_ON_WRITE`(독립 키)** — 힌트 프롬프트 이상 시 코퍼스 임베딩을 죽이지 않는 독립 킬스위치. 게이트 3규칙은 embed-on-write와 **의도적 2벌**(0709 배치 3에서 공용 추출 기각 — 명시성이 실이익. 이제 3벌이지만 결정 존중, 주석으로 상호 참조).
- **재료 = spec 목록 그대로**: 프로필 청크 텍스트(`buildCustomerProfileChunkText` SSOT 재사용) + 진행/가능성/우선순위 + 최근 메모 3 + 미완료 할일 3 + 최신 견적 1 + (앱 고객) 최신 상담신청 문의 1(dismissed 제외). **일정·서류는 의도적 제외**(spec 재료 목록에 없음 — 훅 콜사이트도 안 붙인다).
- **재료 전무 → `ai_summary` NULL 클리어**(embed의 빈 텍스트→행 삭제 미러). 이름/진행 상태만으론 힌트 무의미.
- **저장 포맷 = `**…**` 인라인 마크다운 문장**(다른 서식 금지 — sanitize가 보증).
- **결정 ②(목업 문장 폐기 = 이사님 2026-05-19 설계 문장 교체)는 PR 머지 후 `ref/director-pending-confirmations.md`에 사후 공유 항목 추가**(spec의 "사후 확인 공유 권장" 이행 — Task 8).

## 파일 구조

| 파일 | 역할 |
|---|---|
| `src/db/schema.ts` (수정) | `aiSummarySourceHash` 컬럼 추가 |
| `drizzle/0028_*.sql` (생성) | `db:generate` 산출 — ADD COLUMN 1줄만 |
| `src/lib/ai-hint.ts` (신설) | 순수: 재료 조립 `buildAiHintMaterial` · `AI_HINT_SYSTEM_PROMPT` · `sanitizeAiHint` |
| `src/db/queries/ai-hint-sources.ts` (신설) | `loadAiHintSource`(fresh read) · `setCustomerAiHint`(쓰기) |
| `src/lib/ai-hint-on-write.ts` (신설) | `aiHintDeps` · `runAiHintJob` · `scheduleAiHintRefresh`(게이트+holdWork) |
| `src/routes/customers.ts` (수정) | 콜사이트 11곳(고객 POST/PATCH·메모/할일/견적 CUD) |
| `src/routes/consultations.ts` · `quote-requests.ts` (수정) | 승격 link/create-customer 4곳 |
| `src/scripts/backfill-ai-hints.ts` (신설) | 전 고객 1회 소급(hash skip으로 재실행 저비용) |
| `src/test-utils/fixture-codes.ts` (수정) | `CU-AIHINT-`·`QT-AIHINT-` 접두사 **선등록** |
| `package.json` (수정) | `test:server`에 `AI_HINT_ON_WRITE=off` 프리픽스 |
| `client/src/lib/customer-table.ts` (수정) | 목업 테이블 삭제 · `parseAiHintParts` · `aiHintDisplay` 재작성 · `aiHintPlainText` |
| `client/src/pages/CustomerManagementRow.tsx` (수정) | 값 없으면 AI 힌트 버튼 숨김 |
| `client/src/pages/CustomerManagementPage.tsx` (수정) | 검색 문자열(:176)·레거시 all 셀(:791) 평문화 |

## ⚠️ 공통 함정 (전 태스크 적용)

- **게이트 3규칙 재발 방지**: 서버 테스트는 반드시 `bun run test:server`(off 프리픽스). `bun test <파일>` 직접 실행 금지 — NODE_ENV=test 기본 off가 지켜주지만 셸에 NODE_ENV export된 환경에선 무력(2026-07-05 실사고와 같은 축).
- **실 DB 픽스처**: 랜덤 서픽스 + **registry 선등록 후** 테스트 작성(#214 tripwire — 정규식 고쳐 회피 금지). 잔재 확인 `bun run check:residue`.
- **`db:push` 금지** — `db:generate` → `db:migrate`만, schemaFilter는 crm 기존 설정 그대로.
- **견적/메모 psql 직접 삭제 금지**(임베딩 고아) — 정리는 API/UI 경로 또는 테스트 afterAll의 검증된 순서(quotes 먼저 → customers cascade).
- 커밋 메시지에 skip-ci 마커 토큰을 **글자로도 쓰지 말 것**(squash 전파 + substring 매칭 2중 사고 전례).

---

### Task 1: 스키마 — `ai_summary_source_hash` 컬럼 + 마이그 0028

**Files:**
- Modify: `src/db/schema.ts:83` (customers 테이블, `aiSummary` 바로 아래)
- Create: `drizzle/0028_*.sql` (db:generate 산출물)

- [ ] **Step 1: 컬럼 추가**

`src/db/schema.ts`의 `aiSummary: text("ai_summary"),` 바로 아래에:

```ts
  // AI 힌트 입력 재료 hash(lib/ai-hint-on-write) — 재료 불변 재생성 skip. embed content_hash 사상 재사용.
  aiSummarySourceHash: text("ai_summary_source_hash"),
```

- [ ] **Step 2: 마이그 생성·검수**

Run: `bun run db:generate`
Expected: `drizzle/0028_*.sql` 생성. **파일 내용이 `ALTER TABLE "crm"."customers" ADD COLUMN "ai_summary_source_hash" text;` 1문뿐인지 눈으로 확인**(다른 테이블 DDL이 섞이면 중단 — schemaFilter 밖 유출 신호).

- [ ] **Step 3: 마이그 적용 + psql 실측**

Run: `bun run db:migrate`
Run: `psql "$DATABASE_URL" -c "select column_name from information_schema.columns where table_schema='crm' and table_name='customers' and column_name='ai_summary_source_hash';"`
Expected: 1행 반환.

- [ ] **Step 4: typecheck 후 커밋**

Run: `bun run typecheck` → 0 errors
```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(crm): customers.ai_summary_source_hash 컬럼 — AI 힌트 재료 hash skip (마이그 0028)"
```

---

### Task 2: 순수 계층 `src/lib/ai-hint.ts` — 재료 조립·프롬프트·후처리 (TDD)

**Files:**
- Create: `src/lib/ai-hint.ts`
- Test: `src/lib/ai-hint.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/ai-hint.test.ts`:

```ts
import { test, expect } from "bun:test";

import { buildAiHintMaterial, sanitizeAiHint, type AiHintMaterialInput } from "./ai-hint";

const BASE: AiHintMaterialInput = {
  name: "김민준",
  statusGroup: "견적", status: "발송완료", chance: "높음", priority: "긴급",
  profileText: "거주지 인천광역시 남동구 · 직군 개인·4대보험 · 관심 차종 Maybach S-Class",
  memos: [{ body: "GLC 재고 확인 후 재견적" }],
  tasks: [{ category: "급함", due: "오늘", body: "X3 조건 비교" }],
  quote: { modelName: "S-Class", trimName: "S 500 4M Long", appStatus: "sent" },
  consultationNote: "중도해지 위약금이 궁금합니다",
};

test("buildAiHintMaterial: 전 재료 조립 — 섹션 라벨·발송 라벨·상담 문의 포함", () => {
  const m = buildAiHintMaterial(BASE);
  expect(m).toContain("고객 김민준");
  expect(m).toContain("진행 견적·발송완료");
  expect(m).toContain("계약 가능성 높음");
  expect(m).toContain("우선순위 긴급");
  expect(m).toContain("프로필: 거주지 인천광역시 남동구");
  expect(m).toContain("최근 메모:\n- GLC 재고 확인 후 재견적");
  expect(m).toContain("미완료 할 일:\n- 급함 · 오늘 · X3 조건 비교");
  expect(m).toContain("최신 견적: S-Class S 500 4M Long — 발송완료");
  expect(m).toContain("앱 상담 문의: 중도해지 위약금이 궁금합니다");
});

test("buildAiHintMaterial: 재료 전무(이름·상태만) → null", () => {
  expect(buildAiHintMaterial({
    ...BASE, profileText: "", memos: [], tasks: [], quote: null, consultationNote: null,
  })).toBeNull();
});

test("buildAiHintMaterial: 미발송 견적은 '작성 중', 진행/가능성 없으면 상태 라인 생략", () => {
  const m = buildAiHintMaterial({
    ...BASE, statusGroup: null, status: null, chance: null, priority: null,
    memos: [], tasks: [], consultationNote: null,
    quote: { modelName: "쏘렌토", trimName: null, appStatus: "draft" },
  });
  expect(m).toContain("최신 견적: 쏘렌토 — 작성 중");
  expect(m).not.toContain("진행 ");
  expect(m).not.toContain("우선순위");
});

test("buildAiHintMaterial: 200자 초과 재료는 클립(… 접미)", () => {
  const long = "가".repeat(300);
  const m = buildAiHintMaterial({ ...BASE, memos: [{ body: long }] });
  expect(m).toContain(`- ${"가".repeat(200)}…`);
  expect(m).not.toContain("가".repeat(201));
});

test("sanitizeAiHint: 다줄 출력 → 첫 비공백 줄만, 리스트 마커·앞뒤 따옴표 제거·공백 정규화", () => {
  expect(sanitizeAiHint('\n- "**X3 · GLC** 비교  중"\n부연 설명')).toBe("**X3 · GLC** 비교 중");
});

test("sanitizeAiHint: ** 짝이 안 맞으면 굵게 서식 전체 제거", () => {
  expect(sanitizeAiHint("**깨진 마크다운 문장")).toBe("깨진 마크다운 문장");
});

test("sanitizeAiHint: 빈/공백 출력 → 빈 문자열", () => {
  expect(sanitizeAiHint("  \n  ")).toBe("");
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server` (또는 이 시점엔 `bun test src/lib/ai-hint.test.ts`도 허용 — **순수 모듈이라 게이트 무관**, 단 실 DB 테스트가 생기는 Task 3부터는 금지)
Expected: FAIL — "Cannot find module './ai-hint'"

- [ ] **Step 3: 구현**

`src/lib/ai-hint.ts`:

```ts
// AI 힌트(고객 목록 hover 한 줄) — 순수 조립/후처리 계층. 재료 로드는 db/queries/ai-hint-sources,
// 생성 오케스트레이션은 lib/ai-hint-on-write, 클라 파서는 client/src/lib/customer-table.ts.
// 스펙: ref/specs/2026-07-12-crm-ai-hint-datafication-design.md (목업 20문장 역설계 — 단계별 관점).

export type AiHintMaterialInput = {
  name: string;
  statusGroup: string | null;
  status: string | null;
  chance: string | null;
  priority: string | null;
  profileText: string; // buildCustomerProfileChunkText 결과(빈 문자열 = 프로필 재료 없음)
  memos: { body: string }[]; // 최근순 상위 N
  tasks: { category: string | null; due: string | null; body: string | null }[]; // 미완료 최근순 상위 N
  quote: { modelName: string | null; trimName: string | null; appStatus: string | null } | null; // 최신 1건
  consultationNote: string | null; // 앱 상담신청 최신 문의(dismissed 제외)
};

const CLIP_CHARS = 200;

function clip(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length > CLIP_CHARS ? `${s.slice(0, CLIP_CHARS)}…` : s;
}

// 재료 전무(프로필·메모·할일·견적·상담 없음) → null = 힌트 클리어 신호(runAiHintJob이 ai_summary NULL 저장).
// 이름/진행 상태만으로 문장을 만들면 "신규 고객" 같은 무의미 힌트가 생겨 빈 말풍선보다 나쁘다.
export function buildAiHintMaterial(src: AiHintMaterialInput): string | null {
  const memoLines = src.memos.map((m) => m.body.trim()).filter(Boolean).map((b) => `- ${clip(b)}`);
  const taskLines = src.tasks
    .map((t) => [t.category, t.due, t.body].map((v) => v?.trim()).filter(Boolean).join(" · "))
    .filter(Boolean)
    .map((line) => `- ${clip(line)}`);
  const quoteLine = src.quote
    ? `최신 견적: ${[src.quote.modelName, src.quote.trimName].filter(Boolean).join(" ") || "차종 미정"} — ${src.quote.appStatus === "sent" ? "발송완료" : "작성 중"}`
    : null;
  const consultation = src.consultationNote?.trim() ? `앱 상담 문의: ${clip(src.consultationNote)}` : null;
  if (!src.profileText && memoLines.length === 0 && taskLines.length === 0 && !quoteLine && !consultation) return null;

  const progress = [src.statusGroup, src.status].filter(Boolean).join("·");
  const statusLine = [
    progress ? `진행 ${progress}` : null,
    src.chance ? `계약 가능성 ${src.chance}` : null,
    src.priority ? `우선순위 ${src.priority}` : null,
  ].filter(Boolean).join(" · ");

  return [
    `고객 ${src.name}`,
    statusLine || null,
    src.profileText ? `프로필: ${src.profileText}` : null,
    memoLines.length ? `최근 메모:\n${memoLines.join("\n")}` : null,
    taskLines.length ? `미완료 할 일:\n${taskLines.join("\n")}` : null,
    quoteLine,
    consultation,
  ].filter(Boolean).join("\n");
}

// 목업 역설계 스펙(설계 노트 결정 1) — 단계별 관점 + few-shot은 이사님 5/19 문장 원형.
export const AI_HINT_SYSTEM_PROMPT = [
  "당신은 자동차 리스·렌트·할부 CRM의 상담 보조 AI다. 고객 데이터를 읽고 상담사가 목록에서 한눈에 참고할 \"AI 힌트\" 한 문장을 만든다.",
  "",
  "규칙:",
  "- 한국어 1문장, 60자 내외(최대 90자). 줄바꿈 금지.",
  "- 형식: 무엇을 원하는가 + 무엇에 민감한가 + (필요 시) 지금 우선할 것.",
  "- 핵심어 1~2곳만 **굵게** 표시한다. 마크다운은 ** 만 허용, 다른 서식 금지.",
  "- 진행 단계별 관점: 상담/견적 단계=니즈+민감 포인트, 심사 단계=리스크+선결 조건, 계약완료/출고=잔여 작업, 보류/이탈=이탈 사유+재접근 명분.",
  "- 데이터에 없는 사실을 지어내지 않는다. 재료가 빈약하면 있는 것만으로 짧게 쓴다.",
  "- 존칭·인사·설명·따옴표 없이 힌트 문장만 출력한다.",
  "",
  "예시:",
  "- **X3 · GLC**를 비교 중이며 **중도해지, 월 납입액, 총비용** 차이에 민감",
  "- **사업자 증빙**이 약해 **승인 금융사**를 먼저 좁혀야 함",
  "- **계약 확정** 건으로 **출고 안내, 법인 서류**만 남음",
  "- **가족 반대**로 취소되어 **재컨택 명분** 정리가 필요",
].join("\n");

// 모델 출력 방어: 첫 비공백 줄만 취해 1문장 계약을 코드로 보증. ** 짝이 안 맞으면 깨진 마크다운이
// 말풍선에 그대로 노출되므로 서식을 통째로 벗긴다. 빈 문자열 반환 = 저장하지 않음(호출부 fail-open).
export function sanitizeAiHint(raw: string): string {
  const line = raw.replace(/\r/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  let hint = line
    .replace(/^[-*•]\s+/, "")
    .replace(/^["“]+|["”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if ((hint.match(/\*\*/g) ?? []).length % 2 !== 0) hint = hint.replaceAll("**", "");
  return hint;
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `bun run test:server`
Expected: 신규 7 pass 포함 전체 green.
```bash
git add src/lib/ai-hint.ts src/lib/ai-hint.test.ts
git commit -m "feat(crm): AI 힌트 순수 계층 — 재료 조립·시스템 프롬프트·후처리 sanitize (TDD)"
```

---

### Task 3: 로더/라이터 `src/db/queries/ai-hint-sources.ts` (실 DB 통합, 픽스처 registry 선등록)

**Files:**
- Modify: `src/test-utils/fixture-codes.ts` — **registry 선등록이 첫 스텝**
- Create: `src/db/queries/ai-hint-sources.ts`
- Test: `src/db/queries/ai-hint-sources.test.ts`

- [ ] **Step 1: 픽스처 접두사 registry 선등록**

`src/test-utils/fixture-codes.ts`의 `TEST_CUSTOMER_CODE_PREFIXES`에 알파벳 순 위치로:

```ts
  "CU-AIHINT-",     // db/queries/ai-hint-sources.test.ts · routes/customers.ai-hint.test.ts
```

`TEST_QUOTE_CODE_PREFIXES`에:

```ts
  "QT-AIHINT-",     // db/queries/ai-hint-sources.test.ts
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/db/queries/ai-hint-sources.test.ts` (실 master DB — `db/queries/embed-sources.test.ts` 스타일):

```ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customerMemos, customerTasks, customers, quotes } from "../schema";
import { loadAiHintSource, setCustomerAiHint } from "./ai-hint-sources";

const db = getDefaultDb();
const SUFFIX = crypto.randomUUID().slice(0, 8);
let CUST = "";

beforeAll(async () => {
  // 랜덤 서픽스 — 공유 master 재실행 트랩 방지(afterAll 실패 시 unique 위반 연쇄 방지).
  const [c] = await db.insert(customers).values({
    customerCode: `CU-AIHINT-${SUFFIX}`,
    name: "AI힌트소스테스트",
    statusGroup: "견적", status: "발송완료", chance: "높음", priority: "긴급",
    residence: "인천광역시 남동구", needModel: "X3",
    aiSummary: "이전 힌트", aiSummarySourceHash: "old-hash",
  }).returning({ id: customers.id });
  CUST = c.id;
  // 메모 4건(최근 3만 실려야 함) — createdAt 명시로 순서 결정화.
  for (let i = 0; i < 4; i++) {
    await db.insert(customerMemos).values({
      customerId: CUST, body: `메모${i}`, createdAt: new Date(Date.UTC(2026, 6, 1 + i)),
    });
  }
  await db.insert(customerTasks).values([
    { customerId: CUST, category: "급함", due: "오늘", body: "미완료 할일", done: false },
    { customerId: CUST, category: "오늘", due: "오늘", body: "완료된 할일", done: true },
  ]);
  await db.insert(quotes).values({
    customerId: CUST, quoteCode: `QT-AIHINT-${SUFFIX}`,
    modelName: "X3", trimName: "xDrive20i", appStatus: "sent",
  });
});

afterAll(async () => {
  await db.delete(quotes).where(eq(quotes.customerId, CUST)); // FK cascade 없음 — 견적 먼저
  await db.delete(customers).where(eq(customers.id, CUST));   // 메모·할일은 cascade
});

test("loadAiHintSource: 프로필 텍스트·최근 메모 3(최신순)·미완료 할일만·최신 견적·기존 hash", async () => {
  const src = await loadAiHintSource(CUST, db);
  expect(src).not.toBeNull();
  expect(src?.name).toBe("AI힌트소스테스트");
  expect(src?.profileText).toContain("거주지 인천광역시 남동구");
  expect(src?.profileText).toContain("관심 차종 X3");
  expect(src?.memos.map((m) => m.body)).toEqual(["메모3", "메모2", "메모1"]);
  expect(src?.tasks).toEqual([{ category: "급함", due: "오늘", body: "미완료 할일" }]);
  expect(src?.quote).toEqual({ modelName: "X3", trimName: "xDrive20i", appStatus: "sent" });
  expect(src?.consultationNote).toBeNull(); // app_user_id 없음 — 상담 조회 자체를 안 탄다
  expect(src?.aiSummary).toBe("이전 힌트");
  expect(src?.sourceHash).toBe("old-hash");
});

test("loadAiHintSource: 없는 고객 → null", async () => {
  expect(await loadAiHintSource(crypto.randomUUID(), db)).toBeNull();
});

test("setCustomerAiHint: ai_summary·hash 왕복 + null 클리어", async () => {
  await setCustomerAiHint(CUST, { aiSummary: "**새** 힌트", sourceHash: "h2" }, db);
  let src = await loadAiHintSource(CUST, db);
  expect(src?.aiSummary).toBe("**새** 힌트");
  expect(src?.sourceHash).toBe("h2");
  await setCustomerAiHint(CUST, { aiSummary: null, sourceHash: null }, db);
  src = await loadAiHintSource(CUST, db);
  expect(src?.aiSummary).toBeNull();
  expect(src?.sourceHash).toBeNull();
});
```

- [ ] **Step 3: 실패 확인**

Run: `bun run test:server`
Expected: FAIL — "Cannot find module './ai-hint-sources'"

- [ ] **Step 4: 구현**

`src/db/queries/ai-hint-sources.ts`:

```ts
import { and, desc, eq, isNotNull, ne, notExists, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { AiHintMaterialInput } from "../../lib/ai-hint";
import { buildCustomerProfileChunkText } from "../../lib/assistant-corpus";
import { getDefaultDb, type Executor } from "../client";
import { consultationRequests } from "../public-app";
import { consultationDismissals, customerMemos, customerTasks, customers, quotes } from "../schema";
import { PROFILE_CHUNK_COLUMNS } from "./embed-sources";

// AI 힌트 재료의 fresh read(고객 단위) + ai_summary 쓰기. 재료 구성 = spec 재료 목록
// (프로필 SSOT + 진행 + 최근 메모/미완료 할일 + 최신 견적 + 앱 상담 문의). 일정·서류는 의도적 제외.

export type AiHintSourceSnapshot = AiHintMaterialInput & {
  aiSummary: string | null;
  sourceHash: string | null;
};

const RECENT_MEMOS = 3;
const RECENT_TASKS = 3;

function nonEmpty(col: AnyPgColumn) {
  return and(isNotNull(col), ne(sql`btrim(${col})`, ""));
}

export async function loadAiHintSource(customerId: string, ex: Executor = getDefaultDb()): Promise<AiHintSourceSnapshot | null> {
  const [row] = await ex.select({
    name: customers.name,
    statusGroup: customers.statusGroup, status: customers.status,
    chance: customers.chance, priority: customers.priority,
    appUserId: customers.appUserId,
    aiSummary: customers.aiSummary, sourceHash: customers.aiSummarySourceHash,
    ...PROFILE_CHUNK_COLUMNS,
  }).from(customers).where(eq(customers.id, customerId));
  if (!row) return null;

  const memos = await ex.select({ body: customerMemos.body })
    .from(customerMemos)
    .where(and(eq(customerMemos.customerId, customerId), nonEmpty(customerMemos.body)))
    .orderBy(desc(customerMemos.createdAt), desc(customerMemos.id))
    .limit(RECENT_MEMOS);

  const tasks = await ex.select({ category: customerTasks.category, due: customerTasks.due, body: customerTasks.body })
    .from(customerTasks)
    .where(and(eq(customerTasks.customerId, customerId), eq(customerTasks.done, false)))
    .orderBy(desc(customerTasks.createdAt), desc(customerTasks.id))
    .limit(RECENT_TASKS);

  const [quote] = await ex.select({ modelName: quotes.modelName, trimName: quotes.trimName, appStatus: quotes.appStatus })
    .from(quotes)
    .where(eq(quotes.customerId, customerId))
    .orderBy(desc(quotes.createdAt), desc(quotes.id))
    .limit(1);

  // 앱 상담신청 최신 문의 — customer_consultations 도구와 같은 dismissed 제외 규칙.
  let consultationNote: string | null = null;
  if (row.appUserId) {
    const [latest] = await ex.select({ notes: consultationRequests.notes })
      .from(consultationRequests)
      .where(and(
        eq(consultationRequests.userId, row.appUserId),
        nonEmpty(consultationRequests.notes),
        notExists(
          ex.select({ one: sql`1` }).from(consultationDismissals)
            .where(eq(consultationDismissals.consultationId, consultationRequests.id)),
        ),
      ))
      .orderBy(desc(consultationRequests.createdAt))
      .limit(1);
    consultationNote = latest?.notes ?? null;
  }

  return {
    name: row.name,
    statusGroup: row.statusGroup, status: row.status, chance: row.chance, priority: row.priority,
    aiSummary: row.aiSummary, sourceHash: row.sourceHash,
    profileText: buildCustomerProfileChunkText(row),
    memos: memos.map((m) => ({ body: m.body ?? "" })),
    tasks,
    quote: quote ?? null,
    consultationNote,
  };
}

export async function setCustomerAiHint(
  customerId: string,
  hint: { aiSummary: string | null; sourceHash: string | null },
  ex: Executor = getDefaultDb(),
): Promise<void> {
  await ex.update(customers)
    .set({ aiSummary: hint.aiSummary, aiSummarySourceHash: hint.sourceHash })
    .where(eq(customers.id, customerId));
}
```

⚠️ 검수 포인트: `consultationDismissals`의 상담 FK 컬럼명은 `src/db/schema.ts:323`에서 실물 확인(`consultationId` 가정 — 다르면 그 이름으로).

- [ ] **Step 5: 통과 확인 + 잔재 0 확인 + 커밋**

Run: `bun run test:server` → green (fixture-codes.test.ts가 접두사 등록도 함께 통과 확인)
Run: `bun run check:residue` → 잔재 0
```bash
git add src/test-utils/fixture-codes.ts src/db/queries/ai-hint-sources.ts src/db/queries/ai-hint-sources.test.ts
git commit -m "feat(crm): AI 힌트 재료 로더/라이터 — 실 DB 통합 테스트, 픽스처 registry 선등록"
```

---

### Task 4: 훅 `src/lib/ai-hint-on-write.ts` — runAiHintJob + scheduleAiHintRefresh (TDD) + 게이트

**Files:**
- Create: `src/lib/ai-hint-on-write.ts`
- Test: `src/lib/ai-hint-on-write.test.ts`
- Modify: `package.json:18` — `test:server`에 `AI_HINT_ON_WRITE=off`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/ai-hint-on-write.test.ts` (`embed-on-write.test.ts` 미러 — fake deps·전역 누출 없는 필드 교체):

```ts
import { test, expect, beforeEach, afterAll } from "bun:test";

import type { Db } from "../db/client";
import type { AiHintSourceSnapshot } from "../db/queries/ai-hint-sources";
import { buildAiHintMaterial, type AiHintMaterialInput } from "./ai-hint";
import { aiHintDeps, runAiHintJob } from "./ai-hint-on-write";
import { contentHash } from "./assistant-corpus";
import type { GeminiTarget } from "./gemini-target";

const ORIGINAL = { ...aiHintDeps };
afterAll(() => { Object.assign(aiHintDeps, ORIGINAL); });
beforeEach(() => { Object.assign(aiHintDeps, ORIGINAL); });

const TARGET: GeminiTarget = { baseUrl: "https://gemini.test", apiKey: "k" };
const DB = {} as Db; // deps가 전부 fake라 실제로 안 쓰인다

const MATERIAL_INPUT: AiHintMaterialInput = {
  name: "훅테스트", statusGroup: "상담중", status: "차량상담중", chance: null, priority: null,
  profileText: "관심 차종 X3", memos: [], tasks: [], quote: null, consultationNote: null,
};
const SNAP: AiHintSourceSnapshot = { ...MATERIAL_INPUT, aiSummary: null, sourceHash: null };

type Calls = { generate: number; set: { aiSummary: string | null; sourceHash: string | null }[] };
function arm(opts: { snap: AiHintSourceSnapshot | null; answer?: string }): Calls {
  const calls: Calls = { generate: 0, set: [] };
  aiHintDeps.loadAiHintSource = async () => opts.snap;
  aiHintDeps.generateAnswer = async () => { calls.generate++; return opts.answer ?? "**X3** 상담 중"; };
  aiHintDeps.setCustomerAiHint = async (_id, hint) => { calls.set.push(hint); };
  return calls;
}

test("runAiHintJob: 재료 신규 → 생성 1회 + sanitize된 힌트·재료 hash 저장, outcome generated", async () => {
  const calls = arm({ snap: SNAP, answer: '- "**X3** 상담 중"\n부연' });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("generated");
  const material = buildAiHintMaterial(MATERIAL_INPUT);
  expect(calls.set).toEqual([{ aiSummary: "**X3** 상담 중", sourceHash: contentHash(material ?? "") }]);
});

test("runAiHintJob: 재료 hash 동일 → Gemini 미호출 skip, outcome unchanged", async () => {
  const material = buildAiHintMaterial(MATERIAL_INPUT);
  const calls = arm({ snap: { ...SNAP, sourceHash: contentHash(material ?? "") } });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("unchanged");
  expect(calls.generate).toBe(0);
  expect(calls.set).toEqual([]);
});

test("runAiHintJob: 재료 전무 + 기존 힌트 있음 → NULL 클리어, outcome cleared", async () => {
  const calls = arm({ snap: { ...SNAP, profileText: "", aiSummary: "잔재", sourceHash: "h" } });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("cleared");
  expect(calls.generate).toBe(0);
  expect(calls.set).toEqual([{ aiSummary: null, sourceHash: null }]);
});

test("runAiHintJob: 재료 전무 + 이미 비어 있음 → UPDATE 생략(멱등 cleared)", async () => {
  const calls = arm({ snap: { ...SNAP, profileText: "" } });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("cleared");
  expect(calls.set).toEqual([]);
});

test("runAiHintJob: 고객 소실(경합 삭제) → 아무것도 안 함, outcome missing", async () => {
  const calls = arm({ snap: null });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("missing");
  expect(calls.generate).toBe(0);
  expect(calls.set).toEqual([]);
});

test("runAiHintJob: 생성이 빈 문자열 → 기존 값 유지(쓰기 0)·hash도 안 올림, outcome empty", async () => {
  const calls = arm({ snap: { ...SNAP, aiSummary: "기존", sourceHash: "old" }, answer: "  \n " });
  expect(await runAiHintJob("c1", TARGET, DB)).toBe("empty");
  expect(calls.set).toEqual([]);
});

test("runAiHintJob: Gemini throw → 그대로 전파(쓰기 0 — 호출부 catch가 fail-open 로그)", async () => {
  const calls = arm({ snap: SNAP });
  aiHintDeps.generateAnswer = async () => { throw new Error("boom"); };
  await expect(runAiHintJob("c1", TARGET, DB)).rejects.toThrow("boom");
  expect(calls.set).toEqual([]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server`
Expected: FAIL — "Cannot find module './ai-hint-on-write'"

- [ ] **Step 3: 구현**

`src/lib/ai-hint-on-write.ts`:

```ts
import type { Context } from "hono";

import type { Db } from "../db/client";
import { loadAiHintSource, setCustomerAiHint } from "../db/queries/ai-hint-sources";
import { holdWork } from "../middleware/db";
import { AI_HINT_SYSTEM_PROMPT, buildAiHintMaterial, sanitizeAiHint } from "./ai-hint";
import { contentHash } from "./assistant-corpus";
import { generateAnswer } from "./gemini-generate";
import { resolveGeminiTargetFromRequest, type GeminiTarget } from "./gemini-target";

// AI 힌트 재생성 훅(스펙 2026-07-12): 고객 데이터 실변경 라우트가 성공 직후 scheduleAiHintRefresh를
// 호출하면 응답 반환 후 백그라운드에서 fresh read→재료 조립→입력 hash 비교→Gemini 1콜→ai_summary 저장.
// 실패는 로그만·기존 값 유지(fail-open — 백필 backfill-ai-hints가 보정). embed-on-write와 같은 사상,
// 대상만 다르다(임베딩 행 vs customers.ai_summary). 동시 요청 다건은 마지막 완료가 이긴다(각 job이
// fresh read라 최종 수렴 — 내구성 없음은 embed 스펙과 같은 수용 결정).

export type AiHintJobOutcome = "missing" | "cleared" | "unchanged" | "generated" | "empty";

// 테스트 주입용(embedOnWriteDeps 패턴).
export const aiHintDeps = { loadAiHintSource, setCustomerAiHint, generateAnswer };

export async function runAiHintJob(customerId: string, target: GeminiTarget, db: Db): Promise<AiHintJobOutcome> {
  const src = await aiHintDeps.loadAiHintSource(customerId, db);
  if (!src) return "missing"; // 고객 삭제 경합 — ai_summary는 행과 함께 사라졌으니 할 일 없음
  const material = buildAiHintMaterial(src);
  if (material === null) {
    // 재료 전무 — 힌트 클리어(클라가 버튼째 숨김). 이미 비어 있으면 UPDATE 생략(멱등).
    if (src.aiSummary !== null || src.sourceHash !== null) {
      await aiHintDeps.setCustomerAiHint(customerId, { aiSummary: null, sourceHash: null }, db);
    }
    return "cleared";
  }
  const hash = contentHash(material);
  if (src.sourceHash === hash) return "unchanged"; // 재료 불변 → Gemini 호출 생략(no-op 쓰기·백필 재실행 흡수)
  const hint = sanitizeAiHint(await aiHintDeps.generateAnswer(AI_HINT_SYSTEM_PROMPT, material, target));
  if (!hint) return "empty"; // 빈 출력 — 기존 값 유지. hash도 안 올린다(다음 쓰기가 자연 재시도)
  if (hint.length > 90) console.log(`[ai-hint] 길이 초과 관측 ${hint.length}자 customer=${customerId}`); // 프롬프트 튜닝 신호(저장은 한다)
  await aiHintDeps.setCustomerAiHint(customerId, { aiSummary: hint, sourceHash: hash }, db);
  return "generated";
}

// 구조적 타입 — hono Context가 Variables에 invariant라 교차 Variables 라우트(quote-requests는
// AuthVariables 없음)가 못 들어오는 문제 회피(embed-on-write와 동일).
type HookContext = Pick<Context, "executionCtx"> & {
  env: unknown;
  req: { header: (name: string) => string | undefined };
  get: (key: "dbHold") => Promise<unknown> | undefined;
  set: (key: "dbHold", value: Promise<unknown>) => void;
  var: { db: Db };
};

let gateSkipWarned = false;

// 게이트 3규칙은 embed-on-write.ts와 **의도적 2벌**(0709 배치 3에서 공용 추출 기각 — 명시성이 실이익).
// 규칙을 바꾸면 양쪽을 함께 고친다. env 키만 다르다(AI_HINT_ON_WRITE) — 힌트 프롬프트 이상 시
// 코퍼스 임베딩을 죽이지 않고 힌트만 끄는 독립 킬스위치.
// ①명시적 off 항상 off ②NODE_ENV=test는 기본 off·명시적 on만 ③그 외는 Gemini 키 있으면 on.
export function scheduleAiHintRefresh(c: HookContext, customerId: string): void {
  try {
    const env = (c.env ?? {}) as { AI_HINT_ON_WRITE?: string };
    const flag = (env.AI_HINT_ON_WRITE ?? process.env.AI_HINT_ON_WRITE)?.trim().toLowerCase();
    const gatedOff = flag === "off" || (flag !== "on" && process.env.NODE_ENV === "test");
    const target = gatedOff ? null : resolveGeminiTargetFromRequest(c);
    if (!target) {
      if (!gateSkipWarned) {
        gateSkipWarned = true;
        console.warn("[ai-hint] 재생성 비활성(키 부재·AI_HINT_ON_WRITE=off·NODE_ENV=test 기본 off) — 이후 동일 skip은 무로그");
      }
      return;
    }
    const task = runAiHintJob(customerId, target, c.var.db).then(
      (outcome) => { if (outcome !== "unchanged") console.log(`[ai-hint] ${customerId} ${outcome}`); },
      (e) => console.error(`[ai-hint] ${customerId} 실패:`, e),
    );
    holdWork(c, task); // dbHold 체인+waitUntil — 응답 비차단(#143 유형 방지)
  } catch (e) {
    console.error("[ai-hint] 스케줄 실패:", e);
  }
}
```

- [ ] **Step 4: `package.json` 게이트 프리픽스**

```json
"test:server": "EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local",
```

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `bun run test:server` → 신규 7 pass 포함 green
```bash
git add src/lib/ai-hint-on-write.ts src/lib/ai-hint-on-write.test.ts package.json
git commit -m "feat(crm): AI 힌트 재생성 훅 — hash skip·fail-open·게이트 3규칙(AI_HINT_ON_WRITE)"
```

---

### Task 5: 라우트 배선 15곳 + 배선 통합 테스트

**Files:**
- Modify: `src/routes/customers.ts` (11곳)
- Modify: `src/routes/consultations.ts` (2곳)
- Modify: `src/routes/quote-requests.ts` (2곳)
- Test: `src/routes/customers.ai-hint.test.ts` (신설 — `customers.embed.test.ts` 미러)

**배선 원칙**: 기존 `scheduleEmbedOnWrite`와 같은 자리(저장 성공 직후) 한 줄. 재료 무관 필드 변경은 hash skip이 흡수하므로 라우트에서 필드 조건 분기하지 않는다(PATCH는 무조건 1콜). **일정(schedules)·서류(documents) 라우트에는 붙이지 않는다** — spec 재료 목록 밖(의도적 제외, 이 원칙 위반 시 재료와 트리거가 어긋난다).

- [ ] **Step 1: 실패하는 배선 통합 테스트 작성**

`src/routes/customers.ai-hint.test.ts` (게이트 개방 + `generateAnswer`만 fake·DB deps 실물 — `crm.customers.ai_summary` 실 왕복 검증):

```ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customers } from "../db/schema";
import { aiHintDeps } from "../lib/ai-hint-on-write";

const db = getDefaultDb();
const ORIGINAL_GENERATE = aiHintDeps.generateAnswer;
const SAVED_FLAG = process.env.AI_HINT_ON_WRITE;
let CUST = "";
let generateCalls = 0;
let auth: Awaited<ReturnType<typeof makeTestAuth>>;

beforeAll(async () => {
  // 게이트 개방(test:server 기본 off) + generateAnswer만 fake(실 Gemini 차단). 로더/라이터는 실물.
  process.env.AI_HINT_ON_WRITE = "on";
  aiHintDeps.generateAnswer = async () => { generateCalls++; return "**배선** 검증 힌트"; };
  auth = await makeTestAuth("admin");
  const [c] = await db.insert(customers).values({
    customerCode: `CU-AIHINT-${crypto.randomUUID().slice(0, 8)}`, name: "AI힌트배선테스트",
  }).returning({ id: customers.id });
  CUST = c.id;
});

afterAll(async () => {
  aiHintDeps.generateAnswer = ORIGINAL_GENERATE;
  if (SAVED_FLAG !== undefined) process.env.AI_HINT_ON_WRITE = SAVED_FLAG; else delete process.env.AI_HINT_ON_WRITE;
  await db.delete(customers).where(eq(customers.id, CUST)); // 메모는 FK cascade
});

async function until(cond: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error("until: 조건 미충족 타임아웃");
    await Bun.sleep(25);
  }
}

async function hintRow() {
  const [row] = await db.select({ aiSummary: customers.aiSummary, hash: customers.aiSummarySourceHash })
    .from(customers).where(eq(customers.id, CUST));
  return row;
}

function makeApp() {
  return createApp({ keyResolver: auth.keyResolver, issuer: auth.issuer });
}

test("고객 PATCH(재료 필드) → ai_summary 생성(비동기), 동일 재료 재PATCH는 hash skip", async () => {
  const app = makeApp();
  const patch = (body: unknown) => app.request(`/api/customers/${CUST}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  expect((await patch({ needModel: "X3" })).status).toBe(200);
  await until(async () => (await hintRow())?.aiSummary === "**배선** 검증 힌트");
  expect((await hintRow())?.hash).not.toBeNull();
  const callsAfterFirst = generateCalls;

  // 같은 값 재PATCH → 재료 불변 → Gemini 미호출(hash skip)
  expect((await patch({ needModel: "X3" })).status).toBe(200);
  await Bun.sleep(300); // 훅이 돌 시간 — skip이라 관측할 변화가 없어 고정 대기
  expect(generateCalls).toBe(callsAfterFirst);
});

test("메모 POST → 재료 변경 → 재생성, 메모 삭제 → 다시 재생성(원 재료로 수렴)", async () => {
  const app = makeApp();
  const before = generateCalls;
  const res = await app.request(`/api/customers/${CUST}/memos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "AI힌트 배선 검증 메모" }),
  });
  expect(res.status).toBe(201);
  const memo = (await res.json()) as { id: string };
  await until(() => generateCalls === before + 1);

  const del = await app.request(`/api/customers/${CUST}/memos/${memo.id}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(del.status).toBe(200);
  await until(() => generateCalls === before + 2); // 삭제 후 재료(메모 없음)로 재생성
});

test("재료 전무 고객의 무관 필드 PATCH → 잔재 힌트 NULL 클리어", async () => {
  // 별도 고객 — 프로필/메모/할일/견적/상담 전무, 잔재 힌트만 시드.
  const [ghost] = await db.insert(customers).values({
    customerCode: `CU-AIHINT-${crypto.randomUUID().slice(0, 8)}`, name: "AI힌트클리어테스트",
    aiSummary: "잔재 힌트", aiSummarySourceHash: "stale",
  }).returning({ id: customers.id });
  try {
    const app = makeApp();
    const res = await app.request(`/api/customers/${ghost.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ team: "인천본사" }), // 재료 밖 필드 — 그래도 훅은 돌고, 재료 전무 판정이 클리어
    });
    expect(res.status).toBe(200);
    await until(async () => {
      const [row] = await db.select({ aiSummary: customers.aiSummary }).from(customers).where(eq(customers.id, ghost.id));
      return row.aiSummary === null;
    });
  } finally {
    await db.delete(customers).where(eq(customers.id, ghost.id));
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:server`
Expected: 신규 3 테스트 FAIL(훅 미배선 — `until` 타임아웃).

- [ ] **Step 3: `src/routes/customers.ts` 배선 11곳**

import 추가(19행 근처):

```ts
import { scheduleAiHintRefresh } from "../lib/ai-hint-on-write";
```

각 콜사이트 — 기존 `scheduleEmbedOnWrite` 바로 다음 줄에 추가:

| # | 위치(현재 라인 기준) | 추가 코드 |
|---|---|---|
| 1 | POST `/` :102 다음 | `scheduleAiHintRefresh(c, row.id);` |
| 2 | PATCH `/:id` :217 블록 뒤(if(row) 안) | `scheduleAiHintRefresh(c, id); // 어떤 필드든 재료 후보 — 재료 불변은 hash skip이 흡수` |
| 3 | POST `/:id/memos` :351 다음 | `scheduleAiHintRefresh(c, c.req.valid("param").id);` |
| 4 | PATCH memos :358 if(row) 안 | `if (row) { scheduleEmbedOnWrite(...); scheduleAiHintRefresh(c, p.id); }` 형태로 블록화 |
| 5 | DELETE memos :366 if(row) 안 | `scheduleAiHintRefresh(c, p.id);` (cleanup 다음 줄) |
| 6 | POST `/:id/tasks` :378 다음 | `scheduleAiHintRefresh(c, c.req.valid("param").id);` |
| 7 | PATCH tasks :390 if(row) 안 | `scheduleAiHintRefresh(c, p.id);` (4와 같은 블록화) |
| 8 | DELETE tasks :398 if(row) 안 | `scheduleAiHintRefresh(c, p.id);` |
| 9 | POST `/:id/quotes` :441 다음 | `scheduleAiHintRefresh(c, id);` |
| 10 | PATCH quotes :451 if(row) 안 | `scheduleAiHintRefresh(c, p.id);` (블록화) |
| 11 | DELETE quotes :465 다음(if(!row) return null 뒤) | `scheduleAiHintRefresh(c, p.id);` |

예시 — #4 메모 PATCH의 블록화(한 줄 if를 중괄호로):

```ts
customers.patch("/:id/memos/:childId", zValidator("param", childParam), zValidator("json", memoBody), (c) => {
  const p = c.req.valid("param");
  return run(c, async () => {
    const row = await updateMemo(p.id, p.childId, c.req.valid("json"), c.var.db);
    if (row) {
      scheduleEmbedOnWrite(c, { sourceType: "memo", sourceId: p.childId });
      scheduleAiHintRefresh(c, p.id);
    }
    return row;
  }, "메모를 찾을 수 없습니다.");
});
```

**일정 3곳(:403~:433)·서류(:554~:591)·견적 원본(:472~) 라우트는 건드리지 않는다.**

- [ ] **Step 4: 승격 라우트 4곳**

`src/routes/consultations.ts` — import 추가 후:

```ts
// link(:49) — 연결로 앱 상담 문의가 재료에 들어온다(customerId는 body에서).
if (row) {
  await schedulePromotionEmbeds(c, { appUserId: row.appUserId });
  scheduleAiHintRefresh(c, c.req.valid("json").customerId);
}
// create-customer(:62)
if (row) {
  await schedulePromotionEmbeds(c, { appUserId: row.appUserId, customerId: row.id });
  scheduleAiHintRefresh(c, row.id);
}
```

`src/routes/quote-requests.ts` — 동일 패턴(link :41 → `c.req.valid("json").customerId`, create-customer :55 → `row.id`). quoteRequests 라우터는 `AuthVariables` 없이 `DbVariables`만인데, `scheduleAiHintRefresh`의 `HookContext`가 구조적 타입이라 그대로 들어간다(embed 훅과 동일).

- [ ] **Step 5: 통과 확인 + 잔재 0 + 커밋**

Run: `bun run test:server` → green (배선 3종 포함)
Run: `bun run check:residue` → 잔재 0
```bash
git add src/routes/customers.ts src/routes/consultations.ts src/routes/quote-requests.ts src/routes/customers.ai-hint.test.ts
git commit -m "feat(crm): AI 힌트 재생성 라우트 배선 15곳 — 배선 통합 테스트(hash skip·클리어 실왕복)"
```

---

### Task 6: 클라 — 목업 테이블 폐기·parts 파서·버튼 숨김 (TDD)

**Files:**
- Modify: `client/src/lib/customer-table.ts` (:64-85 삭제, :121-123 재작성)
- Test: `client/src/lib/customer-table.test.ts`
- Create: `client/src/pages/CustomerManagementRow.test.tsx`
- Modify: `client/src/pages/CustomerManagementRow.tsx:443-473` (CustomerActionsCell)
- Modify: `client/src/pages/CustomerManagementPage.tsx:176, :791`

- [ ] **Step 1: 실패하는 유닛 테스트 (vitest)**

`client/src/lib/customer-table.test.ts`에 추가(기존 fixture `aiSummary: ""` 재사용, 스프레드로 변형):

```ts
describe("parseAiHintParts", () => {
  it("빈/공백 값 → 빈 배열(버튼 숨김 신호)", () => {
    expect(parseAiHintParts("")).toEqual([]);
    expect(parseAiHintParts("   ")).toEqual([]);
  });

  it("마커 없는 평문 → 단일 파트(구 DB 값 하위호환)", () => {
    expect(parseAiHintParts("초기비용 0원 선호")).toEqual([{ text: "초기비용 0원 선호" }]);
  });

  it("** 마커 → strong 파트 분해(선두·중간·연속)", () => {
    expect(parseAiHintParts("**X3 · GLC**를 비교 중이며 **총비용**에 민감")).toEqual([
      { text: "X3 · GLC", strong: true },
      { text: "를 비교 중이며 " },
      { text: "총비용", strong: true },
      { text: "에 민감" },
    ]);
  });
});

describe("aiHintDisplay (목업 테이블 폐기 후)", () => {
  it("목업 고객번호(CU-2605-0020)여도 aiSummary 기반으로만 파싱한다", () => {
    const customer = { ...baseCustomer, customerId: "CU-2605-0020", aiSummary: "**실데이터** 힌트" };
    expect(aiHintDisplay(customer).parts).toEqual([{ text: "실데이터", strong: true }, { text: " 힌트" }]);
  });
});

describe("aiHintPlainText", () => {
  it("마커 제거 평문(검색·레거시 셀용)", () => {
    expect(aiHintPlainText({ ...baseCustomer, aiSummary: "**X3** 비교 중" })).toBe("X3 비교 중");
  });
});
```

(`baseCustomer`는 이 테스트 파일의 기존 Customer fixture를 사용. import에 `parseAiHintParts`, `aiHintPlainText` 추가.)

`client/src/pages/CustomerManagementRow.test.tsx` 신설:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialCustomers } from "@/data/customers";
import { CustomerActionsCell } from "./CustomerManagementRow";

function renderCell(aiSummary: string) {
  const customer = { ...initialCustomers[0], aiSummary };
  render(
    <table><tbody><tr>
      <CustomerActionsCell customer={customer} onHintHover={() => {}} />
    </tr></tbody></table>,
  );
}

describe("CustomerActionsCell AI 힌트", () => {
  it("ai_summary 없으면 AI 힌트 버튼째 숨긴다(빈 보라 말풍선 방지) — 나머지 액션은 유지", () => {
    renderCell("");
    expect(screen.queryByLabelText("AI 힌트")).toBeNull();
    expect(screen.getByTitle("상담 열기")).toBeTruthy();
  });

  it("ai_summary 있으면 버튼 + 말풍선 strong 렌더", () => {
    renderCell("**X3** 비교 중");
    expect(screen.getByLabelText("AI 힌트")).toBeTruthy();
    const strong = screen.getByText("X3");
    expect(strong.tagName).toBe("STRONG");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit`
Expected: FAIL — `parseAiHintParts` export 부재 + 숨김 미구현.

- [ ] **Step 3: 구현**

`client/src/lib/customer-table.ts`:
- `aiHintDisplayByCustomerId` 테이블(:64-85) **삭제**.
- `aiHintDisplay`(:121-123)를 아래로 교체 + 신규 2함수:

```ts
// AI 힌트(ai_summary)는 서버 생성 문장 — 핵심어만 **…**로 감싼 인라인 마크다운 서브셋이 온다
// (src/lib/ai-hint.ts sanitizeAiHint가 보증). 구 DB 값(마커 없음)은 단일 평문 파트로 하위호환.
export function parseAiHintParts(text: string): { text: string; strong?: boolean }[] {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return [];
  const parts: { text: string; strong?: boolean }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(trimmed); m !== null; m = re.exec(trimmed)) {
    if (m.index > last) parts.push({ text: trimmed.slice(last, m.index) });
    parts.push({ text: m[1], strong: true });
    last = m.index + m[0].length;
  }
  if (last < trimmed.length) parts.push({ text: trimmed.slice(last) });
  return parts;
}

// 빈 배열 = 값 없음 — 소비처(CustomerActionsCell)가 버튼째 숨긴다(빈 보라 말풍선 방지).
export function aiHintDisplay(customer: Customer) {
  return { parts: parseAiHintParts(customer.aiSummary) };
}

// 마커 제거 평문 — 목록 검색 문자열·레거시 all 모드 셀용(마커가 검색어 경계를 깨는 것 방지).
export function aiHintPlainText(customer: Customer) {
  return parseAiHintParts(customer.aiSummary).map((part) => part.text).join("");
}
```

`client/src/pages/CustomerManagementRow.tsx` CustomerActionsCell(:443) — `ai-hint-wrap` span을 조건부로:

```tsx
export function CustomerActionsCell({ customer, onHintHover }: { customer: Customer; onHintHover: () => void }) {
  const hint = aiHintDisplay(customer);
  return (
    <td className="actions-cell">
      <span className="row-actions" onClick={(event) => event.stopPropagation()} onPointerDown={stopTableControlPointer}>
        {hint.parts.length > 0 && (
          <span
            className="ai-hint-wrap"
            onFocus={onHintHover}
            onMouseEnter={onHintHover}
            onPointerEnter={onHintHover}
          >
            <button aria-label="AI 힌트" className="tiny-btn ai-hint-btn" title="AI 힌트" type="button">
              <AiHintIcon />
            </button>
            <span className="ai-hint-tooltip">
              {hint.parts.map((part, index) => (
                part.strong ? <strong key={`${part.text}-${index}`}>{part.text}</strong> : <span key={`${part.text}-${index}`}>{part.text}</span>
              ))}
            </span>
          </span>
        )}
        <button className="tiny-btn" title="상담 열기" type="button"><MessageSquare size={15} /></button>
        <button className="tiny-btn" title="상세 문서" type="button"><FileText size={15} /></button>
      </span>
    </td>
  );
}
```

`client/src/pages/CustomerManagementPage.tsx` — `aiHintPlainText` import 후:
- :176 검색 문자열: `${customer.aiSummary}` → `${aiHintPlainText(customer)}`
- :791 레거시 all 셀: `{customer.aiSummary}` → `{aiHintPlainText(customer)}`

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `bun run test:unit` → green (기존 CustomerManagementPage 테스트 포함 — 목업 고객은 aiSummary 상주라 버튼 유지)
Run: `bun run typecheck && bun run lint` → 0
```bash
git add client/src/lib/customer-table.ts client/src/lib/customer-table.test.ts client/src/pages/CustomerManagementRow.tsx client/src/pages/CustomerManagementRow.test.tsx client/src/pages/CustomerManagementPage.tsx
git commit -m "feat(crm): AI 힌트 표시 실데이터화 — 목업 테이블 폐기·** 파서·값 없으면 버튼 숨김"
```

---

### Task 7: 백필 스크립트 + 실 실행

**Files:**
- Create: `src/scripts/backfill-ai-hints.ts`

- [ ] **Step 1: 스크립트 작성**

```ts
// 전 고객 AI 힌트 1회 소급 생성(스펙 2026-07-12 결정 2 — 목업 하드코딩 폐기의 데이터 채움).
// 훅(ai-hint-on-write) 도입 후에는 복구/보정 도구다 — 입력 hash skip으로 재실행 저비용.
// 실행: bun run --env-file=.env.local src/scripts/backfill-ai-hints.ts
import { asc } from "drizzle-orm";

import { getDefaultDb } from "../db/client";
import { customers } from "../db/schema";
import { runAiHintJob } from "../lib/ai-hint-on-write";
import { resolveGeminiTarget } from "../lib/gemini-target";

const db = getDefaultDb();
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is not set (.env.local)");
const target = resolveGeminiTarget({ apiKey }); // 로컬 실행 — 항상 직결(한국 IP)

const rows = await db
  .select({ id: customers.id, code: customers.customerCode, name: customers.name })
  .from(customers)
  .orderBy(asc(customers.createdAt));

const counts: Record<string, number> = {};
for (const row of rows) {
  try {
    const outcome = await runAiHintJob(row.id, target, db);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    console.log(`${row.code} ${row.name}: ${outcome}`);
  } catch (e) {
    counts.failed = (counts.failed ?? 0) + 1;
    console.error(`${row.code} ${row.name}: 실패`, e); // fail-open — 다음 고객 계속
  }
}
console.log("합계:", counts);
```

- [ ] **Step 2: typecheck·lint 후 커밋**

Run: `bun run typecheck && bun run lint` → 0
```bash
git add src/scripts/backfill-ai-hints.ts
git commit -m "feat(crm): AI 힌트 백필 스크립트 — 전 고객 소급·hash skip 재실행 저비용"
```

- [ ] **Step 3: 실 실행(공유 master — 의도된 데이터 변경)**

Run: `bun run --env-file=.env.local src/scripts/backfill-ai-hints.ts`
Expected: 22명 규모 — 데이터 있는 고객 `generated`, 완전 빈 고객 `cleared`(있다면). `failed` 0.

Run(검수): `psql "$DATABASE_URL" -c "select customer_code, left(ai_summary, 60), ai_summary_source_hash is not null as hashed from crm.customers order by customer_code;"`
Expected: 앱 유입 실 고객(CU-2606-0001/0002) 포함 전원 채워짐(또는 재료 전무 NULL). 문장이 60자 내외·`**` 짝 정상인지 눈으로 검수 — **이 실행이 프롬프트 품질의 1차 실측**이며, 톤이 어긋나면 여기서 `AI_HINT_SYSTEM_PROMPT`를 조정하고 재실행한다(hash가 있어 재실행 시 skip되므로, 프롬프트만 바꿔 강제 재생성하려면 임시로 `psql`… 대신 **스크립트에 `--force` 옵션을 만들지 말고** `update crm.customers set ai_summary_source_hash = null` 1회 후 재실행 — hash 클리어는 임베딩 고아를 만들지 않아 안전).

- [ ] **Step 4: 재실행 멱등 증명**

Run: 같은 명령 1회 더.
Expected: 전건 `unchanged` (Gemini 0콜 — hash skip 기계 증명).

---

### Task 8: 통합 검증 — 4종+build, 실 Gemini e2e, 격리 스택 브라우저 스모크

- [ ] **Step 1: 정적 검증 일괄**

Run: `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`
Expected: 전부 green, lint 0 problems. `bun run knip` clean(신규 export 전부 소비처 존재).

- [ ] **Step 2: 훅 실 Gemini e2e(로컬 dev 스택)**

1. `PUSH_NOTIFY=off bun dev`로 기동(로컬 dev는 GEMINI 키 존재 → 힌트 훅 자동 on. 배정을 안 만지면 PUSH는 무관하나 관례상 off).
2. 스모크 고객 1명(`CU-SMOKE` 접두 코드 — registry 상주)을 API로 생성 → 메모 1건 POST.
3. 서버 로그에서 `[ai-hint] <id> generated` 확인 + `psql`로 `ai_summary`·hash 실측.
4. 같은 메모 내용으로 재저장 → 로그에 generated 없음(unchanged는 무로그 설계 — generated가 안 찍히는 것으로 skip 확인).
5. 스모크 고객 UI/API 경로로 삭제(견적 만들었으면 견적부터 — psql 직접 삭제 금지) → `bun run check:residue` 잔재 0.

- [ ] **Step 3: 격리 스택 브라우저 스모크(목업 교체 시각 확인)**

격리 스택(#158 선례 — 임시 config로 API 8799 + vite 5174, 사용자 dev 불가침) + magiclink admin 세션:
1. 고객 목록 → 목업 고객(예: 김민준 CU-2605-0020) AI 힌트 hover → **하드코딩 문장이 아니라 생성 문장**(백필 결과와 byte 일치)이 굵게 파싱되어 뜨는지.
2. 앱 유입 고객(CU-2606-0001) hover → 빈 보라 말풍선이 아니라 실 문장.
3. `ai_summary` NULL 고객(신규 등록 직후 재료 전무)이 있으면 → AI 힌트 버튼 자체가 없음. 없으면 psql로 임시 NULL 세팅·확인 후 **원값 복원**.
4. 목록 검색창에 힌트 속 키워드 입력 → 검색 매칭(평문화 경로).
5. 스모크로 만든 데이터 전량 원복, 캡처는 `screenshots/`.

- [ ] **Step 4: 문서·이사님 공유 항목**

1. `ref/director-pending-confirmations.md`에 추가: "AI 힌트 목업 20문장(2026-05-19 이사님 설계 문장) → AI 생성값 교체(사후 공유) — 역설계 스펙으로 톤 보존, 원문은 git 이력에 보존".
2. `ref/active-session-brief.md` 갱신(완료 항목 + follow-up).
3. PR 생성(브랜치 → squash 관례, **커밋·푸시는 유슨생 지시 후**).

**PR 본문에 남길 follow-up 후보(구현하지 않음):**
- 일정·서류 재료 편입(spec 재료 목록 확장 시 훅 콜사이트 동반 — 원칙 주석 참조)
- 앱이 직접 쓰는 활동(채팅·견적요청 신규)은 힌트 트리거 없음 → 백필이 보정(embed와 동일 한계, CF Cron 검토 보류와 같은 축)
- 길이 초과 관측 로그 기반 프롬프트 재조정(임계값 튜닝 선례)
- 목업 고객 20명의 mock 배열(`data/customers.ts`) aiSummary 문자열은 불변(프로토타입·테스트 전용 — 합의 사항)

---

## Self-Review 체크 (작성 시점 수행 완료)

- **Spec 커버리지**: 결정 1(역설계 스펙→프롬프트+few-shot, Task 2) / 결정 2(목업 폐기+백필 단일 소스, Task 6·7) / 결정 3(실변경 자동 갱신, Task 4·5) / 빈 말풍선 해소(버튼 숨김, Task 6) / 표시 parts 파싱(Task 6) / 검색 문자열 유지(Task 6 — 평문화로 강화) ✅
- **타입 일관성**: `AiHintMaterialInput`(Task 2) ⊂ `AiHintSourceSnapshot`(Task 3) → `runAiHintJob`(Task 4)이 소비, `aiHintDeps` 필드명 = 테스트 arm()과 일치 ✅
- **spec 이탈 1건 명시**: hash 컬럼 신설(마이그 0028) — "스키마 변경 0" 문구에서 이탈, 근거는 OQ 표.
