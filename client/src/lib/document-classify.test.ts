import { describe, expect, it, vi, beforeEach } from "vitest";

import { classifyDocumentWithAI } from "./document-classify";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
// 썸네일은 브라우저 API라 테스트에선 무력화(원본 사용).
vi.mock("./image-thumbnail", () => ({ createImageThumbnail: vi.fn(async () => null) }));

const invoke = vi.mocked(supabase.functions.invoke);

function pngFile(name: string) {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

describe("classifyDocumentWithAI", () => {
  // 주의: `beforeEach(() => invoke.mockReset())`처럼 mock 함수 자체를 훅 반환값으로 흘리면
  // vitest(v4.1.9)+tinyspy 조합에서 이후 mockRejectedValue+await 케이스가 실제로는 정상
  // catch됐음에도 거짓 실패로 보고되는 문제가 재현된다(재귀적으로 격리 확인함).
  // 블록 바디로 반환값을 버려 회피한다.
  beforeEach(() => {
    invoke.mockReset();
  });

  it("AI가 22종을 반환하면 그 값을 쓴다", async () => {
    invoke.mockResolvedValue({ data: { docType: "사업자등록증" }, error: null });
    expect(await classifyDocumentWithAI(pngFile("scan.png"))).toBe("사업자등록증");
  });

  it("AI가 unknown이면 파일명 regex로 폴백", async () => {
    invoke.mockResolvedValue({ data: { docType: "unknown" }, error: null });
    expect(await classifyDocumentWithAI(pngFile("운전면허증.png"))).toBe("면허증");
  });

  it("invoke 에러면 파일명 regex로 폴백", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("boom") });
    expect(await classifyDocumentWithAI(pngFile("사업자등록증.png"))).toBe("사업자등록증");
  });

  it("invoke가 throw해도 폴백(예외 삼킴)", async () => {
    invoke.mockRejectedValue(new Error("network"));
    expect(await classifyDocumentWithAI(pngFile("아무거나.png"))).toBe("기타서류");
  });
});
