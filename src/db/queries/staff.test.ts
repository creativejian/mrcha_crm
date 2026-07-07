import { test, expect } from "bun:test";
import { sql } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { profiles } from "../public-app";
import { getStaffName } from "./staff";

const db = getDefaultDb();

// 실 쿼리 본체 스모크 — 라우트 테스트는 ragFakes가 getStaffName을 상시 스텁해서 실 함수가 어떤 테스트도
// 지나지 않았다. 공백 이름 → null 폴백(trim || null)이 유일한 로직.
test("getStaffName: 실 profile은 트림된 이름, 없는 uuid는 null — 실 DB", async () => {
  const [p] = await db
    .select({ id: profiles.id, name: profiles.fullName })
    .from(profiles)
    .where(sql`btrim(coalesce(${profiles.fullName}, '')) <> ''`)
    .limit(1);
  expect(p).toBeDefined(); // master에 이름 있는 계정 상존(자메스관리자 등)
  expect(await getStaffName(p.id, db)).toBe(p.name!.trim());
  expect(await getStaffName(crypto.randomUUID(), db)).toBeNull();
});
