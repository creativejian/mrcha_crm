import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { Customer } from "@/data/customers";
import { CHAT_QUEUE_TABS, CHAT_TAB_LABELS, type ChatQueueTab } from "@/data/chat";
import type { RoleTab } from "@/data/roles";
import { getStaffId } from "@/lib/chat";
import { fetchStaffDirectory, type StaffEntry } from "@/lib/staff";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useChatThread } from "@/hooks/useChatThread";
import { ChatQueue } from "@/components/chat/ChatQueue";
import { ChatThread } from "@/components/chat/ChatThread";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatSessionHeader } from "@/components/chat/ChatSessionHeader";
import { ChatCustomerPanel } from "@/components/chat/ChatCustomerPanel";
import { HandoffStatusBadge } from "@/components/chat/HandoffStatusBadge";

type ChatPageProps = {
  customers: Customer[];
  roleTab: RoleTab;
  onOpenCustomer: (customer: Customer) => void;
  onToast: (message: string) => void;
  onRead: () => void; // Topbar pending 알림 읽음 처리
};

export function ChatPage({ customers, roleTab, onOpenCustomer, onToast, onRead }: ChatPageProps) {
  useEffect(() => { onRead(); }, [onRead]);
  const { sessions, loading, reload } = useChatSessions(onToast);
  const [tab, setTab] = useState<ChatQueueTab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffEntry[]>([]);

  useEffect(() => {
    getStaffId().then(setStaffId).catch(() => setStaffId(null));
    fetchStaffDirectory().then(setStaffOptions).catch(() => setStaffOptions([]));
  }, []);

  // 고객 상세 → 앱 채팅 딥링크(?user=<appUserId>): 수동 선택(selectedId)이 없는 동안 그 유저의
  // 최신 세션을 선택한다(목록이 updated_at desc — 첫 매치 = 최신). 상태 복제 없이 URL이 선택의
  // 소스(드로어 ?customer 문법 미러)라 새로고침에도 유지되고, 다른 세션을 클릭하면 selectedId가 이긴다.
  const [searchParams] = useSearchParams();
  const deepLinkUserId = searchParams.get("user");
  const deepLinkSession = deepLinkUserId ? sessions.find((s) => s.userId === deepLinkUserId) ?? null : null;
  useEffect(() => {
    if (loading || !deepLinkUserId || deepLinkSession) return;
    // 세션 미발견은 로드 완료 후 한 번만 안내 — deps가 전부 안정값(null 유지)이라 재조회에 재발화하지 않는다.
    onToast("이 고객의 앱 채팅 세션이 없습니다.");
  }, [loading, deepLinkUserId, deepLinkSession, onToast]);

  const visible = tab === "all" ? sessions : sessions.filter((session) => session.mode === tab);
  // 선택 세션은 탭 필터와 독립적으로 유지 — 인수(pending→human) 직후에도 보던 스레드를 지키고,
  // 미선택 상태에서만 현재 탭의 첫 세션으로 자동 선택한다.
  const active = (selectedId ? sessions.find((s) => s.id === selectedId) : undefined) ?? deepLinkSession ?? visible[0] ?? null;
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
        <HandoffStatusBadge canManage={roleTab === "최고관리자"} />
      </div>
      <div className="chat-layout">
        <ChatQueue activeId={active?.id ?? null} onSelect={setSelectedId} sessions={visible} unassignedCount={unassignedCount} />
        <section className="card chat-window">
          {!active && <div className="chat-window-empty">{loading ? "상담 목록을 불러오는 중…" : "왼쪽에서 상담을 선택하세요."}</div>}
          {active && (
            <>
              <ChatSessionHeader onChanged={reload} onToast={onToast} session={active} staffId={staffId} staffOptions={staffOptions} />
              <ChatThread customerAvatarUrl={active.customerAvatarUrl} customerLabel={customerLabel} customerTyping={thread.customerTyping} hasMore={thread.hasMore} loadingOlder={thread.loadingOlder} messages={thread.messages} onLoadOlder={thread.loadOlder} />
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
