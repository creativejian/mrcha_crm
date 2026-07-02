# CRM 실시간 상담 (앱 채팅 상담원 콘솔) v1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ChatPage.tsx` 목업(61줄)을 실동작 상담원 콘솔로 교체 — 앱 고객 채팅(public.chat_sessions/chat_messages)을 staff JWT + RLS + Supabase Realtime으로 직접 read/write.

**Architecture:** 프론트 supabase-js 직결(백엔드·DDL 변경 0). 앱 레포 admin 섹션(`handoff_provider.dart` 등)의 웹 포팅 — payload·문구·전이 순서를 그대로 미러. 순수 로직은 `lib/chat.ts`에 두고 TDD, 컴포넌트는 수동 검증(프로젝트 관례).

**Tech Stack:** React + supabase-js v2(기존 `client/src/lib/supabase.ts`), vitest, 기존 chat-* CSS 재사용.

**Spec:** `ref/specs/2026-07-02-crm-realtime-chat-design.md`

**전제/주의:**
- 이 spec/plan 문서 2개는 현재 untracked 상태(작성 세션에서 커밋 금지 지시). 구현 세션의 Task 1 커밋에 포함할 것.
- SSOT는 앱 레포 `/Users/tobedoit/Documents/Flutter/mr-cha-app` (`lib/core/constants/app_status.dart`, `handoff_provider.dart`, `chat_session_repository.dart`, `supabase_chat_repository.dart`). 아래 payload/문구는 2026-07-02 실측 추출값.
- profiles RLS 실측: "Profiles viewable by self or staff"(`auth.uid()=id OR private.is_staff()`) → staff 계정이 배정용 프로필 목록 SELECT 가능(확인됨).
- 백엔드 `listCustomers`는 `getTableColumns(customers)` 스프레드라 `appUserId`가 이미 응답에 포함 → 백엔드 변경 없음, 프론트 타입에만 추가(Task 6).

---

### Task 1: 브랜치 준비 + 설계 문서 커밋

**Files:**
- Commit: `ref/specs/2026-07-02-crm-realtime-chat-design.md`, `ref/plans/2026-07-02-crm-realtime-chat.md`

- [ ] **Step 1: main 최신화 후 브랜치 생성**

```bash
git checkout main && git pull
git checkout -b feat/crm-realtime-chat
```

- [ ] **Step 2: 설계 문서 커밋** (`[skip ci]` 금지 — squash 전파 사고 이력)

```bash
git add ref/specs/2026-07-02-crm-realtime-chat-design.md ref/plans/2026-07-02-crm-realtime-chat.md
git commit -m "docs(crm): 실시간 상담(앱 채팅 콘솔) v1 설계+계획"
```

---

### Task 2: 미러 상수 (`client/src/data/chat.ts`)

**Files:**
- Create: `client/src/data/chat.ts`

순수 상수라 테스트 없음(프로젝트 관례: 계산 로직만 TDD).

- [ ] **Step 1: 상수 파일 작성**

```ts
// 앱 채팅 세션/메시지 상수 미러. SSOT = 앱 레포 mr-cha-app:
//   lib/core/constants/app_status.dart (mode 값), chat_messages CHECK 제약 (sender_type 값).
// CRM은 값만 미러하고 라벨은 콘솔 관점으로 따로 둔다. 앱 스키마 변경 시 여기부터 맞출 것.
export const CHAT_SESSION_MODES = ["ai", "pending", "human"] as const;
export type ChatSessionMode = (typeof CHAT_SESSION_MODES)[number];

// 콘솔 표시 라벨(앱 고객측 라벨과 다름 — 상담원 관점).
export const CHAT_MODE_LABELS: Record<ChatSessionMode, string> = {
  pending: "상담원 연결 요청",
  human: "상담원 상담중",
  ai: "AI 상담중",
};

// 큐 탭 순서: 요청이 가장 급하므로 pending 먼저.
export const CHAT_QUEUE_TABS = ["all", "pending", "human", "ai"] as const;
export type ChatQueueTab = (typeof CHAT_QUEUE_TABS)[number];
export const CHAT_TAB_LABELS: Record<ChatQueueTab, string> = {
  all: "전체",
  pending: CHAT_MODE_LABELS.pending,
  human: CHAT_MODE_LABELS.human,
  ai: CHAT_MODE_LABELS.ai,
};

export const CHAT_SENDER_TYPES = ["user", "ai", "staff", "system"] as const;
export type ChatSenderType = (typeof CHAT_SENDER_TYPES)[number];

// 앱 admin 미러 system 문구 (handoff_provider.dart:85, :96 원문 그대로 — 변경 금지).
export const CHAT_SYSTEM_MSG_TAKEOVER = "상담원이 대화에 참여했습니다.";
export const CHAT_SYSTEM_MSG_RETURN = "상담원이 퇴장했습니다. 차선생이 대화를 이어갑니다.";
```

- [ ] **Step 2: typecheck 후 커밋**

```bash
bun run typecheck
git add client/src/data/chat.ts
git commit -m "feat(crm): 채팅 상수 미러(data/chat.ts) — SSOT=앱 app_status"
```

---

### Task 3: 순수 유틸 + row 매퍼 (`client/src/lib/chat.ts` 1부, TDD)

