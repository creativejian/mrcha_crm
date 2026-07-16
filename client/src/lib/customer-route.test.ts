import { describe, expect, it } from "vitest";

import { customerCodeFromLocation, customerListPath, customerModeFromSearch } from "./customer-route";

describe("customerModeFromSearch", () => {
  it("?view= 값을 CustomerMode로 반환", () => {
    expect(customerModeFromSearch("?view=consulting")).toBe("consulting");
    expect(customerModeFromSearch("?view=hold")).toBe("hold");
  });
  it("view가 없으면 all", () => {
    expect(customerModeFromSearch("")).toBe("all");
  });
  it("?view=all 도 all", () => {
    expect(customerModeFromSearch("?view=all")).toBe("all");
  });
  it("알 수 없는 view 값은 all로 폴백", () => {
    expect(customerModeFromSearch("?view=bogus")).toBe("all");
  });
  it("drawer customer 쿼리와 공존해도 view를 파싱", () => {
    expect(customerModeFromSearch("?view=consulting&customer=CU-2605-0020")).toBe("consulting");
  });
});

describe("customerListPath", () => {
  it("all은 파라미터 없는 /customers", () => {
    expect(customerListPath("all")).toBe("/customers");
  });
  it("비-all은 ?view= 부착", () => {
    expect(customerListPath("consulting")).toBe("/customers?view=consulting");
  });
  it("customer 코드를 함께 부착(드로어)", () => {
    expect(customerListPath("all", "CU-2605-0020")).toBe("/customers?customer=CU-2605-0020");
    expect(customerListPath("consulting", "CU-2605-0020")).toBe("/customers?view=consulting&customer=CU-2605-0020");
  });
});

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
