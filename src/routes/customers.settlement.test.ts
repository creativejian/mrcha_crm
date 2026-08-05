import { expect, test } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { getDefaultDb } from "../db/client";
import { customerDeliveries } from "../db/schema";
import { eq } from "drizzle-orm";

// ── 정산(입금일·실입금액) role 게이트 ────────────────────────────────────
// 유슨생 결정(2026-08-03): **관리자만, 읽기도 차단.** 출고 정보(`/delivery`)는 상담사도 쓰지만
// 정산은 admin 단독이다 — manager(팀장)도 막는다(경영 리포트와 같은 축).
// 게이트가 뚫리면 회사 수입이 전 직원에게 노출되므로 fail-closed가 맞다.

const db = getDefaultDb();

async function reqFor(
  role: "admin" | "manager" | "staff" | "dealer",
  path: string,
  init?: RequestInit,
) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

const SOME_ID = "00000000-0000-4000-8000-000000000001";

// ⚠️ 차단 코드가 role마다 다르다 — 게이트가 여러 겹이라서다(2026-08-03 실측):
//   manager      → requireRoles가 **403**. scope가 "all"이라 앞 게이트를 그냥 통과한다.
//   staff·dealer → role scope(#301)가 먼저 **404**(타 담당·미배정은 "미존재"와 같은 문구 — 존재 비노출).
//   dealer PUT   → 전역 dealerWriteGate가 **403**.
// 그래서 staff·dealer는 코드를 고정하지 않고 "200이 아니다"로 단언한다. **manager 403이 이 파일의
// 핵심 검증**이다 — 관리자급인데도 막히는지가 이번 결정(admin 단독)의 전부이고, scope가 가려주지
// 않는 유일한 role이라 게이트가 실제로 걸렸는지 여기서만 드러난다.
test("GET /settlement — manager는 403 (팀장도 막는다 — 경영 리포트와 같은 축)", async () => {
  const res = await reqFor("manager", `/api/customers/${SOME_ID}/settlement`);
  expect(res.status).toBe(403);
});

test("PUT /settlement — manager는 403 (게이트가 zod·본 처리보다 앞)", async () => {
  const res = await reqFor("manager", `/api/customers/${SOME_ID}/settlement`, {
    method: "PUT",
    body: JSON.stringify({ settledAt: "2026-09-10", feeAmount: 1180000 }),
  });
  expect(res.status).toBe(403);
});

test("GET·PUT /settlement — staff·dealer는 어느 겹에서든 차단된다(200 불가)", async () => {
  for (const role of ["staff", "dealer"] as const) {
    const get = await reqFor(role, `/api/customers/${SOME_ID}/settlement`);
    expect(get.status).not.toBe(200);
    const put = await reqFor(role, `/api/customers/${SOME_ID}/settlement`, {
      method: "PUT",
      body: JSON.stringify({ settledAt: "2026-09-10", feeAmount: 1180000 }),
    });
    expect(put.status).not.toBe(200);
  }
});

test("GET /settlement — admin은 통과하고, 출고 정보가 없는 고객도 빈 값으로 응답", async () => {
  const res = await reqFor("admin", `/api/customers/${SOME_ID}/settlement`);
  expect(res.status).toBe(200);
  // 출고 행이 없어도 화면이 분기하지 않도록 **빈 값 형태를 그대로 준다** — 비용은 빈 배열,
  // 단계는 "미정산"이 기본이다(null이면 클라가 매번 ?? 로 메워야 하고 한 곳만 빠뜨려도 깨진다).
  expect(await res.json()).toEqual({ settledAt: null, feeAmount: null, costs: [], status: "미정산" });
});

test("PUT /settlement — 없는 고객은 404 (admin이어도 만들어내지 않는다)", async () => {
  const res = await reqFor("admin", `/api/customers/${SOME_ID}/settlement`, {
    method: "PUT",
    body: JSON.stringify({ settledAt: "2026-09-10", feeAmount: 1180000 }),
  });
  expect(res.status).toBe(404);
});

test("PUT /settlement — 음수 실입금액은 400 (입금 개념상 성립하지 않는다)", async () => {
  const res = await reqFor("admin", `/api/customers/${SOME_ID}/settlement`, {
    method: "PUT",
    body: JSON.stringify({ settledAt: null, feeAmount: -1 }),
  });
  expect(res.status).toBe(400);
});

