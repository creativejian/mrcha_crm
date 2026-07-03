import type { AssistantMessageRow } from "../db/queries/assistant-messages";

export const STOP_SUFFIX = " (중단됨)"; // 앱 미러
export const ERROR_SUFFIX = " (연결 오류로 중단됨)";

export type StreamOutcome = { kind: "done"; assistant: AssistantMessageRow } | { kind: "error" };

// 스트리밍 종료 상태에 따라 선저장된 placeholder를 마감한다.
// - 0자: 삭제 + error (빈 assistant 메시지를 히스토리에 남기지 않음 — 정상 done인데 0자여도 동일)
// - aborted: STOP_SUFFIX / failed: ERROR_SUFFIX / 정상: 원문 그대로. sources는 부분 저장에도 동일 근거라 항상 저장.
export async function finalizeStreamedAnswer(opts: {
  fullText: string;
  aborted: boolean;
  failed: boolean;
  sources: unknown;
  update: (content: string, sources: unknown) => Promise<AssistantMessageRow | null>;
  remove: () => Promise<void>;
}): Promise<StreamOutcome> {
  if (opts.fullText.length === 0) {
    await opts.remove();
    return { kind: "error" };
  }
  const suffix = opts.aborted ? STOP_SUFFIX : opts.failed ? ERROR_SUFFIX : "";
  const updated = await opts.update(opts.fullText + suffix, opts.sources);
  return updated ? { kind: "done", assistant: updated } : { kind: "error" };
}
