import { describe, expect, it } from "vitest";

import {
  classifyDocumentFile,
  formatFileSize,
  formatNumberWithCommas,
  formatRecentUpdateTime,
  formatLocalPhone,
  formatScheduleDateLabel,
  formatShortDateLabel,
  checkDueDateRank,
  checkDueRank,
  documentFileKind,
  purchaseTags,
  quoteValidClass,
  timeLabelMinutes,
  localPhoneFrom,
  parseCheckDueDate,
  phoneChunks,
} from "./detail-utils";

describe("classifyDocumentFile", () => {
  it("파일명 키워드로 서류 종류를 분류한다", () => {
    expect(classifyDocumentFile("운전면허증_앞면.jpg")).toBe("면허증");
    expect(classifyDocumentFile("주민등록등본.pdf")).toBe("주민등록등본");
    expect(classifyDocumentFile("사업자등록증.png")).toBe("사업자등록증");
    expect(classifyDocumentFile("business-registration.pdf")).toBe("사업자등록증");
  });
  it("재무제표는 전기/당해를 구분한다(전기 우선)", () => {
    expect(classifyDocumentFile("재무제표_전기.pdf")).toBe("법인(점)재무제표(전기)");
    expect(classifyDocumentFile("재무제표_당해.pdf")).toBe("법인(점)재무제표(당해)");
  });
  it("매칭 없으면 기타서류로 폴백한다", () => {
    expect(classifyDocumentFile("아무거나.txt")).toBe("기타서류");
  });
});

describe("documentFileKind", () => {
  it("MIME/확장자로 이미지·PDF·파일을 가른다", () => {
    expect(documentFileKind("image/png")).toBe("이미지");
    expect(documentFileKind("application/pdf")).toBe("PDF");
    expect(documentFileKind(undefined, "scan.PDF")).toBe("PDF");
    expect(documentFileKind("text/plain", "memo.txt")).toBe("파일");
  });
});

describe("전화번호 포맷", () => {
  it("formatLocalPhone은 뒤 8자리를 4-4로 끊고 비숫자를 제거한다", () => {
    expect(formatLocalPhone("12345678")).toBe("1234-5678");
    expect(formatLocalPhone("123")).toBe("123");
    expect(formatLocalPhone("9588-0812")).toBe("9588-0812");
    expect(formatLocalPhone("123456789")).toBe("1234-5678"); // 8자리로 자름
  });
  it("localPhoneFrom은 010 prefix를 떼고 뒤 8자리를 포맷한다", () => {
    expect(localPhoneFrom("01095880812")).toBe("9588-0812");
    expect(localPhoneFrom("010-9588-0812")).toBe("9588-0812");
  });
  it("phoneChunks는 하이픈 또는 길이 기준으로 3등분한다", () => {
    expect(phoneChunks("010-9588-0812")).toEqual(["010", "9588", "0812"]);
    expect(phoneChunks("01095880812")).toEqual(["010", "9588", "0812"]);
  });
});

describe("숫자·파일 크기", () => {
  it("formatNumberWithCommas는 숫자만 추려 천단위 콤마", () => {
    expect(formatNumberWithCommas("2473200원")).toBe("2,473,200");
    expect(formatNumberWithCommas("")).toBe("");
    expect(formatNumberWithCommas("abc")).toBe("");
  });
  it("formatFileSize는 KB/MB 단위와 빈 값을 처리한다", () => {
    expect(formatFileSize(undefined)).toBe("크기 확인 전");
    expect(formatFileSize(0)).toBe("크기 확인 전");
    expect(formatFileSize(2048)).toBe("2KB");
    expect(formatFileSize(1.4 * 1024 * 1024)).toBe("1.4MB");
  });
});

describe("formatRecentUpdateTime", () => {
  const base = 1_000_000_000_000;
  it("경과에 따라 방금/분/시간/일/날짜를 반환한다", () => {
    expect(formatRecentUpdateTime(base, base + 5 * 60_000)).toBe("방금 전");
    expect(formatRecentUpdateTime(base, base + 35 * 60_000)).toBe("30분 전");
    expect(formatRecentUpdateTime(base, base + 3 * 3_600_000)).toBe("3시간 전");
    expect(formatRecentUpdateTime(base, base + 2 * 86_400_000)).toBe("2일 전");
  });
  it("7일 이상이면 YYYY-MM-DD", () => {
    const out = formatRecentUpdateTime(base, base + 10 * 86_400_000);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("정렬 랭크", () => {
  it("checkDueRank는 급함<오늘<내일<이번 주<기타 순", () => {
    expect(checkDueRank("급함")).toBe(0);
    expect(checkDueRank("오늘")).toBe(1);
    expect(checkDueRank("이번 주")).toBe(3);
    expect(checkDueRank("지정")).toBe(4);
  });
  it("checkDueDateRank는 월*100+일, 잘못된 값은 MAX", () => {
    expect(checkDueDateRank("3/15")).toBe(315);
    expect(checkDueDateRank("지정")).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("timeLabelMinutes는 '오늘 HH:MM'을 분으로, 잘못된 값은 MAX", () => {
    expect(timeLabelMinutes("오늘 14:20")).toBe(860);
    expect(timeLabelMinutes("이상한값")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("날짜·태그·클래스", () => {
  it("formatShortDateLabel은 빈 값에 '지정', 정상은 M/D", () => {
    expect(formatShortDateLabel("2026-05-14")).toBe("5/14");
    expect(formatShortDateLabel("")).toBe("지정");
  });
  it("formatScheduleDateLabel은 빈 값에 원본 반환", () => {
    expect(formatScheduleDateLabel("2026-05-14")).toBe("5/14");
    expect(formatScheduleDateLabel("미정")).toBe("미정");
  });
  it("parseCheckDueDate는 M/D를 주입 날짜의 연도로 YYYY-MM-DD", () => {
    expect(parseCheckDueDate("3/5", new Date(2026, 0, 1))).toBe("2026-03-05");
    expect(parseCheckDueDate("없음")).toBe("");
  });
  it("purchaseTags는 #로 끊어 트림 후 다시 # 부착", () => {
    expect(purchaseTags("#카톡 선호 #가족과 상의")).toEqual(["#카톡 선호", "#가족과 상의"]);
    expect(purchaseTags("")).toEqual([]);
  });
  it("quoteValidClass는 만료/긴급/활성을 가른다", () => {
    expect(quoteValidClass("만료됨")).toBe(" expired");
    expect(quoteValidClass("D-1")).toBe(" urgent");
    expect(quoteValidClass("D-6")).toBe(" active");
    expect(quoteValidClass()).toBe("");
  });
});
