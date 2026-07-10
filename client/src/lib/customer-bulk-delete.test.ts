import { describe, expect, it, vi } from "vitest";

import { deleteCustomersBulk } from "./customer-bulk-delete";

// 다건 삭제는 **건별 독립 트랜잭션**이다(2026-07-10 이사님 결정).
// 20명 중 1명이 막혔다고 19명을 되돌리는 건 실무에서 더 나쁘다.
// 그래서 한 건의 실패가 나머지를 멈추면 안 되고, 목록에서는 **성공한 건만** 빠져야 한다.

describe("deleteCustomersBulk", () => {
  it("전부 성공하면 deletedIds에 모두, failed는 빈 배열", async () => {
    const deleteOne = vi.fn().mockResolvedValue(undefined);
    const res = await deleteCustomersBulk([{ id: "a", name: "김" }, { id: "b", name: "박" }], deleteOne);
    expect(res.deletedIds).toEqual(["a", "b"]);
    expect(res.failed).toEqual([]);
    expect(deleteOne).toHaveBeenCalledTimes(2);
  });

  it("한 건이 실패해도 나머지는 계속 지운다(건별 독립)", async () => {
    const deleteOne = vi.fn(async (id: string) => {
      if (id === "b") throw new Error("앱으로 발송한 견적이 2건 있습니다.");
    });
    const res = await deleteCustomersBulk(
      [{ id: "a", name: "김" }, { id: "b", name: "제임스" }, { id: "c", name: "최" }],
      deleteOne,
    );
    expect(res.deletedIds).toEqual(["a", "c"]); // b만 빠진다
    expect(res.failed).toEqual([{ name: "제임스", reason: "앱으로 발송한 견적이 2건 있습니다." }]);
    expect(deleteOne).toHaveBeenCalledTimes(3); // 실패가 루프를 멈추지 않는다
  });

  it("서버의 한글 사유(409/403)를 그대로 전달한다", async () => {
    const deleteOne = vi.fn().mockRejectedValue(new Error("권한이 없습니다."));
    const res = await deleteCustomersBulk([{ id: "a", name: "김" }], deleteOne);
    expect(res.deletedIds).toEqual([]);
    expect(res.failed[0].reason).toBe("권한이 없습니다.");
  });

  it("Error가 아닌 값이 던져져도 삼키지 않고 사유를 남긴다", async () => {
    const deleteOne = vi.fn().mockRejectedValue("boom");
    const res = await deleteCustomersBulk([{ id: "a", name: "김" }], deleteOne);
    expect(res.failed[0].name).toBe("김");
    expect(res.failed[0].reason).toBeTruthy();
  });

  it("DB id 없는 행(목업)은 호출하지 않고 실패로 분류한다", async () => {
    const deleteOne = vi.fn();
    const res = await deleteCustomersBulk([{ id: undefined, name: "목업고객" }], deleteOne);
    expect(deleteOne).not.toHaveBeenCalled();
    expect(res.deletedIds).toEqual([]);
    expect(res.failed).toEqual([{ name: "목업고객", reason: "저장되지 않은 행이라 삭제할 수 없습니다." }]);
  });

  it("빈 목록은 아무것도 하지 않는다", async () => {
    const deleteOne = vi.fn();
    const res = await deleteCustomersBulk([], deleteOne);
    expect(deleteOne).not.toHaveBeenCalled();
    expect(res).toEqual({ deletedIds: [], failed: [] });
  });
});
