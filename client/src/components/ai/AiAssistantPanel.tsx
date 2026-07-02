import { Maximize2, Send, X } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";

import { DoubleBounceDots } from "@/components/ai/DoubleBounceDots";
import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { type useAssistantThread } from "@/components/ai/useAssistantThread";

const quickAiPrompts = [
  "오늘 내가 먼저 처리할 일 정리해줘",
  "계약 가능성 높은 고객 순위 뽑아줘",
  "응답 지연 고객 알려줘",
  "오늘 견적 보낼 고객 정리해줘",
  "출고/정산 리스크 찾아줘",
];

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
  const [selectedPrompt, setSelectedPrompt] = useState(quickAiPrompts[0]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { entries, historyStatus, hasMore, loadingOlder, asking, prependAnchorRef } = thread;

  // 대화 갱신 시 스크롤: 이전 메시지 prepend면 그 배치의 최상단 메시지(data-eid 앵커)를 상단에 노출, 그 외엔 최하단.
  // data-eid 앵커 방식이라 본문 위 브리핑/빠른질문 블록이 바뀌어도 어긋나지 않는다(children[n] 위치 결합 제거).
  // 앵커는 상단 근접(<40px) 밖에 위치하므로 자동 연쇄 로딩도 안 생긴다.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const anchorId = prependAnchorRef.current;
    if (anchorId) {
      prependAnchorRef.current = null;
      const anchor = el.querySelector<HTMLElement>(`[data-eid="${anchorId}"]`);
      el.scrollTop = anchor ? anchor.offsetTop : el.scrollHeight;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries, asking, prependAnchorRef]);

  async function submitQuestion() {
    const question = input.trim();
    if (!question || asking) return;
    setInput("");
    await thread.submit(question);
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
              {quickAiPrompts.map((prompt) => (
                <button className={selectedPrompt === prompt ? "active" : ""} key={prompt} onClick={() => { setSelectedPrompt(prompt); setInput(prompt); }} type="button">{prompt}</button>
              ))}
            </div>
          </div>
          {historyStatus === "error" && (
            <div className="work-ai-history-error">
              <p>이전 대화를 불러오지 못했습니다.</p>
              <button onClick={() => void thread.ensureHistory()} type="button">다시 시도</button>
            </div>
          )}
          {entries.map((entry) =>
            entry.kind === "message" ? (
              <div className={`work-ai-message ${entry.message.role}`} data-eid={entry.message.id} key={entry.message.id}>
                {entry.message.role === "assistant" ? <MarkdownMessage content={entry.message.content} /> : <p>{entry.message.content}</p>}
                {entry.message.role === "assistant" && entry.message.sources && entry.message.sources.length > 0 && (
                  <ul className="work-ai-sources">
                    {entry.message.sources.map((source, index) => <li key={index}>{source.customerName} · {source.snippet}</li>)}
                  </ul>
                )}
              </div>
            ) : (
              <Fragment key={entry.tempId}>
                <div className="work-ai-message user"><p>{entry.question}</p></div>
                <div className="work-ai-message assistant">
                  {entry.error ? <p className="work-ai-error">{entry.error}</p> : <DoubleBounceDots />}
                </div>
              </Fragment>
            ),
          )}
        </div>
      </div>
      <div className="work-ai-compose">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submitQuestion(); } }}
          placeholder="업무 AI에게 물어보기"
        />
        <button type="button" aria-label="보내기" disabled={asking} onClick={() => void submitQuestion()}><Send size={16} /></button>
      </div>
    </section>
  );
}
