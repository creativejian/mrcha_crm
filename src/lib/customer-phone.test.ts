import { describe, expect, test } from "bun:test";

import { normalizePhoneDigits, resolvePhoneOnLink } from "./customer-phone";

describe("normalizePhoneDigits", () => {
  test("하이픈·공백을 걷어내고 숫자만 남긴다", () => {
    expect(normalizePhoneDigits("010-1234-5678")).toBe("01012345678");
    expect(normalizePhoneDigits(" 010 1234 5678 ")).toBe("01012345678");
  });

  test("이미 숫자만이면 그대로", () => {
    expect(normalizePhoneDigits("01012345678")).toBe("01012345678");
  });

  test("숫자가 없으면 null (빈 문자열·기호만·null·undefined)", () => {
    expect(normalizePhoneDigits("")).toBeNull();
    expect(normalizePhoneDigits("--")).toBeNull();
    expect(normalizePhoneDigits(null)).toBeNull();
    expect(normalizePhoneDigits(undefined)).toBeNull();
  });
});

describe("resolvePhoneOnLink", () => {
  // spec §3-4: 연결 시 기존 phone 전이. 어느 분기든 phone은 null(불변식 app_user_id → phone IS NULL).

  test("기존 phone이 없으면 no-op (secondary 유지)", () => {
    expect(resolvePhoneOnLink({ currentPhone: null, currentSecondary: "01099998888", appPhone: "01012345678" }))
      .toEqual({ phone: null, phoneSecondary: "01099998888", droppedPhone: null });
  });

  test("앱 번호와 같으면 버린다 (phone 매칭 연결의 흔한 경로 — 중복 방지)", () => {
    expect(resolvePhoneOnLink({ currentPhone: "01012345678", currentSecondary: null, appPhone: "01012345678" }))
      .toEqual({ phone: null, phoneSecondary: null, droppedPhone: null });
  });

  test("같음 비교는 정규화 후 (하이픈 유입 호환)", () => {
    expect(resolvePhoneOnLink({ currentPhone: "010-1234-5678", currentSecondary: null, appPhone: "01012345678" }))
      .toEqual({ phone: null, phoneSecondary: null, droppedPhone: null });
  });

  test("다르면 secondary로 내린다 (상담사가 적은 번호 보존)", () => {
    expect(resolvePhoneOnLink({ currentPhone: "01095880812", currentSecondary: null, appPhone: "01012345678" }))
      .toEqual({ phone: null, phoneSecondary: "01095880812", droppedPhone: null });
  });

  test("secondary에 이미 같은 값이 있으면 버린다 (중복 병기 방지)", () => {
    expect(resolvePhoneOnLink({ currentPhone: "01095880812", currentSecondary: "010-9588-0812", appPhone: "01012345678" }))
      .toEqual({ phone: null, phoneSecondary: "010-9588-0812", droppedPhone: null });
  });

  test("secondary가 다른 값으로 차 있으면 기존 phone은 droppedPhone으로 표면화 (연결은 막지 않음 — v1 토스트)", () => {
    expect(resolvePhoneOnLink({ currentPhone: "01095880812", currentSecondary: "01055556666", appPhone: "01012345678" }))
      .toEqual({ phone: null, phoneSecondary: "01055556666", droppedPhone: "01095880812" });
  });

  // 배치 8 C#2(유슨생 결정): secondary가 앱 번호와 같은 값으로 차 있으면 점유가 아니라 중복 정보 —
  // 주 번호가 profiles 파생으로 같은 값을 표시하므로 그 자리를 기존 phone(실번호)으로 교체·보존한다.
  // 구 동작은 점유 판정 → 동일 번호 2회 병기(`x · x`) + 실번호 droppedPhone 폐기였다.
  test("secondary가 앱 번호와 같은 값이면 기존 phone으로 교체·보존 (droppedPhone 없음)", () => {
    expect(resolvePhoneOnLink({ currentPhone: "01011112222", currentSecondary: "01012345678", appPhone: "01012345678" }))
      .toEqual({ phone: null, phoneSecondary: "01011112222", droppedPhone: null });
  });

  test("secondary==앱 번호 비교도 정규화 후 (하이픈 유입 호환)", () => {
    expect(resolvePhoneOnLink({ currentPhone: "010-1111-2222", currentSecondary: "010-1234-5678", appPhone: "01012345678" }))
      .toEqual({ phone: null, phoneSecondary: "01011112222", droppedPhone: null });
  });

  test("앱 번호가 없어도(과거 테스트 계정) phone은 secondary로 보존 후 null", () => {
    expect(resolvePhoneOnLink({ currentPhone: "01095880812", currentSecondary: null, appPhone: null }))
      .toEqual({ phone: null, phoneSecondary: "01095880812", droppedPhone: null });
  });

  test("secondary 이동 시 저장값은 정규화된 digits", () => {
    expect(resolvePhoneOnLink({ currentPhone: "010-9588-0812", currentSecondary: null, appPhone: "01012345678" }))
      .toEqual({ phone: null, phoneSecondary: "01095880812", droppedPhone: null });
  });
});
