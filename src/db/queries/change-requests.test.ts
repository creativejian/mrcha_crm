import { beforeAll, expect, test } from "bun:test";
import { eq, ne, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../catalog";
import { toRows, type Executor } from "../client";
import { createOption, deleteOption } from "./catalog-admin";
import { getTestDb } from "../../test-utils/hermetic-db";
import {
  cancelOwnPending, claimPending, listChangeRequests, listModelPendingRequests, listMyChangeRequests,
  markRejected, upsertPendingRequest,
} from "./change-requests";

// ── 변경 요청 큐 CRUD — 전부 트랜잭션 롤백(discount-adoptions.test.ts와 같은 이유:
// afterAll에 의존하면 실행이 끊길 때 공유 master에 잔재가 남는다). requestedBy는 랜덤
// uuid를 쓴다 — 롤백이라 잔재 그물(고아 판정)에 걸릴 일도 없다.
// dual-mode(hermetic-db.ts): 로컬 test:server = 실 master(기존 그대로), CI test:pure = PGlite.
const db = await getTestDb();
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
    // toRows: 드라이버별 execute() 반환형 차이 정규화(postgres-js 배열 ↔ PGlite `{rows}`) —
    // dual-mode 테스트에서 원시 SQL 결과를 배열로 쓰려면 필수다(client.ts 주석).
    const [row] = toRows<{ advanced: boolean; price: number }>(
      await tx.execute(sql`
        select (updated_at > created_at) as advanced, (payload->>'price')::int as price
        from crm.catalog_change_requests where id = ${first.id}`),
    );
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

// ⚠️ 이 테스트는 upsert 내부의 "UPDATE 0행 → insert 폴스루" 분기 자체를 타지 않는다 — 같은 tx라
// claimPending 이후의 SELECT부터 pending이 안 보여 바깥 INSERT 경로를 탄다(내부 분기는 두 커넥션
// 인터리빙에서만 도달, 단일 tx로 재현 불가). 여기서 잠그는 것은 그 관찰 가능 계약이다:
// 승인된 뒤 같은 사람이 재제출하면 에러 없이 **새** 요청이 생기고, 옛 approved 행은 되살아나지 않는다.
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
    // NaN 가드 폴백 — payload에 trimId가 없으면 좌표 3개 모두 null(점프 비활성).
    expect(mine?.targetTrimId).toBeNull();
    expect(mine?.targetModelId).toBeNull();
    expect(mine?.targetBrandId).toBeNull();
  });
});

// admin이 대상을 직접 지운 뒤에도 pending이 남아있는 실운영 시나리오 — coordsFromOption이 optionById
// miss를 만나 noCoords로 떨어지는지 확인(라벨의 "삭제됨" 폴백과 대칭인 좌표 그물).
test("대상이 실제로 삭제되면 좌표가 전부 null로 떨어진다(option.update 대상 소실)", async () => {
  await inRollback(async (tx) => {
    const option = await createOption({ trimId, type: "basic", name: "승인요청검증좌표소실옵션", price: 1000 }, tx);
    const r = await upsertPendingRequest(
      {
        kind: "option.update", targetType: "option", targetId: option!.id,
        payload: { price: 2000 }, snapshot: { price: 1000 }, requestedBy: requester(),
      },
      tx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("적재 실패");
    await deleteOption(option!.id, tx);

    const rows = await listChangeRequests("pending", tx);
    const mine = rows.find((row) => row.id === r.id);
    expect(mine?.targetLabel).toBe("삭제됨");
    expect(mine?.targetBrandId).toBeNull();
    expect(mine?.targetModelId).toBeNull();
    expect(mine?.targetTrimId).toBeNull();
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
    // trim.create는 target_id가 없다 — 점프 좌표는 payload.modelId에서 파생돼야 한다(트림은 아직 없음).
    const created = rows.find((r) => r.kind === "trim.create");
    expect(created?.targetModelId).toBe(modelId);
    expect(created?.targetTrimId).toBeNull();
  });
});

test("목록 조회에 대상 라벨과 점프 좌표가 붙는다", async () => {
  await inRollback(async (tx) => {
    const me = requester();
    await upsertPendingRequest(trimUpdateInput(me), tx);
    const [model] = await tx
      .select({ name: modelsInCatalog.name, brandId: modelsInCatalog.brandId })
      .from(modelsInCatalog)
      .where(eq(modelsInCatalog.id, modelId));
    const all = await listChangeRequests("pending", tx);
    const mineRow = all.find((r) => r.requestedBy === me);
    expect(mineRow?.targetLabel).toContain(model!.name);
    // trim.update 대상이므로 세 좌표 모두 채워져야 한다(클라가 /mc-master/:modelId?brand=&hl= 조립).
    expect(mineRow?.targetModelId).toBe(modelId);
    expect(mineRow?.targetTrimId).toBe(trimId);
    expect(mineRow?.targetBrandId).toBe(model!.brandId);
    const mine = await listMyChangeRequests(me, tx);
    expect(mine.length).toBe(1);
  });
});
