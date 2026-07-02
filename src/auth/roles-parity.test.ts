import { expect, test } from "bun:test";

import { CRM_ROLES as EDGE_CRM_ROLES } from "../../supabase/functions/crm-analyst/auth";
import { CRM_ROLES } from "./verify";

// 보안 게이트 역할 집합이 서버(verify.ts)와 Edge(crm-analyst/auth.ts)에 복제돼 있다.
// 한쪽만 role을 추가/제거하면 Edge가 과대(강등 role이 Gemini 호출 가능)·과소(전 staff 403→regex 무음 강등) 허용된다.
test("CRM 게이트 역할 집합: 서버와 Edge 복제본이 동일하다", () => {
  expect([...EDGE_CRM_ROLES].sort()).toEqual([...CRM_ROLES].sort());
});
