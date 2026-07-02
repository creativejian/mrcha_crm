import { useState } from "react";
import { CHAT_MODE_LABELS } from "@/data/chat";
import { assignSession, returnSessionToAi, takeOverSession, type ChatSession, type StaffOption } from "@/lib/chat";

type ChatSessionHeaderProps = {
  session: ChatSession;
  staffId: string | null;
  staffOptions: StaffOption[];
  onChanged: () => void; // 세션 reload
  onToast: (message: string) => void;
};

export function ChatSessionHeader({ session, staffId, staffOptions, onChanged, onToast }: ChatSessionHeaderProps) {
  const [busy, setBusy] = useState(false);
  const assignedName = staffOptions.find((option) => option.id === session.assignedStaffId)?.name ?? null;
  const isMineHuman = session.mode === "human" && staffId !== null && session.assignedStaffId === staffId;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch {
      onToast("처리에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-header">
      <div>
        <h2>{session.customerName} · {CHAT_MODE_LABELS[session.mode]}</h2>
        <span>{assignedName ? `담당 ${assignedName}` : "미배정"}{session.customerEmail ? ` · ${session.customerEmail}` : ""}</span>
      </div>
      <div className="top-actions">
        {session.mode !== "human" && (
          <>
            <select
              aria-label="상담원 배정"
              className="chat-assign-select"
              disabled={busy || staffOptions.length === 0}
              onChange={(event) => {
                const nextStaffId = event.target.value;
                if (!nextStaffId) return;
                void run(async () => {
                  await assignSession(session.id, nextStaffId);
                  onToast("상담원을 배정했습니다.");
                });
                event.target.value = "";
              }}
              value=""
            >
              <option value="">배정…</option>
              {staffOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <button
              className="btn primary"
              disabled={busy || staffId === null}
              onClick={() => void run(async () => {
                if (staffId === null) return;
                const ok = await takeOverSession({ id: session.id, userId: session.userId }, staffId);
                onToast(ok ? "상담을 시작합니다. AI 응답은 중지됩니다." : "이미 다른 상담원이 인수했습니다.");
              })}
              type="button"
            >채팅 시작</button>
          </>
        )}
        {isMineHuman && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run(async () => {
              await returnSessionToAi({ id: session.id, userId: session.userId });
              onToast("AI에게 상담을 돌려줬습니다.");
            })}
            type="button"
          >AI에게 반환</button>
        )}
      </div>
    </div>
  );
}
