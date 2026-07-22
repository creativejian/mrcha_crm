import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { askAssistantStream, fetchAssistantMessages, updateAssistantMessageContent, type AssistantAskResult, type AssistantMessage } from "@/lib/assistant";
import { DRAIN_TICK_MS, STOP_SUFFIX, nextDisplayLength } from "@/lib/assistant-drain";
import { AI_HISTORY_PAGE } from "@/lib/assistant-history";

const OLDER_INDICATOR_MIN_MS = 400; // 빠른 로드에도 로딩 표시가 최소 이 시간은 보이도록(번쩍임 방지)
const STOP_SYNC_DELAY_MS = 500; // 중지 후 백그라운드 재조회 1차 지연 — 이후 선형 증가(0.5·1·1.5…)
const STOP_SYNC_RETRIES = 6; // 서버 마감은 하트비트 감지(≤5s)+저장까지 수 초 — 누적 ~10.5s 커버(백그라운드라 UX 비용 없음)

export type AssistantThreadEntry =
  | { kind: "message"; message: AssistantMessage }
  | { kind: "pending"; tempId: string; question: string; error?: string; streamText?: string; stopped?: boolean };

export type HistoryStatus = "idle" | "loading" | "loaded" | "error";

// 낙관적 turn. afterMessageId = 생성 시점의 마지막 메시지(시간순 자리 고정용 — 이후 새 대화가 와도 역전 없음).
// stopped: 사용자가 중지한 turn — 인디케이터를 즉시 내리고(dots 제거) 서버 동기화를 백그라운드로 기다린다.
type PendingTurn = { tempId: string; question: string; afterMessageId: string | null; error?: string; streamText?: string; stopped?: boolean };

