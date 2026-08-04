import { test, expect, afterAll } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { assistantMessages } from "../schema";
import {
  deleteAssistantMessage,
  insertAssistantMessages,
  listRecentMessages,
  purgeAssistantMessagesOlderThan,
  updateAssistantMessage,
} from "./assistant-messages";

const db = getDefaultDb();
const STAFF = "cccccccc-cccc-cccc-cccc-cccccccccccc";

afterAll(async () => { await db.delete(assistantMessages).where(eq(assistantMessages.staffUserId, STAFF)); });

test("insertAssistantMessages: user+assistant 원자 저장, createdAt 순서 보존", async () => {
  const now = new Date();
  const saved = await insertAssistantMessages([
    { staffUserId: STAFF, role: "user", content: "질문1", sources: null, createdAt: now },
    { staffUserId: STAFF, role: "assistant", content: "답1", sources: [{ customerId: "x" }], createdAt: new Date(now.getTime() + 1) },
  ], db);
  expect(saved).toHaveLength(2);
});

test("listRecentMessages: 최근 N개 created_at 오름차순 반환", async () => {
  const rows = await listRecentMessages(STAFF, 10, db);
  expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  expect(rows[0].content).toBe("질문1");
  expect(rows[1].content).toBe("답1");
});

test("listRecentMessages: limit 초과분은 최신 우선으로 잘림", async () => {
  const base = new Date();
  await insertAssistantMessages(
    Array.from({ length: 4 }, (_, i) => ({ staffUserId: STAFF, role: "user" as const, content: `m${i}`, sources: null, createdAt: new Date(base.getTime() + 100 + i) })),
    db,
  );
  const rows = await listRecentMessages(STAFF, 2, db);
  expect(rows).toHaveLength(2);
  expect(rows[1].content).toBe("m3"); // 가장 최신이 마지막
});

test("listRecentMessages: before 커서로 더 오래된 페이지 로드(중복/누락 없음)", async () => {
  const S = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const base = new Date();
  await insertAssistantMessages(
    Array.from({ length: 5 }, (_, i) => ({ staffUserId: S, role: "user" as const, content: `p${i}`, sources: null, createdAt: new Date(base.getTime() + i) })),
    db,
  );
  const page1 = await listRecentMessages(S, 2, db); // 최신 2개(p3,p4) 오름차순
  expect(page1.map((r) => r.content)).toEqual(["p3", "p4"]);
  const oldestOfPage1 = page1[0]; // p3
  const page2 = await listRecentMessages(S, 2, db, { createdAt: oldestOfPage1.createdAt, id: oldestOfPage1.id }); // p3보다 오래된 2개(p1,p2)
  expect(page2.map((r) => r.content)).toEqual(["p1", "p2"]);
  await db.delete(assistantMessages).where(eq(assistantMessages.staffUserId, S));
});

test("updateAssistantMessage: 본인 것만 갱신, 타 staff는 null·미변경", async () => {
  const S = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const [saved] = await insertAssistantMessages([
    { staffUserId: S, role: "assistant", content: "", sources: null, createdAt: new Date() },
  ], db);
  // 타 staff로는 갱신 불가(null 반환·원본 미변경)
  const denied = await updateAssistantMessage(saved.id, OTHER, "탈취", [{ customerId: "y" }], db);
  expect(denied).toBeNull();
  const [untouched] = await db.select().from(assistantMessages).where(eq(assistantMessages.id, saved.id));
  expect(untouched.content).toBe("");
  expect(untouched.sources).toBeNull();
  // 본인 staff로는 내용·출처 확정
  const updated = await updateAssistantMessage(saved.id, S, "완성된 답변", [{ customerId: "x" }], db);
  expect(updated?.content).toBe("완성된 답변");
  expect(updated?.sources).toEqual([{ customerId: "x" }]);
  await db.delete(assistantMessages).where(eq(assistantMessages.staffUserId, S));
});

test("deleteAssistantMessage: 삽입한 placeholder가 삭제돼 조회되지 않음", async () => {
  const S = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const [saved] = await insertAssistantMessages([
    { staffUserId: S, role: "assistant", content: "", sources: null, createdAt: new Date() },
  ], db);
  await deleteAssistantMessage(saved.id, S, db);
  const rows = await db.select().from(assistantMessages).where(eq(assistantMessages.id, saved.id));
  expect(rows).toHaveLength(0);
});

// 30일 rolling retention(2026-08-04, 회원탈퇴 계약 §7) — 경계가 DB 시계 기준으로 정확한지.
// ⚠️ **반드시 트랜잭션 롤백 안에서** 돌린다: purge는 staff 필터가 없는 **전역 삭제**라(그게
// 프로덕션에서 맞는 동작이다) 그냥 부르면 공유 master의 실제 직원 대화를 지운다.
// 같은 이유로 "몇 행 지워졌나"는 단언하지 않는다 — 반환값에 남의 실 데이터가 섞인다.
// 잠그는 것은 **내 픽스처 2행의 운명**(경계 밖은 사라지고 경계 안은 남는다)이다.
const ROLLBACK = "__rollback__";

test("purgeAssistantMessagesOlderThan: 기한 경과분만 파기하고 기한 내는 남긴다", async () => {
  const staff = crypto.randomUUID();
  await expect(
    db.transaction(async (tx) => {
      const [old, fresh] = await insertAssistantMessages(
        [
          // 31일 전 = 경과(파기 대상) · 29일 전 = 기한 내(보존). 경계 하루 안팎을 함께 둬
          // "30일"이 실제로 30일인지 잠근다(오프바이원이면 둘 중 하나가 뒤집힌다).
          { staffUserId: staff, role: "user", content: "오래된 질문", sources: null, createdAt: daysAgo(31) },
          { staffUserId: staff, role: "user", content: "최근 질문", sources: null, createdAt: daysAgo(29) },
        ],
        tx,
      );
      await purgeAssistantMessagesOlderThan(30, tx);
      const left = await tx
        .select({ id: assistantMessages.id })
        .from(assistantMessages)
        .where(inArray(assistantMessages.id, [old!.id, fresh!.id]));
      expect(left.map((r) => r.id)).toEqual([fresh!.id]);
      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