test("PUT /settlement — 저장은 출고 정보 필드를 덮지 않는다(같은 행·다른 축)", async () => {
  // 실 DB의 기존 출고 행 하나를 빌려 왕복한다(픽스처를 만들지 않는다 — 정산은 읽기 전용 축 검증).
  const [existing] = await db
    .select({ customerId: customerDeliveries.customerId, contractVehicle: customerDeliveries.contractVehicle })
    .from(customerDeliveries)
    .limit(1);
  if (!existing) return; // 출고 행이 없는 환경에서는 검증 불가 — 조용히 통과(픽스처 생성 금지)

  const before = await db
    .select({ settledAt: customerDeliveries.settledAt, feeAmount: customerDeliveries.feeAmount })
    .from(customerDeliveries)
    .where(eq(customerDeliveries.customerId, existing.customerId));
  try {
    const res = await reqFor("admin", `/api/customers/${existing.customerId}/settlement`, {
      method: "PUT",
      body: JSON.stringify({ settledAt: "2026-09-10", feeAmount: 1180000 }),
    });
    expect(res.status).toBe(200);
    // 비용·단계가 응답에 함께 실린다(2026-08-04) — 저장 body에 안 실은 두 필드는 기존 값을 유지한다.
    const saved = (await res.json()) as { settledAt: string; feeAmount: number; costs: unknown[]; status: string };
    expect(saved.settledAt).toBe("2026-09-10");
    expect(saved.feeAmount).toBe(1180000);
    expect(Array.isArray(saved.costs)).toBe(true);

    // 핵심: 계약 차량(출고 축)이 그대로여야 한다. 정산 저장이 출고 필드를 비우면 여기서 깨진다.
    const [after] = await db
      .select({ contractVehicle: customerDeliveries.contractVehicle })
      .from(customerDeliveries)
      .where(eq(customerDeliveries.customerId, existing.customerId));
    expect(after.contractVehicle).toBe(existing.contractVehicle);
  } finally {
    // 빌려 쓴 행의 정산 값을 원복한다(실 DB 오염 금지).
    await db
      .update(customerDeliveries)
      .set({ settledAt: before[0]?.settledAt ?? null, feeAmount: before[0]?.feeAmount ?? null })
      .where(eq(customerDeliveries.customerId, existing.customerId));
  }
});

// ── 비용·단계(2026-08-04 이사님 확정) ──────────────────────────────────────
// 비용 항목은 썬팅·블랙박스·탁송·페이백·직접입력 5종이고 **"직접입력"만 항목명을 요구**한다.
// 양방향으로 막는 이유: 라벨 없는 직접입력은 나중에 "이 15만원이 뭐였지"가 되고, 고정 항목에
// 라벨이 붙으면 집계 키가 둘로 갈린다(썬팅인데 label="썬팅시공").
test("PUT /settlement — 직접입력은 항목명이 없으면 400", async () => {
  const res = await reqFor("admin", `/api/customers/${SOME_ID}/settlement`, {
    method: "PUT",
    body: JSON.stringify({
      settledAt: null,
      feeAmount: null,
      costs: [{ kind: "직접입력", label: null, amount: 150000 }],
    }),
  });
  expect(res.status).toBe(400);
});

test("PUT /settlement — 고정 항목에 항목명을 넣어도 400(집계 키가 갈린다)", async () => {
  const res = await reqFor("admin", `/api/customers/${SOME_ID}/settlement`, {
    method: "PUT",
    body: JSON.stringify({
      settledAt: null,
      feeAmount: null,
      costs: [{ kind: "썬팅", label: "썬팅시공", amount: 300000 }],
    }),
  });
  expect(res.status).toBe(400);
});

test("PUT /settlement — 없는 비용 종류는 400(닫힌 5종)", async () => {
  const res = await reqFor("admin", `/api/customers/${SOME_ID}/settlement`, {
    method: "PUT",
    body: JSON.stringify({
      settledAt: null,
      feeAmount: null,
      costs: [{ kind: "광택", label: null, amount: 120000 }],
    }),
  });
  expect(res.status).toBe(400);
});

