import { describe, expect, test } from "vitest";

import { resolveStatusFieldSubmit } from "./useCustomerWorkflow";

// saveStatusField의 제출 판정 계약(배치 8 C#1).
// 핵심: 빈 제출은 phoneSecondary(추가 연락처)만 클리어다 — 주 번호(phone)는 no-op 유지.
// 추가 연락처는 서버가 null 클리어를 지원하는데(phoneField·customers.phone.test.ts 잠금)
// 클라에 비우는 경로가 없어 한번 입력하면 목록 병기·검색에 영구 노출되던 것을 해소한다.
// 주 번호를 UI로 비우는 경로는 만들지 않는다(2026-07-17 전화번호 소유권 계약 불변).
describe("resolveStatusFieldSubmit", () => {
  test("빈 제출 + phoneSecondary → 클리어(추가 연락처만 비우기 경로)", () => {
    expect(resolveStatusFieldSubmit("phoneSecondary", "")).toEqual({ kind: "clearSecondary" });
    expect(resolveStatusFieldSubmit("phoneSecondary", "   ")).toEqual({ kind: "clearSecondary" });
  });

  test("빈 제출 + phone(주 번호) → no-op 유지(계약 불변 — 클리어 경로 없음)", () => {
    expect(resolveStatusFieldSubmit("phone", "")).toEqual({ kind: "noop" });
    expect(resolveStatusFieldSubmit("phone", "  ")).toEqual({ kind: "noop" });
  });

  test("빈 제출 + 일반 텍스트 키 → no-op 유지", () => {
    expect(resolveStatusFieldSubmit("location", "")).toEqual({ kind: "noop" });
  });

  test("phone류 값 제출 → 010 prefix digits + 하이픈 표시값", () => {
    expect(resolveStatusFieldSubmit("phone", "1234-5678")).toEqual({
      kind: "phone",
      digits: "01012345678",
      display: "010-1234-5678",
    });
    expect(resolveStatusFieldSubmit("phoneSecondary", "9876-5432")).toEqual({
      kind: "phone",
      digits: "01098765432",
      display: "010-9876-5432",
    });
  });

  test("일반 텍스트 키 값 제출 → trim된 텍스트 저장", () => {
    expect(resolveStatusFieldSubmit("location", " 인천광역시 · 남동구 ")).toEqual({
      kind: "text",
      value: "인천광역시 · 남동구",
    });
  });
});
