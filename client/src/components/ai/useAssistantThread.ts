import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { askAssistant, fetchAssistantMessages, type AssistantMessage } from "@/lib/assistant";

export const AI_HISTORY_PAGE = 30; // 백엔드 DISPLAY_LIMIT와 일치
const OLDER_INDICATOR_MIN_MS = 400; // 빠른 로드에도 로딩 표시가 최소 이 시간은 보이도록(번쩍임 방지)

export type AssistantThreadEntry =
  | { kind: "message"; message: AssistantMessage }
  | { kind: "pending"; tempId: string; question: string; error?: string };

export type HistoryStatus = "idle" | "loading" | "loaded" | "error";

// 낙관적 turn. afterMessageId = 생성 시점의 마지막 메시지(시간순 자리 고정용 — 이후 새 대화가 와도 역전 없음).
type PendingTurn = { tempId: string; question: string; afterMessageId: string | null; error?: string };

// (createdAt, id) 복합 정렬 — 서버 커서 정렬과 동일 기준. ISO UTC 직렬화라 문자열 비교로 충분.
function compareMessages(a: AssistantMessage, b: AssistantMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// id 합집합 + 복합 정렬. 늦게 도착한 초기 스냅샷이 그 사이 append된 새 메시지를 지우지 못한다(replace 금지).
export function mergeAssistantMessages(current: AssistantMessage[], incoming: AssistantMessage[]): AssistantMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(compareMessages);
}

// 업무 AI 대화 스레드 상태기계 — Topbar가 소유하고(팝오버 닫아도 유지) AiAssistantPanel이 렌더한다.
export function useAssistantThread() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [pendings, setPendings] = useState<PendingTurn[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("idle");
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [asking, setAsking] = useState(false);

  // 비동기 콜백에서 최신 messages를 읽기 위한 미러(stale closure 방지).
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const statusRef = useRef<HistoryStatus>("idle");
  const loadingOlderRef = useRef(false); // onScroll 고빈도 재진입 가드(state는 커밋 지연)
  const tempSeqRef = useRef(0);
  // 직전 갱신이 "이전 메시지 prepend"였으면 새 배치의 최상단 메시지 id — 패널이 소비 후 null로 되돌린다.
  const prependAnchorRef = useRef<string | null>(null);

  // pending은 afterMessageId 뒤에 끼워 시간순을 유지한다(성공 대화가 나중에 와도 실패 turn이 아래로 밀리지 않음).
  const entries = useMemo<AssistantThreadEntry[]>(() => {
    const byAnchor = new Map<string | null, PendingTurn[]>();
    for (const p of pendings) {
      const list = byAnchor.get(p.afterMessageId) ?? [];
      list.push(p);
      byAnchor.set(p.afterMessageId, list);
    }
    const out: AssistantThreadEntry[] = [];
    for (const p of byAnchor.get(null) ?? []) out.push({ kind: "pending", tempId: p.tempId, question: p.question, error: p.error });
    for (const m of messages) {
      out.push({ kind: "message", message: m });
      for (const p of byAnchor.get(m.id) ?? []) out.push({ kind: "pending", tempId: p.tempId, question: p.question, error: p.error });
    }
    return out;
  }, [messages, pendings]);

  // 최초 로드(idle) 또는 실패(error) 상태에서만 페이지1을 불러온다 — 실패가 세션 내 영구 고착되지 않게 재호출 허용.
  // useCallback([]): Topbar의 "팝오버 열림" effect 의존성으로 쓰여 재실행 루프를 막는다(내부는 ref/setter만 사용).
  const ensureHistory = useCallback(async (): Promise<void> => {
    if (statusRef.current === "loading" || statusRef.current === "loaded") return;
    statusRef.current = "loading";
    setHistoryStatus("loading");
    try {
      const rows = await fetchAssistantMessages();
      setMessages((cur) => mergeAssistantMessages(cur, rows));
      setHasMore(rows.length === AI_HISTORY_PAGE);
      statusRef.current = "loaded";
      setHistoryStatus("loaded");
    } catch {
      statusRef.current = "error";
      setHistoryStatus("error");
    }
  }, []);

  async function loadOlder(): Promise<void> {
    if (loadingOlderRef.current || !hasMore) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const startedAt = Date.now();
    try {
      const older = await fetchAssistantMessages({ createdAt: oldest.createdAt, id: oldest.id });
      if (older.length > 0) {
        prependAnchorRef.current = older[0].id; // 새로 불러온 배치의 가장 오래된 메시지를 상단에 노출
        setMessages((cur) => mergeAssistantMessages(cur, older));
      }
      setHasMore(older.length === AI_HISTORY_PAGE);
    } catch {
      // 실패 시 앵커/스크롤 없음 — 다음 스크롤에서 재시도된다.
    } finally {
      const remaining = OLDER_INDICATOR_MIN_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  // 질문 전송. 성공 시 낙관적 turn을 영속본(user/assistant 2건)으로 제자리 대체, 실패 시 turn에 에러 표시.
  async function submit(questionRaw: string): Promise<boolean> {
    const question = questionRaw.trim();
    if (!question || asking) return false;
    const tempId = `pending-${++tempSeqRef.current}`;
    const afterMessageId = messagesRef.current.at(-1)?.id ?? null;
    setPendings((cur) => [...cur, { tempId, question, afterMessageId }]);
    setAsking(true);
    try {
      const res = await askAssistant(question);
      setMessages((cur) => mergeAssistantMessages(cur, res.messages));
      setPendings((cur) => cur.filter((p) => p.tempId !== tempId)); // tempId 기준 — 동일 문구 실패 이력은 보존
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "일시적으로 답변에 실패했습니다.";
      setPendings((cur) => cur.map((p) => (p.tempId === tempId ? { ...p, error: message } : p)));
      return false;
    } finally {
      setAsking(false);
    }
  }

  return { entries, historyStatus, hasMore, loadingOlder, asking, prependAnchorRef, ensureHistory, loadOlder, submit };
}
