import { expect, test } from "bun:test";

import { buildCanonicalName } from "./canonical-name";

test("국산: brand model trimName", () => {
  expect(
    buildCanonicalName({
      brand: "현대",
      model: "그랜저",
      isDomestic: true,
      modelYear: 2026,
      fuelType: "가솔린",
      trimName: "프리미엄 - 익스클루시브",
    }),
  ).toBe("현대 그랜저 프리미엄 - 익스클루시브");
});

test("수입: brand model year fuel trimName", () => {
  expect(
    buildCanonicalName({
      brand: "BMW",
      model: "5 Series",
      isDomestic: false,
      modelYear: 2026,
      fuelType: "가솔린",
      trimName: "520i",
    }),
  ).toBe("BMW 5 Series 2026 가솔린 520i");
});

test("앞뒤 공백 trim + 빈 brand/model 허용", () => {
  expect(
    buildCanonicalName({
      brand: "",
      model: "",
      isDomestic: false,
      modelYear: 2026,
      fuelType: "가솔린",
      trimName: "X",
    }),
  ).toBe("2026 가솔린 X");
});
