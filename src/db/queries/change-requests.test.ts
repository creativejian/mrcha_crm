import { beforeAll, expect, test } from "bun:test";
import { eq, ne, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import {
  cancelOwnPending, claimPending, listChangeRequests, listModelPendingRequests, listMyChangeRequests,
  markRejected, upsertPendingRequest,
} from "./change-requests";

// ── 변경 요청 큐 CRUD — 전부 트랜잭션 롤백(discount-adoptions.test.ts와 같은 이유:
// afterAll에 의존하면 실행이 끊길 때 공유 master에 잔재가 남는다). requestedBy는 랜덤
// uuid를 쓴다 — 롤백이라 잔재 그물(고아 판정)에 걸릴 일도 없다.
const db = getDefaultDb();
let trimId = 0;
let modelId = 0;
let otherModelTrimId = 0; // 다른 모델 소속 트림 — option.create 축 스코프 제외 검증용

beforeAll(async () => {
  const [trim] = await db
    .select({ id: trimsInCatalog.id, modelId: trimsInCatalog.modelId })
    .from(trimsInCatalog)
    .limit(1);
  trimId = trim!.id;
  modelId = trim!.modelId;

  const [other] = await db
    .select({ id: trimsInCatalog.id })
    .from(trimsInCatalog)
    .where(ne(trimsInCatalog.modelId, modelId))
    .limit(1);
  otherModelTrimId = other!.id;
});

async function inRollback(fn: (tx: Executor) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw new Error("rollback");
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
}

const requester = () => crypto.randomUUID();

function trimUpdateInput(requestedBy: string, price = 999) {
  return {
    kind: "trim.update",
    targetType: "trim",
    targetId: trimId,
    payload: { price },
    snapshot: { price: 100 },
    requestedBy,
  };
}

test("적재: 새 요청은 pending으로 insert된다", async () => {
  await inRollback(async (tx) => {
    const r = await upsertPendingRequest(trimUpdateInput(requester()), tx);
    expect(r.ok).toBe(true);
  });
});

// ⚠️ 같은 트랜잭션에선 now()가 트랜잭션 시작 시각으로 고정된다(discount-adoptions.test.ts의
// backdateAudit과 같은 이유 — psql로 실측: BEGIN 안에서 두 now() 호출이 50ms 간격을 둬도 완전히
// 같은 값이다). 그래서 첫 insert 직후 created_at/updated_at을 살짝 뒤로 밀어야 두 번째 upsert의
// `updated_at = now()`가 그보다 "미래"임을 검증할 수 있다 — 운영에선 요청마다 트랜잭션이 달라
// 이 조작이 필요 없다.
async function backdate(tx: Executor, id: string, interval: string) {
  await tx.execute(sql`
    update crm.catalog_change_requests
    set created_at = created_at - ${sql.raw(`interval '${interval}'`)},
        updated_at = updated_at - ${sql.raw(`interval '${interval}'`)}
    where id = ${id}`);
}

test("본인 재제출은 같은 행을 갱신한다(payload 교체 + updated_at 전진 — DB 안 비교)", async () => {
  await inRollback(async (tx) => {
    const me = requester();
    const first = await upsertPendingRequest(trimUpdateInput(me, 100), tx);
    if (!first.ok) throw new Error("적재 실패");
    await backdate(tx, first.id, "1 hour");
    const second = await upsertPendingRequest(trimUpdateInput(me, 200), tx);
    if (!first.ok || !second.ok) throw new Error("적재 실패");
    expect(second.id).toBe(first.id);
    // JS Date 비교 금지(#334 — ms 절삭 거짓 실패·스큐 은폐). timestamptz끼리 DB 안에서 비교.
    const [row] = (await tx.execute(sql`
      select (updated_at > created_at) as advanced, (payload->>'price')::int as price
      from crm.catalog_change_requests where id = ${first.id}`)) as unknown as Array<{
      advanced: boolean; price: number;
    }>;
    expect(row!.advanced).toBe(true);
    expect(row!.price).toBe(200);
  });
});

test("타인의 pending이 있으면 적재를 거부하고 기존 요청 정보를 준다", async () => {
  await inRollback(async (tx) => {
    const firstRequester = requester();
    const first = await upsertPendingRequest(trimUpdateInput(firstRequester), tx);
    expect(first.ok).toBe(true);
    const second = await upsertPendingRequest(trimUpdateInput(requester()), tx);
    expect(second.ok).toBe(false);
    // 필드 뒤바뀜 회귀 방지 — 거부 응답이 "기존(첫) 요청자"를 정확히 가리키는지 확인.
    if (second.ok) throw new Error("거부 예상 실패");
    expect(second.existingRequestedBy).toBe(firstRequester);
    expect(second.existingCreatedAt).toBeInstanceOf(Date);
  });
});

test("승인으로 pending이 사라진 뒤 같은 요청자가 다시 적재하면 새 행이 insert된다(폴스루)", async () => {
  await inRollback(async (tx) => {
    const me = requester();
    const first = await upsertPendingRequest(trimUpdateInput(me), tx);
    if (!first.ok) throw new Error("적재 실패");
    const claimed = await claimPending(first.id, requester(), tx);
    expect(claimed).not.toBeNull();

    const second = await upsertPendingRequest(trimUpdateInput(me), tx);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("적재 실패");
    // 기존 pending이 이미 approved로 전이됐으므로 갱신 대상이 없다 — 새 행이어야 한다.
    expect(second.id).not.toBe(first.id);
  });
});

test("모델 단위 pending 조회: option.create는 payload.trimId가 그 모델 소속일 때만 잡힌다", async () => {
  await inRollback(async (tx) => {
    const optionCreateInput = (byTrimId: number) => ({
      kind: "option.create", targetType: "option", targetId: null,
      payload: { trimId: byTrimId, name: "승인요청검증옵션", price: 1, type: "basic" },
      snapshot: {}, requestedBy: requester(),
    });
    const inScope = await upsertPendingRequest(optionCreateInput(trimId), tx);
    const outOfScope = await upsertPendingRequest(optionCreateInput(otherModelTrimId), tx);
    expect(inScope.ok).toBe(true);
    expect(outOfScope.ok).toBe(true);
    if (!inScope.ok || !outOfScope.ok) throw new Error("적재 실패");

    const rows = await listModelPendingRequests(modelId, tx);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(inScope.id);
    expect(ids).not.toContain(outOfScope.id);
  });
});

test("payload에 trimId가 없는 option.create도 목록 조회가 죽지 않고 '삭제됨' 폴백으로 떨어진다", async () => {
  await inRollback(async (tx) => {
    const r = await upsertPendingRequest(
      {
        kind: "option.create", targetType: "option", targetId: null,
        payload: {}, snapshot: {}, requestedBy: requester(),
      },
      tx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("적재 실패");
    const rows = await listChangeRequests("pending", tx);
    const mine = rows.find((row) => row.id === r.id);
    expect(mine?.targetLabel.startsWith("삭제됨")).toBe(true);
  });
});

test("create(target_id NULL)는 UNIQUE 대상이 아니다 — 여러 건 공존", async () => {
  await inRollback(async (tx) => {
    const input = (by: string) => ({
      kind: "trim.create", targetType: "trim", targetId: null,
      payload: { modelId, trimName: "승인요청검증", price: 1, modelYear: 2027, fuelType: "가솔린" },
      snapshot: {}, requestedBy: by,
    });
    const a = await upsertPendingRequest(input(requester()), tx);
    const b = await upsertPendingRequest(input(requester()), tx);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

test("claimPending: pending만 선점하고, 두 번째 claim은 null", async () => {
  await inRollback(async (tx) => {
    const r = await upsertPendingRequest(trimUpdateInput(requester()), tx);
    if (!r.ok) throw new Error("적재 실패");
    const admin = requester();
    const claimed = await claimPending(r.id, admin, tx);
    expect(claimed?.kind).toBe("trim.update");
    expect(await claimPending(r.id, admin, tx)).toBeNull();
  });
});

test("markRejected: 사유가 남고 pending만 대상이다", async () => {
  await inRollback(async (tx) => {
    const r = await upsertPendingRequest(trimUpdateInput(requester()), tx);
    if (!r.ok) throw new Error("적재 실패");
    const rejected = await markRejected(r.id, "가격 근거 부족", requester(), tx);
    expect(rejected?.rejectReason).toBe("가격 근거 부족");
    expect(await markRejected(r.id, "again", requester(), tx)).toBeNull();
  });
});

test("cancelOwnPending: 본인+pending만 취소된다", async () => {
  await inRollback(async (tx) => {
    const me = requester();
    const r = await upsertPendingRequest(trimUpdateInput(me), tx);
    if (!r.ok) throw new Error("적재 실패");
    expect(await cancelOwnPending(r.id, requester(), tx)).toBeNull(); // 타인
    const canceled = await cancelOwnPending(r.id, me, tx);
    expect(canceled?.status).toBe("canceled");
  });
});

test("모델 단위 pending 조회가 trim 대상·trim.create payload를 모두 잡는다", async () => {
  await inRollback(async (tx) => {
    await upsertPendingRequest(trimUpdateInput(requester()), tx);
    await upsertPendingRequest(
      {
        kind: "trim.create", targetType: "trim", targetId: null,
        payload: { modelId, trimName: "승인요청검증", price: 1, modelYear: 2027, fuelType: "가솔린" },
        snapshot: {}, requestedBy: requester(),
      },
      tx,
    );
    const rows = await listModelPendingRequests(modelId, tx);
    const kinds = rows.map((r) => r.kind).sort();
    expect(kinds).toContain("trim.update");
    expect(kinds).toContain("trim.create");
  });
});

test("목록 조회에 대상 라벨이 붙는다", async () => {
  await inRollback(async (tx) => {
    const me = requester();
    await upsertPendingRequest(trimUpdateInput(me), tx);
    const [model] = await tx
      .select({ name: modelsInCatalog.name })
      .from(modelsInCatalog)
      .where(eq(modelsInCatalog.id, modelId));
    const all = await listChangeRequests("pending", tx);
    const mineRow = all.find((r) => r.requestedBy === me);
    expect(mineRow?.targetLabel).toContain(model!.name);
    const mine = await listMyChangeRequests(me, tx);
    expect(mine.length).toBe(1);
  });
});