// ── 담당자 정산 요청 ──────────────────────────────────────────────────────
// 정산 축은 admin 단독인데 **요청만 담당자 행위**라(이사님: "정산요청(담당자가 관리자에게)")
// 이 경로만 역할 게이트 없이 열되 **할 수 있는 일을 전이 하나로 좁힌다**. 금액은 응답에도 없다.
test("POST /settlement/request — 출고 정보가 없으면 404", async () => {
  const res = await reqFor("admin", `/api/customers/${SOME_ID}/settlement/request`, { method: "POST" });
  expect(res.status).toBe(404);
});

test("POST /settlement/request — 미정산 → 정산요청, 재요청은 409(조용히 성공시키지 않는다)", async () => {
  const [existing] = await db
    .select({ customerId: customerDeliveries.customerId, status: customerDeliveries.settlementStatus })
    .from(customerDeliveries)
    .limit(1);
  if (!existing) return; // 출고 행이 없는 환경에서는 검증 불가 — 조용히 통과(픽스처 생성 금지)

  try {
    await db
      .update(customerDeliveries)
      .set({ settlementStatus: "미정산" })
      .where(eq(customerDeliveries.customerId, existing.customerId));

    const ok = await reqFor("admin", `/api/customers/${existing.customerId}/settlement/request`, { method: "POST" });
    expect(ok.status).toBe(200);
    // 응답에 금액이 없어야 한다 — 담당자도 부르는 경로다.
    expect(await ok.json()).toEqual({ status: "정산요청" });

    // 같은 요청을 한 번 더 — 조건부 UPDATE가 0행을 내고 409로 떨어진다(경합 안전).
    const dup = await reqFor("admin", `/api/customers/${existing.customerId}/settlement/request`, { method: "POST" });
    expect(dup.status).toBe(409);
  } finally {
    await db
      .update(customerDeliveries)
      .set({ settlementStatus: existing.status })
      .where(eq(customerDeliveries.customerId, existing.customerId));
  }
});

// ── admin 단계 전이(2026-08-05 정산 상태 편집 UI) ──────────────────────────
// 담당자가 올린 "정산요청"을 admin이 "정산완료"로 넘기는 경로. zod enum·upsert 매핑은 진작
// 있었지만 **저장하는 화면이 없어 한 번도 실사용된 적이 없었다** — 위 request 경로가 커버하는
// 것은 미정산→정산요청 하나뿐이라, 이 왕복은 여기서 처음 검증된다.
// ⚠️ status를 **단독으로** 보내는 케이스는 만들 수 없다 — `settlementBody`에서 settledAt·feeAmount는
// 필수라(optional은 costs·status뿐) status만 담은 body는 400이다. 화면도 늘 셋을 함께 보낸다.
test("PUT /settlement — admin은 단계를 정산완료로 넘길 수 있다(담당자 요청을 받는 쪽)", async () => {
  const [existing] = await db
    .select({
      customerId: customerDeliveries.customerId,
      status: customerDeliveries.settlementStatus,
      feeAmount: customerDeliveries.feeAmount,
      settledAt: customerDeliveries.settledAt,
    })
    .from(customerDeliveries)
    .limit(1);
  if (!existing) return; // 출고 행이 없는 환경에서는 검증 불가 — 조용히 통과(픽스처 생성 금지)

  try {
    await db
      .update(customerDeliveries)
      .set({ settlementStatus: "정산요청" })
      .where(eq(customerDeliveries.customerId, existing.customerId));

    const res = await reqFor("admin", `/api/customers/${existing.customerId}/settlement`, {
      method: "PUT",
      // 화면이 보내는 것과 같은 모양 — 단계를 바꾼 저장에는 입금일·실입금액도 함께 실린다.
      body: JSON.stringify({ settledAt: "2026-09-10", feeAmount: 1180000, status: "정산완료" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string; feeAmount: number }).toMatchObject({
      status: "정산완료",
      feeAmount: 1180000,
    });
  } finally {
    await db
      .update(customerDeliveries)
      .set({ settlementStatus: existing.status, feeAmount: existing.feeAmount, settledAt: existing.settledAt })
      .where(eq(customerDeliveries.customerId, existing.customerId));
  }
});
