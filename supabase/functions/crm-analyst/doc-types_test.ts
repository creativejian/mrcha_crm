import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CLASSIFY_RESPONSE_SCHEMA, DOC_TYPE_OPTIONS, buildClassifyPrompt } from "./doc-types.ts";

Deno.test("DOC_TYPE_OPTIONS는 22종", () => {
  assertEquals(DOC_TYPE_OPTIONS.length, 22);
  assert(DOC_TYPE_OPTIONS.includes("기타서류"));
  assert(DOC_TYPE_OPTIONS.includes("면허증"));
});

Deno.test("responseSchema enum은 22종 + unknown", () => {
  const en = CLASSIFY_RESPONSE_SCHEMA.properties.docType.enum;
  assertEquals(en.length, 23);
  assert(en.includes("unknown"));
  assert(en.includes("법인(점)재무제표(당해)"));
});

Deno.test("프롬프트는 22종을 모두 포함하고 unknown 규칙을 명시", () => {
  const p = buildClassifyPrompt();
  for (const t of DOC_TYPE_OPTIONS) assert(p.includes(t), `프롬프트에 ${t} 누락`);
  assert(p.includes("unknown"));
});
