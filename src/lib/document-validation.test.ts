import { test, expect } from "bun:test";

import { isAllowedMime, MAX_DOC_BYTES, safeFileName } from "./document-validation";

test("isAllowedMime: 이미지·PDF·오피스 허용, 그 외 거부", () => {
  expect(isAllowedMime("image/png")).toBe(true);
  expect(isAllowedMime("image/heic")).toBe(true);
  expect(isAllowedMime("application/pdf")).toBe(true);
  expect(isAllowedMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(true);
  expect(isAllowedMime("application/x-msdownload")).toBe(false);
  expect(isAllowedMime("")).toBe(false);
});

test("safeFileName: 경로·제어문자 제거, 한글 유지", () => {
  expect(safeFileName("운전면허증.png")).toBe("운전면허증.png");
  expect(safeFileName("../../etc/passwd")).toBe("passwd");
  expect(safeFileName("a b/c\\d.pdf")).toBe("d.pdf");
  expect(safeFileName("a" + String.fromCharCode(1) + "b" + String.fromCharCode(31) + ".png")).toBe("ab.png");
  expect(safeFileName(".hidden")).toBe("_hidden");
  expect(safeFileName("")).toBe("file");
});

test("MAX_DOC_BYTES = 20MB", () => {
  expect(MAX_DOC_BYTES).toBe(20 * 1024 * 1024);
});
