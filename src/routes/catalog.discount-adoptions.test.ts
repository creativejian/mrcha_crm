import { beforeAll, expect, test } from "bun:test";
import { eq, isNull } from "drizzle-orm";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { trimsInCatalog } from "../db/catalog";
import { getDefaultDb } from "../db/client";
import { catalogDiscountAdoptions } from "../db/schema";

// ── 채택 라우트 게이트(슬라이스 C) ──────────────────────────────────────────
// 딜러 제안 열람·채택은 admin 전용이다 — 그 위에 게이트가 없으면 staff가 남의 딜러 제안을
// 열람하고 확정 할인까지 채택한다. dealerWriteGate는 쓰기만 보므로 GET은 딜러에게도 열린다 —
// 경쟁사 할인 전략 노출이다.
// 그래서 두 라우트 모두 requireRoles(["admin"])를 명시로 붙였고, 이 파일이 그 축을 잠근다.
// (2026-07-30부터 catalog 쓰기 전 라우트에도 role 게이트가 붙었다 — 큐 8종 admin·manager,
// 삭제/이동/mc_code/reorder admin 전용. spec: 2026-07-30-crm-catalog-change-approval-design.md §6.2)
//
// ⚠️ 이 파일은 **실제 채택을 하지 않는다.** 라우트가 자기 트랜잭션을 열기 때문에(dbMiddleware
// 관례) 바깥에서 롤백할 수 없고, 채택이 커밋되면 앱 고객에게 보이는 확정 할인이 바뀐다.
// 채택 동작 자체는 db/queries/discount-adoptions.test.ts가 롤백 안에서 검증한다.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §6.3
const db = getDefaultDb();
let trimId = 0;
let modelId = 0;
let cleanTrimId = 0; // 감사 이력 0건 트림 — 되돌리기 테스트 전용(아래 ⚠️ 참조)

beforeAll(async () => {
  const [trim] = await db
    .select({ id: trimsInCatalog.id, modelId: trimsInCatalog.modelId })
    .from(trimsInCatalog)
    .limit(1);
  trimId = trim!.id;
  modelId = trim!.modelId;

  // ⚠️ 되돌리기는 채택과 달리 랜덤 uuid 같은 안전판이 없다 — 이력 있는 트림에 admin으로 부르면
  // **실제로 되돌아가 커밋된다**(라우트가 자기 트랜잭션). 반드시 감사 0건 트림으로 404를 만든다.
  const [clean] = await db
    .select({ id: trimsInCatalog.id })
    .from(trimsInCatalog)
    .leftJoin(catalogDiscountAdoptions, eq(catalogDiscountAdoptions.trimId, trimsInCatalog.id))
    .where(isNull(catalogDiscountAdoptions.id))
    .limit(1);
  cleanTrimId = clean!.id;
});

async function request(
  role: "dealer" | "staff" | "manager" | "admin",
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// 조회는 모델 단위다(화면이 트림 표의 셀마다 단서를 달아야 한다 — 트림 단위면 13번 왕복).
const proposalsPath = () => `/api/catalog/models/${modelId}/discount-proposals`;
const adoptionsPath = () => `/api/catalog/trims/${trimId}/discount-adoptions`;
const ADOPT_BODY = { field: "financial", dealerUserId: crypto.randomUUID() };
const undoPath = () => `/api/catalog/trims/${cleanTrimId}/discount-adoptions/undo`;

test("제안 조회: admin은 200", async () => {
  const res = await request("admin", "GET", proposalsPath());
  expect(res.status).toBe(200);
  // 제안이 있는 트림만 담긴다(0건 트림은 채택할 것이 없어 팝오버를 열 이유가 없다).
  expect(Array.isArray(await res.json())).toBe(true);
});

test("제안 조회: staff·manager·dealer는 403 (GET도 막는다 — 경쟁사 전략 노출)", async () => {
  for (const role of ["staff", "manager", "dealer"] as const) {
    const res = await request(role, "GET", proposalsPath());
    expect(res.status).toBe(403);
  }
});

test("채택: staff·manager·dealer는 403", async () => {
  for (const role of ["staff", "manager", "dealer"] as const) {
    const res = await request(role, "POST", adoptionsPath(), ADOPT_BODY);
    expect(res.status).toBe(403);
  }
});

test("채택: admin이 부르면 게이트를 지나고, 채택할 제안이 없으면 404", async () => {
  // 존재하지 않는 딜러(랜덤 uuid)의 제안을 채택하려는 요청이라 아무것도 바뀌지 않는다 —
  // 게이트 통과(403이 아님)와 fail-closed(404)를 한 번에 확인한다.
  const res = await request("admin", "POST", adoptionsPath(), ADOPT_BODY);
  expect(res.status).toBe(404);
});

test("채택: 본문 스키마가 필드명을 제한한다(임의 문자열로 컬럼을 지목할 수 없다)", async () => {
  const res = await request("admin", "POST", adoptionsPath(), {
    field: "price", // 할인 3필드가 아닌 컬럼을 노린 요청
    dealerUserId: crypto.randomUUID(),
  });
  expect(res.status).toBe(400);
});

test("확정 할인은 이 파일 실행으로 바뀌지 않는다(게이트 테스트의 부작용 0)", async () => {
  // 위 케이스들이 전부 403/404/400이므로 catalog.trims는 손대지 않았어야 한다.
  const [row] = await db
    .select({ stampedAt: trimsInCatalog.discountUpdatedAt })
    .from(trimsInCatalog)
    .where(eq(trimsInCatalog.id, trimId));
  // 스탬프가 "오늘"이면 이 실행이 뭔가를 바꿨다는 뜻이다(트리거가 값 변경 시에만 찍는다).
  const stamped = row!.stampedAt;
  if (stamped !== null) {
    expect(new Date(stamped).toDateString()).not.toBe(new Date().toDateString());
  }
});

// ── 되돌리기 라우트 게이트(2026-07-29) — 채택과 같은 축 ──────────────────────
test("되돌리기: staff·manager·dealer는 403", async () => {
  for (const role of ["staff", "manager", "dealer"] as const) {
    const res = await request(role, "POST", undoPath(), { field: "financial" });
    expect(res.status).toBe(403);
  }
});

test("되돌리기: admin은 게이트를 지나고, 감사 이력이 없으면 404(fail-closed)", async () => {
  const res = await request("admin", "POST", undoPath(), { field: "financial" });
  expect(res.status).toBe(404);
});

test("되돌리기: 본문 스키마가 필드명을 제한한다", async () => {
  const res = await request("admin", "POST", undoPath(), { field: "price" });
  expect(res.status).toBe(400);
});
