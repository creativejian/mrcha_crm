import { describe, expect, it } from "vitest";

import { canWriteQuote } from "./quote-write-access";

const STAFF = { id: "11111111-1111-4111-8111-111111111111", role: "staff" };

// 2026-07-21 이사님 결정 매트릭스(D-1①/D-2①/D-3①) 전분기 잠금.
describe("canWriteQuote", () => {
  it("admin·manager는 담당 무관 전체 허용(D-2 ①)", () => {
    expect(canWriteQuote({ id: "a", role: "admin" }, null)).toBe(true);
    expect(canWriteQuote({ id: "a", role: "admin" }, "다른담당")).toBe(true);
    expect(canWriteQuote({ id: "m", role: "manager" }, null)).toBe(true);
    expect(canWriteQuote({ id: "m", role: "manager" }, "다른담당")).toBe(true);
  });

  it("staff는 본인 담당(advisor_id 일치)만 허용", () => {
    expect(canWriteQuote(STAFF, STAFF.id)).toBe(true);
    expect(canWriteQuote(STAFF, "22222222-2222-4222-8222-222222222222")).toBe(false);
  });

  it("미배정(advisor_id null) 고객은 staff 불가(D-3 ① — 본인 배정부터)", () => {
    expect(canWriteQuote(STAFF, null)).toBe(false);
  });

  it("dealer·미지 역할은 fail-closed", () => {
    expect(canWriteQuote({ id: "d", role: "dealer" }, "d")).toBe(false);
    expect(canWriteQuote({ id: "c", role: "customer" }, "c")).toBe(false);
    expect(canWriteQuote({ id: "x", role: "" }, "x")).toBe(false);
  });
});
