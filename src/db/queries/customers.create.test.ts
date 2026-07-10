import { expect, test } from "bun:test";

import { getDefaultDb } from "../client";
import { createCustomerManual } from "./customers";

const db = getDefaultDb();

// 실 master지만 전 케이스 트랜잭션 롤백 — 잔재 0 (fixture-residue.test.ts 검사기 검증과 같은 패턴).
// advisor id는 loose id(FK 없음)라 임의 uuid로 충분하다.
const ADVISOR = { id: "3f6a7f7e-90d1-4f7a-b6a1-000000000001", name: "테스트상담사" };

function rollbackOnly(e: unknown): void {
  if (!(e instanceof Error) || e.message !== "rollback") throw e;
}

test("createCustomerManual: 채번 형식 + 시드 3필드 + 등록자 자동 배정", async () => {
  await db
    .transaction(async (tx) => {
      const row = await createCustomerManual(
        { name: "수기등록테스트", phone: "01099887766", source: "소개", advisor: ADVISOR },
        tx,
      );
      expect(row.customerCode).toMatch(/^CU-\d{4}-\d{4}$/);
      expect(row.name).toBe("수기등록테스트");
      expect(row.phone).toBe("01099887766");
      expect(row.source).toBe("소개");
      // 승격과 같은 시드 — 신규 고객은 목록 "신규/상담접수"로 나타난다.
      expect(row.statusGroup).toBe("신규");
      expect(row.status).toBe("상담접수");
      expect(row.receivedAt).not.toBeNull();
      // 자동 배정 — 이름·id·배정시각 동반(PATCH의 "이름과 id 동반" 규칙과 정합).
      expect(row.advisorId).toBe(ADVISOR.id);
      expect(row.advisorName).toBe(ADVISOR.name);
      expect(row.assignedAt).not.toBeNull();
      throw new Error("rollback");
    })
    .catch(rollbackOnly);
});

test("createCustomerManual: advisor null이면 미배정으로 생성(fail-open)", async () => {
  await db
    .transaction(async (tx) => {
      const row = await createCustomerManual({ name: "수기등록테스트", advisor: null }, tx);
      expect(row.advisorId).toBeNull();
      expect(row.advisorName).toBeNull();
      expect(row.assignedAt).toBeNull();
      expect(row.phone).toBeNull();
      expect(row.source).toBeNull();
      throw new Error("rollback");
    })
    .catch(rollbackOnly);
});
