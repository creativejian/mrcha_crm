import { count, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { z } from "zod";

import {
  brandsInCatalog, modelsInCatalog, trimNoOptionsInCatalog, trimOptionsInCatalog, trimsInCatalog,
} from "../../db/catalog";
import type { Executor } from "../../db/client";
import {
  createModel, createOption, createTrim, setTrimNoOption, unsetTrimNoOption, updateModel, updateOption,
} from "../../db/queries/catalog-admin";
import { claimPending, upsertPendingRequest } from "../../db/queries/change-requests";
import { updateTrimWithDiscountAudit } from "../../db/queries/discount-adoptions";
import { type ChangeRequestKind } from "../../db/schema";
import { detectSnapshotDrift } from "../../lib/change-request-drift";
import { ConflictError } from "../../lib/errors";
import type { AuthVariables } from "../../middleware/auth";
import type { DbVariables } from "../../middleware/db";
import { errorResponse } from "../shared";
import {
  emptyBody, modelCreateBody, modelUpdateBody, optionCreatePayload, optionUpdateBody, trimCreateBody, trimUpdateBody,
} from "./schemas";

// kind 레지스트리 — 적재(스냅샷)와 승인 replay(재검증·드리프트·실행)의 단일 소스(spec §5).
// admin 직접 실행 라우트와 승인 경로가 같은 execute를 부르므로 두 경로가 갈라질 수 없다.
// kind 어휘는 schema.ts의 CHANGE_REQUEST_KINDS가 SSOT다(DB CHECK와 이 레지스트리가 같은 배열 파생).
//
// buildSnapshot 계약: null = 대상/부모 없음(적재 시 404, 승인 시 드리프트 409).
// update 계약: snapshot은 payload가 건드리는 필드의 현재 값만 담는다(spec §5.1 — 무관 필드의
// admin 직접 수정은 승인을 막지 않는다). 값은 payload와 같은 JS 타입으로 정규화한다
// (detectSnapshotDrift가 타입까지 엄격 비교 — price numeric의 Number() 정규화가 그 예).

type KindDef = {
  targetType: "model" | "trim" | "option";
  bodySchema: z.ZodTypeAny;
  notFoundMsg: string;
  buildSnapshot(targetId: number | null, payload: Record<string, unknown>, ex: Executor): Promise<Record<string, unknown> | null>;
  execute(targetId: number | null, payload: Record<string, unknown>, ctx: { decidedBy: string }, tx: Executor): Promise<unknown>;
};

const pickByPayloadKeys = (fields: Record<string, unknown>, payload: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(payload).map((k) => [k, fields[k] ?? null]));

async function brandExists(brandId: number, ex: Executor) {
  const [row] = await ex.select({ id: brandsInCatalog.id }).from(brandsInCatalog).where(eq(brandsInCatalog.id, brandId));
  return row ? {} : null;
}

async function modelExists(modelId: number, ex: Executor) {
  const [row] = await ex.select({ id: modelsInCatalog.id }).from(modelsInCatalog).where(eq(modelsInCatalog.id, modelId));
  return row ? {} : null;
}

async function trimExists(trimId: number, ex: Executor) {
  const [row] = await ex.select({ id: trimsInCatalog.id }).from(trimsInCatalog).where(eq(trimsInCatalog.id, trimId));
  return row ? {} : null;
}

async function modelFields(id: number, ex: Executor): Promise<Record<string, unknown> | null> {
  const [row] = await ex
    .select({ category: modelsInCatalog.category, status: modelsInCatalog.status })
    .from(modelsInCatalog)
    .where(eq(modelsInCatalog.id, id));
  return row ?? null;
}

async function trimFields(id: number, ex: Executor): Promise<Record<string, unknown> | null> {
  const [row] = await ex
    .select({
      trimName: trimsInCatalog.trimName,
      price: trimsInCatalog.price,
      modelYear: trimsInCatalog.modelYear,
      fuelType: trimsInCatalog.fuelType,
      driveSystem: trimsInCatalog.driveSystem,
      displacementCc: trimsInCatalog.displacementCc,
      transmissionType: trimsInCatalog.transmissionType,
      bodyStyle: trimsInCatalog.bodyStyle,
      seatingCapacity: trimsInCatalog.seatingCapacity,
      status: trimsInCatalog.status,
      financialDiscountAmount: trimsInCatalog.financialDiscountAmount,
      partnerDiscountAmount: trimsInCatalog.partnerDiscountAmount,
      cashDiscountAmount: trimsInCatalog.cashDiscountAmount,
    })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.id, id));
  if (!row) return null;
  // price는 numeric이라 드라이버가 문자열로 줄 수 있다 — payload(number)와 같은 표현으로 정규화.
  return { ...row, price: Number(row.price) };
}

