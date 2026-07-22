import type { Context } from "hono";

import type { Db } from "../db/client";
import { loadAiHintSource, setCustomerAiHint } from "../db/queries/ai-hint-sources";
import { holdWork } from "../middleware/db";
import { AI_HINT_SYSTEM_PROMPT, aiHintSourceHash, buildAiHintMaterial, sanitizeAiHint } from "./ai-hint";
import { generateAnswer } from "./gemini-generate";
import { resolveGeminiTargetFromRequest, type GeminiTarget } from "./gemini-target";

// AI 힌트 재생성 훅(스펙 2026-07-12): 고객 데이터 실변경 라우트가 성공 직후 scheduleAiHintRefresh를
// 호출하면 응답 반환 후 백그라운드에서 fresh read→재료 조립→입력 hash 비교→Gemini 1콜→ai_summary 저장.
// 실패는 로그만·기존 값 유지(fail-open — 백필 backfill-ai-hints가 보정). embed-on-write와 같은 사상,
// 대상만 다르다(임베딩 행 vs customers.ai_summary). 동시 요청 다건은 마지막 완료가 이긴다(각 job이
// fresh read라 최종 수렴 — 내구성 없음은 embed 스펙과 같은 수용 결정).

export type AiHintJobOutcome = "missing" | "cleared" | "unchanged" | "generated" | "empty";

// 테스트 주입용(embedOnWriteDeps 패턴 — mock.module 대신 전역 누출 없는 필드 교체).
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
  const hash = aiHintSourceHash(material);
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

// 게이트 3규칙은 **의도적 3벌**(embed-on-write.ts · push-notify.ts assignmentPushEnabled · 여기 —
// 0709 배치 3에서 공용 추출 기각 — 명시성이 실이익. "2벌" 표기는 push-notify를 빠뜨린 과소 서술이라
// 0713 정정). 규칙을 바꾸면 **세 곳**을 함께 고친다. env 키만 다르다(AI_HINT_ON_WRITE) — 힌트
// 프롬프트 이상 시 코퍼스 임베딩을 죽이지 않고 힌트만 끄는 독립 킬스위치.
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
    holdWork(c, task); // dbHold 체인+waitUntil — 응답 비차단, CF 연결/아이솔레이트 수명 확보(#143 유형 방지)
  } catch (e) {
    console.error("[ai-hint] 스케줄 실패:", e);
  }
}
