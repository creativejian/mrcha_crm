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

test("safeFileName: non-ASCII(한글)·제어문자·안전치 않은 문자 제거, 확장자 보존", () => {
  expect(safeFileName("운전면허증.png")).toBe("file.png"); // 한글만 → file, 확장자 유지
  expect(safeFileName("내 사업자 등록증.pdf")).toBe("file.pdf"); // 한글+공백
  expect(safeFileName("재무제표 2026 (최종).xlsx")).toBe("2026_.xlsx"); // 한글 제거 + 공백→_ + 괄호 제거
  expect(safeFileName("hello world.png")).toBe("hello_world.png"); // 영문 공백 → _
  expect(safeFileName("../../etc/passwd")).toBe("passwd"); // basename, 확장자 없음
  expect(safeFileName("a b/c.pdf")).toBe("c.pdf"); // 경로 분리 후 basename
  expect(safeFileName("a" + String.fromCharCode(1) + "b" + String.fromCharCode(31) + ".png")).toBe("ab.png"); // 제어문자 제거
  expect(safeFileName("")).toBe("file");
});

test("MAX_DOC_BYTES = 20MB", () => {
  expect(MAX_DOC_BYTES).toBe(20 * 1024 * 1024);
});
