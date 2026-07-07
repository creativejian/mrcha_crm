import { test, expect } from "bun:test";

import { CRM_ROLES } from "../auth/verify";
import { CRM_ROLE_LABELS } from "./assistant-tools";

// 역할 라벨 어휘 tripwire — CRM_ROLES는 Set이라 union 타입 파생이 안 돼 컴파일러가 라벨 누락을 못 잡는다.
// 역할이 추가/제거될 때(dealer 추가 전례) CRM_ROLE_LABELS[role] ?? role 폴백이 raw 문자열을 조용히
// 노출하는 것 방지(roles-parity·doc-type-parity 관례와 동일 패턴).
test("CRM_ROLE_LABELS 키 집합 = CRM_ROLES(로그인 게이트 어휘)", () => {
  expect(Object.keys(CRM_ROLE_LABELS).sort()).toEqual([...CRM_ROLES].sort());
});
