import { expect, test } from "bun:test";

import { getDefaultDb } from "../db/client";
import { embeddings } from "../db/schema";
import { embeddingContentHash } from "../lib/assistant-corpus";
import { EMBEDDING_MODEL } from "../lib/gemini-embed";

const db = getDefaultDb();

// ── 임베딩 코퍼스 불변식: 저장된 모든 벡터가 **현재 모델**의 산출물이다 ──────────────────
// 배치 14 K1-c. `crm.embeddings`에는 모델 컬럼이 없어(schema.ts) 어떤 모델이 만든 벡터인지 행만
// 봐서는 알 수 없다. 유일한 단서가 `content_hash`에 섞인 모델명 salt(embeddingContentHash)다.
//
// 왜 필요한가 — `#312`(001 → 2 이관)에서 **백필이 prod 배포에 38초 선행**한 것이 실측으로 확인됐다
// (커밋 10:55:27 KST vs 백필 행 updated_at 10:56:05~11 KST). 그 창 안에 쓰기가 있었다면 구 모델
// 벡터와 신 모델 벡터가 한 테이블에 공존한다. 차원이 같아 **에러가 나지 않고**(3072 동일), 검색
// 유사도만 무작위가 되어 조용히 재현율이 죽는다 — 증상으로는 잡을 수 없는 실패 모드다.
//
// 자가치유가 있긴 하다(그 소스를 다음에 편집하면 embed-on-write가 새 해시로 덮는다). 하지만
// "언젠가 고쳐진다"와 "지금 섞여 있지 않다"는 다른 명제고, 후자를 확인할 수단이 이것뿐이다.
test("crm.embeddings 전 행이 현재 임베딩 모델의 해시 스킴을 따른다", async () => {
  const rows = await db.select({
    sourceType: embeddings.sourceType,
    sourceId: embeddings.sourceId,
    content: embeddings.content,
    contentHash: embeddings.contentHash,
  }).from(embeddings);

  const stale = rows.filter((r) => r.contentHash !== embeddingContentHash(r.content));

  if (stale.length > 0) {
    // 원인이 둘이라 병기한다 — 오진하면 멀쩡한 코퍼스를 갈아엎게 된다.
    console.error(
      `\n[embedding] 현재 모델(${EMBEDDING_MODEL}) 스킴과 다른 행 ${stale.length}/${rows.length}건:\n` +
      stale.slice(0, 5).map((r) => `  ${r.sourceType}/${r.sourceId}`).join("\n") +
      `\n\n  원인 ①구 모델 벡터 잔존 → 'bun run --env-file=.env.local src/scripts/backfill-embeddings.ts'로 재임베딩` +
      `\n  원인 ②테스트 픽스처 잔재(embeddings.test.ts는 "h1"·"hash-v1" 같은 리터럴 해시를 심는다)` +
      ` → 실행이 끊겨 남은 행이면 해당 sourceId를 지울 것. sourceId가 랜덤 UUID면 ②를 먼저 의심한다.\n`,
    );
  }
  expect(stale.map((r) => `${r.sourceType}/${r.sourceId}`)).toEqual([]);
});

// 검사 자체 검증 — "0건"만 단언하면 판별식이 고장 나도 초록불이 켜진다(fixture-residue와 같은 사상).
// 실 DB를 건드리지 않고 판별식만 검증한다.
test("판별식이 구 스킴 해시를 실제로 잡는다(자가 검증)", () => {
  const content = "고객 홍길동 상담메모: 판별식 자가검증";
  const currentScheme = embeddingContentHash(content);
  // 구 스킴 = 모델명 salt 없는 순수 sha256(= `#312` 이전 형태이자, 다른 모델로 만든 행의 형태).
  const legacyScheme = new Bun.CryptoHasher("sha256").update(content).digest("hex");

  expect(legacyScheme).not.toBe(currentScheme); // 두 스킴이 실제로 구분된다
  expect(currentScheme !== embeddingContentHash(content)).toBe(false); // 현재 스킴은 통과
  expect(legacyScheme !== embeddingContentHash(content)).toBe(true); // 구 스킴은 걸린다
});