async function optionFields(id: number, ex: Executor): Promise<Record<string, unknown> | null> {
  const [row] = await ex
    .select({ name: trimOptionsInCatalog.name, price: trimOptionsInCatalog.price })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.id, id));
  return row ?? null;
}

// 무옵션 토글 스냅샷: 옵션 개수까지 담아 "요청 이후 옵션이 생겼다/사라졌다"를 드리프트로 잡는다.
async function noOptionSnapshot(trimId: number, ex: Executor): Promise<Record<string, unknown> | null> {
  if ((await trimExists(trimId, ex)) === null) return null;
  const [opt] = await ex
    .select({ c: count() })
    .from(trimOptionsInCatalog)
    .where(eq(trimOptionsInCatalog.trimId, trimId));
  const [no] = await ex
    .select({ c: count() })
    .from(trimNoOptionsInCatalog)
    .where(eq(trimNoOptionsInCatalog.trimId, trimId));
  return { optionCount: Number(opt?.c ?? 0), noOption: Number(no?.c ?? 0) > 0 };
}

export const CHANGE_KINDS: Record<ChangeRequestKind, KindDef> = {
  "model.create": {
    targetType: "model",
    bodySchema: modelCreateBody,
    notFoundMsg: "브랜드를 찾을 수 없습니다.",
    buildSnapshot: (_t, payload, ex) => brandExists(Number(payload.brandId), ex),
    execute: (_t, payload, _ctx, tx) => createModel(modelCreateBody.parse(payload), tx),
  },
  "model.update": {
    targetType: "model",
    bodySchema: modelUpdateBody,
    notFoundMsg: "모델을 찾을 수 없습니다.",
    buildSnapshot: async (targetId, payload, ex) => {
      const fields = await modelFields(targetId!, ex);
      return fields === null ? null : pickByPayloadKeys(fields, payload);
    },
    execute: (targetId, payload, _ctx, tx) => updateModel(targetId!, modelUpdateBody.parse(payload), tx),
  },
  "trim.create": {
    targetType: "trim",
    bodySchema: trimCreateBody,
    notFoundMsg: "모델을 찾을 수 없습니다.",
    buildSnapshot: (_t, payload, ex) => modelExists(Number(payload.modelId), ex),
    execute: (_t, payload, _ctx, tx) => createTrim(trimCreateBody.parse(payload), tx),
  },
  "trim.update": {
    targetType: "trim",
    bodySchema: trimUpdateBody,
    notFoundMsg: "트림을 찾을 수 없습니다.",
    buildSnapshot: async (targetId, payload, ex) => {
      const fields = await trimFields(targetId!, ex);
      return fields === null ? null : pickByPayloadKeys(fields, payload);
    },
    execute: (targetId, payload, ctx, tx) =>
      updateTrimWithDiscountAudit(targetId!, trimUpdateBody.parse(payload), ctx.decidedBy, tx),
  },
  "option.create": {
    targetType: "option",
    bodySchema: optionCreatePayload,
    notFoundMsg: "트림을 찾을 수 없습니다.",
    buildSnapshot: (_t, payload, ex) => trimExists(Number(payload.trimId), ex),
    execute: (_t, payload, _ctx, tx) => createOption(optionCreatePayload.parse(payload), tx),
  },
  "option.update": {
    targetType: "option",
    bodySchema: optionUpdateBody,
    notFoundMsg: "옵션을 찾을 수 없습니다.",
    buildSnapshot: async (targetId, payload, ex) => {
      const fields = await optionFields(targetId!, ex);
      return fields === null ? null : pickByPayloadKeys(fields, payload);
    },
    execute: (targetId, payload, _ctx, tx) => updateOption(targetId!, optionUpdateBody.parse(payload), tx),
  },
  "trim.no-option.set": {
    targetType: "trim",
    bodySchema: emptyBody,
    notFoundMsg: "트림을 찾을 수 없습니다.",
    buildSnapshot: (targetId, _p, ex) => noOptionSnapshot(targetId!, ex),
    execute: (targetId, _p, _ctx, tx) => setTrimNoOption(targetId!, tx),
  },
  "trim.no-option.unset": {
    targetType: "trim",
    bodySchema: emptyBody,
    notFoundMsg: "트림을 찾을 수 없습니다.",
    buildSnapshot: (targetId, _p, ex) => noOptionSnapshot(targetId!, ex),
    execute: (targetId, _p, _ctx, tx) => unsetTrimNoOption(targetId!, tx),
  },
};

