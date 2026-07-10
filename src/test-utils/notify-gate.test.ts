import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../db/client";
import { guardedDb } from "./notify-gate";

const db = getDefaultDb();

// 알림 가드의 스위치는 트랜잭션 스코프 GUC 하나뿐이다 — 그 값이 실제로 켜지는지만 본다.
// (알림 트리거가 달린 public 테이블은 여기서 전혀 건드리지 않는다.)
async function readSkipNotify(ex: Executor): Promise<string | null> {
  const rows = await ex.execute(sql`select current_setting('app.skip_notify', true) as v`);
  return (rows[0] as { v: string | null } | undefined)?.v ?? null;
}

test("guardedDb: 열리는 모든 트랜잭션에서 app.skip_notify='on'", async () => {
  const guarded = guardedDb(db);
  const v = await guarded.transaction((tx) => readSkipNotify(tx));
  expect(v).toBe("on");
});

test("guardedDb: 반환값·인자를 그대로 전파(트랜잭션 계약 불변)", async () => {
  const guarded = guardedDb(db);
  const result = await guarded.transaction(async (tx) => {
    const rows = await tx.execute(sql`select 42 as answer`);
    return (rows[0] as { answer: number }).answer;
  });
  expect(result).toBe(42);
});

test("guardedDb: 롤백 계약 불변(콜백이 throw하면 트랜잭션도 throw)", async () => {
  const guarded = guardedDb(db);
  expect(
    guarded.transaction(async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
});

test("guardedDb: transaction 외 메서드는 원본에 그대로 위임", async () => {
  const guarded = guardedDb(db);
  const rows = await guarded.execute(sql`select 1 as one`);
  expect((rows[0] as { one: number }).one).toBe(1);
});

// 대조군 — 가드하지 않은 db의 트랜잭션에는 GUC가 없다. 이게 'on'이면 위 테스트는
// guardedDb가 아니라 세션에 눌러붙은 값(=다른 커넥션의 진짜 알림을 묻는 상태)을 보고 있는 것이다.
test("맨 db: 트랜잭션 안에서 app.skip_notify는 켜져 있지 않다(세션 잔류 없음)", async () => {
  const v = await db.transaction((tx) => readSkipNotify(tx));
  expect(v).not.toBe("on");
});
