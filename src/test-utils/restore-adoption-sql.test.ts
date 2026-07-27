import { expect, test } from "bun:test";

import { restoreAdoptionSql, type FixtureResidue } from "./fixture-residue";

// 고아 채택 되돌리기 SQL 조립 — **순수 함수라 이 파일은 DB에 붙지 않는다**(그래서 test:pure가 돌린다).
// 형제 파일 `fixture-residue.test.ts`는 getDefaultDb를 쓰므로 db-bound registry에 있어 CI에서 빠진다 —
// 이 로직은 잘못되면 앱 고객에게 보이는 확정 할인을 엉뚱한 값으로 되돌리므로 CI 그물 안에 둔다.

const row = (
  over: Partial<FixtureResidue["orphanAdoptions"][number]>,
): FixtureResidue["orphanAdoptions"][number] => ({
  trimId: 250,
  field: "financial",
  previousAmount: 6_500_000,
  adoptedAt: "2026-07-27 10:00:00+00",
  ...over,
});

test("3필드가 각자의 catalog.trims 컬럼으로 매핑된다", () => {
  const out = restoreAdoptionSql([
    row({ field: "financial", previousAmount: 1 }),
    row({ field: "partner", previousAmount: 2 }),
    row({ field: "cash", previousAmount: 3 }),
  ]).join("\n");
  expect(out).toContain("set financial_discount_amount = 1 where id = 250;");
  expect(out).toContain("set partner_discount_amount = 2 where id = 250;");
  expect(out).toContain("set cash_discount_amount = 3 where id = 250;");
});

test("같은 (트림, 필드)가 여러 번 채택되면 가장 오래된 previous_amount를 쓴다", () => {
  // 두 번째 채택의 previous_amount(9,000,000)는 이미 첫 채택이 넣은 테스트 값이다 —
  // 그걸 복원하면 오염이 그대로 남는다. 입력은 adopted_at 오름차순으로 들어온다.
  const out = restoreAdoptionSql([
    row({ previousAmount: 6_500_000, adoptedAt: "2026-07-27 10:00:00+00" }),
    row({ previousAmount: 9_000_000, adoptedAt: "2026-07-27 11:00:00+00" }),
  ]);
  const updates = out.filter((l) => l.includes("update catalog.trims"));
  expect(updates).toHaveLength(1);
  expect(updates[0]).toContain("= 6500000");
});

test("비움을 채택했던 경우 null로 되돌린다", () => {
  expect(restoreAdoptionSql([row({ previousAmount: null })]).join("\n")).toContain(
    "set financial_discount_amount = null where id = 250;",
  );
});

test("서로 다른 트림·필드는 각각 한 줄씩 나온다", () => {
  const out = restoreAdoptionSql([
    row({ trimId: 250, field: "financial" }),
    row({ trimId: 250, field: "partner" }),
    row({ trimId: 694, field: "financial" }),
  ]).filter((l) => l.includes("update catalog.trims"));
  expect(out).toHaveLength(3);
});

test("알 수 없는 field는 SQL을 만들지 않고 수동 확인으로 넘긴다(CHECK 우회·스키마 변경 대비)", () => {
  const out = restoreAdoptionSql([row({ field: "bogus" })]).join("\n");
  expect(out).not.toContain("update catalog.trims");
  expect(out).toContain("알 수 없는 field 'bogus'");
});

test("감사 행 정리는 되돌리기 뒤에 오도록 안내된다(순서가 뒤집히면 복원 근거가 사라진다)", () => {
  const out = restoreAdoptionSql([row({})]);
  const updateAt = out.findIndex((l) => l.includes("update catalog.trims"));
  const deleteAt = out.findIndex((l) => l.includes("delete from crm.catalog_discount_adoptions"));
  expect(updateAt).toBeGreaterThanOrEqual(0);
  expect(deleteAt).toBeGreaterThan(updateAt);
});
