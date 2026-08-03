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
import {
  claimPending, getChangeRequest, replaceOwnPendingPayload, upsertPendingRequest,
} from "../../db/queries/change-requests";
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
// kind 어휘 SSOT는 client/src/lib/catalog-change-kinds.ts다(schema.ts는 re-export 경유 —
// DB CHECK와 이 레지스트리가 같은 배열 파생).
//
// buildSnapshot 계약: null = 대상/부모 없음(적재 시 404, 승인 시 드리프트 409).
// update 계약: snapshot은 payload가 건드리는 필드의 현재 값만 담는다(spec §5.1 — 무관 필드의
// admin 직접 수정은 승인을 막지 않는다). 값은 payload와 같은 JS 타입으로 정규화한다
// (detectSnapshotDrift가 타입까지 엄격 비교 — price numeric의 Number() 정규화가 그 예).

// payload 계약: submit/approve가 넘기는 payload는 bodySchema 파싱(+default 적용) 완료 값이다.
// execute 내부의 재파싱은 의도적 방어선(이중 parse) — transform 없는 스키마만 쓰므로 멱등하다.
type KindDef = {
  targetType: "model" | "trim" | "option";
  bodySchema: z.ZodTypeAny;
  notFoundMsg: string;
  buildSnapshot(targetId: number | null, payload: Record<string, unknown>, ex: Executor): Promise<Record<string, unknown> | null>;
  execute(targetId: number | null, payload: Record<string, unknown>, ctx: { decidedBy: string }, tx: Executor): Promise<unknown>;
};

// payload가 건드리는 필드만 스냅샷에 담는다(spec §5.1). selector가 모르는 키는 계약 위반 —
// 조용히 null 비교로 통과시키면 그 필드만 드리프트 무방비로 catalog에 써지므로 즉시 터뜨린다
// (스키마에 필드를 추가하면서 스냅샷 selector를 같이 안 고친 개발 실수를 적재 시점에 잡는 그물).
const pickByPayloadKeys = (fields: Record<string, unknown>, payload: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(payload).map((k) => {
      if (!(k in fields)) throw new Error(`스냅샷 selector에 없는 payload 키: ${k} — buildSnapshot을 함께 갱신하세요.`);
      return [k, fields[k] ?? null];
    }),
  );

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
  // price는 bigint({mode:"number"})라 이미 number다(Number()는 방어적 no-op) — 새 숫자 컬럼을
  // 추가할 땐 드라이버 표현을 payload 타입에 맞출 것(detectSnapshotDrift가 타입까지 엄격 비교).
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
  // 재검증 출력(data)을 흘린다 — 저장 payload가 구 스키마여도 default 보정된 값으로 스냅샷·실행이 일치한다.
  const data = parsed.data as Record<string, unknown>;
  const current = await def.buildSnapshot(claimed.targetId, data, tx); // ③ 드리프트
  if (current === null) throw new ConflictError("대상이 그 사이 삭제되어 승인할 수 없습니다. 반려 후 재요청을 안내하세요.");
  // snapshot NULL은 앱 경로로 불가(submitChangeRequest가 404) — psql 조작 흔적이므로 검사 생략 대신 거부.
  if (claimed.snapshot == null) throw new ConflictError("요청에 스냅샷이 없습니다. 반려 처리하세요.");
  const drifted = detectSnapshotDrift(claimed.snapshot, current);
  if (drifted.length > 0) {
    throw new ConflictError(`그 사이 값이 바뀌어 승인할 수 없습니다(${drifted.join(", ")}). 반려 후 재요청을 안내하세요.`);
  }
  return def.execute(claimed.targetId, data, { decidedBy }, tx); // ④ replay (⑤ 스탬프는 ①에서 — 같은 tx라 원자)
}

type CatalogContext = Context<{ Variables: AuthVariables & DbVariables }>;

// 확정 할인 3필드 — 팀장 제안 payload에서 제거하는 축(딜러 제안→관리자 채택 체계 소유,
// spec §3.1 정정 2026-07-31). trims.ts(적재 라우트)와 교체 경로(replaceOwnChangeRequest)가
// 같은 규칙을 공유한다 — trims.ts에 두면 이 모듈이 역방향 import를 하게 돼 여기로 옮겼다.
const DISCOUNT_KEYS = ["financialDiscountAmount", "partnerDiscountAmount", "cashDiscountAmount"] as const;

