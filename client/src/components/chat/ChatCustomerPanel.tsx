import type { Customer } from "@/data/customers";
import type { ChatSession } from "@/lib/chat";

type ChatCustomerPanelProps = {
  session: ChatSession | null;
  customer: Customer | null; // app_user_id 매칭 결과(없으면 미승격)
  onOpenCustomer: (customer: Customer) => void;
};

export function ChatCustomerPanel({ session, customer, onOpenCustomer }: ChatCustomerPanelProps) {
  return (
    <aside className="card chat-panel">
      <div className="panel-head"><h2>고객 정보</h2>{customer && <span className="badge blue">CRM 연결됨</span>}</div>
      <div className="panel-body">
        {!session && <p className="chat-panel-empty">상담을 선택하세요.</p>}
        {session && (
          <div className="insight-stack">
            <div className="insight-item"><span>고객명</span><strong>{session.customerName}</strong><p>{session.customerEmail ?? "이메일 없음"}</p></div>
            {customer && <div className="insight-item"><span>CRM 고객</span><strong>{customer.customerId}</strong><p>{customer.vehicle ? `${customer.vehicle} · ${customer.method}` : "니즈 미입력"}</p></div>}
            {!customer && <div className="insight-item"><span>CRM 고객</span><strong>미승격</strong><p>앱 견적요청 인박스에서 승격하면 연결됩니다.</p></div>}
          </div>
        )}
        <div className="action-stack">
          <button className="btn primary" disabled={!customer} onClick={() => customer && onOpenCustomer(customer)} title={customer ? undefined : "미승격 고객"} type="button">고객 상세 이동</button>
        </div>
      </div>
    </aside>
  );
}
