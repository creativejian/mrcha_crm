import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { modelsInCatalog, trimOptionsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb, type Executor } from "../client";
import { catalogChangeRequests } from "../schema";

// MC 마스터 변경 요청 큐 CRUD — kind 의미론(스냅샷·실행)은 모른다. 그건
// routes/catalog/change-request-kinds.ts(레지스트리)의 몫이고, 여기는 행 상태 전이만 담당.
// spec: ref/specs/2026-07-30-crm-catalog-change-approval-design.md §4·§6.3

export type ChangeRequestRow = typeof catalogChangeRequests.$inferSelect;
export type ChangeRequestListItem = ChangeRequestRow & {
  targetLabel: string;
  // 대기열 착지 점프 좌표(2026-07-30 PR2) — 클라가 /mc-master/:modelId?brand=&hl= 를 조립한다.
  // 라벨 합성이 이미 만든 모델/트림 맵에서 꺼내므로 추가 쿼리 0. 대상 소실 시 null(점프 비활성).
  targetBrandId: number | null;
  targetModelId: number | null;
  targetTrimId: number | null;
};

export type UpsertPendingInput = {
  kind: string;
  targetType: string;
  targetId: number | null;
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
  requestedBy: string;
};

export type UpsertPendingResult =
  | { ok: true; id: string }
  | { ok: false; existingRequestedBy: string; existingCreatedAt: Date };

// 대상+작업당 pending 1건(spec §4.1): 본인 재제출 = 갱신, 타인 = 거부. 동시 insert 경합은
// 부분 UNIQUE가 최종 방어선(23505 → routes/shared.ts가 한글 매핑).
export async function upsertPendingRequest(
  input: UpsertPendingInput,
  executor: Executor = getDefaultDb(),
): Promise<UpsertPendingResult> {
  if (input.targetId != null) {
    const [existing] = await executor
      .select()
      .from(catalogChangeRequests)
      .where(
        and(
          eq(catalogChangeRequests.targetType, input.targetType),
          eq(catalogChangeRequests.targetId, input.targetId),
          eq(catalogChangeRequests.kind, input.kind),
          eq(catalogChangeRequests.status, "pending"),
        ),
      );
    if (existing && existing.requestedBy !== input.requestedBy) {
      return { ok: false, existingRequestedBy: existing.requestedBy, existingCreatedAt: existing.createdAt };
    }
    if (existing) {
      const [row] = await executor
        .update(catalogChangeRequests)
        .set({ payload: input.payload, snapshot: input.snapshot, updatedAt: sql`now()` })
        .where(and(eq(catalogChangeRequests.id, existing.id), eq(catalogChangeRequests.status, "pending")))
        .returning();
      if (row) return { ok: true, id: row.id };
      // 그 사이 승인/반려로 pending이 사라졌다 — 새 요청으로 insert(아래 폴스루)
    }
  }
  const [row] = await executor
    .insert(catalogChangeRequests)
    .values({
      kind: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload,
      snapshot: input.snapshot,
      requestedBy: input.requestedBy,
    })
    .returning();
  return { ok: true, id: row!.id };
}

// 승인 선점 — status 조건부 UPDATE라 동시 더블클릭은 한쪽만 통과한다(spec §6.4 ①).
// 호출자는 이걸 승인 트랜잭션 안에서 부른다: 이후 단계(재검증·드리프트)가 던지면 전이도 롤백.
export async function claimPending(id: string, decidedBy: string, tx: Executor): Promise<ChangeRequestRow | null> {
  const [row] = await tx
    .update(catalogChangeRequests)
    .set({ status: "approved", decidedBy, decidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(catalogChangeRequests.id, id), eq(catalogChangeRequests.status, "pending")))
    .returning();
  return row ?? null;
}

