import { beforeEach, describe, expect, it, vi } from "vitest";

// ── supabase mock: 체이너블 쿼리 빌더(thenable) ─────────────────────────────
type QueryCall = { method: string; args: unknown[] };
type QueryResult = { data: unknown; error: unknown };

class QueryMock implements PromiseLike<QueryResult> {
  calls: QueryCall[] = [];
  constructor(public table: string, private result: QueryResult) {}
  private chain(method: string) {
    return (...args: unknown[]): QueryMock => {
      this.calls.push({ method, args });
      return this;
    };
  }
  select = this.chain("select");
  insert = this.chain("insert");
  update = this.chain("update");
  eq = this.chain("eq");
  neq = this.chain("neq");
  in = this.chain("in");
  or = this.chain("or");
  order = this.chain("order");
  limit = this.chain("limit");
  single = this.chain("single");
  then<T1 = QueryResult, T2 = never>(
    onfulfilled?: ((value: QueryResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
  /** 특정 메서드 호출의 첫 인자를 꺼낸다 (없으면 undefined) */
  argOf(method: string): unknown {
    return this.calls.find((c) => c.method === method)?.args[0];
  }
}

const queue: QueryMock[] = [];
function enqueue(table: string, result: QueryResult): QueryMock {
  const q = new QueryMock(table, result);
  queue.push(q);
  return q;
}

vi.mock("./supabase", () => ({
  supabase: {
    from: (table: string) => {
      const next = queue.shift();
      if (!next) throw new Error(`unexpected from(${table})`);
      if (next.table !== table) throw new Error(`expected from(${next.table}), got from(${table})`);
      return next;
    },
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { sub: "staff-1" } } })) },
  },
}));

import {
  assignSession,
  fetchChatMessages,
  fetchChatSessions,
  getStaffId,
  returnSessionToAi,
  sendStaffMessage,
  takeOverSession,
  type ChatMessageRow,
  type ChatSessionRow,
} from "./chat";
import { CHAT_SYSTEM_MSG_RETURN, CHAT_SYSTEM_MSG_TAKEOVER } from "@/data/chat";

const sessionRow: ChatSessionRow = {
  id: "s1", user_id: "u1", mode: "pending",
  assigned_staff_id: null, assigned_at: null,
  created_at: "2026-07-02T09:00:00+00:00", updated_at: "2026-07-02T10:00:00+00:00",
  profiles: { full_name: "김민준", email: null, role: "customer" },
};
const msgRow: ChatMessageRow = {
  id: "m1", user_id: "u1", message: "hi", is_user: true, sender_type: "user",
  session_id: "s1", staff_id: null,
  attachment_url: null, attachment_width: null, attachment_height: null,
  created_at: "2026-07-02T10:00:00+00:00",
};

beforeEach(() => {
  queue.length = 0;
});

describe("fetchChatSessions", () => {
  it("profiles 조인 select + updated_at desc, role!=customer는 클라이언트에서 걸러낸다", async () => {
    const staffRow = { ...sessionRow, id: "s2", profiles: { full_name: "관리자", email: null, role: "admin" } };
    const q = enqueue("chat_sessions", { data: [sessionRow, staffRow], error: null });
    const sessions = await fetchChatSessions();
    expect(q.argOf("select")).toBe("*, profiles!chat_sessions_user_id_fkey(full_name, email, role, avatar_url)");
    expect(q.calls.find((c) => c.method === "order")?.args).toEqual(["updated_at", { ascending: false }]);
    expect(sessions.map((s) => s.id)).toEqual(["s1"]);
  });
});

describe("fetchChatMessages", () => {
  it("user_id 기준 최신 50건을 과거→최신으로 뒤집어 반환한다", async () => {
    const older = { ...msgRow, id: "m0", created_at: "2026-07-02T09:59:00+00:00" };
    const q = enqueue("chat_messages", { data: [msgRow, older], error: null });
    const msgs = await fetchChatMessages("u1");
    expect(q.argOf("eq")).toBe("user_id");
    expect(q.argOf("limit")).toBe(50);
    expect(q.calls.some((c) => c.method === "or")).toBe(false);
    expect(msgs.map((m) => m.id)).toEqual(["m0", "m1"]);
  });
  it("cursor가 있으면 created_at/id 복합 커서 or 필터를 건다", async () => {
    const q = enqueue("chat_messages", { data: [], error: null });
    await fetchChatMessages("u1", { createdAt: "2026-07-02T09:00:00+00:00", id: "m0" });
    expect(q.argOf("or")).toBe(
      'created_at.lt."2026-07-02T09:00:00+00:00",and(created_at.eq."2026-07-02T09:00:00+00:00",id.lt.m0)',
    );
  });
});

