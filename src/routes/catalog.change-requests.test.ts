import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { modelsInCatalog, trimOptionsInCatalog } from "../db/catalog";
import { getDefaultDb } from "../db/client";
import { catalogChangeRequests } from "../db/schema";

// ── 변경 승인 워크플로 라우트 게이트(spec §3.3 역할 매트릭스) ────────────────
// 실제 catalog 변이는 하지 않는다(존재하지 않는 대상 → 404 fail-closed로 게이트 통과를 확인).
// 유일한 실 행 = manager 202 케이스의 pending 1건 — 같은 테스트에서 본인 취소까지 확인하고
// afterAll이 hard delete, 잔재는 고아 판정 그물(fixture-residue)이 백스톱.
const db = getDefaultDb();
let modelId = 0;
let modelCategory: string | null = null;
let optionedTrimId = 0; // 옵션이 1개 이상 있는 트림 — 무옵션 확정 적재 게이트(409) 검증용
const createdIds: string[] = [];

beforeAll(async () => {
  const [model] = await db
    .select({ id: modelsInCatalog.id, category: modelsInCatalog.category })
    .from(modelsInCatalog)
    .limit(1);
  modelId = model!.id;
  modelCategory = model!.category;
  const [opt] = await db
    .select({ trimId: trimOptionsInCatalog.trimId })
    .from(trimOptionsInCatalog)
    .limit(1);
  optionedTrimId = opt!.trimId;
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(catalogChangeRequests).where(inArray(catalogChangeRequests.id, createdIds));
  }
});

type Role = "dealer" | "staff" | "manager" | "admin";

async function makeClient(role: Role) {
  const userId = crypto.randomUUID();
  const { token, keyResolver, issuer } = await makeTestAuth(role, userId);
  const app = createApp({ keyResolver, issuer });
  return {
    userId,
    request: (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

const NO_MODEL = 999_999_999;

test("큐 8종 축: staff·dealer는 403 (구멍 봉인 — 종전엔 staff가 API 직접 쓰기 가능했다)", async () => {
  for (const role of ["staff", "dealer"] as const) {
    const c = await makeClient(role);
    expect((await c.request("POST", "/api/catalog/models", { brandId: 1, name: "x" })).status).toBe(403);
    expect((await c.request("PATCH", `/api/catalog/models/${NO_MODEL}`, { category: "x" })).status).toBe(403);
    expect((await c.request("POST", `/api/catalog/trims/${NO_MODEL}/no-option`)).status).toBe(403);
  }
});

test("admin 전용 축: manager도 403 (삭제·이동·mc_code·reorder)", async () => {
  const c = await makeClient("manager");
  expect((await c.request("DELETE", `/api/catalog/models/${NO_MODEL}`)).status).toBe(403);
  expect((await c.request("DELETE", `/api/catalog/trims/${NO_MODEL}`)).status).toBe(403);
  expect((await c.request("DELETE", `/api/catalog/options/${NO_MODEL}`)).status).toBe(403);
  expect((await c.request("POST", "/api/catalog/trims/move", { trimIds: [NO_MODEL], targetModelId: 1 })).status).toBe(403);
  expect((await c.request("POST", `/api/catalog/models/${NO_MODEL}/assign-codes`)).status).toBe(403);
  expect((await c.request("POST", "/api/catalog/models/reorder", { ids: [1] })).status).toBe(403);
  expect((await c.request("POST", "/api/catalog/trims/reorder", { ids: [1] })).status).toBe(403);
});

test("manager: 없는 대상 요청은 404 — 큐에 행이 생기지 않는다(fail-closed)", async () => {
  const c = await makeClient("manager");
  const res = await c.request("PATCH", `/api/catalog/models/${NO_MODEL}`, { category: "x" });
  expect(res.status).toBe(404);
  const rows = await db
    .select({ id: catalogChangeRequests.id })
    .from(catalogChangeRequests)
    .where(eq(catalogChangeRequests.requestedBy, c.userId));
  expect(rows.length).toBe(0);
});

test("admin: 없는 대상은 404 — 즉시 실행 경로(큐를 타지 않는다)", async () => {
  const c = await makeClient("admin");
  const res = await c.request("PATCH", `/api/catalog/models/${NO_MODEL}`, { category: "x" });
  expect(res.status).toBe(404);
});

test("manager: 옵션 있는 트림의 무옵션 확정은 적재 시점 409 — 승인 불가 요청은 큐에 안 받는다", async () => {
  const c = await makeClient("manager");
  const res = await c.request("POST", `/api/catalog/trims/${optionedTrimId}/no-option`);
  expect(res.status).toBe(409);
  const rows = await db
    .select({ id: catalogChangeRequests.id })
    .from(catalogChangeRequests)
    .where(eq(catalogChangeRequests.requestedBy, c.userId));
  expect(rows.length).toBe(0);
});

test("manager 202 적재 → 내 요청 목록 → 본인 취소 (실 행 1건, 즉시 정리)", async () => {
  const c = await makeClient("manager");
  // 현재 값 그대로를 payload로 — 승인돼도 무변이지만, 이 테스트는 승인하지 않는다.
  const res = await c.request("PATCH", `/api/catalog/models/${modelId}`, { category: modelCategory });
  expect(res.status).toBe(202);
  const body = (await res.json()) as { queued: boolean; requestId: string };
  expect(body.queued).toBe(true);
  createdIds.push(body.requestId);

  const mine = await c.request("GET", "/api/catalog/change-requests?mine=1");
  expect(mine.status).toBe(200);
  const mineRows = (await mine.json()) as Array<{ id: string; status: string }>;
  expect(mineRows.some((r) => r.id === body.requestId && r.status === "pending")).toBe(true);

  // 모델 단위 배지 조회에도 잡힌다
  const scoped = await c.request("GET", `/api/catalog/models/${modelId}/change-requests`);
  expect(scoped.status).toBe(200);
  expect(((await scoped.json()) as Array<{ id: string }>).some((r) => r.id === body.requestId)).toBe(true);

  const cancel = await c.request("DELETE", `/api/catalog/change-requests/${body.requestId}`);
  expect(cancel.status).toBe(200);
  expect(((await cancel.json()) as { status: string }).status).toBe("canceled");
});

test("대기열 조회: admin 200 · manager(mine 없이) 403 · staff 403 · dealer 403", async () => {
  expect((await (await makeClient("admin")).request("GET", "/api/catalog/change-requests")).status).toBe(200);
  expect((await (await makeClient("manager")).request("GET", "/api/catalog/change-requests")).status).toBe(403);
  expect((await (await makeClient("staff")).request("GET", "/api/catalog/change-requests?mine=1")).status).toBe(403);
  expect((await (await makeClient("dealer")).request("GET", "/api/catalog/change-requests")).status).toBe(403);
});

test("승인·반려: manager 403 · admin은 없는 id에 404 · 반려 사유 없으면 400", async () => {
  const someId = crypto.randomUUID();
  const m = await makeClient("manager");
  expect((await m.request("POST", `/api/catalog/change-requests/${someId}/approve`)).status).toBe(403);
  const a = await makeClient("admin");
  expect((await a.request("POST", `/api/catalog/change-requests/${someId}/approve`)).status).toBe(404);
  expect((await a.request("POST", `/api/catalog/change-requests/${someId}/reject`, { reason: "" })).status).toBe(400);
  expect((await a.request("POST", `/api/catalog/change-requests/${someId}/reject`, { reason: "사유" })).status).toBe(404);
});