// (createdAt, id) 복합 정렬 — 서버 커서 정렬과 동일 기준. ISO UTC 직렬화라 문자열 비교로 충분.
function compareMessages(a: AssistantMessage, b: AssistantMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// id 합집합 + 복합 정렬. 늦게 도착한 초기 스냅샷이 그 사이 append된 새 메시지를 지우지 못한다(replace 금지).
function mergeAssistantMessages(current: AssistantMessage[], incoming: AssistantMessage[]): AssistantMessage[] {
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
  const abortRef = useRef<AbortController | null>(null);
  const drainTimerRef = useRef<ReturnType<typeof setInterval> | null>(null); // asking 가드로 동시 1턴만 사용
  // 직전 갱신이 "새 턴 전송"이면 그 tempId — 패널이 앵커 스크롤 후 null로 되돌린다(prependAnchorRef와 동일 패턴).
  const newTurnAnchorRef = useRef<string | null>(null);

  // 언마운트 시 in-flight 스트림 abort + 드레인 타이머 정리(Topbar 상주라 드물지만 hang된 스트림의 유일한 회복 경로 보강).
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (drainTimerRef.current) clearInterval(drainTimerRef.current);
    },
    [],
  );

  // pending은 afterMessageId 뒤에 끼워 시간순을 유지한다(성공 대화가 나중에 와도 실패 turn이 아래로 밀리지 않음).
  const entries = useMemo<AssistantThreadEntry[]>(() => {
    const byAnchor = new Map<string | null, PendingTurn[]>();
    for (const p of pendings) {
      const list = byAnchor.get(p.afterMessageId) ?? [];
      list.push(p);
      byAnchor.set(p.afterMessageId, list);
    }
    const out: AssistantThreadEntry[] = [];
    for (const p of byAnchor.get(null) ?? [])
      out.push({ kind: "pending", tempId: p.tempId, question: p.question, error: p.error, streamText: p.streamText, stopped: p.stopped });
    for (const m of messages) {
      // 마감 전 placeholder/유령 빈 assistant 행은 표시하지 않는다(서버가 곧 채우거나 다음 로드에서 해소).
      // 앵커로 쓰인 경우를 위해 pending flush는 유지한다.
      if (!(m.role === "assistant" && m.content === "")) out.push({ kind: "message", message: m });
      for (const p of byAnchor.get(m.id) ?? [])
        out.push({ kind: "pending", tempId: p.tempId, question: p.question, error: p.error, streamText: p.streamText, stopped: p.stopped });
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

  // 질문 전송(SSE 스트리밍). text 청크는 드레인 타자기로 streamText에 점진 노출,
  // done 수신 시 드레인 완주를 기다린 뒤 영속본(user/assistant 2건)으로 교체. 실패 시 turn에 에러 표시.
  async function submit(questionRaw: string, tool?: string): Promise<boolean> {
    const question = questionRaw.trim();
    if (!question || asking) return false;
    const tempId = `pending-${++tempSeqRef.current}`;
    const afterMessageId = messagesRef.current.at(-1)?.id ?? null;
    setPendings((cur) => [...cur, { tempId, question, afterMessageId }]);
    newTurnAnchorRef.current = tempId;
    setAsking(true);
    const abort = new AbortController();
    abortRef.current = abort;

    // 드레인 상태(이 턴 로컬 — state가 아니라 지역 변수, 38ms 틱이 setPendings로만 반영. 타이머 핸들만 언마운트 정리용 ref)
    let fullText = "";
    let displayLength = 0;
    let doneResult: AssistantAskResult | null = null;
    let settleDrain: (() => void) | null = null;
    const drained = new Promise<void>((resolve) => {
      settleDrain = resolve;
    });

    const stopTimer = () => {
      if (drainTimerRef.current) {
        clearInterval(drainTimerRef.current);
        drainTimerRef.current = null;
      }
    };
    const pump = () => {
      const next = nextDisplayLength(fullText, displayLength);
      if (next > displayLength) {
        displayLength = next;
        const text = fullText.slice(0, next);
        setPendings((cur) => cur.map((p) => (p.tempId === tempId ? { ...p, streamText: text } : p)));
      }
      if (doneResult && displayLength >= fullText.length) {
        stopTimer();
        settleDrain?.();
      }
    };
    const ensureTimer = () => {
      if (!drainTimerRef.current) drainTimerRef.current = setInterval(pump, DRAIN_TICK_MS);
    };

    // done 이후(생성·저장 완료, 타자기 드레인만 남음) stop = 드레인 즉시 동결. 서버 생성이 드레인보다
    // 훨씬 빨라 체감 "스트리밍 중" stop의 대부분이 이 구간이다 — fetch는 이미 닫혀 있어 abort가 no-op였던
    // 것이 prod "정지 안 됨"의 원인. 동결 후 처리(트림 저장)는 drained 이후 분기가 담당. done 전 stop은 catch.
    abort.signal.addEventListener("abort", () => {
      if (!doneResult) return;
      stopTimer();
      settleDrain?.();
    });

    try {
      const res = await askAssistantStream(
        question,
        {
          onChunk: (chunk) => {
            fullText += chunk;
            ensureTimer();
          },
        },
        abort.signal,
        tool,
      );
      doneResult = res;
      ensureTimer();
      pump(); // 즉시 done(짧은 답변·hits 0)도 마감되게
      await drained;
      const displayed = fullText.slice(0, displayLength);
      const assistantRow = res.messages.find((m) => m.role === "assistant");
      if (abort.signal.aborted && assistantRow && displayed.length > 0 && displayed.length < fullText.length) {
        // 드레인 중 stop: 화면 노출분+"(중단됨)"으로 즉시 동결하고, 이미 전체가 저장된 서버 행을
        // 노출분으로 트림해 화면과 리로드를 일치시킨다(앱 미러: stop = 본 것까지만).
        const stoppedContent = `${displayed}${STOP_SUFFIX}`;
        setPendings((cur) => cur.map((p) => (p.tempId === tempId ? { ...p, stopped: true, streamText: stoppedContent } : p)));
        void trimStoppedMessage(tempId, res, assistantRow, stoppedContent);
        return false;
      }
      setMessages((cur) => mergeAssistantMessages(cur, res.messages));
      setPendings((cur) => cur.filter((p) => p.tempId !== tempId)); // tempId 기준 — 동일 문구 실패 이력은 보존
      return true;
    } catch (e) {
      stopTimer();
      if (abort.signal.aborted) {
        // 낙관 마감(앱 미러 즉시 정지): 표시분+"(중단됨)"을 확정하고(청크 전이면 인디케이터 제거) 바로 반환 —
        // 버튼·입력이 즉시 풀린다. 서버 저장본(부분+suffix 또는 placeholder 삭제)과의 동기화는 백그라운드.
        const displayed = fullText.slice(0, displayLength);
        setPendings((cur) =>
          cur.map((p) => (p.tempId === tempId ? { ...p, stopped: true, streamText: displayed ? `${displayed}${STOP_SUFFIX}` : undefined } : p)),
        );
        void syncStoppedTurn(tempId, displayed ? `${displayed}${STOP_SUFFIX}` : undefined);
        return false;
      }
      const message = e instanceof Error ? e.message : "일시적으로 답변에 실패했습니다.";
      setPendings((cur) => cur.map((p) => (p.tempId === tempId ? { ...p, error: message, streamText: undefined } : p)));
      return false;
    } finally {
      stopTimer();
      abortRef.current = null;
      setAsking(false);
    }
  }

  // done 이후 stop의 트림 저장 — 실패해도 UI는 이미 동결(서버 원본은 다음 리로드에서 보일 수 있음, 드묾).
  async function trimStoppedMessage(tempId: string, res: AssistantAskResult, row: AssistantMessage, content: string): Promise<void> {
    try {
      const patched = await updateAssistantMessageContent(row.id, content);
      setMessages((cur) => mergeAssistantMessages(cur, res.messages.map((m) => (m.id === patched.id ? patched : m))));
    } catch {
      setMessages((cur) => mergeAssistantMessages(cur, res.messages));
    }
    setPendings((cur) => cur.filter((p) => p.tempId !== tempId));
  }

  // stop 후 서버 저장본과의 백그라운드 동기화 — UI는 기다리지 않는다(즉시 정지 UX).
  // 서버 마감(하트비트 감지→부분 저장/삭제)은 수 초 걸릴 수 있어 마지막 행이 빈 placeholder면
  // 간격을 늘려가며 재조회하고, 저장본이 화면 노출분과 다르면(서버가 더 받았거나 로컬 dev가 전체 저장)
  // 노출분으로 트림해 화면과 리로드를 일치시킨 뒤 낙관 pending을 제거한다.
  async function syncStoppedTurn(tempId: string, stoppedContent?: string): Promise<void> {
    for (let attempt = 0; attempt < STOP_SYNC_RETRIES; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, STOP_SYNC_DELAY_MS * (attempt + 1)));
      try {
        const rows = await fetchAssistantMessages();
        const last = rows.at(-1);
        const settled = !(last && last.role === "assistant" && last.content === "");
        if (settled || attempt === STOP_SYNC_RETRIES - 1) {
          let final = rows;
          if (stoppedContent && last && last.role === "assistant" && last.content !== "" && last.content !== stoppedContent) {
            try {
              const patched = await updateAssistantMessageContent(last.id, stoppedContent);
              final = rows.map((m) => (m.id === patched.id ? patched : m));
            } catch {
              // 트림 실패 — 서버 원본 그대로 반영.
            }
          }
          setMessages((cur) => mergeAssistantMessages(cur, final));
          break;
        }
      } catch {
        // 재조회 실패해도 pending은 제거(이중 표시 방지) — 저장본은 다음 히스토리 로드/리로드에서 표시.
        break;
      }
    }
    setPendings((cur) => cur.filter((p) => p.tempId !== tempId));
  }

  // 생성 중지 — fetch abort. 이후 정리는 submit의 abort 분기가 담당.
  function stop(): void {
    abortRef.current?.abort();
  }

  return {
    entries,
    historyStatus,
    hasMore,
    loadingOlder,
    asking,
    prependAnchorRef,
    newTurnAnchorRef,
    ensureHistory,
    loadOlder,
    submit,
    stop,
  };
}
