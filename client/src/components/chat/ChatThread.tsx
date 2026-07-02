import { useEffect, useRef } from "react";
import { parseChatTimestamp, type ChatMessage } from "@/lib/chat";
import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { CustomerAvatar } from "@/components/chat/CustomerAvatar";

const BUBBLE_CLASS: Record<ChatMessage["senderKind"], string> = {
  customer: "customer",
  ai: "ai",
  staff: "advisor",
  system: "system",
};

function timeLabel(iso: string): string {
  const d = parseChatTimestamp(iso); // REST/Realtime 직렬화 편차 + JSC(Safari) NaN 안전 파싱
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

type ChatThreadProps = {
  messages: ChatMessage[];
  customerLabel: string; // 고객명(profiles.full_name) 있으면 이름, 없으면 "고객"
  customerAvatarUrl: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
};

export function ChatThread({ messages, customerLabel, customerAvatarUrl, hasMore, loadingOlder, onLoadOlder }: ChatThreadProps) {
  const senderLabel: Record<Exclude<ChatMessage["senderKind"], "system">, string> = {
    customer: customerLabel,
    ai: "AI",
    staff: "상담원",
  };
  const listRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);
  const prevHeightRef = useRef(0);

  // 새 메시지(마지막 id 변경) → 최하단 이동. 위쪽 prepend(더 보기) → 기존 읽던 위치 유지(높이 증가분 보정).
  useEffect(() => {
    const el = listRef.current;
    if (!el || messages.length === 0) return;
    const lastId = messages[messages.length - 1].id;
    if (lastIdRef.current !== lastId) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
    }
    lastIdRef.current = lastId;
    prevHeightRef.current = el.scrollHeight;
  }, [messages]);

  return (
    <div className="chat-messages" ref={listRef}>
      {hasMore && (
        <button className="chat-load-more" disabled={loadingOlder} onClick={onLoadOlder} type="button">
          {loadingOlder ? "불러오는 중…" : "이전 메시지 더 보기"}
        </button>
      )}
      {messages.map((message) => {
        if (message.senderKind === "system") {
          return (
            <div className="message system" key={message.id}>
              <span className="message-text">{message.message}</span>
            </div>
          );
        }
        /* 앱 미러: 보낸이 라벨은 버블 밖 위, 버블 안엔 본문만. 고객 메시지는 아바타 동반 */
        const group = (
          <div className={`message-group ${BUBBLE_CLASS[message.senderKind]}`}>
            <small className="message-sender">{senderLabel[message.senderKind]} · {timeLabel(message.createdAt)}</small>
            <div className={`message ${BUBBLE_CLASS[message.senderKind]}`}>
              {message.attachmentUrl && (
                <a className="message-attachment" href={message.attachmentUrl} rel="noreferrer" target="_blank">
                  <img
                    alt="첨부 이미지"
                    src={message.attachmentUrl}
                    style={message.attachmentWidth && message.attachmentHeight ? { aspectRatio: `${message.attachmentWidth} / ${message.attachmentHeight}` } : undefined}
                  />
                </a>
              )}
              {/* AI 답변만 마크다운 렌더(raw HTML 미허용 = XSS 안전), 나머지는 평문 */}
              {message.senderKind === "ai"
                ? <MarkdownMessage content={message.message} />
                : <span className="message-text">{message.message}</span>}
            </div>
          </div>
        );
        if (message.senderKind !== "customer") {
          return <div className={`message-row ${BUBBLE_CLASS[message.senderKind]}`} key={message.id}>{group}</div>;
        }
        return (
          <div className="message-row customer" key={message.id}>
            <CustomerAvatar url={customerAvatarUrl} />
            {group}
          </div>
        );
      })}
    </div>
  );
}