// 승인 트랜잭션 본체(spec §6.4) — 호출자(라우트)가 db.transaction으로 감싼다.
// ConflictError는 run()이 409로 매핑하고, tx 전체가 롤백되어 행은 pending으로 남는다.
export async function approveChangeRequest(id: string, decidedBy: string, tx: Executor): Promise<unknown> {
  const claimed = await claimPending(id, decidedBy, tx); // ① 선점
  if (!claimed) return null; // → 404 "대기 중인 요청이 없습니다."
  const def = CHANGE_KINDS[claimed.kind as ChangeRequestKind];
  if (!def) throw new ConflictError("알 수 없는 요청 종류입니다. 반려 처리하세요.");
  const parsed = def.bodySchema.safeParse(claimed.payload); // ② 재검증
  if (!parsed.success) throw new ConflictError("요청 내용이 현재 스키마와 맞지 않습니다. 반려 후 재요청을 안내하세요.");
  const current = await def.buildSnapshot(claimed.targetId, claimed.payload, tx); // ③ 드리프트
  if (current === null) throw new ConflictError("대상이 그 사이 삭제되어 승인할 수 없습니다. 반려 후 재요청을 안내하세요.");
  const drifted = detectSnapshotDrift(claimed.snapshot ?? {}, current);
  if (drifted.length > 0) {
    throw new ConflictError(`그 사이 값이 바뀌어 승인할 수 없습니다(${drifted.join(", ")}). 반려 후 재요청을 안내하세요.`);
  }
  return def.execute(claimed.targetId, claimed.payload, { decidedBy }, tx); // ④ replay (⑤ 스탬프는 ①에서 — 같은 tx라 원자)
}

type CatalogContext = Context<{ Variables: AuthVariables & DbVariables }>;

// manager의 쓰기 → 큐 적재 + 202. 라우트 분기(spec §6.1)의 manager 쪽 절반.
// 404(대상 없음)·409(타인 pending)·202(적재)를 스스로 응답한다 — run()은 200 고정이라 못 쓴다.
export async function submitChangeRequest(
  c: CatalogContext,
  kind: ChangeRequestKind,
  targetId: number | null,
  payload: Record<string, unknown>,
): Promise<Response> {
  const def = CHANGE_KINDS[kind];
  try {
    const snapshot = await def.buildSnapshot(targetId, payload, c.var.db);
    if (snapshot === null) return c.json({ error: def.notFoundMsg }, 404);
    const result = await upsertPendingRequest(
      { kind, targetType: def.targetType, targetId, payload, snapshot, requestedBy: c.var.user.id },
      c.var.db,
    );
    if (!result.ok) {
      return c.json(
        { error: "이미 승인 대기 중인 요청이 있습니다.", requestedBy: result.existingRequestedBy, requestedAt: result.existingCreatedAt },
        409,
      );
    }
    return c.json({ queued: true, requestId: result.id }, 202);
  } catch (e) {
    return errorResponse(c, e);
  }
}
