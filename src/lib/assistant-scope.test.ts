import { test, expect } from "bun:test";

import { resolveCustomerScope } from "./assistant-scope";

test("v1: 모든 CRM 역할은 전체 코퍼스(all)", () => {
  expect(resolveCustomerScope({ id: "u1", role: "admin" })).toBe("all");
  expect(resolveCustomerScope({ id: "u2", role: "manager" })).toBe("all");
  expect(resolveCustomerScope({ id: "u3", role: "staff" })).toBe("all");
});