**Files:**
- Create: `client/src/lib/chat.ts`
- Test: `client/src/lib/chat.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// client/src/lib/chat.test.ts
import { describe, expect, it } from "vitest";
import {
  mergeMessages,
  senderKindOf,
  toChatMessage,
  toChatSession,
  waitingLabel,
  type ChatMessage,
  type ChatMessageRow,
  type ChatSessionRow,
} from "./chat";

const baseMsgRow: ChatMessageRow = {
  id: "m1",
  user_id: "u1",
  message: "hi",
  is_user: true,
  sender_type: "user",
  session_id: null,
  staff_id: null,
  attachment_url: null,
  attachment_width: null,
  attachment_height: null,
  created_at: "2026-07-02T10:00:00+00:00",
};

describe("senderKindOf", () => {
  it("staff/system은 sender_type이 우선한다", () => {
    expect(senderKindOf({ ...baseMsgRow, sender_type: "staff", is_user: false })).toBe("staff");
    expect(senderKindOf({ ...baseMsgRow, sender_type: "system", is_user: false })).toBe("system");
  });
  it("구세대 AI quirk: sender_type='user'+is_user=false는 ai다", () => {
    expect(senderKindOf({ ...baseMsgRow, sender_type: "user", is_user: false })).toBe("ai");
  });
  it("고객: is_user=true", () => {
    expect(senderKindOf(baseMsgRow)).toBe("customer");
  });
});

describe("toChatSession", () => {
  it("profiles 조인에서 고객명을 뽑고 없으면 email→'고객' 폴백", () => {
    const row: ChatSessionRow = {
      id: "s1", user_id: "u1", mode: "pending",
      assigned_staff_id: null, assigned_at: null,
      created_at: "2026-07-02T09:00:00+00:00", updated_at: "2026-07-02T10:00:00+00:00",
      profiles: { full_name: "김민준", email: "kim@x.com", role: "customer" },
    };
    expect(toChatSession(row).customerName).toBe("김민준");
    expect(toChatSession({ ...row, profiles: { full_name: null, email: "kim@x.com", role: "customer" } }).customerName).toBe("kim@x.com");
    expect(toChatSession({ ...row, profiles: null }).customerName).toBe("고객");
  });
  it("알 수 없는 mode는 ai로 폴백한다", () => {
    const row: ChatSessionRow = {
      id: "s1", user_id: "u1", mode: "weird",
      assigned_staff_id: null, assigned_at: null,
      created_at: "2026-07-02T09:00:00+00:00", updated_at: "2026-07-02T10:00:00+00:00",
      profiles: null,
    };
    expect(toChatSession(row).mode).toBe("ai");
  });
});

describe("waitingLabel", () => {
  const now = new Date("2026-07-02T10:30:00+00:00");
  it("분/시간/일 단위로 표시한다", () => {
    expect(waitingLabel("2026-07-02T10:29:30+00:00", now)).toBe("방금 전");
    expect(waitingLabel("2026-07-02T10:18:00+00:00", now)).toBe("12분 대기");
    expect(waitingLabel("2026-07-02T07:30:00+00:00", now)).toBe("3시간 대기");
    expect(waitingLabel("2026-06-30T10:30:00+00:00", now)).toBe("2일 대기");
  });
});

describe("mergeMessages", () => {
  const m = (id: string, createdAt: string): ChatMessage => toChatMessage({ ...baseMsgRow, id, created_at: createdAt });
  it("id로 dedupe하고 created_at→id 순으로 정렬한다", () => {
    const cur = [m("a", "2026-07-02T10:00:00+00:00"), m("b", "2026-07-02T10:01:00+00:00")];
    const merged = mergeMessages(cur, [m("b", "2026-07-02T10:01:00+00:00"), m("c", "2026-07-02T09:59:00+00:00")]);
    expect(merged.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("같은 id의 UPDATE는 기존 항목을 교체한다", () => {
    const cur = [m("a", "2026-07-02T10:00:00+00:00")];
    const updated = toChatMessage({ ...baseMsgRow, id: "a", message: "edited", created_at: "2026-07-02T10:00:00+00:00" });
    expect(mergeMessages(cur, [updated])[0].message).toBe("edited");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/chat.test.ts`
Expected: FAIL — `./chat` 모듈 없음.

- [ ] **Step 3: 최소 구현**

```ts
// client/src/lib/chat.ts
// 앱 채팅(public.chat_sessions/chat_messages) 콘솔용 순수 유틸 + supabase 데이터 접근.
// 미러 원본: mr-cha-app lib/data/repositories/{chat_session_repository,supabase_chat_repository}.dart,
// lib/presentation/providers/handoff_provider.dart. payload·문구·전이 순서를 임의로 바꾸지 말 것.
import { CHAT_SESSION_MODES, type ChatSessionMode } from "@/data/chat";

export type ChatSessionRow = {
  id: string;
  user_id: string;
  mode: string;
  assigned_staff_id: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
  profiles?: { full_name: string | null; email: string | null; role: string | null } | null;
};

export type ChatMessageRow = {
  id: string;
  user_id: string;
  message: string;
  is_user: boolean;
  sender_type: string;
  session_id: string | null;
  staff_id: string | null;
  attachment_url: string | null;
  attachment_width: number | null;
  attachment_height: number | null;
  created_at: string;
};

export type ChatSession = {
  id: string;
  userId: string;
  mode: ChatSessionMode;
  assignedStaffId: string | null;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  customerEmail: string | null;
};

export type ChatSenderKind = "customer" | "ai" | "staff" | "system";

export type ChatMessage = {
  id: string;
  userId: string;
  message: string;
  senderKind: ChatSenderKind;
  staffId: string | null;
  sessionId: string | null;
  attachmentUrl: string | null;
  attachmentWidth: number | null;
  attachmentHeight: number | null;
  createdAt: string;
};

// 발신자 판별. 구세대 quirk: sender_type 컬럼이 나중에 추가돼 AI 응답 4,383건이
// sender_type='user' + is_user=false로 저장돼 있다 → staff/system 외에는 is_user로 판별.
export function senderKindOf(row: Pick<ChatMessageRow, "sender_type" | "is_user">): ChatSenderKind {
  if (row.sender_type === "staff") return "staff";
  if (row.sender_type === "system") return "system";
  return row.is_user ? "customer" : "ai";
}

function toMode(raw: string): ChatSessionMode {
  return (CHAT_SESSION_MODES as readonly string[]).includes(raw) ? (raw as ChatSessionMode) : "ai";
}

export function toChatSession(row: ChatSessionRow): ChatSession {
  return {
    id: row.id,
    userId: row.user_id,
    mode: toMode(row.mode),
    assignedStaffId: row.assigned_staff_id,
    assignedAt: row.assigned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: row.profiles?.full_name ?? row.profiles?.email ?? "고객",
    customerEmail: row.profiles?.email ?? null,
  };
}

export function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    message: row.message,
    senderKind: senderKindOf(row),
    staffId: row.staff_id,
    sessionId: row.session_id,
    attachmentUrl: row.attachment_url,
    attachmentWidth: row.attachment_width,
    attachmentHeight: row.attachment_height,
    createdAt: row.created_at,
  };
}

// pending 대기시간 파생 표시(전용 컬럼 없음 — updated_at 경과. spec §3).
export function waitingLabel(sinceIso: string, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(sinceIso).getTime()) / 60000));
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 대기`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 대기`;
  return `${Math.floor(hours / 24)}일 대기`;
}

// Realtime echo/낙관 반영 병합: id dedupe(교체) + created_at→id 오름차순.
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/lib/chat.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/chat.ts client/src/lib/chat.test.ts
git commit -m "feat(crm): 채팅 순수 유틸(발신자 판별·대기시간·병합) TDD"
```

---

### Task 4: supabase 데이터 접근 (`client/src/lib/chat.ts` 2부, TDD)

**Files:**
- Modify: `client/src/lib/chat.ts` (Task 3 파일에 이어서 추가)
- Test: `client/src/lib/chat-data.test.ts` (mock이 커서 별도 파일)

핵심 검증 대상 = **insert/update payload가 앱과 byte-level로 같은가**. 앱 실측:
- takeOver(`chat_session_repository.dart:99-108`): `{mode:'human', assigned_staff_id, assigned_at: 클라이언트 ISO}` — update 먼저, system 메시지 나중.
- returnToAi(`:111-120`): `{mode:'ai', assigned_staff_id: null, assigned_at: null}` — system 메시지 **먼저**, update 나중(`handoff_provider.dart:93-98`).
- sendStaffMessage(`supabase_chat_repository.dart:227-251`): `{user_id, session_id, message, is_user:false, sender_type:'staff', staff_id}`.
- insertSystemMessage(`:255-271`): `{user_id, session_id, message, is_user:false, sender_type:'system'}` — staff_id 없음.
- 세션 목록(`chat_session_repository.dart:35-55`): select `"*, profiles!chat_sessions_user_id_fkey(full_name, email, role)"`, order `updated_at desc`, **role='customer' 필터는 클라이언트측**.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// client/src/lib/chat-data.test.ts
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
  fetchStaffOptions,
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
    expect(q.argOf("select")).toBe("*, profiles!chat_sessions_user_id_fkey(full_name, email, role)");
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
      "created_at.lt.2026-07-02T09:00:00+00:00,and(created_at.eq.2026-07-02T09:00:00+00:00,id.lt.m0)",
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

