import { describe, expect, it } from "vitest";

import { customerCodeFromLocation } from "./customer-route";

describe("customerCodeFromLocation", () => {
  it("/customer-detail/:code 의 path code를 반환", () => {
    expect(customerCodeFromLocation("/customer-detail/CU-2605-0020", "")).toBe("CU-2605-0020");
  });
  it("끝 슬래시가 있어도 path code를 반환", () => {
    expect(customerCodeFromLocation("/customer-detail/CU-2605-0020/", "")).toBe("CU-2605-0020");
  });
  it("/customers + ?customer= 쿼리값을 반환", () => {
    expect(customerCodeFromLocation("/customers", "?customer=CU-2605-0019")).toBe("CU-2605-0019");
  });
  it("/customers 에 쿼리 없으면 null", () => {
    expect(customerCodeFromLocation("/customers", "")).toBeNull();
  });
  it("/customer-detail (code 없음)은 null", () => {
    expect(customerCodeFromLocation("/customer-detail", "")).toBeNull();
  });
  it("다른 경로의 customer 쿼리는 무시(null)", () => {
    expect(customerCodeFromLocation("/quotes", "?customer=CU-2605-0001")).toBeNull();
  });
  it("URL 인코딩된 코드를 디코드", () => {
    expect(customerCodeFromLocation("/customer-detail/CU%2D2605%2D0020", "")).toBe("CU-2605-0020");
  });
});
