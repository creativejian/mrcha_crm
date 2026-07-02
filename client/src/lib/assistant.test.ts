import { describe, expect, it, vi } from "vitest";

vi.mock("./http", () => ({ sendJson: vi.fn(async () => ({ answer: "답", sources: [{ customerId: "c1", customerName: "김민준", sourceType: "memo", snippet: "…" }] })) }));

import { sendJson } from "./http";
import { askAssistant } from "./assistant";

describe("askAssistant", () => {
  it("POST /api/assistant/ask로 질문 전송, 응답 반환", async () => {
    const res = await askAssistant("계약 가능성 높은 고객은?");
    expect(sendJson).toHaveBeenCalledWith("/api/assistant/ask", "POST", { question: "계약 가능성 높은 고객은?" });
    expect(res.answer).toBe("답");
    expect(res.sources[0].customerName).toBe("김민준");
  });
});
