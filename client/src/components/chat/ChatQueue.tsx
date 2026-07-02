import { CHAT_MODE_LABELS } from "@/data/chat";
import { waitingLabel, type ChatSession } from "@/lib/chat";

type ChatQueueProps = {
  sessions: ChatSession[];
  activeId: string | null;
  unassignedCount: number;
  onSelect: (id: string) => void;
};

const MODE_BADGE_COLOR: Record<ChatSession["mode"], string> = { pending: "red", human: "green", ai: "" };

export function ChatQueue({ sessions, activeId, unassignedCount, onSelect }: ChatQueueProps) {
  return (
    <section className="card chat-panel">
      <div className="panel-head"><h2>상담 연결 큐</h2>{unassignedCount > 0 && <span className="badge red">미배정 {unassignedCount}</span>}</div>
      <div className="chat-queue">
        {sessions.length === 0 && <p className="chat-queue-empty">해당 상태의 상담이 없습니다.</p>}
        {sessions.map((session) => (
          <button className={`chat-request ${session.id === activeId ? "active" : ""}`} key={session.id} onClick={() => onSelect(session.id)} type="button">
            <div className="chat-request-head"><strong>{session.customerName}</strong><span className={`badge ${MODE_BADGE_COLOR[session.mode]}`}>{CHAT_MODE_LABELS[session.mode]}</span></div>
            <div className="chat-meta">
              {session.mode === "pending"
                ? <span className="badge yellow">{waitingLabel(session.updatedAt, new Date())}</span>
                : <span className="badge">{waitingLabel(session.updatedAt, new Date(), "전")}</span>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
