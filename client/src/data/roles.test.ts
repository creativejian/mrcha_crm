import { describe, expect, it } from "vitest";

import { roleTabFromClaim } from "./roles";

describe("roleTabFromClaim", () => {
  it("DB role을 RoleTab으로 매핑한다", () => {
    expect(roleTabFromClaim("admin")).toBe("최고관리자");
    expect(roleTabFromClaim("manager")).toBe("팀장");
    expect(roleTabFromClaim("staff")).toBe("상담사");
    expect(roleTabFromClaim("dealer")).toBe("딜러");
  });

  it("customer·미지정·알 수 없는 값은 null(접근 거부)", () => {
    expect(roleTabFromClaim("customer")).toBeNull();
    expect(roleTabFromClaim(null)).toBeNull();
    expect(roleTabFromClaim(undefined)).toBeNull();
    expect(roleTabFromClaim("guest")).toBeNull();
  });
});
