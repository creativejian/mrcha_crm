import { describe, expect, it } from "vitest";

import { changeAdvisorBulk } from "./customer-bulk-advisor";
import type { CustomerWritePatch } from "./customers";

const ADVISOR = { id: "3f6a7f7e-90d1-4f7a-b6a1-000000000001", name: "강현준" };

describe("changeAdvisorBulk", () => {
  it("전건 성공 — 건별로 advisorName+advisorId 정확히 두 필드만 보낸다(team 미포함 잠금)", async () => {
    const calls: { id: string; patch: CustomerWritePatch }[] = [];
    const result = await changeAdvisorBulk(
      [{ id: "a", name: "김민준" }, { id: "b", name: "박서연" }],
      ADVISOR,
      async (id, patch) => { calls.push({ id, patch }); },
    );
    expect(result).toEqual({ changedIds: ["a", "b"], failed: [] });
    expect(calls).toEqual([
      { id: "a", patch: { advisorName: "강현준", advisorId: ADVISOR.id } },
      { id: "b", patch: { advisorName: "강현준", advisorId: ADVISOR.id } },
    ]);
  });

  it("일부 실패 — 서버 한글 사유를 수집하고 나머지 건은 계속 진행한다", async () => {
    const result = await changeAdvisorBulk(
      [{ id: "a", name: "김민준" }, { id: "b", name: "박서연" }, { id: "c", name: "최유진" }],
      ADVISOR,
      async (id) => {
        if (id === "b") throw new Error("고객을 찾을 수 없습니다.");
      },
    );
    expect(result.changedIds).toEqual(["a", "c"]);
    expect(result.failed).toEqual([{ name: "박서연", reason: "고객을 찾을 수 없습니다." }]);
  });

  it("id 없는 목업/미저장 행은 호출 없이 실패 목록으로", async () => {
    let called = 0;
    const result = await changeAdvisorBulk(
      [{ name: "목업행" }],
      ADVISOR,
      async () => { called += 1; },
    );
    expect(called).toBe(0);
    expect(result.changedIds).toEqual([]);
    expect(result.failed).toEqual([{ name: "목업행", reason: "저장되지 않은 행이라 변경할 수 없습니다." }]);
  });

  it("Error가 아닌 throw는 기본 문구로", async () => {
    const result = await changeAdvisorBulk(
      [{ id: "a", name: "김민준" }],
      ADVISOR,
      async () => { throw "boom"; },
    );
    expect(result.failed).toEqual([{ name: "김민준", reason: "변경에 실패했습니다." }]);
  });
});