export function stripDiscountProposal<T extends Partial<Record<(typeof DISCOUNT_KEYS)[number], unknown>>>(body: T): T {
  const proposal = { ...body };
  for (const key of DISCOUNT_KEYS) delete proposal[key];
  return proposal;
}

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
    // 저장 payload = zod 파싱 출력(2026-07-30 PR2) — default(카테고리 null 등)가 적용된 "실행될 값"을
    // 저장해야 승인 replay·diff 화면·감사 기록이 같은 값을 본다(PR 1 리뷰 합의). 라우트 zValidator를
    // 이미 통과한 값이라 parse가 던질 일은 사실상 없다(던지면 errorResponse 500 — 코딩 오류 신호).
    const parsedPayload = def.bodySchema.parse(payload) as Record<string, unknown>;
    const snapshot = await def.buildSnapshot(targetId, parsedPayload, c.var.db);
    if (snapshot === null) return c.json({ error: def.notFoundMsg }, 404);
    // 옵션 있는 트림의 무옵션 확정은 승인 시점에 반드시 실패한다(setTrimNoOption이 거부) —
    // "절대 승인될 수 없는 요청"을 큐에 받으면 제3자(관리자) 화면에서 500으로 터지므로
    // 적재 시점에 409로 돌려보낸다(admin 직접 실행이 즉시 에러를 보는 것과 대칭).
    if (kind === "trim.no-option.set" && Number(snapshot.optionCount) > 0) {
      return c.json({ error: "옵션이 있는 트림은 '옵션 없음'으로 확정할 수 없습니다." }, 409);
    }
    const result = await upsertPendingRequest(
      { kind, targetType: def.targetType, targetId, payload: parsedPayload, snapshot, requestedBy: c.var.user.id },
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
    // 두 팀장이 ms 단위로 겹치면 SELECT 선검사를 지나 부분 UNIQUE(23505)에서 만난다 —
    // 의미는 위 409와 같으므로 상태코드도 같게(500이면 클라 분기가 "알 수 없는 오류"가 된다).
    if (
      String(e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : e).includes(
        "catalog_change_requests_pending_target_unique",
      )
    ) {
      return c.json({ error: "이미 승인 대기 중인 요청이 있습니다." }, 409);
    }
    return errorResponse(c, e);
  }
}

// 내 pending 요청 "이어서 수정"(2026-08-03) — payload 통째 교체를 적재와 같은 검증 경로
// (bodySchema 파싱 → 할인 제거 → 스냅샷 재구축)로 태운다. create류(target_id 없음)는
// upsertPendingRequest의 본인 갱신 분기가 못 잡는 축이라 이 경로가 유일한 수정 수단이다
// (구 흐름 = 취소 후 13필드 재입력). 응답은 적재와 동형 202 { queued } — 클라 공통 감지
// (sendCatalogWrite)가 토스트·배지 재조회·broadcast를 그대로 처리한다.
//
// 부모 좌표(brandId/modelId/trimId)는 **원 요청 값으로 고정** — 교체로 다른 부모에 갈아타면
// 미리보기·배지가 다른 모델로 이동하고 스냅샷(부모 존재 확인)의 대상도 뒤바뀐다(대상 불변 계약).
const PARENT_COORD_KEYS = ["brandId", "modelId", "trimId"] as const;

export async function replaceOwnChangeRequest(
  c: CatalogContext,
  requestId: string,
  rawBody: Record<string, unknown>,
): Promise<Response> {
  try {
    const existing = await getChangeRequest(requestId, c.var.db);
    // 소유·상태를 한 번에 404로 — 남의 요청 id를 찔러도 존재 여부가 새지 않는다(cancel과 같은 결).
    if (!existing || existing.status !== "pending" || existing.requestedBy !== c.var.user.id) {
      return c.json({ error: "수정할 대기 요청이 없습니다." }, 404);
    }
    const def = CHANGE_KINDS[existing.kind as ChangeRequestKind] as KindDef | undefined;
    if (!def) return c.json({ error: "알 수 없는 요청 종류입니다." }, 409);
    const parsed = def.bodySchema.safeParse(rawBody);
    if (!parsed.success) return c.json({ error: "요청 본문이 올바르지 않습니다." }, 400);
    // 이 라우트는 요청자 본인(팀장 제안) 전용 — 할인 3필드는 적재 라우트와 같은 규칙으로 제거.
    const payload = stripDiscountProposal(parsed.data as Record<string, unknown>);
    for (const k of PARENT_COORD_KEYS) {
      if (k in existing.payload) payload[k] = existing.payload[k];
    }
    const snapshot = await def.buildSnapshot(existing.targetId, payload, c.var.db);
    if (snapshot === null) return c.json({ error: def.notFoundMsg }, 404);
    // 적재 시점과 같은 사전 봉쇄(submitChangeRequest 주석 참조) — 교체로도 "절대 승인 불가"
    // 상태를 만들 수 없게 한다.
    if (existing.kind === "trim.no-option.set" && Number(snapshot.optionCount) > 0) {
      return c.json({ error: "옵션이 있는 트림은 '옵션 없음'으로 확정할 수 없습니다." }, 409);
    }
    const row = await replaceOwnPendingPayload(requestId, c.var.user.id, payload, snapshot, c.var.db);
    // 선조회를 지나 승인/반려/취소와 경합 — pending이 아니게 됐으니 같은 404로.
    if (!row) return c.json({ error: "수정할 대기 요청이 없습니다." }, 404);
    return c.json({ queued: true, requestId: row.id }, 202);
  } catch (e) {
    return errorResponse(c, e);
  }
}
