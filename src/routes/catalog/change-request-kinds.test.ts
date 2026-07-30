import { beforeAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../../db/catalog";
import { getDefaultDb, type Executor } from "../../db/client";
import { catalogDiscountAdoptions, type ChangeRequestKind } from "../../db/schema";
import { updateTrim } from "../../db/queries/catalog-admin";
import { upsertPendingRequest } from "../../db/queries/change-requests";
import { ConflictError } from "../../lib/errors";
import { approveChangeRequest, CHANGE_KINDS } from "./change-request-kinds";

// ── kind 레지스트리 + 승인 replay — 전부 롤백(catalog를 실제로 바꾸는 테스트라 필수).
const db = getDefaultDb();
let trimId = 0;
let modelId = 0;
let brandId = 0;

beforeAll(async () => {
  const [trim] = await db
    .select({ id: trimsInCatalog.id, modelId: trimsInCatalog.modelId, brandId: modelsInCatalog.brandId })
    .from(trimsInCatalog)
    .innerJoin(modelsInCatalog, eq(modelsInCatalog.id, trimsInCatalog.modelId))
    .limit(1);
  trimId = trim!.id;
  modelId = trim!.modelId;
  brandId = trim!.brandId;
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

async function enqueue(tx: Executor, kind: ChangeRequestKind, targetId: number | null, payload: Record<string, unknown>) {
  const def = CHANGE_KINDS[kind];
  const snapshot = await def.buildSnapshot(targetId, payload, tx);
  expect(snapshot).not.toBeNull();
  const r = await upsertPendingRequest(
    { kind, targetType: def.targetType, targetId, payload, snapshot, requestedBy: crypto.randomUUID() },
    tx,
  );
  if (!r.ok) throw new Error("적재 실패");
  return r.id;
}

test("trim.update 승인 replay가 catalog를 실제로 바꾸고 할인 감사가 승인자 명의로 남는다", async () => {
  await inRollback(async (tx) => {
    const [before] = await tx
      .select({ price: trimsInCatalog.price, fin: trimsInCatalog.financialDiscountAmount })
      .from(trimsInCatalog)
      .where(eq(trimsInCatalog.id, trimId));
    const newFin = (before!.fin ?? 0) + 111;
    const id = await enqueue(tx, "trim.update", trimId, { financialDiscountAmount: newFin });
    const adminId = crypto.randomUUID();
    const result = await approveChangeRequest(id, adminId, tx);
    expect(result).not.toBeNull();
    const [after] = await tx
      .select({ fin: trimsInCatalog.financialDiscountAmount })
      .from(trimsInCatalog)
      .where(eq(trimsInCatalog.id, trimId));
    expect(after!.fin).toBe(newFin);
    // 할인 감사 명의 = 승인한 관리자(spec §6.4 ④)
    const audits = await tx
      .select()
      .from(catalogDiscountAdoptions)
      .where(eq(catalogDiscountAdoptions.adoptedBy, adminId));
    expect(audits.length).toBe(1);
    expect(audits[0]!.field).toBe("financial");
  });
});

test("드리프트: 요청 후 admin이 직접 고치면 승인이 ConflictError로 죽고 행은 롤백된다", async () => {
  await inRollback(async (tx) => {
    const [before] = await tx
      .select({ price: trimsInCatalog.price })
      .from(trimsInCatalog)
      .where(eq(trimsInCatalog.id, trimId));
    const id = await enqueue(tx, "trim.update", trimId, { price: Number(before!.price) + 1 });
    // 그 사이 admin 직접 수정(같은 필드)
    await updateTrim(trimId, { price: Number(before!.price) + 500 }, tx);
    await expect(approveChangeRequest(id, crypto.randomUUID(), tx)).rejects.toThrow(ConflictError);
  });
});

test("model.create: 승인 replay가 모델을 만든다(부모 = 브랜드 존재 확인)", async () => {
  await inRollback(async (tx) => {
    const id = await enqueue(tx, "model.create", null, {
      brandId, name: "승인요청검증모델", category: null, status: "판매중",
    });
    const created = (await approveChangeRequest(id, crypto.randomUUID(), tx)) as { id: number } | null;
    expect(created?.id).toBeGreaterThan(0);
    const [row] = await tx
      .select({ name: modelsInCatalog.name })
      .from(modelsInCatalog)
      .where(eq(modelsInCatalog.id, created!.id));
    expect(row!.name).toBe("승인요청검증모델");
  });
});

test("payload가 현재 스키마에 안 맞으면 승인이 ConflictError(재검증 §6.4 ②)", async () => {
  await inRollback(async (tx) => {
    const id = await enqueue(tx, "model.update", modelId, { category: "테스트" });
    // psql 직접 조작 시나리오 — payload를 스키마 밖 값으로 오염
    await tx.execute(
      sql`update crm.catalog_change_requests set payload = '{"status":"없는상태"}'::jsonb where id = ${id}`,
    );
    await expect(approveChangeRequest(id, crypto.randomUUID(), tx)).rejects.toThrow(ConflictError);
  });
});

test("no-option 스냅샷은 옵션 개수를 담는다(요청 후 옵션 생김 = 드리프트 재료)", async () => {
  await inRollback(async (tx) => {
    const def = CHANGE_KINDS["trim.no-option.set"];
    const snapshot = await def.buildSnapshot(trimId, {}, tx);
    expect(snapshot).not.toBeNull();
    expect(typeof (snapshot as Record<string, unknown>).optionCount).toBe("number");
  });
});
