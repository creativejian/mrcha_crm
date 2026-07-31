import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq, inArray, ne } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { modelsInCatalog, trimOptionsInCatalog, trimsInCatalog } from "../db/catalog";
import { getDefaultDb } from "../db/client";
import { catalogChangeRequests } from "../db/schema";

// ── 변경 승인 워크플로 라우트 게이트(spec §3.3 역할 매트릭스) ────────────────
// 실제 catalog 변이는 하지 않는다(존재하지 않는 대상 → 404 fail-closed로 게이트 통과를 확인,
// 큐 202 케이스는 승인하지 않아 catalog에 반영되지 않는다). 유일한 실 행 = pending 생성분
// (취소 흐름 1건 + 큐 8종 순회 7건) — 전부 createdIds로 추적해 afterAll이 hard delete,
// 잔재는 고아 판정 그물(fixture-residue)이 백스톱.
const db = getDefaultDb();
let modelId = 0;
let modelCategory: string | null = null;
let brandId = 0; // modelId가 속한 브랜드 — model.create 큐 케이스용
let optionedTrimId = 0; // 옵션이 1개 이상 있는 트림 — 무옵션 확정 적재 게이트(409)·큐 순회 공용
let optionId = 0; // optionedTrimId의 옵션 1개 — option.update 큐 케이스용
let optionName = ""; // 위 옵션의 현재 이름 — "현재 값 그대로" payload
let trimModelYear = 0; // optionedTrimId의 현재 modelYear — "현재 값 그대로" payload
const createdIds: string[] = [];

beforeAll(async () => {
  const [model] = await db
    .select({ id: modelsInCatalog.id, category: modelsInCatalog.category, brandId: modelsInCatalog.brandId })
    .from(modelsInCatalog)
    .limit(1);
  modelId = model!.id;
  modelCategory = model!.category;
  brandId = model!.brandId;

  const [opt] = await db
    .select({
      trimId: trimOptionsInCatalog.trimId,
      optionId: trimOptionsInCatalog.id,
      optionName: trimOptionsInCatalog.name,
    })
    .from(trimOptionsInCatalog)
    .limit(1);
  optionedTrimId = opt!.trimId;
  optionId = opt!.optionId;
  optionName = opt!.optionName;

  const [trim] = await db
    .select({ modelYear: trimsInCatalog.modelYear })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.id, optionedTrimId));
  trimModelYear = trim!.modelYear ?? 2020; // modelYear는 스키마상 nullable — 방어적 폴백
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

// 큐 8종 라우트 표 — 403 전수(staff·dealer)와 202+kind 배선 단언(manager)이 같은 표를 순회한다.
// 표에 없는 큐 라우트가 생기면 두 축 모두에서 빠지므로, 새 kind 추가 시 여기 한 줄을 잊지 말 것.
// set은 표에 없다 — 옵션 있는 트림에서 늘 409다(아래 별도 테스트가 그 배선을 증명한다).
type QueueRouteCase = { method: string; path: () => string; body?: () => unknown; kind: string; targetType: string };

const QUEUE_ROUTES: QueueRouteCase[] = [
  {
    method: "POST",
    path: () => "/api/catalog/models",
    body: () => ({ brandId, name: "승인요청검증모델" }),
    kind: "model.create",
    targetType: "model",
  },
  {
    method: "PATCH",
    path: () => `/api/catalog/models/${modelId}`,
    body: () => ({ category: modelCategory }),
    kind: "model.update",
    targetType: "model",
  },
  {
    method: "POST",
    path: () => "/api/catalog/trims",
    body: () => ({ modelId, trimName: "승인요청검증 - 등급", price: 1, modelYear: 2027, fuelType: "가솔린" }),
    kind: "trim.create",
    targetType: "trim",
  },
  {
    method: "PATCH",
    path: () => `/api/catalog/trims/${optionedTrimId}`,
    body: () => ({ modelYear: trimModelYear }),
    kind: "trim.update",
    targetType: "trim",
  },
  {
    method: "POST",
    path: () => `/api/catalog/trims/${optionedTrimId}/options`,
    body: () => ({ type: "basic", name: "승인요청검증옵션", price: null }),
    kind: "option.create",
    targetType: "option",
  },
  {
    method: "PATCH",
    path: () => `/api/catalog/options/${optionId}`,
    body: () => ({ name: optionName }),
    kind: "option.update",
    targetType: "option",
  },
  {
    method: "DELETE",
    path: () => `/api/catalog/trims/${optionedTrimId}/no-option`,
    kind: "trim.no-option.unset",
    targetType: "trim",
  },
];

