import { describe, expect, it } from "vitest";

import { createSseParser } from "./assistant-sse";

describe("createSseParser", () => {
  it("완성된 이벤트(event+data)를 파싱한다", () => {
    const feed = createSseParser();
    expect(feed('event: text\ndata: {"chunk":"안녕"}\n\n')).toEqual([{ event: "text", data: '{"chunk":"안녕"}' }]);
  });

  it("청크 경계가 라인 중간이어도 이어붙여 파싱한다(증분)", () => {
    const feed = createSseParser();
    expect(feed("event: te")).toEqual([]);
    expect(feed('xt\ndata: {"chunk":"분')).toEqual([]);
    expect(feed('할"}\n\n')).toEqual([{ event: "text", data: '{"chunk":"분할"}' }]);
  });

  it("한 청크에 여러 이벤트가 있으면 순서대로 전부 반환한다", () => {
    const feed = createSseParser();
    const out = feed('event: text\ndata: {"chunk":"a"}\n\nevent: done\ndata: {"messages":[]}\n\n');
    expect(out.map((e) => e.event)).toEqual(["text", "done"]);
  });

  it("event 없는 이벤트는 message, CRLF 라인도 처리한다", () => {
    const feed = createSseParser();
    expect(feed("data: x\r\n\r\n")).toEqual([{ event: "message", data: "x" }]);
  });

  it("data 여러 줄은 \\n으로 합친다(SSE 규격)", () => {
    const feed = createSseParser();
    expect(feed("event: text\ndata: 줄1\ndata: 줄2\n\n")).toEqual([{ event: "text", data: "줄1\n줄2" }]);
  });
});
