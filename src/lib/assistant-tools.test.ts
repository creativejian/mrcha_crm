import { test, expect } from "bun:test";

import { CRM_ROLES } from "../auth/verify";
import { ROUTER_SYSTEM_PROMPT } from "./assistant-tool-router";
import { ASSISTANT_TOOL_DECLARATIONS, CRM_ROLE_LABELS } from "./assistant-tools";

// 역할 라벨 어휘 tripwire — CRM_ROLES는 Set이라 union 타입 파생이 안 돼 컴파일러가 라벨 누락을 못 잡는다.
// 역할이 추가/제거될 때(dealer 추가 전례) CRM_ROLE_LABELS[role] ?? role 폴백이 raw 문자열을 조용히
// 노출하는 것 방지(roles-parity·doc-type-parity 관례와 동일 패턴).
test("CRM_ROLE_LABELS 키 집합 = CRM_ROLES(로그인 게이트 어휘)", () => {
  expect(Object.keys(CRM_ROLE_LABELS).sort()).toEqual([...CRM_ROLES].sort());
});

// 라우터 오라우팅 1차 억제 잠금(배치 14 K2-d) — `#315`가 실기로 확인한 사실: 라우터가 질문에 없던
// 파라미터를 지어낼 때(`"마이바흐 관심 고객"` → `statusGroup:"상담중"`) **시스템 프롬프트에 금지 지침을
// 넣는 것으로는 막히지 않았고**, 모델이 실제로 보는 이 description을 조여서야 멈췄다. 그런데 그 문구를
// 잠그는 테스트가 0개라 지워도 전 스위트가 GREEN이었다 — 실기로 검증된 유일한 1차 억제가 무방비였다.
// 문구 표현은 튜닝 가능하되(다른 어휘로 바꿔도 됨) **"이 조건에선 부르지 마라"와 "값을 추측하지 마라"
// 두 축이 사라지면 RED**가 되도록 각 축의 핵심 어휘만 잡는다. LLM 행위라 자동 검증 수단이 없으므로,
// 문구를 바꿀 땐 실기(전/후 대조)로 재확인할 것.
test("search_customers 선언이 오라우팅 억제 문구를 유지한다(#315 실기 산출물)", () => {
  const decl = ASSISTANT_TOOL_DECLARATIONS.find((d) => d.name === "search_customers");
  expect(decl).toBeDefined();
  const params = decl!.parameters as { properties: Record<string, { description?: string }> };

  // 축 1 — 지원 필터 밖 조건이면 호출 자체를 하지 마라(부정 예시 포함이 실기에서 결정적이었다).
  expect(decl!.description).toContain("관심 차종");
  expect(decl!.description).toContain("호출하지 마라");

  // 축 2 — 질문에 없는 값을 지어내지 마라(파라미터 자리에서 말해야 먹힌다).
  const guarded = ["statusGroup", "purchaseMethod", "source"].filter(
    (k) => params.properties[k]?.description?.includes("명시한 경우에만"),
  );
  expect(guarded).toEqual(["statusGroup", "purchaseMethod", "source"]);
  expect(params.properties.statusGroup?.description).toContain("추측해 채우지 마라");
});

// 라우터 프롬프트 쪽 하드닝 잠금(배치 15 M5) — 위 description 잠금과 **같은 두 축**을 프롬프트에서도 잠근다.
// 왜 둘 다 잠그나: 배치 15가 실 Gemini로 절제 실험을 돌려 두 축이 **중복 방어**임을 확인했다(2회 반복 동일)
// — 어느 한쪽만 지우면 3/3 안전하고, **둘 다 지워야** `"마이바흐 관심 고객이 누구야?"`에서
// `search_customers{name:"마이바흐"}` 날조가 재현된다. 그래서 프롬프트 축이 사라져도 **당장은 증상이 없고**,
// `ef45ebb`가 description만 잠근 상태에서는 이쪽을 통째로 지워도 전 스위트가 GREEN이었다. 무음으로 한 겹이
// 빠진 뒤 나머지 한 겹까지 건드리면 방어가 한 번에 사라지므로, 두 겹을 각각 잠가 둔다.
// description 잠금과 같은 원칙: **문구 표현은 튜닝 가능하되 두 축의 핵심 어휘가 사라지면 RED**.
test("ROUTER_SYSTEM_PROMPT가 오라우팅 억제 2축을 유지한다(배치 15 M5)", () => {
  // 축 1 — 파라미터 날조 금지.
  expect(ROUTER_SYSTEM_PROMPT).toContain("지어내지 마세요");

  // 축 2 — 지원 필터로 표현할 수 없는 조건이면 호출 자체를 하지 마라(부정 예시 "관심 차종" 포함이
  // 실기에서 결정적이었다 — `#315`).
  expect(ROUTER_SYSTEM_PROMPT).toContain("관심 차종");
  expect(ROUTER_SYSTEM_PROMPT).toContain("함수를 호출하지 말고");
});
