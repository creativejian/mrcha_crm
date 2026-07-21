import { describe, expect, it } from "vitest";

import { canAssignAdvisor } from "./advisor-assign-access";

// 담당자 배정 권한 — 서버 403(진짜 게이트)과 클라 UI 게이트가 공유하는 판정.
describe("canAssignAdvisor", () => {
  it("admin·manager는 배정할 수 있다 — 팀장은 admin 동급(canWriteQuote D-2① 미러)", () => {
    expect(canAssignAdvisor({ role: "admin" })).toBe(true);
    expect(canAssignAdvisor({ role: "manager" })).toBe(true);
  });

  it("staff는 배정할 수 없다 — 남에게 넘기면 본인 스코프에서 사라져 되돌릴 수 없다", () => {
    expect(canAssignAdvisor({ role: "staff" })).toBe(false);
  });

  it("dealer·미상 role은 fail-closed", () => {
    expect(canAssignAdvisor({ role: "dealer" })).toBe(false);
    expect(canAssignAdvisor({ role: "" })).toBe(false);
    expect(canAssignAdvisor({ role: "customer" })).toBe(false);
  });
});
