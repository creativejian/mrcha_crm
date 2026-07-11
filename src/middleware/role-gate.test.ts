import { describe, expect, test } from "bun:test";

import { createApp } from "../app";
import { makeTestAuth } from "../auth/test-jwt";
import { isDealerWriteAllowed } from "./role-gate";

// dealer는 읽기 전용 역할이다. UI는 딜러에게 쓰기 버튼을 숨기지만 API 직접 호출은
// 열려 있었다(2026-07-11 스캔: 쓰기 라우트 29개 중 role 게이트 2개). 전역 게이트로
// 전면 403하되, 미래의 정당한 딜러 쓰기(MC 마스터 할인 입력 — 확정 요구)는
// allowlist로 라우트 단위 개방한다.

describe("isDealerWriteAllowed (allowlist 매칭)", () => {
  test("빈 allowlist에서는 모든 쓰기가 불허", () => {
    expect(isDealerWriteAllowed("POST", "/api/customers", [])).toBe(false);
    expect(isDealerWriteAllowed("DELETE", "/api/customers/x/memos/y", [])).toBe(false);
  });

  test("등록된 method+경로 정규식만 통과한다 — 미래 할인 입력 개방 경로", () => {
    const allowlist = [{ method: "PATCH", path: /^\/api\/catalog\/trims\/[^/]+\/discounts$/ }];
    expect(isDealerWriteAllowed("PATCH", "/api/catalog/trims/abc-123/discounts", allowlist)).toBe(true);
    // method가 다르면 불허(경로만 맞아도 안 됨)
    expect(isDealerWriteAllowed("DELETE", "/api/catalog/trims/abc-123/discounts", allowlist)).toBe(false);
    // 경로 부분 일치로 새는 것 방지(앵커 정규식)
    expect(isDealerWriteAllowed("PATCH", "/api/catalog/trims/abc-123/discounts/extra", allowlist)).toBe(false);
  });
});

async function requestAs(role: string, method: string, path: string, body?: unknown) {
  const { token, keyResolver, issuer } = await makeTestAuth(role, crypto.randomUUID());
  const app = createApp({ keyResolver, issuer });
  return app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("dealerWriteGate (전역 미들웨어)", () => {
  test("dealer 쓰기는 라우트 불문 403 — 자식 삭제 계열(기존 무게이트 라우트)", async () => {
    // 존재하지 않는 uuid — 게이트가 없으면 404(라우트 도달), 게이트가 있으면 403(도달 전 차단).
    const res = await requestAs("dealer", "DELETE", `/api/customers/${crypto.randomUUID()}/memos/${crypto.randomUUID()}`);
    expect(res.status).toBe(403);
  });

  test("dealer 쓰기 403 — 본인 설정 PATCH도 예외 아님(클라도 딜러 제외 정합)", async () => {
    const res = await requestAs("dealer", "PATCH", "/api/me/live-consulting", { receiving: false });
    expect(res.status).toBe(403);
  });

  test("dealer POST /api/customers 403 유지(구 인라인 게이트를 전역이 대체)", async () => {
    const res = await requestAs("dealer", "POST", "/api/customers", { name: "게이트검증" });
    expect(res.status).toBe(403);
  });

  test("dealer 읽기(GET)는 계속 허용", async () => {
    const res = await requestAs("dealer", "GET", "/api/customers");
    expect(res.status).toBe(200);
  });

  test("staff 쓰기는 게이트 영향 없음 — 없는 자식 삭제가 게이트(403)가 아니라 라우트(404)에 도달", async () => {
    const res = await requestAs("staff", "DELETE", `/api/customers/${crypto.randomUUID()}/memos/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});
