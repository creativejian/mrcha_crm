import { useEffect, useMemo, useState } from "react";
import type { Customer } from "@/data/customers";
import { CHAT_QUEUE_TABS, CHAT_TAB_LABELS, type ChatQueueTab } from "@/data/chat";
import { fetchStaffOptions, getStaffId, type StaffOption } from "@/lib/chat";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useChatThread } from "@/hooks/useChatThread";
import { ChatQueue } from "@/components/chat/ChatQueue";
import { ChatThread } from "@/components/chat/ChatThread";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatSessionHeader } from "@/components/chat/ChatSessionHeader";
import { ChatCustomerPanel } from "@/components/chat/ChatCustomerPanel";

type ChatPageProps = {
  customers: Customer[];
  onOpenCustomer: (customer: Customer) => void;
  onToast: (message: string) => void;
  onRead: () => void; // Topbar pending 알림 읽음 처리
};

export function ChatPage({ customers, onOpenCustomer, onToast, onRead }: ChatPageProps) {
  useEffect(() => { onRead(); }, [onRead]);
  const { sessions, loading, reload } = useChatSessions(onToast);
  const [tab, setTab] = useState<ChatQueueTab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);

  useEffect(() => {
    getStaffId().then(setStaffId).catch(() => setStaffId(null));
    fetchStaffOptions().then(setStaffOptions).catch(() => setStaffOptions([]));
  }, []);

  const visible = tab === "all" ? sessions : sessions.filter((session) => session.mode === tab);
  // 선택 세션은 탭 필터와 독립적으로 유지 — 인수(pending→human) 직후에도 보던 스레드를 지키고,
  // 미선택 상태에서만 현재 탭의 첫 세션으로 자동 선택한다.
  const active = (selectedId ? sessions.find((s) => s.id === selectedId) : undefined) ?? visible[0] ?? null;
  const thread = useChatThread(active?.userId ?? null, onToast);
  const matchedCustomer = useMemo(
    () => (active ? customers.find((customer) => customer.appUserId === active.userId) ?? null : null),
    [customers, active],
  );
  const countOf = (t: ChatQueueTab) => (t === "all" ? sessions.length : sessions.filter((s) => s.mode === t).length);
  const unassignedCount = sessions.filter((s) => s.mode === "pending" && s.assignedStaffId === null).length;
  // 고객명(full_name) 있으면 이름, 없으면 "고객" — customerName은 이름 없을 때 email로 폴백하므로 email과 같으면 이름 부재.
  const customerLabel = !active || active.customerName === active.customerEmail ? "고객" : active.customerName;

  return (
    <>
      <div className="chat-tabs">
        {CHAT_QUEUE_TABS.map((t) => (
          <button className={`chat-tab ${tab === t ? "active" : ""}`} key={t} onClick={() => { setTab(t); setSelectedId(null); }} type="button">
            {CHAT_TAB_LABELS[t]} {countOf(t)}
          </button>
        ))}
      </div>
      <div className="chat-layout">
        <ChatQueue activeId={active?.id ?? null} onSelect={setSelectedId} sessions={visible} unassignedCount={unassignedCount} />
        <section className="card chat-window">
          {!active && <div className="chat-window-empty">{loading ? "상담 목록을 불러오는 중…" : "왼쪽에서 상담을 선택하세요."}</div>}
          {active && (
            <>
              <ChatSessionHeader onChanged={reload} onToast={onToast} session={active} staffId={staffId} staffOptions={staffOptions} />
              <ChatThread customerLabel={customerLabel} hasMore={thread.hasMore} loadingOlder={thread.loadingOlder} messages={thread.messages} onLoadOlder={thread.loadOlder} />
              {/* 스크롤 리스트 밖, 입력창 바로 위(앱 배치 미러 — 스크롤 앵커와 상호작용 없음) */}
              {thread.customerTyping && (
                <div className="chat-typing-row" aria-live="polite">
                  <span className="chat-typing-label">{customerLabel}</span>
                  <div aria-label={`${customerLabel} 입력 중`} className="chat-typing-bubble">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                </div>
              )}
              <ChatComposer
                key={active.id}
                onSend={(message) => staffId ? thread.send({ sessionId: active.id, staffId, message }) : Promise.resolve(false)}
                onTyping={thread.sendTyping}
                session={active}
                staffId={staffId}
              />
            </>
          )}
        </section>
        <ChatCustomerPanel customer={matchedCustomer} onOpenCustomer={onOpenCustomer} session={active} />
      </div>
    </>
  );
}
