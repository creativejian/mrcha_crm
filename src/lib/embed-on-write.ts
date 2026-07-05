import type { Context } from "hono";

import type { Db } from "../db/client";
import { loadCorpusSource, type WritableCorpusSourceType } from "../db/queries/embed-sources";
import { deleteEmbeddingBySource, getEmbeddingHash, upsertEmbedding } from "../db/queries/embeddings";
import { holdWork } from "../middleware/db";
import { buildChunkContent, contentHash } from "./assistant-corpus";
import { embedTexts } from "./gemini-embed";
import { resolveGeminiTargetFromRequest, type GeminiTarget } from "./gemini-target";

// 증분 임베딩(스펙 2026-07-05): 쓰기 라우트가 성공 직후 scheduleEmbedOnWrite를 호출하면
// 응답 반환 후 백그라운드에서 fresh read→hash 비교→임베딩→upsert가 돈다. 실패는 로그만
// (다음 쓰기/백필이 보정 — 내구성 없음은 스펙 수용 결정).

export type EmbedOnWriteJob = { sourceType: WritableCorpusSourceType; sourceId: string };
export type EmbedJobOutcome = "deleted" | "unchanged" | "embedded";

// 테스트 주입용(assistantDeps 패턴 — mock.module 대신 전역 누출 없는 필드 교체).
export const embedOnWriteDeps = { loadCorpusSource, getEmbeddingHash, deleteEmbeddingBySource, upsertEmbedding, embedTexts };

// 태스크 본문. 순수 오케스트레이션 — 유닛은 fake deps로 직접 호출, 라우트 경유는 배선 테스트가 커버.
export async function runEmbedJob(job: EmbedOnWriteJob, target: GeminiTarget, db: Db): Promise<EmbedJobOutcome> {
  const snap = await embedOnWriteDeps.loadCorpusSource(job.sourceType, job.sourceId, db);
  if (!snap || !snap.text.trim()) {
    // 원본 소실(경합 삭제) 또는 텍스트 비움(니즈 필드 클리어) — 검색에서 제거.
    await embedOnWriteDeps.deleteEmbeddingBySource(job.sourceType, job.sourceId, db);
    return "deleted";
  }
  const content = buildChunkContent({
    sourceType: job.sourceType, sourceId: job.sourceId,
    customerId: snap.customerId, customerName: snap.customerName, text: snap.text,
  });
  const hash = contentHash(content);
  if ((await embedOnWriteDeps.getEmbeddingHash(job.sourceType, job.sourceId, db)) === hash) return "unchanged"; // Gemini 호출 생략(스펙 결정 4)
  const [vector] = await embedOnWriteDeps.embedTexts([content], target, "RETRIEVAL_DOCUMENT");
  await embedOnWriteDeps.upsertEmbedding(
    { sourceType: job.sourceType, sourceId: job.sourceId, customerId: snap.customerId, content, contentHash: hash, embedding: vector },
    db,
  );
  return "embedded";
}

// 구조적 타입 — hono Context가 Variables에 invariant라 교차 Variables 라우트가 못 들어오는 문제 회피
// (holdStreamLifetime과 같은 이유). env는 CF Pages c.env, 로컬(Bun.serve)은 c.env가 Bun Server 객체라
// GEMINI_* 키가 없음 → process.env 폴백.
type HookContext = Pick<Context, "executionCtx"> & {
  env: unknown;
  req: { header: (name: string) => string | undefined };
  get: (key: "dbHold") => Promise<unknown> | undefined;
  set: (key: "dbHold", value: Promise<unknown>) => void;
  var: { db: Db };
};

// 게이트 미충족 skip은 첫 발생만 경고(스펙 77행 "skip(+로그)") — 매 쓰기 로그는 노이즈라 1회로 제한.
let gateSkipWarned = false;

// 저장 성공 경로에서 호출. 어떤 경우에도 throw하지 않는다(저장 응답 불변) — 게이트 미충족은 조용히 no-op.
export function scheduleEmbedOnWrite(c: HookContext, job: EmbedOnWriteJob): void {
  try {
    const env = (c.env ?? {}) as { EMBED_ON_WRITE?: string };
    // sentinel 정규화 — 킬스위치 오타("OFF", " off")가 fail-open(실 Gemini 호출)되는 방향이 나쁘다.
    const flag = (env.EMBED_ON_WRITE ?? process.env.EMBED_ON_WRITE)?.trim().toLowerCase();
    // 게이트 3규칙: ①명시적 off는 항상 off ②bun test(NODE_ENV=test 자동 설정)에서는 기본 off —
    // 명시적 on만 허용(test:server의 off 프리픽스를 우회한 `bun test <파일>` 직접 실행이
    // 실 Gemini 호출+master crm.embeddings 오염을 낸 실사고 방지, 2026-07-05)
    // ③그 외(로컬 dev·prod)는 키 있으면 on.
    // 전제: bun은 NODE_ENV가 미설정일 때만 test로 자동 세팅한다 — 셸에 NODE_ENV가 export된 환경에선
    // ②가 무력화될 수 있어 test:server의 EMBED_ON_WRITE=off 프리픽스가 1차 방어로 잔존한다.
    const gatedOff = flag === "off" || (flag !== "on" && process.env.NODE_ENV === "test");
    // env→target 배선 SSOT(gemini-target.ts) — 키 부재는 null, 프록시 설정 시 서울 핀+Authorization 포워딩(#144).
    // 게이트 off가 target 해석보다 먼저다(해석은 프록시 오설정 시 throw 가능 — 킬스위치는 무조건 조용히 skip).
    const target = gatedOff ? null : resolveGeminiTargetFromRequest(c);
    if (!target) {
      if (!gateSkipWarned) {
        gateSkipWarned = true;
        console.warn("[embed-on-write] 증분 임베딩 비활성(키 부재·EMBED_ON_WRITE=off·NODE_ENV=test 기본 off) — 이후 동일 skip은 무로그");
      }
      return; // 키 없는 환경·테스트(EMBED_ON_WRITE=off)는 임베딩 없이 저장만
    }
    const task = runEmbedJob(job, target, c.var.db).then(
      (outcome) => { if (outcome !== "unchanged") console.log(`[embed-on-write] ${job.sourceType}/${job.sourceId} ${outcome}`); },
      (e) => console.error(`[embed-on-write] ${job.sourceType}/${job.sourceId} 실패:`, e),
    );
    holdWork(c, task); // dbHold 체인+waitUntil — 응답 비차단, CF 연결/아이솔레이트 수명 확보(#143 유형 방지)
  } catch (e) {
    console.error("[embed-on-write] 스케줄 실패:", e);
  }
}