test("큐 8종 축 전수: staff·dealer는 403 — 구멍 봉인(종전 staff 직접 쓰기)의 회귀 그물", async () => {
  for (const role of ["staff", "dealer"] as const) {
    const c = await makeClient(role);
    for (const rc of QUEUE_ROUTES) {
      expect((await c.request(rc.method, rc.path(), rc.body?.())).status).toBe(403);
    }
    // set은 표에 없으니 별도 한 줄(403은 게이트가 payload보다 앞이라 옵션 유무 무관)
    expect((await c.request("POST", `/api/catalog/trims/${optionedTrimId}/no-option`)).status).toBe(403);
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

// 위 취소 테스트가 model.update 큐 행을 이미 canceled로 정리해 뒀으므로, 아래 순회가 같은
// (modelId, model.update)에 pending을 새로 적재해도 부분 UNIQUE와 충돌하지 않는다.
test("manager 202 순회: 라우트→kind 배선이 표와 일치한다(생성 행을 DB로 단언)", async () => {
  const c = await makeClient("manager");
  for (const rc of QUEUE_ROUTES) {
    const res = await c.request(rc.method, rc.path(), rc.body?.());
    expect(res.status).toBe(202);
    const { requestId } = (await res.json()) as { requestId: string };
    createdIds.push(requestId);
    const [row] = await db
      .select({ kind: catalogChangeRequests.kind, targetType: catalogChangeRequests.targetType })
      .from(catalogChangeRequests)
      .where(eq(catalogChangeRequests.id, requestId));
    expect(`${rc.kind}/${row!.kind}`).toBe(`${rc.kind}/${rc.kind}`);
    expect(row!.targetType).toBe(rc.targetType);
  }
});

// 할인 3필드는 딜러 제안→관리자 채택 체계 소유(spec §3.1 정정 2026-07-31) — 팀장 제안
// payload에서 서버가 제거하고, 그 결과 snapshot에도 안 실려 채택이 드리프트 409를 유발하지
// 않는다(폼 오픈 시점 구 할인값이 채택값을 되돌리는 사고 차단).
test("manager trim.update 202: 할인 3필드는 payload·snapshot에서 제거된다", async () => {
  const c = await makeClient("manager");
  // ⚠️ optionedTrimId를 쓰면 순회 테스트가 남긴 pending과 충돌한다 — makeClient는 호출마다
  // 다른 유저라 "타인 pending" 409가 난다. pending 없는 다른 트림으로 순서 의존 없이 간다.
  const [other] = await db
    .select({ id: trimsInCatalog.id, modelYear: trimsInCatalog.modelYear })
    .from(trimsInCatalog)
    .where(ne(trimsInCatalog.id, optionedTrimId))
    .limit(1);
  const res = await c.request("PATCH", `/api/catalog/trims/${other!.id}`, {
    modelYear: other!.modelYear ?? 2020,
    financialDiscountAmount: 123456,
    partnerDiscountAmount: 234567,
    cashDiscountAmount: 345678,
  });
  expect(res.status).toBe(202);
  const { requestId } = (await res.json()) as { requestId: string };
  createdIds.push(requestId);
  const [row] = await db
    .select({ payload: catalogChangeRequests.payload, snapshot: catalogChangeRequests.snapshot })
    .from(catalogChangeRequests)
    .where(eq(catalogChangeRequests.id, requestId));
  expect(Object.keys(row!.payload)).toEqual(["modelYear"]);
  expect(Object.keys(row!.snapshot ?? {})).toEqual(["modelYear"]);
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
