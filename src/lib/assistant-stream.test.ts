import { test, expect } from "bun:test";

import { finalizeStreamedAnswer, STOP_SUFFIX, ERROR_SUFFIX } from "./assistant-stream";
import type { AssistantMessageRow } from "../db/queries/assistant-messages";

function harness() {
  const calls: { updated?: { content: string; sources: unknown }; removed: boolean } = { removed: false };
  const update = async (content: string, sources: unknown): Promise<AssistantMessageRow | null> => {
    calls.updated = { content, sources };
    return { id: "a1", staffUserId: "s", role: "assistant", content, sources, createdAt: new Date(1) } as AssistantMessageRow;
  };
  const remove = async () => { calls.removed = true; };
  return { calls, update, remove };
}

test("정상 완료: 원문 그대로 + sources 저장, done", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "답변", aborted: false, failed: false, sources: [{ s: 1 }], update: h.update, remove: h.remove });
  expect(out.kind).toBe("done");
  expect(h.calls.updated).toEqual({ content: "답변", sources: [{ s: 1 }] });
  expect(h.calls.removed).toBe(false);
});

test("중단(부분 있음): ' (중단됨)' suffix 저장", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "부분", aborted: true, failed: false, sources: null, update: h.update, remove: h.remove });
  expect(out.kind).toBe("done");
  expect(h.calls.updated!.content).toBe(`부분${STOP_SUFFIX}`);
});

test("스트림 중간 실패(부분 있음): ' (연결 오류로 중단됨)' suffix 저장", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "부분", aborted: false, failed: true, sources: null, update: h.update, remove: h.remove });
  expect(out.kind).toBe("done");
  expect(h.calls.updated!.content).toBe(`부분${ERROR_SUFFIX}`);
});

test("aborted+failed 동시: aborted 우선 — ' (중단됨)' suffix 저장", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "부분", aborted: true, failed: true, sources: null, update: h.update, remove: h.remove });
  expect(out.kind).toBe("done");
  expect(h.calls.updated!.content).toBe(`부분${STOP_SUFFIX}`);
});

test("0자(중단/실패/빈 완료 공통): placeholder 삭제 + error", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "", aborted: true, failed: false, sources: null, update: h.update, remove: h.remove });
  expect(out.kind).toBe("error");
  expect(h.calls.removed).toBe(true);
  expect(h.calls.updated).toBeUndefined();
});

test("0자 정상완료(aborted/failed 모두 false): remove 호출 + error", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({ fullText: "", aborted: false, failed: false, sources: null, update: h.update, remove: h.remove });
  expect(out.kind).toBe("error");
  expect(h.calls.removed).toBe(true);
  expect(h.calls.updated).toBeUndefined();
});

test("update가 null(행 소실) 반환 시 error", async () => {
  const h = harness();
  const out = await finalizeStreamedAnswer({
    fullText: "답변", aborted: false, failed: false, sources: null,
    update: async () => null, remove: h.remove,
  });
  expect(out.kind).toBe("error");
});

// 클라 임시 표시(assistant-drain.ts)와 서버 저장 suffix의 드리프트 tripwire — 값이 갈라지면 중지 직후
// 화면 문구와 리로드 후 저장본 문구가 달라진다.
test("STOP_SUFFIX 서버↔클라 파리티", async () => {
  const { STOP_SUFFIX: CLIENT_STOP_SUFFIX } = await import("../../client/src/lib/assistant-drain");
  expect(STOP_SUFFIX).toBe(CLIENT_STOP_SUFFIX);
});
