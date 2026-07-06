import { test, expect } from "bun:test";

import { resolveCustomerScope } from "./assistant-scope";

// 역할 scope(이사님 요구 2026-07-06): 관리자·팀장 = 전체, 상담사(staff) = 본인 담당 고객만.
test("admin·manager는 전체(all)", () => {
  expect(resolveCustomerScope({ id: "u1", role: "admin" })).toBe("all");
  expect(resolveCustomerScope({ id: "u2", role: "manager" })).toBe("all");
});

test("staff는 본인 담당(advisor_id 매칭) scope", () => {
  expect(resolveCustomerScope({ id: "u3", role: "staff" })).toEqual({ advisorId: "u3" });
});

test("dealer는 staff와 동일 규칙(담당 고객 없음 = 사실상 0건) — 화이트리스트 밖 role도 fail-closed", () => {
  expect(resolveCustomerScope({ id: "u4", role: "dealer" })).toEqual({ advisorId: "u4" });
  expect(resolveCustomerScope({ id: "u5", role: "unknown" })).toEqual({ advisorId: "u5" });
});
