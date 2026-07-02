import { useState } from "react";
import type { ChatSession } from "@/lib/chat";

type ChatComposerProps = {
  session: ChatSession;
  staffId: string | null;
  onSend: (message: string) => Promise<boolean>;
  onTyping: () => void; // keystroke마다 호출(1s throttle은 lib 책임). canSend일 때만 input이 렌더돼 자연 gate(앱 미러)
};

// 활성 조건 = 앱 미러: mode==='human' && assignedStaffId===내 staffId (admin_chat_detail_screen.dart:100-102).
export function ChatComposer({ session, staffId, onSend, onTyping }: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const canSend = session.mode === "human" && staffId !== null && session.assignedStaffId === staffId;

  if (!canSend) {
    const notice =
      session.mode === "human" ? "다른 상담원이 대화 중입니다."
      : session.mode === "pending" ? "고객이 상담원 연결을 요청했습니다. 채팅 시작을 눌러 대화에 참여하세요."
      : "AI 상담 모드입니다.";
    return <div className="chat-compose"><span className="chat-disabled-banner">{notice}</span></div>;
  }

  async function submit() {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setDraft("");
    const ok = await onSend(message);
    if (!ok) setDraft(message); // 실패 시 원문 복원(spec §8)
    setSending(false);
  }

  return (
    <div className="chat-compose">
      <input
        className="input"
        onChange={(event) => { setDraft(event.target.value); onTyping(); }}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit(); }}
        placeholder="고객에게 보낼 메시지를 입력하세요"
        value={draft}
      />
      <button className="btn primary" disabled={sending || draft.trim().length === 0} onClick={() => void submit()} type="button">전송</button>
    </div>
  );
}
