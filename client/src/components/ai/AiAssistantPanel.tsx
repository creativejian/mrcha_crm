import { Maximize2, Send, Square, X } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";

import { DoubleBounceDots } from "@/components/ai/DoubleBounceDots";
import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { type useAssistantThread } from "@/components/ai/useAssistantThread";
import { NEW_TURN_TOP_GAP, computeTurnMinHeight } from "@/lib/assistant-layout";

import { QUICK_AI_PROMPTS } from "@/components/ai/quick-prompts";

type AiAssistantPanelProps = {
  thread: ReturnType<typeof useAssistantThread>; // 스레드 상태는 Topbar 소유 — 팝오버를 닫아도 대화가 유지된다
  expanded: boolean;
  closing: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
};

// Topbar 업무 AI 팝오버 본체(헤더·대화·입력). 팝오버 열림/닫힘·shield는 Topbar 책임.
export function AiAssistantPanel({ thread, expanded, closing, onToggleExpand, onClose }: AiAssistantPanelProps) {
  const [input, setInput] = useState("");
  const [selectedPrompt, setSelectedPrompt] = useState<string>(QUICK_AI_PROMPTS[0].text);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { entries, historyStatus, hasMore, loadingOlder, asking, prependAnchorRef, newTurnAnchorRef } = thread;
  // 마지막 턴 assistant 요소에 줄 min-height(px). 새 턴 전송 시 계산 — 영속 교체 후에도 렌더에 유지돼 스크롤 점프가 없다.
  const [turnMinHeight, setTurnMinHeight] = useState<number | null>(null);

  // 대화 갱신 시 스크롤 분기:
  //  - 이전 대화 prepend → 그 배치 최상단 앵커(기존 동작)
  //  - 새 턴 전송 → 질문을 상단 20px에 앵커 + 마지막 턴 min-height 예약(아래 공간 확보, 앱 미러)
  //  - 그 외(스트리밍 틱·done 교체 등) → 스크롤 안 함(질문 고정이 핵심 — 답변은 예약 공간을 채우며 자란다)
  //  - 마운트 직후·히스토리 로드 완료 전이 → 최하단(기존 동작)
  const mountedRef = useRef(false);
  const prevStatusRef = useRef(historyStatus);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const prependId = prependAnchorRef.current;
    const newTurnId = newTurnAnchorRef.current;
    const loadedNow = prevStatusRef.current === "loading" && historyStatus === "loaded";
    prevStatusRef.current = historyStatus;

    if (prependId) {
      prependAnchorRef.current = null;
      const anchor = el.querySelector<HTMLElement>(`[data-eid="${prependId}"]`);
      el.scrollTop = anchor ? anchor.offsetTop : el.scrollHeight;
    } else if (newTurnId) {
      newTurnAnchorRef.current = null;
      const question = el.querySelector<HTMLElement>(`[data-eid="${newTurnId}-q"]`);
      if (question) {
        const minHeight = computeTurnMinHeight(el.clientHeight, question.offsetHeight);
        // 스크롤 목표가 max-scroll에 클램프되지 않도록 DOM에 먼저 반영(같은 프레임), state는 이후 렌더 유지용.
        const answer = el.querySelector<HTMLElement>(`[data-eid="${newTurnId}-a"]`);
        if (answer) answer.style.minHeight = `${minHeight}px`;
        setTurnMinHeight(minHeight);
        el.scrollTo({ top: question.offsetTop - NEW_TURN_TOP_GAP, behavior: "smooth" });
      }
    } else if (!mountedRef.current || loadedNow) {
      el.scrollTop = el.scrollHeight;
    }
    mountedRef.current = true;
  }, [entries, asking, historyStatus, prependAnchorRef, newTurnAnchorRef]);

  // body 크기 변화 시 마지막 턴 min-height 재계산(스크롤은 유지). expanded 의존 effect는 CSS 전환이
  // 끝나기 전의 높이를 측정해 옛값이 잔존했다(스모크 실측) — ResizeObserver가 전환 완료 후 최종 크기를
  // 자연 포착하고 창 리사이즈까지 커버한다. 질문 요소는 pending(tempId-q)→영속(UUID) 교체로 data-eid가
  // 바뀌므로 id가 아니라 "마지막 user 버블"로 조회한다.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setTurnMinHeight((cur) => {
        if (cur === null) return cur; // 활성 턴이 없으면 예약 없음 유지
        const users = el.querySelectorAll<HTMLElement>(".work-ai-message.user");
        const question = users[users.length - 1];
        return question ? computeTurnMinHeight(el.clientHeight, question.offsetHeight) : cur;
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function submitQuestion() {
    const question = input.trim();
    if (!question || asking) return;
    setInput("");
    // 전송 텍스트가 빠른 질문과 정확히 일치하면 도구 결정론 라우팅 — 사용자가 문구를 고치면
    // 자유 질문(기존 RAG 경로)으로 흐른다(모델 라우팅은 PR2).
    const tool = QUICK_AI_PROMPTS.find((p) => p.text === question)?.tool;
    await thread.submit(question, tool);
  }

  return (
    <section className={`work-ai-panel ${expanded ? "expanded" : ""} ${closing ? "closing" : ""}`} role="dialog" aria-label="업무 AI">
      <div className="work-ai-head">
        <div className="work-ai-title"><strong>업무 AI</strong><small>CRM 데이터를 기준으로 우선순위를 정리합니다.</small></div>
        <div className="work-ai-actions"><button className={expanded ? "active" : ""} onClick={onToggleExpand} type="button" aria-label={expanded ? "업무 AI 축소" : "업무 AI 확대"} aria-pressed={expanded}><Maximize2 size={15} /></button><button onClick={onClose} type="button" aria-label="닫기"><X size={16} /></button></div>
      </div>
      <div className="work-ai-body-shell">
        {loadingOlder && <div className="work-ai-load-older"><DoubleBounceDots /></div>}
        <div className="work-ai-body" ref={bodyRef} onScroll={(event) => { if (event.currentTarget.scrollTop < 40 && hasMore && !loadingOlder) void thread.loadOlder(); }}>
          <div className="work-ai-message assistant">
            <strong>오늘 브리핑</strong>
            <p>궁금한 업무를 물어보면 CRM 데이터(메모·상담·니즈)를 근거로 답합니다.</p>
          </div>
          <div className="work-ai-quick">
            <span>빠른 질문</span>
            <div>
              {QUICK_AI_PROMPTS.map((prompt) => (
                <button className={selectedPrompt === prompt.text ? "active" : ""} key={prompt.text} onClick={() => { setSelectedPrompt(prompt.text); setInput(prompt.text); }} type="button">{prompt.text}</button>
              ))}
            </div>
          </div>
          {historyStatus === "loading" && (
            <div className="work-ai-history-loading" aria-label="이전 대화 불러오는 중"><DoubleBounceDots /></div>
          )}
          {historyStatus === "error" && (
            <div className="work-ai-history-error">
              <p>이전 대화를 불러오지 못했습니다.</p>
              <button onClick={() => void thread.ensureHistory()} type="button">다시 시도</button>
            </div>
          )}
          {entries.map((entry, index) => {
            const isLast = index === entries.length - 1;
            const lastTurnStyle = isLast && turnMinHeight !== null ? { minHeight: `${turnMinHeight}px` } : undefined;
            if (entry.kind === "message") {
              return (
                <div
                  className={`work-ai-message ${entry.message.role}`}
                  data-eid={entry.message.id}
                  key={entry.message.id}
                  style={entry.message.role === "assistant" ? lastTurnStyle : undefined}
                >
                  {entry.message.role === "assistant" ? <MarkdownMessage content={entry.message.content} /> : <p>{entry.message.content}</p>}
                  {entry.message.role === "assistant" && entry.message.sources && entry.message.sources.length > 0 && (
                    <ul className="work-ai-sources">
                      {entry.message.sources.map((source, sourceIndex) => <li key={sourceIndex}>{source.customerName} · {source.snippet}</li>)}
                    </ul>
                  )}
                </div>
              );
            }
            return (
              <Fragment key={entry.tempId}>
                <div className="work-ai-message user" data-eid={`${entry.tempId}-q`}><p>{entry.question}</p></div>
                <div className="work-ai-message assistant" data-eid={`${entry.tempId}-a`} style={lastTurnStyle}>
                  {entry.error ? <p className="work-ai-error">{entry.error}</p>
                    : entry.streamText ? <MarkdownMessage content={entry.streamText} />
                    : entry.stopped ? null // 청크 전 중지 — 인디케이터 즉시 제거(서버는 placeholder 삭제, 질문만 유지)
                    : <DoubleBounceDots />}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
      <div className="work-ai-compose">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submitQuestion(); } }}
          placeholder="업무 AI에게 물어보기"
        />
        <button
          type="button"
          aria-label={asking ? "생성 중지" : "보내기"}
          onClick={() => (asking ? thread.stop() : void submitQuestion())}
        >
          {asking ? <Square size={14} /> : <Send size={16} />}
        </button>
      </div>
    </section>
  );
}