describe("sendStaffMessage", () => {
  it("앱 미러 payload로 insert하고 반환 row를 매핑한다", async () => {
    const returned = { ...msgRow, id: "m9", sender_type: "staff", is_user: false, staff_id: "staff-1" };
    const q = enqueue("chat_messages", { data: returned, error: null });
    const sent = await sendStaffMessage({ userId: "u1", sessionId: "s1", staffId: "staff-1", message: "안녕하세요" });
    expect(q.argOf("insert")).toEqual({
      user_id: "u1", session_id: "s1", message: "안녕하세요",
      is_user: false, sender_type: "staff", staff_id: "staff-1",
    });
    expect(sent.senderKind).toBe("staff");
  });
});

describe("takeOverSession", () => {
  it("human 전환 update(neq human 가드) 후 system 메시지를 넣는다 — 이 순서", async () => {
    const upd = enqueue("chat_sessions", { data: [sessionRow], error: null });
    const sys = enqueue("chat_messages", { data: null, error: null });
    const ok = await takeOverSession({ id: "s1", userId: "u1" }, "staff-1");
    expect(ok).toBe(true);
    const payload = upd.argOf("update") as Record<string, unknown>;
    expect(payload.mode).toBe("human");
    expect(payload.assigned_staff_id).toBe("staff-1");
    expect(typeof payload.assigned_at).toBe("string"); // 클라이언트 ISO(앱 미러)
    expect(upd.calls.find((c) => c.method === "neq")?.args).toEqual(["mode", "human"]);
    expect(sys.argOf("insert")).toEqual({
      user_id: "u1", session_id: "s1", message: CHAT_SYSTEM_MSG_TAKEOVER,
      is_user: false, sender_type: "system",
    });
  });
  it("이미 다른 상담원이 인수했으면(update 0행) false, system 메시지 없음", async () => {
    enqueue("chat_sessions", { data: [], error: null });
    const ok = await takeOverSession({ id: "s1", userId: "u1" }, "staff-1");
    expect(ok).toBe(false);
    expect(queue).toHaveLength(0); // chat_messages from() 호출 안 함
  });
  it("system 메시지 실패는 인수를 무르지 않는다(앱 미러)", async () => {
    enqueue("chat_sessions", { data: [sessionRow], error: null });
    enqueue("chat_messages", { data: null, error: { message: "network" } });
    const ok = await takeOverSession({ id: "s1", userId: "u1" }, "staff-1");
    expect(ok).toBe(true);
  });
});

describe("returnSessionToAi", () => {
  it("system 메시지 먼저, 세션 초기화(assigned null clear) 나중 — 앱 순서 미러", async () => {
    const sys = enqueue("chat_messages", { data: null, error: null });
    const upd = enqueue("chat_sessions", { data: null, error: null });
    await returnSessionToAi({ id: "s1", userId: "u1" });
    expect(sys.argOf("insert")).toEqual({
      user_id: "u1", session_id: "s1", message: CHAT_SYSTEM_MSG_RETURN,
      is_user: false, sender_type: "system",
    });
    expect(upd.argOf("update")).toEqual({ mode: "ai", assigned_staff_id: null, assigned_at: null });
  });
});

describe("assignSession", () => {
  it("mode는 건드리지 않고 배정 필드만 갱신한다", async () => {
    const upd = enqueue("chat_sessions", { data: null, error: null });
    await assignSession("s1", "staff-2");
    const payload = upd.argOf("update") as Record<string, unknown>;
    expect(payload.mode).toBeUndefined();
    expect(payload.assigned_staff_id).toBe("staff-2");
    expect(typeof payload.assigned_at).toBe("string");
  });
});

describe("getStaffId", () => {
  it("getStaffId는 JWT claims sub를 반환한다", async () => {
    expect(await getStaffId()).toBe("staff-1");
  });
});
