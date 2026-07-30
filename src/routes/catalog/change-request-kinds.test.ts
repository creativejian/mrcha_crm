import { beforeAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { modelsInCatalog, trimsInCatalog } from "../../db/catalog";
import { getDefaultDb, type Executor } from "../../db/client";
import { catalogDiscountAdoptions, type ChangeRequestKind } from "../../db/schema";
import { createOption, createTrim, deleteOption, updateTrim } from "../../db/queries/catalog-admin";
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

test("submit 저장 payload는 파싱 출력이다 — model.create의 category default가 채워진다", async () => {
  await inRollback(async (tx) => {
    // enqueue 헬퍼는 파싱 전 payload를 그대로 넣으므로 여기선 submitChangeRequest 경로의 계약을
    // 쿼리 레벨로 재현한다: bodySchema.parse가 default를 채우는지 + 그 값이 저장되는지.
    const def = CHANGE_KINDS["model.create"];
    const parsed = def.bodySchema.parse({ brandId, name: "승인요청검증모델" }) as Record<string, unknown>;
    expect(parsed.category).toBeNull();
    expect(parsed.status).toBe("판매중");

    const snapshot = await def.buildSnapshot(null, parsed, tx);
    const r = await upsertPendingRequest(
      { kind: "model.create", targetType: "model", targetId: null, payload: parsed, snapshot, requestedBy: crypto.randomUUID() },
      tx,
    );
    if (!r.ok) throw new Error("적재 실패");
    const [row] = (await tx.execute(
      sql`select payload from crm.catalog_change_requests where id = ${r.id}`,
    )) as unknown as Array<{ payload: Record<string, unknown> }>;
    expect(row!.payload.category).toBeNull();
    expect(row!.payload.status).toBe("판매중");
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

test("no-option 드리프트: 요청 후 옵션이 생기면 승인이 ConflictError로 죽는다", async () => {
  await inRollback(async (tx) => {
    const noOptTrim = await createTrim(
      { modelId, trimName: "승인요청검증무옵션드리프트 - 등급", price: 1_000_000, modelYear: 2027, fuelType: "가솔린" },
      tx,
    );
    const reqId = await enqueue(tx, "trim.no-option.set", noOptTrim!.id, {});
    // 요청 후 옵션이 생겨 스냅샷(optionCount:0)과 어긋난다.
    await createOption({ trimId: noOptTrim!.id, type: "basic", name: "드리프트옵션", price: 10000 }, tx);
    await expect(approveChangeRequest(reqId, crypto.randomUUID(), tx)).rejects.toThrow(ConflictError);
  });
});

test("8종 kind 전수 스모크 — enqueue→approve가 전부 에러 없이 끝난다(레지스트리 오타 그물)", async () => {
  await inRollback(async (tx) => {
    // model.create
    const modelReqId = await enqueue(tx, "model.create", null, {
      brandId, name: "승인요청검증스모크모델", category: null, status: "판매중",
    });
    const newModel = (await approveChangeRequest(modelReqId, crypto.randomUUID(), tx)) as { id: number } | null;
    expect(newModel?.id).toBeGreaterThan(0);
    const newModelId = newModel!.id;

    // trim.create (하이픈 포함 — 국산 브랜드 트림명 트리거 대비)
    const trimReqId = await enqueue(tx, "trim.create", null, {
      modelId: newModelId, trimName: "승인요청검증 - 등급", price: 10_000_000, modelYear: 2027, fuelType: "가솔린",
    });
    const newTrim = (await approveChangeRequest(trimReqId, crypto.randomUUID(), tx)) as { id: number } | null;
    expect(newTrim?.id).toBeGreaterThan(0);
    const newTrimId = newTrim!.id;

    // option.create
    const optReqId = await enqueue(tx, "option.create", null, {
      trimId: newTrimId, type: "basic", name: "승인요청검증옵션", price: 100000,
    });
    const newOption = (await approveChangeRequest(optReqId, crypto.randomUUID(), tx)) as { id: number } | null;
    expect(newOption?.id).toBeGreaterThan(0);

    // option.update
    const optUpdReqId = await enqueue(tx, "option.update", newOption!.id, { price: 200000 });
    await expect(approveChangeRequest(optUpdReqId, crypto.randomUUID(), tx)).resolves.not.toBeNull();

    // trim.update(기존 트림)
    const [beforeTrim] = await tx
      .select({ fin: trimsInCatalog.financialDiscountAmount })
      .from(trimsInCatalog)
      .where(eq(trimsInCatalog.id, trimId));
    const trimUpdReqId = await enqueue(tx, "trim.update", trimId, {
      financialDiscountAmount: (beforeTrim!.fin ?? 0) + 222,
    });
    await expect(approveChangeRequest(trimUpdReqId, crypto.randomUUID(), tx)).resolves.not.toBeNull();

    // model.update(기존 모델)
    const modelUpdReqId = await enqueue(tx, "model.update", modelId, { category: "승인요청검증카테고리" });
    await expect(approveChangeRequest(modelUpdReqId, crypto.randomUUID(), tx)).resolves.not.toBeNull();

    // 새 트림(옵션 없음) — no-option set/unset 대상. 승인이 슬롯을 비우므로 순차 진행에 UNIQUE 충돌 없음.
    const noOptTrim = await createTrim(
      { modelId: newModelId, trimName: "승인요청검증무옵션 - 등급", price: 5_000_000, modelYear: 2027, fuelType: "가솔린" },
      tx,
    );

    const setReqId = await enqueue(tx, "trim.no-option.set", noOptTrim!.id, {});
    await expect(approveChangeRequest(setReqId, crypto.randomUUID(), tx)).resolves.not.toBeNull();

    const unsetReqId = await enqueue(tx, "trim.no-option.unset", noOptTrim!.id, {});
    await expect(approveChangeRequest(unsetReqId, crypto.randomUUID(), tx)).resolves.not.toBeNull();
  });
});

test("대상 삭제 가드: 승인 전에 대상이 삭제되면 ConflictError(spec §6.4 ③)", async () => {
  await inRollback(async (tx) => {
    const option = await createOption({ trimId, type: "basic", name: "승인요청검증삭제옵션", price: 50000 }, tx);
    const reqId = await enqueue(tx, "option.update", option!.id, { price: 60000 });
    await deleteOption(option!.id, tx);
    await expect(approveChangeRequest(reqId, crypto.randomUUID(), tx)).rejects.toThrow(ConflictError);
  });
});

test("update 3종: 스키마 전체 키 payload로 스냅샷을 떠도 계약 위반이 없다(selector 완비 tripwire)", async () => {
  await inRollback(async (tx) => {
    // 스키마에 필드를 추가하면서 스냅샷 selector를 같이 안 고치면 여기가 먼저 빨개진다
    // (운영에선 팀장 폼 전체 PATCH가 첫 희생자다 — pickByPayloadKeys 주석 참조).
    const trimPayload = {
      trimName: "x", price: 1, modelYear: 2027, fuelType: "가솔린", driveSystem: null,
      displacementCc: null, transmissionType: null, bodyStyle: null, seatingCapacity: null,
      status: "판매중", financialDiscountAmount: null, partnerDiscountAmount: null, cashDiscountAmount: null,
    };
    const trimSnap = await CHANGE_KINDS["trim.update"].buildSnapshot(trimId, trimPayload, tx);
    expect(Object.keys(trimSnap!).length).toBe(Object.keys(trimPayload).length);
    const modelPayload = { category: null, status: "판매중" };
    const modelSnap = await CHANGE_KINDS["model.update"].buildSnapshot(modelId, modelPayload, tx);
    expect(Object.keys(modelSnap!).length).toBe(Object.keys(modelPayload).length);
    // option.update — beforeAll의 트림에 옵션이 없을 수 있어 tx 안에서 하나 만들어 쓴다
    const created = (await createOption({ trimId, type: "basic", name: "승인요청검증옵션", price: null }, tx)) as { id: number };
    const optionPayload = { name: "y", price: null };
    const optionSnap = await CHANGE_KINDS["option.update"].buildSnapshot(created.id, optionPayload, tx);
    expect(Object.keys(optionSnap!).length).toBe(Object.keys(optionPayload).length);
  });
});
