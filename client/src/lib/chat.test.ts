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
  it("60분 경계에서 시간 단위로 바뀐다", () => {
    expect(waitingLabel("2026-07-02T09:31:00+00:00", now)).toBe("59분 대기");
    expect(waitingLabel("2026-07-02T09:30:00+00:00", now)).toBe("1시간 대기");
  });
  it("24시간 경계에서 일 단위로 바뀐다", () => {
    expect(waitingLabel("2026-07-01T10:31:00+00:00", now)).toBe("23시간 대기");
    expect(waitingLabel("2026-07-01T10:30:00+00:00", now)).toBe("1일 대기");
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
  it("동일 created_at은 id로 tie-break한다", () => {
    const merged = mergeMessages([m("y", "2026-07-02T10:00:00+00:00")], [m("x", "2026-07-02T10:00:00+00:00")]);
    expect(merged.map((v) => v.id)).toEqual(["x", "y"]);
  });
});