export async function markRejected(
  id: string,
  reason: string,
  decidedBy: string,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestRow | null> {
  const [row] = await executor
    .update(catalogChangeRequests)
    .set({ status: "rejected", rejectReason: reason, decidedBy, decidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(catalogChangeRequests.id, id), eq(catalogChangeRequests.status, "pending")))
    .returning();
  return row ?? null;
}

export async function cancelOwnPending(
  id: string,
  requesterId: string,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestRow | null> {
  const [row] = await executor
    .update(catalogChangeRequests)
    .set({ status: "canceled", updatedAt: sql`now()` })
    .where(
      and(
        eq(catalogChangeRequests.id, id),
        eq(catalogChangeRequests.requestedBy, requesterId),
        eq(catalogChangeRequests.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listChangeRequests(
  status: string,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestListItem[]> {
  const rows = await executor
    .select()
    .from(catalogChangeRequests)
    .where(eq(catalogChangeRequests.status, status))
    .orderBy(asc(catalogChangeRequests.createdAt));
  return labelTargets(rows, executor);
}

export async function listMyChangeRequests(
  requesterId: string,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestListItem[]> {
  const rows = await executor
    .select()
    .from(catalogChangeRequests)
    .where(eq(catalogChangeRequests.requestedBy, requesterId))
    .orderBy(desc(catalogChangeRequests.createdAt))
    .limit(50);
  return labelTargets(rows, executor);
}

// 화면 배지용 모델 단위 pending — 대상 축이 3층(모델 자신·트림·옵션)이라 create의 부모는
// payload에서 꺼내 잡는다(create는 target_id가 없다).
export async function listModelPendingRequests(
  modelId: number,
  executor: Executor = getDefaultDb(),
): Promise<ChangeRequestListItem[]> {
  const modelTrimIds = executor
    .select({ id: trimsInCatalog.id })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.modelId, modelId));
  const modelOptionIds = executor
    .select({ id: trimOptionsInCatalog.id })
    .from(trimOptionsInCatalog)
    .where(inArray(trimOptionsInCatalog.trimId, modelTrimIds));
  const rows = await executor
    .select()
    .from(catalogChangeRequests)
    .where(
      and(
        eq(catalogChangeRequests.status, "pending"),
        or(
          and(eq(catalogChangeRequests.targetType, "model"), eq(catalogChangeRequests.targetId, modelId)),
          and(
            eq(catalogChangeRequests.targetType, "trim"),
            inArray(catalogChangeRequests.targetId, modelTrimIds),
          ),
          and(
            eq(catalogChangeRequests.kind, "trim.create"),
            sql`(${catalogChangeRequests.payload}->>'modelId')::int = ${modelId}`,
          ),
          and(
            eq(catalogChangeRequests.targetType, "option"),
            inArray(catalogChangeRequests.targetId, modelOptionIds),
          ),
          and(
            eq(catalogChangeRequests.kind, "option.create"),
            sql`(${catalogChangeRequests.payload}->>'trimId')::int in (${modelTrimIds})`,
          ),
        ),
      ),
    )
    .orderBy(asc(catalogChangeRequests.createdAt));
  return labelTargets(rows, executor);
}

// 대상 라벨("모델 › 트림 › 옵션") 합성 — update/토글은 target_id로, create는 payload의 부모로.
// 대상이 그 사이 삭제됐으면 "삭제됨"(pending 승인 시도는 어차피 드리프트로 막힌다).
async function labelTargets(rows: ChangeRequestRow[], ex: Executor): Promise<ChangeRequestListItem[]> {
  const p = (r: ChangeRequestRow) => r.payload;

  const optionIds = rows.filter((r) => r.targetType === "option" && r.targetId != null).map((r) => r.targetId!);
  const options =
    optionIds.length > 0
      ? await ex
          .select({ id: trimOptionsInCatalog.id, name: trimOptionsInCatalog.name, trimId: trimOptionsInCatalog.trimId })
          .from(trimOptionsInCatalog)
          .where(inArray(trimOptionsInCatalog.id, optionIds))
      : [];
  const optionById = new Map(options.map((o) => [o.id, o]));

  // 비정상 payload(키 누락·비숫자)는 NaN이 되는데, 그대로 inArray에 넣으면 bigint 바인딩이
  // 죽어 큐 조회 전체가 500이 된다(실측) — 유한수만 모아 라벨은 "삭제됨" 폴백으로 떨어뜨린다.
  const addId = (set: Set<number>, v: unknown) => {
    const n = Number(v);
    if (Number.isFinite(n)) set.add(n);
  };

  const trimIds = new Set<number>();
  for (const r of rows) {
    if (r.targetType === "trim" && r.targetId != null) trimIds.add(r.targetId);
    if (r.kind === "option.create") addId(trimIds, p(r).trimId);
  }
  for (const o of options) trimIds.add(o.trimId);
  const trims =
    trimIds.size > 0
      ? await ex
          .select({ id: trimsInCatalog.id, trimName: trimsInCatalog.trimName, modelId: trimsInCatalog.modelId })
          .from(trimsInCatalog)
          .where(inArray(trimsInCatalog.id, [...trimIds]))
      : [];
  const trimById = new Map(trims.map((t) => [t.id, t]));

  const modelIds = new Set<number>();
  for (const r of rows) {
    if (r.targetType === "model" && r.targetId != null) modelIds.add(r.targetId);
    if (r.kind === "trim.create") addId(modelIds, p(r).modelId);
  }
  for (const t of trims) modelIds.add(t.modelId);
  const models =
    modelIds.size > 0
      ? await ex
          .select({ id: modelsInCatalog.id, name: modelsInCatalog.name, brandId: modelsInCatalog.brandId })
          .from(modelsInCatalog)
          .where(inArray(modelsInCatalog.id, [...modelIds]))
      : [];
  const modelById = new Map(models.map((m) => [m.id, m]));

  const modelName = (id: number) => modelById.get(id)?.name ?? "삭제됨";
  const trimPath = (trimId: number) => {
    const t = trimById.get(trimId);
    return t ? `${modelName(t.modelId)} › ${t.trimName}` : "삭제됨";
  };

  // 점프 좌표 헬퍼 — model/trim 맵을 그대로 타고 올라가 { brand, model, trim } id를 채운다.
  // 어느 단계든 miss면 셋 다 null(점프 비활성 — 대상 소실과 같은 신호).
  type Coords = { targetBrandId: number | null; targetModelId: number | null; targetTrimId: number | null };
  const noCoords: Coords = { targetBrandId: null, targetModelId: null, targetTrimId: null };
  const coordsFromModel = (modelId: number): Coords => {
    const m = modelById.get(modelId);
    return m ? { targetBrandId: m.brandId, targetModelId: modelId, targetTrimId: null } : noCoords;
  };
  const coordsFromTrim = (trimId: number): Coords => {
    const t = trimById.get(trimId);
    if (!t) return noCoords;
    const m = modelById.get(t.modelId);
    return { targetBrandId: m?.brandId ?? null, targetModelId: t.modelId, targetTrimId: trimId };
  };
  const coordsFromOption = (optionId: number): Coords => {
    const o = optionById.get(optionId);
    return o ? coordsFromTrim(o.trimId) : noCoords;
  };

  return rows.map((r) => {
    let targetLabel = "삭제됨";
    let coords: Coords = noCoords;
    if (r.kind === "model.create") {
      targetLabel = `${String(p(r).name)} (신규 모델)`;
      const brandId = Number(p(r).brandId);
      coords = { targetBrandId: Number.isFinite(brandId) ? brandId : null, targetModelId: null, targetTrimId: null };
    } else if (r.targetType === "model" && r.targetId != null) {
      targetLabel = modelName(r.targetId);
      coords = coordsFromModel(r.targetId);
    } else if (r.kind === "trim.create") {
      const modelId = Number(p(r).modelId);
      targetLabel = `${modelName(modelId)} › ${String(p(r).trimName)} (신규 트림)`;
      coords = Number.isFinite(modelId) ? coordsFromModel(modelId) : noCoords;
    } else if (r.targetType === "trim" && r.targetId != null) {
      targetLabel = trimPath(r.targetId);
      coords = coordsFromTrim(r.targetId);
    } else if (r.kind === "option.create") {
      const trimId = Number(p(r).trimId);
      targetLabel = `${trimPath(trimId)} › ${String(p(r).name)} (신규 옵션)`;
      coords = Number.isFinite(trimId) ? coordsFromTrim(trimId) : noCoords;
    } else if (r.targetType === "option" && r.targetId != null) {
      const o = optionById.get(r.targetId);
      targetLabel = o ? `${trimPath(o.trimId)} › ${o.name}` : "삭제됨";
      coords = coordsFromOption(r.targetId);
    }
    return { ...r, targetLabel, ...coords };
  });
}
