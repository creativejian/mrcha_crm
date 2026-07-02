import { describe, expect, it, vi } from "vitest";

vi.mock("./http", () => ({
  sendJson: vi.fn(async () => ({ answer: "답", sources: [], messages: [
    { id: "m1", role: "user", content: "q", sources: null, createdAt: "2026-07-02T00:00:00Z" },
    { id: "m2", role: "assistant", content: "답", sources: [], createdAt: "2026-07-02T00:00:01Z" },
  ] })),
  getJson: vi.fn(async () => ([
    { id: "m1", role: "user", content: "q", sources: null, createdAt: "2026-07-02T00:00:00Z" },
  ])),
}));

import { getJson, sendJson } from "./http";
import { askAssistant, fetchAssistantMessages } from "./assistant";

describe("assistant client", () => {
  it("askAssistant: POST /ask + messages 반환", async () => {
    const res = await askAssistant("q");
    expect(sendJson).toHaveBeenCalledWith("/api/assistant/ask", "POST", { question: "q" });
    expect(res.messages).toHaveLength(2);
    expect(res.messages[1].role).toBe("assistant");
  });
  it("fetchAssistantMessages: GET /messages", async () => {
    const rows = await fetchAssistantMessages();
    expect(getJson).toHaveBeenCalledWith("/api/assistant/messages");
    expect(rows[0].content).toBe("q");
  });
  it("fetchAssistantMessages(cursor): before/beforeId 쿼리 포함", async () => {
    await fetchAssistantMessages({ createdAt: "2026-07-02T00:00:00.000Z", id: "abc" });
    expect(getJson).toHaveBeenCalledWith(expect.stringContaining("before=2026-07-02T00%3A00%3A00.000Z"));
  });
});
