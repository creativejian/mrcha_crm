import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getCustomer, listCustomers, updateCustomer } from "../db/queries/customers";
import {
  addMemo, updateMemo, deleteMemo,
  addTask, updateTask, deleteTask,
  addSchedule, updateSchedule, deleteSchedule,
} from "../db/queries/customer-children";
import type { DbVariables } from "../middleware/db";

export const customers = new Hono<{ Variables: DbVariables }>();

// 쓰기 가능 컬럼(전부 optional·문자열 nullable). 값 enum 검증 없음(추후 사이클).
export const customerWriteSchema = z.object({
  phone: z.string().nullable().optional(),
  residence: z.string().nullable().optional(),
  customerType: z.string().nullable().optional(),
  customerTypeDetail: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  statusGroup: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  chance: z.string().nullable().optional(),
  needModel: z.string().nullable().optional(),
  needTrim: z.string().nullable().optional(),
  needColors: z.string().nullable().optional(),
  needMethod: z.string().nullable().optional(),
  needTiming: z.string().nullable().optional(),
  needMemo: z.string().nullable().optional(),
});

customers.get("/", async (c) => c.json(await listCustomers(c.var.db)));

customers.get("/:id", zValidator("param", z.object({ id: z.uuid() })), async (c) => {
  const row = await getCustomer(c.req.valid("param").id, c.var.db);
  return row ? c.json(row) : c.json({ error: "고객을 찾을 수 없습니다." }, 404);
});

customers.patch(
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  zValidator("json", customerWriteSchema),
  async (c) => {
    const row = await updateCustomer(c.req.valid("param").id, c.req.valid("json"), c.var.db);
    return row ? c.json(row) : c.json({ error: "고객을 찾을 수 없습니다." }, 404);
  },
);

// ── 자식 컬렉션 CRUD (메모/할일/일정) ──────────────────────────────
const idParam = z.object({ id: z.uuid() });
const childParam = z.object({ id: z.uuid(), childId: z.uuid() });
const memoBody = z.object({ body: z.string().nullable().optional() });
const taskBody = z.object({ category: z.string().nullable().optional(), due: z.string().nullable().optional(), body: z.string().nullable().optional(), done: z.boolean().optional() });
const scheduleBody = z.object({ scheduledDate: z.string().nullable().optional(), scheduledTime: z.string().nullable().optional(), type: z.string().nullable().optional(), memo: z.string().nullable().optional(), done: z.boolean().optional() });

customers.post("/:id/memos", zValidator("param", idParam), zValidator("json", memoBody), async (c) =>
  c.json(await addMemo(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/memos/:childId", zValidator("param", childParam), zValidator("json", memoBody), async (c) => {
  const p = c.req.valid("param");
  const row = await updateMemo(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "메모를 찾을 수 없습니다." }, 404);
});
customers.delete("/:id/memos/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteMemo(p.id, p.childId, c.var.db);
  return row ? c.json(row) : c.json({ error: "메모를 찾을 수 없습니다." }, 404);
});

customers.post("/:id/tasks", zValidator("param", idParam), zValidator("json", taskBody), async (c) =>
  c.json(await addTask(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/tasks/:childId", zValidator("param", childParam), zValidator("json", taskBody), async (c) => {
  const p = c.req.valid("param");
  const row = await updateTask(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "할 일을 찾을 수 없습니다." }, 404);
});
customers.delete("/:id/tasks/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteTask(p.id, p.childId, c.var.db);
  return row ? c.json(row) : c.json({ error: "할 일을 찾을 수 없습니다." }, 404);
});

customers.post("/:id/schedules", zValidator("param", idParam), zValidator("json", scheduleBody), async (c) =>
  c.json(await addSchedule(c.req.valid("param").id, c.req.valid("json"), c.var.db), 201));
customers.patch("/:id/schedules/:childId", zValidator("param", childParam), zValidator("json", scheduleBody), async (c) => {
  const p = c.req.valid("param");
  const row = await updateSchedule(p.id, p.childId, c.req.valid("json"), c.var.db);
  return row ? c.json(row) : c.json({ error: "일정을 찾을 수 없습니다." }, 404);
});
customers.delete("/:id/schedules/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteSchedule(p.id, p.childId, c.var.db);
  return row ? c.json(row) : c.json({ error: "일정을 찾을 수 없습니다." }, 404);
});