describe("fetchStaffOptions / getStaffId", () => {
  it("staff/manager/admin 프로필을 옵션으로 매핑한다", async () => {
    const q = enqueue("profiles", { data: [{ id: "p1", full_name: "지안", role: "admin" }], error: null });
    const opts = await fetchStaffOptions();
    expect(q.calls.find((c) => c.method === "in")?.args).toEqual(["role", ["staff", "manager", "admin"]]);
    expect(opts).toEqual([{ id: "p1", name: "지안" }]);
  });
  it("getStaffId는 JWT claims sub를 반환한다", async () => {
    expect(await getStaffId()).toBe("staff-1");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/chat-data.test.ts`
Expected: FAIL — `fetchChatSessions` 등 export 없음.

- [ ] **Step 3: 구현 (chat.ts에 추가)**

```ts
// ── supabase 데이터 접근 (staff JWT + RLS. 앱 admin 섹션 미러) ─────────────────
import { supabase } from "./supabase";
import { CHAT_SYSTEM_MSG_RETURN, CHAT_SYSTEM_MSG_TAKEOVER } from "@/data/chat";

const SESSION_SELECT = "*, profiles!chat_sessions_user_id_fkey(full_name, email, role)";
export const CHAT_PAGE_SIZE = 50;

// 앱 getAllSessions 미러: role='customer' 필터는 쿼리가 아니라 클라이언트측(앱과 동일).
export async function fetchChatSessions(): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from("chat_sessions")
    .select(SESSION_SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ChatSessionRow[])
    .filter((row) => (row.profiles?.role ?? "customer") === "customer")
    .map(toChatSession);
}

// user_id 기준(세션 없는 구세대 AI 대화 포함 — 상담원이 맥락을 봐야 함).
// 최신 CHAT_PAGE_SIZE건을 desc로 받아 뒤집어 반환. cursor는 created_at/id 복합(동일 타임스탬프 안전).
export async function fetchChatMessages(
  userId: string,
  before?: { createdAt: string; id: string },
): Promise<ChatMessage[]> {
  let query = supabase
    .from("chat_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CHAT_PAGE_SIZE);
  if (before) {
    query = query.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as ChatMessageRow[]).map(toChatMessage).reverse();
}

// 현재 로그인 staff의 profiles.id(=auth uid). JWT claims라 네트워크 왕복 없음.
export async function getStaffId(): Promise<string> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (typeof sub !== "string" || sub.length === 0) throw new Error("로그인 정보가 없습니다.");
  return sub;
}

export type StaffOption = { id: string; name: string };

// 배정 드롭다운용. profiles RLS "viewable by self or staff"라 staff 계정은 전체 조회 가능(실측).
export async function fetchStaffOptions(): Promise<StaffOption[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("role", ["staff", "manager", "admin"]);
  if (error) throw error;
  return ((data ?? []) as { id: string; full_name: string | null }[]).map((row) => ({
    id: row.id,
    name: row.full_name ?? "이름 없음",
  }));
}

// 앱 insertSystemMessage 미러: staff_id 없음(supabase_chat_repository.dart:255-271).
async function insertSystemMessage(userId: string, sessionId: string, message: string): Promise<void> {
  const { error } = await supabase.from("chat_messages").insert({
    user_id: userId,
    session_id: sessionId,
    message,
    is_user: false,
    sender_type: "system",
  });
  if (error) throw error;
}

// 배정만(목업 "지안에게 배정") — mode 유지, 고객 화면 무변화. CRM 고유(앱에는 없는 흐름).
export async function assignSession(sessionId: string, staffId: string): Promise<void> {
  const { error } = await supabase
    .from("chat_sessions")
    .update({ assigned_staff_id: staffId, assigned_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

// 앱 takeOverSession 미러(update 먼저 → system 메시지) + 경합 가드(neq human).
// false = 이미 다른 상담원이 human 인수(마지막 쓰기 경합에서 짐) → 호출부가 reload+안내.
export async function takeOverSession(
  session: { id: string; userId: string },
  staffId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chat_sessions")
    .update({ mode: "human", assigned_staff_id: staffId, assigned_at: new Date().toISOString() })
    .eq("id", session.id)
    .neq("mode", "human")
    .select();
  if (error) throw error;
  if (!data || (data as unknown[]).length === 0) return false;
  await insertSystemMessage(session.userId, session.id, CHAT_SYSTEM_MSG_TAKEOVER);
  return true;
}

// 앱 returnToAi 미러: system 메시지 먼저 → 세션 초기화(assigned 둘 다 null clear).
export async function returnSessionToAi(session: { id: string; userId: string }): Promise<void> {
  await insertSystemMessage(session.userId, session.id, CHAT_SYSTEM_MSG_RETURN);
  const { error } = await supabase
    .from("chat_sessions")
    .update({ mode: "ai", assigned_staff_id: null, assigned_at: null })
    .eq("id", session.id);
  if (error) throw error;
}

// 앱 sendStaffMessage payload 미러. insert 결과 row를 받아 낙관 temp 교체에 쓴다.
export async function sendStaffMessage(input: {
  userId: string;
  sessionId: string;
  staffId: string;
  message: string;
}): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      user_id: input.userId,
      session_id: input.sessionId,
      message: input.message,
      is_user: false,
      sender_type: "staff",
      staff_id: input.staffId,
    })
    .select()
    .single();
  if (error) throw error;
  return toChatMessage(data as ChatMessageRow);
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun run test:unit client/src/lib/chat.test.ts client/src/lib/chat-data.test.ts`
Expected: PASS 전체.

- [ ] **Step 5: 커밋**

```bash
bun run typecheck && bun run lint
git add client/src/lib/chat.ts client/src/lib/chat-data.test.ts
git commit -m "feat(crm): 채팅 supabase 데이터 접근 — 앱 payload 미러 TDD"
```

---

### Task 5: Realtime 구독 (`client/src/lib/chat-realtime.ts`, TDD)

**Files:**
- Create: `client/src/lib/chat-realtime.ts`
- Test: `client/src/lib/chat-realtime.test.ts`

`quote-requests-realtime.ts` 패턴 미러. 세션 채널은 payload(mode 전이)를 넘겨 App.tsx 알림이 pending 전이를 판별하게 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// client/src/lib/chat-realtime.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => void;
const handlers: { event: string; filter: Record<string, unknown>; cb: Handler }[] = [];
const channel = {
  on: vi.fn((_type: string, filter: Record<string, unknown>, cb: Handler) => {
    handlers.push({ event: String(filter.event), filter, cb });
    return channel;
  }),
  subscribe: vi.fn(() => channel),
};
const removeChannel = vi.fn();

vi.mock("./supabase", () => ({
  supabase: {
    channel: vi.fn(() => channel),
    removeChannel: (c: unknown) => removeChannel(c),
  },
}));

import { subscribeChatMessages, subscribeChatSessions } from "./chat-realtime";

beforeEach(() => {
  handlers.length = 0;
  vi.clearAllMocks();
});

describe("subscribeChatSessions", () => {
  it("INSERT/UPDATE 이벤트에서 mode 전이를 콜백으로 넘긴다", () => {
    const onChange = vi.fn();
    subscribeChatSessions(onChange);
    expect(handlers.map((h) => h.event)).toEqual(["INSERT", "UPDATE"]);
    handlers[1].cb({ new: { mode: "pending" }, old: { mode: "ai" } });
    expect(onChange).toHaveBeenCalledWith({ newMode: "pending", oldMode: "ai" });
    handlers[0].cb({ new: { mode: "ai" }, old: {} });
    expect(onChange).toHaveBeenCalledWith({ newMode: "ai", oldMode: null });
  });
  it("정리 함수가 removeChannel을 호출한다", () => {
    const cleanup = subscribeChatSessions(vi.fn());
    cleanup();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeChatMessages", () => {
  it("user_id 필터로 INSERT/UPDATE row를 넘긴다", () => {
    const onRow = vi.fn();
    subscribeChatMessages("u1", onRow);
    expect(handlers).toHaveLength(2);
    expect(handlers[0].filter.filter).toBe("user_id=eq.u1");
    const row = { id: "m1", user_id: "u1" };
    handlers[0].cb({ new: row, old: {} });
    expect(onRow).toHaveBeenCalledWith(row);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/chat-realtime.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// client/src/lib/chat-realtime.ts
// public.chat_sessions / chat_messages postgres_changes 구독(quote-requests-realtime 패턴).
// 채널명은 CRM 로컬 토픽이라 앱과 충돌 없음. 인증: 현재 세션 JWT → RLS(staff SELECT) 통과 시 수신.
import { supabase } from "./supabase";
import type { ChatMessageRow } from "./chat";

export type ChatSessionChange = { newMode: string | null; oldMode: string | null };

function readMode(row: Record<string, unknown> | null | undefined): string | null {
  const mode = row?.mode;
  return typeof mode === "string" ? mode : null;
}

// 세션 INSERT/UPDATE 신호. 호출부 용도 2가지:
//  - ChatPage 큐: 아무 전이든 fetchChatSessions 재조회(세션 수 적음)
//  - App.tsx 알림: newMode==='pending' && oldMode!=='pending' 전이만 카운트
export function subscribeChatSessions(onChange: (change: ChatSessionChange) => void): () => void {
  const channel = supabase
    .channel("crm-chat-sessions")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_sessions" },
      (payload) => onChange({ newMode: readMode(payload.new as Record<string, unknown>), oldMode: null }),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "chat_sessions" },
      (payload) =>
        onChange({
          newMode: readMode(payload.new as Record<string, unknown>),
          oldMode: readMode(payload.old as Record<string, unknown>),
        }),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// 열린 스레드의 메시지 수신(앱 admin subscribeToUserMessages와 동일한 user_id eq 필터).
export function subscribeChatMessages(userId: string, onRow: (row: ChatMessageRow) => void): () => void {
  const filter = { schema: "public", table: "chat_messages", filter: `user_id=eq.${userId}` };
  const channel = supabase
    .channel(`crm-chat-messages-${userId}`)
    .on("postgres_changes", { ...filter, event: "INSERT" }, (payload) => onRow(payload.new as ChatMessageRow))
    .on("postgres_changes", { ...filter, event: "UPDATE" }, (payload) => onRow(payload.new as ChatMessageRow))
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `bun run test:unit client/src/lib/chat-realtime.test.ts` → PASS

```bash
bun run typecheck && bun run lint
git add client/src/lib/chat-realtime.ts client/src/lib/chat-realtime.test.ts
git commit -m "feat(crm): 채팅 Realtime 구독(세션·메시지) TDD"
```

---

### Task 6: Customer 타입에 appUserId 관통 (프론트만)

**Files:**
- Modify: `client/src/data/customers.ts` (Customer 타입, line 5-33)
- Modify: `client/src/lib/customers.ts` (CustomerRow line 6-28, toCustomer line 48-74)
- Test: `client/src/lib/customers.test.ts` (기존 fixture 보강)

백엔드 `listCustomers`는 `getTableColumns(customers)` 스프레드라 `appUserId`가 이미 내려온다. 프론트 타입/매핑만 추가.

- [ ] **Step 1: 실패하는 테스트 추가** — `customers.test.ts`의 `toCustomer` 관련 describe에 케이스 추가(기존 fixture 스타일 준수):

```ts
it("appUserId를 관통시킨다 (앱 유입 고객 매칭용)", () => {
  expect(toCustomer({ ...baseRow, appUserId: "app-u1" }).appUserId).toBe("app-u1");
  expect(toCustomer({ ...baseRow, appUserId: null }).appUserId).toBeNull();
});
```

(기존 테스트 파일의 base fixture 변수명이 다르면 그 이름을 따른다. fixture가 CustomerRow 전 필드 나열형이면 `appUserId: null`을 추가.)

- [ ] **Step 2: 실패 확인**

Run: `bun run test:unit client/src/lib/customers.test.ts`
Expected: FAIL — 타입에 appUserId 없음.

- [ ] **Step 3: 구현**

`client/src/lib/customers.ts` CustomerRow에 추가:

```ts
  appUserId: string | null;
```

`toCustomer` 반환 객체에 추가:

```ts
    appUserId: row.appUserId,
```

`client/src/data/customers.ts` Customer 타입에 추가(목업 20명 배열은 안 건드리기 위해 optional):

```ts
  appUserId?: string | null; // 앱 profiles.id. 수기 고객/목업은 없음 — 채팅 세션 매칭용
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `bun run test:unit client/src/lib/customers.test.ts` → PASS, `bun run typecheck` → 0

```bash
git add client/src/data/customers.ts client/src/lib/customers.ts client/src/lib/customers.test.ts
git commit -m "feat(crm): Customer 목록 타입에 appUserId 관통 — 채팅 고객 매칭용"
```

---

### Task 7: hooks (`useChatSessions`, `useChatThread`)

**Files:**
- Create: `client/src/hooks/useChatSessions.ts`
- Create: `client/src/hooks/useChatThread.ts`

로직은 Task 3~5의 검증된 lib 함수 조합. hook 자체는 수동 검증(프로젝트 관례: 거대 컴포넌트/hook은 수동, 순수 로직만 TDD).

- [ ] **Step 1: useChatSessions 작성**

```ts
// client/src/hooks/useChatSessions.ts
import { useCallback, useEffect, useState } from "react";
import { fetchChatSessions, type ChatSession } from "@/lib/chat";
import { subscribeChatSessions } from "@/lib/chat-realtime";

// 세션 큐: 초기 로드 + 아무 세션 전이든 재조회(세션 수 적음 — spec §6).
// 재구독/이벤트 유실 보정도 재조회가 겸한다.
export function useChatSessions(onToast: (message: string) => void) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    fetchChatSessions()
      .then(setSessions)
      .catch(() => onToast("상담 목록을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [onToast]);
  useEffect(() => {
    reload();
    return subscribeChatSessions(() => reload());
  }, [reload]);
  return { sessions, loading, reload };
}
```

- [ ] **Step 2: useChatThread 작성**

```ts
// client/src/hooks/useChatThread.ts
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_PAGE_SIZE,
  fetchChatMessages,
  mergeMessages,
  sendStaffMessage,
  toChatMessage,
  type ChatMessage,
} from "@/lib/chat";
import { subscribeChatMessages } from "@/lib/chat-realtime";

// 열린 스레드: user_id 기준 히스토리 + Realtime 수신 병합 + 낙관 전송.
export function useChatThread(userId: string | null, onToast: (message: string) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const seq = useRef(0); // 스레드 전환 race 가드

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    if (!userId) return;
    const mySeq = ++seq.current;
    fetchChatMessages(userId)
      .then((batch) => {
        if (seq.current !== mySeq) return;
        setMessages(batch);
        setHasMore(batch.length === CHAT_PAGE_SIZE);
      })
      .catch(() => onToast("메시지를 불러오지 못했습니다."));
    return subscribeChatMessages(userId, (row) => {
      if (seq.current !== mySeq) return;
      setMessages((current) => mergeMessages(current, [toChatMessage(row)]));
    });
  }, [userId, onToast]);

  const loadOlder = useCallback(() => {
    const oldest = messages[0];
    if (!userId || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    fetchChatMessages(userId, { createdAt: oldest.createdAt, id: oldest.id })
      .then((batch) => {
        setMessages((current) => mergeMessages(current, batch));
        setHasMore(batch.length === CHAT_PAGE_SIZE);
      })
      .catch(() => onToast("이전 메시지를 불러오지 못했습니다."))
      .finally(() => setLoadingOlder(false));
  }, [userId, messages, loadingOlder, onToast]);

  // 낙관 전송: temp 즉시 표시 → insert 성공 시 실제 row로 교체(Realtime echo는 id dedupe).
  // 실패 시 temp 제거 + 원문 반환(호출부가 입력창 복원).
  const send = useCallback(
    async (input: { sessionId: string; staffId: string; message: string }): Promise<boolean> => {
      if (!userId) return false;
      const temp: ChatMessage = {
        id: `temp-${Date.now()}`,
        userId,
        message: input.message,
        senderKind: "staff",
        staffId: input.staffId,
        sessionId: input.sessionId,
        attachmentUrl: null,
        attachmentWidth: null,
        attachmentHeight: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, temp]);
      try {
        const saved = await sendStaffMessage({ userId, ...input });
        setMessages((current) => mergeMessages(current.filter((m) => m.id !== temp.id), [saved]));
        return true;
      } catch {
        setMessages((current) => current.filter((m) => m.id !== temp.id));
        onToast("메시지 전송에 실패했습니다.");
        return false;
      }
    },
    [userId, onToast],
  );

  return { messages, hasMore, loadingOlder, loadOlder, send };
}
```

- [ ] **Step 3: typecheck + 커밋**

```bash
bun run typecheck && bun run lint
git add client/src/hooks/useChatSessions.ts client/src/hooks/useChatThread.ts
git commit -m "feat(crm): 채팅 세션/스레드 hooks"
```

---

### Task 8: 컴포넌트 + ChatPage 교체 + CSS

**Files:**
- Create: `client/src/components/chat/ChatQueue.tsx`
- Create: `client/src/components/chat/ChatThread.tsx`
- Create: `client/src/components/chat/ChatComposer.tsx`
- Create: `client/src/components/chat/ChatSessionHeader.tsx`
- Create: `client/src/components/chat/ChatCustomerPanel.tsx`
- Modify: `client/src/pages/ChatPage.tsx` (61줄 목업 전체 교체)
- Modify: `client/src/index.css` (끝부분에 채팅 신규 클래스 추가)

기존 chat-* CSS 클래스(chat-tabs/chat-layout/chat-panel/chat-queue/chat-request/chat-window/chat-header/chat-messages/message/chat-compose/panel-head/badge)를 재사용. composer 활성 조건은 앱 미러: `mode==='human' && assignedStaffId===내 staffId`(`admin_chat_detail_screen.dart:100-102`).

- [ ] **Step 1: ChatQueue**

```tsx
// client/src/components/chat/ChatQueue.tsx
import { CHAT_MODE_LABELS } from "@/data/chat";
import { waitingLabel, type ChatSession } from "@/lib/chat";

type ChatQueueProps = {
  sessions: ChatSession[];
  activeId: string | null;
  unassignedCount: number;
  onSelect: (id: string) => void;
};

const MODE_BADGE_COLOR: Record<ChatSession["mode"], string> = { pending: "red", human: "green", ai: "" };

export function ChatQueue({ sessions, activeId, unassignedCount, onSelect }: ChatQueueProps) {
  return (
    <section className="card chat-panel">
      <div className="panel-head"><h2>상담 연결 큐</h2>{unassignedCount > 0 && <span className="badge red">미배정 {unassignedCount}</span>}</div>
      <div className="chat-queue">
        {sessions.length === 0 && <p className="chat-queue-empty">해당 상태의 상담이 없습니다.</p>}
        {sessions.map((session) => (
          <button className={`chat-request ${session.id === activeId ? "active" : ""}`} key={session.id} onClick={() => onSelect(session.id)} type="button">
            <div className="chat-request-head"><strong>{session.customerName}</strong><span className={`badge ${MODE_BADGE_COLOR[session.mode]}`}>{CHAT_MODE_LABELS[session.mode]}</span></div>
            <div className="chat-meta">
              {session.mode === "pending" && <span className="badge yellow">{waitingLabel(session.updatedAt, new Date())}</span>}
              {session.mode !== "pending" && <span className="badge">{waitingLabel(session.updatedAt, new Date()).replace(" 대기", " 전")}</span>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: ChatThread** (말풍선: customer→`.message.customer`, ai→`.message.ai`, staff→`.message.advisor`, system→`.message.system` 신규)

```tsx
// client/src/components/chat/ChatThread.tsx
import type { ChatMessage } from "@/lib/chat";

const BUBBLE_CLASS: Record<ChatMessage["senderKind"], string> = {
  customer: "customer",
  ai: "ai",
  staff: "advisor",
  system: "system",
};
const SENDER_LABEL: Record<ChatMessage["senderKind"], string> = {
  customer: "고객",
  ai: "AI",
  staff: "상담원",
  system: "",
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

type ChatThreadProps = {
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
};

export function ChatThread({ messages, hasMore, loadingOlder, onLoadOlder }: ChatThreadProps) {
  return (
    <div className="chat-messages">
      {hasMore && (
        <button className="chat-load-more" disabled={loadingOlder} onClick={onLoadOlder} type="button">
          {loadingOlder ? "불러오는 중…" : "이전 메시지 더 보기"}
        </button>
      )}
      {messages.map((message) => (
        <div className={`message ${BUBBLE_CLASS[message.senderKind]}`} key={message.id}>
          {message.attachmentUrl && (
            <a className="message-attachment" href={message.attachmentUrl} rel="noreferrer" target="_blank">
              <img
                alt="첨부 이미지"
                src={message.attachmentUrl}
                style={message.attachmentWidth && message.attachmentHeight ? { aspectRatio: `${message.attachmentWidth} / ${message.attachmentHeight}` } : undefined}
              />
            </a>
          )}
          {message.message}
          {message.senderKind !== "system" && <small>{SENDER_LABEL[message.senderKind]} · {timeLabel(message.createdAt)}</small>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: ChatComposer** (활성 조건·비활성 안내는 앱 미러 — `admin_chat_detail_screen.dart:198-211`)

```tsx
// client/src/components/chat/ChatComposer.tsx
import { useState } from "react";
import type { ChatSession } from "@/lib/chat";

type ChatComposerProps = {
  session: ChatSession;
  staffId: string | null;
  onSend: (message: string) => Promise<boolean>;
};

export function ChatComposer({ session, staffId, onSend }: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const canSend = session.mode === "human" && staffId !== null && session.assignedStaffId === staffId;

  if (!canSend) {
    const notice =
      session.mode === "human" ? "다른 상담원이 대화 중입니다."
      : session.mode === "pending" ? "고객이 상담원 연결을 요청했습니다. 채팅 시작을 눌러 대화에 참여하세요."
      : "AI 상담 모드입니다.";
    return <div className="chat-compose"><span className="chat-disabled-banner">{notice}</span></div>;
  }

  async function submit() {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setDraft("");
    const ok = await onSend(message);
    if (!ok) setDraft(message); // 실패 시 원문 복원(spec §8)
    setSending(false);
  }

  return (
    <div className="chat-compose">
      <input
        className="input"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit(); }}
        placeholder="고객에게 보낼 메시지를 입력하세요"
        value={draft}
      />
      <button className="btn primary" disabled={sending || draft.trim().length === 0} onClick={() => void submit()} type="button">전송</button>
    </div>
  );
}
```

- [ ] **Step 4: ChatSessionHeader** (버튼 노출: pending/ai→배정 select+채팅 시작, human&내것→AI에게 반환, human&남의것→안내만)

```tsx
// client/src/components/chat/ChatSessionHeader.tsx
import { useState } from "react";
import { CHAT_MODE_LABELS } from "@/data/chat";
import { assignSession, returnSessionToAi, takeOverSession, type ChatSession, type StaffOption } from "@/lib/chat";

type ChatSessionHeaderProps = {
  session: ChatSession;
  staffId: string | null;
  staffOptions: StaffOption[];
  onChanged: () => void; // 세션 reload
  onToast: (message: string) => void;
};

export function ChatSessionHeader({ session, staffId, staffOptions, onChanged, onToast }: ChatSessionHeaderProps) {
  const [busy, setBusy] = useState(false);
  const assignedName = staffOptions.find((option) => option.id === session.assignedStaffId)?.name ?? null;
  const isMineHuman = session.mode === "human" && staffId !== null && session.assignedStaffId === staffId;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch {
      onToast("처리에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-header">
      <div>
        <h2>{session.customerName} · {CHAT_MODE_LABELS[session.mode]}</h2>
        <span>{assignedName ? `담당 ${assignedName}` : "미배정"}{session.customerEmail ? ` · ${session.customerEmail}` : ""}</span>
      </div>
      <div className="top-actions">
        {session.mode !== "human" && (
          <>
            <select
              aria-label="상담원 배정"
              className="chat-assign-select"
              disabled={busy || staffOptions.length === 0}
              onChange={(event) => {
                const nextStaffId = event.target.value;
                if (!nextStaffId) return;
                void run(async () => {
                  await assignSession(session.id, nextStaffId);
                  onToast("상담원을 배정했습니다.");
                });
                event.target.value = "";
              }}
              value=""
            >
              <option value="">배정…</option>
              {staffOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <button
              className="btn primary"
              disabled={busy || staffId === null}
              onClick={() => void run(async () => {
                if (staffId === null) return;
                const ok = await takeOverSession({ id: session.id, userId: session.userId }, staffId);
                onToast(ok ? "상담을 시작합니다. AI 응답은 중지됩니다." : "이미 다른 상담원이 인수했습니다.");
              })}
              type="button"
            >채팅 시작</button>
          </>
        )}
        {isMineHuman && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run(async () => {
              await returnSessionToAi({ id: session.id, userId: session.userId });
              onToast("AI에게 상담을 돌려줬습니다.");
            })}
            type="button"
          >AI에게 반환</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: ChatCustomerPanel**

```tsx
// client/src/components/chat/ChatCustomerPanel.tsx
import type { Customer } from "@/data/customers";
import type { ChatSession } from "@/lib/chat";

type ChatCustomerPanelProps = {
  session: ChatSession | null;
  customer: Customer | null; // app_user_id 매칭 결과(없으면 미승격)
  onOpenCustomer: (customer: Customer) => void;
};

export function ChatCustomerPanel({ session, customer, onOpenCustomer }: ChatCustomerPanelProps) {
  return (
    <aside className="card chat-panel">
      <div className="panel-head"><h2>고객 정보</h2>{customer && <span className="badge blue">CRM 연결됨</span>}</div>
      <div className="panel-body">
        {!session && <p className="chat-panel-empty">상담을 선택하세요.</p>}
        {session && (
          <div className="insight-stack">
            <div className="insight-item"><span>고객명</span><strong>{session.customerName}</strong><p>{session.customerEmail ?? "이메일 없음"}</p></div>
            {customer && <div className="insight-item"><span>CRM 고객</span><strong>{customer.customerId}</strong><p>{customer.vehicle ? `${customer.vehicle} · ${customer.method}` : "니즈 미입력"}</p></div>}
            {!customer && <div className="insight-item"><span>CRM 고객</span><strong>미승격</strong><p>앱 견적요청 인박스에서 승격하면 연결됩니다.</p></div>}
          </div>
        )}
        <div className="action-stack">
          <button className="btn primary" disabled={!customer} onClick={() => customer && onOpenCustomer(customer)} title={customer ? undefined : "미승격 고객"} type="button">고객 상세 이동</button>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: ChatPage 컨테이너 교체** (기존 61줄 전체 삭제 후)

```tsx
// client/src/pages/ChatPage.tsx
import { useEffect, useMemo, useState } from "react";
import type { Customer } from "@/data/customers";
import { CHAT_QUEUE_TABS, CHAT_TAB_LABELS, type ChatQueueTab } from "@/data/chat";
import { fetchStaffOptions, getStaffId, type StaffOption } from "@/lib/chat";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useChatThread } from "@/hooks/useChatThread";
import { ChatQueue } from "@/components/chat/ChatQueue";
import { ChatThread } from "@/components/chat/ChatThread";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatSessionHeader } from "@/components/chat/ChatSessionHeader";
import { ChatCustomerPanel } from "@/components/chat/ChatCustomerPanel";

type ChatPageProps = {
  customers: Customer[];
  onOpenCustomer: (customer: Customer) => void;
  onToast: (message: string) => void;
  onRead: () => void; // Topbar pending 알림 읽음 처리
};

export function ChatPage({ customers, onOpenCustomer, onToast, onRead }: ChatPageProps) {
  useEffect(() => { onRead(); }, [onRead]);
  const { sessions, loading, reload } = useChatSessions(onToast);
  const [tab, setTab] = useState<ChatQueueTab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);

  useEffect(() => {
    getStaffId().then(setStaffId).catch(() => setStaffId(null));
    fetchStaffOptions().then(setStaffOptions).catch(() => setStaffOptions([]));
  }, []);

  const visible = tab === "all" ? sessions : sessions.filter((session) => session.mode === tab);
  const active = visible.find((session) => session.id === selectedId) ?? visible[0] ?? null;
  const thread = useChatThread(active?.userId ?? null, onToast);
  const matchedCustomer = useMemo(
    () => (active ? customers.find((customer) => customer.appUserId === active.userId) ?? null : null),
    [customers, active],
  );
  const countOf = (t: ChatQueueTab) => (t === "all" ? sessions.length : sessions.filter((s) => s.mode === t).length);
  const unassignedCount = sessions.filter((s) => s.mode === "pending" && s.assignedStaffId === null).length;

  return (
    <>
      <div className="chat-tabs">
        {CHAT_QUEUE_TABS.map((t) => (
          <button className={`chat-tab ${tab === t ? "active" : ""}`} key={t} onClick={() => { setTab(t); setSelectedId(null); }} type="button">
            {CHAT_TAB_LABELS[t]} {countOf(t)}
          </button>
        ))}
      </div>
      <div className="chat-layout">
        <ChatQueue activeId={active?.id ?? null} onSelect={setSelectedId} sessions={visible} unassignedCount={unassignedCount} />
        <section className="card chat-window">
          {!active && <div className="chat-window-empty">{loading ? "상담 목록을 불러오는 중…" : "왼쪽에서 상담을 선택하세요."}</div>}
          {active && (
            <>
              <ChatSessionHeader onChanged={reload} onToast={onToast} session={active} staffId={staffId} staffOptions={staffOptions} />
              <ChatThread hasMore={thread.hasMore} loadingOlder={thread.loadingOlder} messages={thread.messages} onLoadOlder={thread.loadOlder} />
              <ChatComposer
                onSend={(message) => staffId ? thread.send({ sessionId: active.id, staffId, message }) : Promise.resolve(false)}
                session={active}
                staffId={staffId}
              />
            </>
          )}
        </section>
        <ChatCustomerPanel customer={matchedCustomer} onOpenCustomer={onOpenCustomer} session={active} />
      </div>
    </>
  );
}
```

- [ ] **Step 7: index.css 추가** (파일 끝 채팅 섹션에, 기존 토큰 문법 준수 — brand 토큰/`var(--line)` 사용)

```css
/* 실시간 상담: 실데이터 전환에서 추가된 상태들 */
.chat-queue-empty, .chat-panel-empty, .chat-window-empty { color: #7f858c; font-size: 12.5px; padding: 18px 6px; text-align: center; }
.chat-window-empty { display: flex; align-items: center; justify-content: center; min-height: 240px; }
.message.system { align-self: center; background: transparent; border: 0; box-shadow: none; color: #7f858c; font-size: 11.5px; max-width: 82%; text-align: center; }
.message-attachment { display: block; margin-bottom: 6px; }
.message-attachment img { border-radius: 8px; display: block; max-width: 260px; width: 100%; }
.chat-load-more { align-self: center; background: #fbfbfa; border: 1px solid #dededb; border-radius: 6px; color: #5f6872; cursor: pointer; font-size: 11.5px; padding: 4px 12px; }
.chat-load-more:hover { border-color: rgba(88, 54, 255, 0.34); }
.chat-disabled-banner { color: #7f858c; font-size: 12px; padding: 6px 4px; }
.chat-assign-select { background: #fbfbfa; border: 1px solid #dededb; border-radius: 6px; color: #4f5a64; font-size: 12px; height: 28px; padding: 0 8px; }
```

(구현 시 기존 `.message`/`.chat-compose` 정의를 먼저 읽고 톤을 맞출 것 — 위 값은 리스트 화면 기존 토큰 기준 초안.)

- [ ] **Step 8: 검증 + 커밋**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun run build
git add client/src/components/chat/ client/src/pages/ChatPage.tsx client/src/index.css
git commit -m "feat(crm): 실시간 상담 콘솔 — ChatPage 목업을 실데이터로 교체"
```

(주의: 이 시점에 App.tsx가 아직 옛 props(`onNavigate`)를 넘겨 typecheck가 깨진다 — Task 9와 같은 커밋으로 묶거나, Task 9를 바로 이어서 실행 후 함께 커밋해도 된다. subagent 실행 시 Task 8+9를 한 세트로 처리할 것.)

---

### Task 9: App.tsx + Topbar 알림 연동

**Files:**
- Modify: `client/src/App.tsx` (알림 state ~line 167-192 인근, ChatPage route line 296)
- Modify: `client/src/components/Topbar.tsx` (props line 101/127, 배지 line 497, popover 항목 line 522-529 인근)

- [ ] **Step 1: App.tsx — pending 알림 state + 구독** (기존 quote-requests 블록(167-192) 바로 아래에 동일 문법으로)

```tsx
import { subscribeChatSessions } from "@/lib/chat-realtime";
// ...
const [pendingChatCount, setPendingChatCount] = useState(0);
const markChatRequestsRead = useCallback(() => setPendingChatCount(0), []);

useEffect(() => {
  if (!auth.authed) return;
  return subscribeChatSessions((change) => {
    // pending 진입 전이만 알림(그 외 전이는 ChatPage 큐가 자체 구독으로 처리).
    if (change.newMode !== "pending" || change.oldMode === "pending") return;
    if (locationRef.current.startsWith("/chat")) return; // 보고 있으면 생략(견적요청 알림과 동일 규칙)
    setPendingChatCount((count) => count + 1);
    showToast("새 상담원 연결 요청이 도착했습니다");
  });
}, [auth.authed, showToast]);
```

- [ ] **Step 2: App.tsx — ChatPage route 교체** (line 296)

```tsx
<Route path="/chat" element={<ChatPage customers={customers} onOpenCustomer={openCustomerDetailPanel} onToast={showToast} onRead={markChatRequestsRead} />} />
```

- [ ] **Step 3: Topbar — props에 pendingChatCount 추가** (line 101 TopbarProps, line 127 구조분해, App.tsx line 365 인근 전달)

```tsx
// TopbarProps에 추가
pendingChatCount: number;
// App.tsx Topbar 호출부에 추가
pendingChatCount={pendingChatCount}
```

- [ ] **Step 4: Topbar — 배지 합산(line 497) + popover 항목(line 522 견적 항목 아래 동일 문법)**

```tsx
// line 497 배지: newAppRequestCount → 합산으로 교체
{(newAppRequestCount + pendingChatCount) > 0 && <span className="notification-count num">{newAppRequestCount + pendingChatCount}</span>}

// popover 항목 추가("상담" 탭):
{(notificationTab === "전체" || notificationTab === "상담") && pendingChatCount > 0 && (
  <button className="notification-item app-request-new" onClick={() => { onNavigate("chat"); setNotificationsOpen(false); }} type="button">
    <span className="notification-badge">상담</span>
    <strong>상담원 연결 요청 {pendingChatCount}건</strong>
    <small>앱 고객이 상담원 연결을 기다리고 있습니다.</small>
    <em>최근</em>
  </button>
)}
```

- [ ] **Step 5: 검증 + 커밋**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun run build
git add client/src/App.tsx client/src/components/Topbar.tsx
git commit -m "feat(crm): 상담원 연결 요청 Topbar 알림 + ChatPage 연결"
```

---

### Task 10: 통합 검증 (실기 크로스 스모크)

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 검증 스위트**

```bash
bun run typecheck && bun run lint && bun run test:unit && bun run build
```

Expected: 모두 green, lint 0 problems.

- [ ] **Step 2: 브라우저 단독 스모크** (`bun dev` — 백엔드 변경 없지만 customers 목록에 API 필요)

1. `/chat` 진입 → 실세션 8개(전부 AI 상담중) 표시, 탭 카운트 일치.
2. 세션 선택 → 히스토리 로드(과거 AI 대화 포함), "이전 메시지 더 보기" 동작(메시지 많은 유저).
3. 첨부 이미지 있는 메시지 렌더 확인(quote_attachments public URL).
4. AI 모드 세션에서 composer 비활성 배너 "AI 상담 모드입니다." 확인.
5. 메시지 50건 초과 유저에서 "이전 메시지 더 보기" 실동작(커서 or 필터 실 PostgREST 통과) 확인.

- [ ] **Step 3: 앱 크로스 스모크** (Flutter 시뮬레이터 `/Users/tobedoit/Documents/Flutter/mr-cha-app` + CRM 동시)

1. 앱 고객 계정으로 "상담사 연결" 요청 → CRM 큐에 실시간 pending 등장 + (다른 페이지에 있을 때) Topbar 알림 배지/토스트.
2. CRM "채팅 시작" → 앱 고객 화면에 "상담원이 대화에 참여했습니다." system 메시지 수신, 앱에서 질문 보내면 **AI가 응답하지 않는지** 확인(ai-analyst human skip).
3. CRM에서 메시지 전송 → 앱 실시간 수신. 앱 고객 메시지 → CRM 실시간 수신.
4. "AI에게 반환" → 앱에 "상담원이 퇴장했습니다…" 수신, 이후 고객 질문에 AI 재응답.
5. 배정 select로 타 상담원 배정 → 큐 항목 담당 표시 갱신(고객 화면 무변화).
6. 두 브라우저 창으로 동시 "채팅 시작" → 한쪽만 성공, 다른 쪽 "이미 다른 상담원이 인수했습니다." 토스트.
7. Realtime로 수신된 신규 메시지가 기존 히스토리와 올바른 시간순 위치에 정렬되는지 확인(직렬화 포맷 차이).

- [ ] **Step 4: 결과 기록**

스모크 결과·발견 이슈를 PR 본문에 기록. UI 스크린샷(1440px) 1장 캡처.

---

### Task 11: 마무리 (brief 갱신 + PR)

**Files:**
- Modify: `ref/active-session-brief.md`

- [ ] **Step 1: active-session-brief 갱신** — Current Focus에 실시간 상담 v1 완료 요약(60줄 이내 유지), follow-up(AI 요약·타이핑·상담원 첨부·종료 상태·팀 scope) 명시.

- [ ] **Step 2: 커밋 + PR** (`[skip ci]` 금지)

```bash
git add ref/active-session-brief.md
git commit -m "docs(crm): active-session-brief 현행화 — 실시간 상담 v1"
git push -u origin feat/crm-realtime-chat
gh pr create --title "feat(crm): 실시간 상담 — 앱 채팅 상담원 콘솔 v1" --body "..."
```

PR 본문에: spec/plan 링크, public 스키마 접근 방식(RLS 정문, DDL 0), 크로스 스모크 결과, follow-up 목록.

---

## Self-Review 결과 (작성 시 점검 완료)

- **Spec coverage**: §2 범위(큐/히스토리/Realtime/배정/인수/반환/전송/첨부/고객이동/알림) → Task 2-9. §3 데이터 계약 → Task 3-4. §4 전환 표 → Task 4. §5 구조 → Task 2/3/5/7/8. §6 Realtime → Task 5/7. §7 알림·고객연동 → Task 6/8/9. §8 에러 → Task 7(롤백·복원)/8(배너). §9 검증 → Task 10. 갭 없음.
- **주의 승계**: Task 8 Step 8의 typecheck는 App.tsx props 불일치로 Task 9와 세트 실행 필요(본문 명시).
- **타입 일관성**: `ChatSession`/`ChatMessage`/`StaffOption`/`ChatSessionChange`는 Task 3-5 정의를 Task 7-9가 그대로 import. `send`는 boolean 반환(Composer 원문 복원용) 일치.

## 구현 편차 노트 (2026-07-02, 리뷰 반영 — plan 코드 블록보다 이 노트가 우선)

- **Task 4 반영분**: fetchChatMessages 커서 값 큰따옴표 quoting(PostgREST or 예약문자) · insertSystemMessage non-fatal(앱 미러) · mergeMessages toEpoch 정렬(REST/Realtime 직렬화 편차).
- **Task 5 반영분**: chat-realtime.ts 채널명에 호출별 고유 suffix(supabase-js v2 topic 재사용 → App.tsx 알림·ChatPage 큐 공존 시 충돌·상호 teardown 방지) + subscribe 상태 콜백 기반 `onResync`(드롭 후 재구독 시 1회 refetch 보정, spec §6). **Task 7 hooks는 subscribe* 호출 시 onResync 인자에 reload/refetch를 연결해야 한다** — Task 7 코드 블록의 구독 호출부는 이 시그니처 기준으로 조정.
- **Task 7 반영분**: statusHandler가 SUBSCRIBED마다 onResync 발화(최초 join 갭 보정 포함 — 스레드 오픈 시 fetch 2회는 의도), useChatThread 초기 fetch replace→merge, loadOlder/send에 seq 가드(스레드 전환 중 타 고객 메시지 혼입 차단), temp id 단조 카운터. 남은 v1 한계(수용): Realtime echo 선착 시 일시 이중 표시(self-heal), lost-ack 시 재전송 중복 가능(드묾), loadOlder 초고속 더블클릭 이중 fetch(무해). onToast는 useCallback identity 고정이 계약(현 App.tsx showToast 준수 — 인라인 함수 전달 금지).
- **Task 8+9 반영분**: `useChatThread`의 `mySeq` 증가를 `if (!userId) return;` 앞으로 이동(null 전환 중 in-flight 응답이 가드를 통과하는 구멍 봉합). `.message.system`은 `.chat-messages`가 grid라 `justify-self: center`로 가운데 정렬(align-self 아님). ChatComposer `key={active.id}`(draft 이월 오발신 차단) · active는 선택 시 탭 필터 독립 유지(인수 직후 점프 방지) · chat-queue-btn 배지=pendingChatCount(실 잔량 배지는 후속) · load-more justify-self.
- **최종 리뷰 반영분**: `parseChatTimestamp` 공유(JSC/Safari 안전 — toEpoch·ChatThread timeLabel 공용) · 스레드 스크롤 컨테이너(`.chat-window` `calc(100vh - 220px)`: globalbar 50+22 + 페이지 헤더 ≈52+18 + chat-tabs 38+14 + main 하단 padding 22 ≈ 216)+하단 앵커(새 메시지=최하단, prepend=위치 유지. 히스토리 읽는 중 신규 수신 시 하단 점프는 v1 수용) · `CHAT_SENDER_TYPES` 죽은 export 제거 · chat-compose 2열.
- **스모크 반영분(2026-07-02)**: AI 메시지 마크다운 렌더(C1 `MarkdownMessage` 재사용, 앱 미러 — 고객/상담원/system은 평문+pre-wrap 유지). `.message.ai .md-body`는 work-ai popover 룰셋을 말풍선 13px 기준 한 단계 축소 미러(본문13/h1 15/h2 14/h3 13.5, li::marker=brand, strong 600, 첫/마지막 블록 마진 제거).
