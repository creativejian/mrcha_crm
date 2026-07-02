import { describe, expect, it } from "vitest";

import { DOC_TYPE_OPTIONS } from "@/data/customers";

import { CLASSIFY_RESPONSE_SCHEMA, DOC_TYPE_OPTIONS as EDGE_DOC_TYPE_OPTIONS } from "../../../supabase/functions/crm-analyst/doc-types";

// 서류 22종의 SSOT는 프론트 DOC_TYPE_OPTIONS. Edge Function은 Deno 격리라 복제본을 쓰는데,
// Deno 테스트는 프론트 변경 시 실행되지 않으므로 여기(bun test:unit)서 드리프트를 잡는다.
// 한쪽만 rename/추가되면 Gemini enum이 그 값을 반환하지 못해 전부 unknown→regex→기타서류로 무음 강등된다.
describe("서류 22종 Edge 복제본 패리티", () => {
  it("Edge doc-types가 프론트 DOC_TYPE_OPTIONS와 순서까지 동일하다", () => {
    expect([...EDGE_DOC_TYPE_OPTIONS]).toEqual([...DOC_TYPE_OPTIONS]);
  });

  it("Gemini responseSchema enum = 22종 + unknown", () => {
    expect([...CLASSIFY_RESPONSE_SCHEMA.properties.docType.enum]).toEqual([...DOC_TYPE_OPTIONS, "unknown"]);
  });
});
