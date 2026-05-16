import { FileText, MessageSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { type Customer, type CustomerMode, customerModeMeta, customerStatusGroups, initialCustomers } from "@/data/customers";

type CustomerManagementPageProps = {
  mode: CustomerMode;
};

function modeFilter(mode: CustomerMode, customer: Customer) {
  if (mode === "consulting") return ["신규", "상담", "견적", "재응대"].includes(customer.statusGroup);
  if (mode === "contract") return customer.statusGroup === "심사/계약";
  if (mode === "delivery") return customer.statusGroup === "출고";
  if (mode === "settlement") return customer.status === "출고완료" && customer.settlementStatus;
  if (mode === "hold") return customer.statusGroup === "종료" || customer.statusGroup === "재응대" || customer.status === "계약취소";
  return true;
}

function badgeClass(value: string, group?: string) {
  if (value === "완료" || value === "계약완료" || group === "출고") return "badge green";
  if (value === "긴급" || value === "계약취소" || value === "심사서류안내") return "badge red";
  if (value === "높음" || value === "보류" || group === "견적" || group === "재응대") return "badge yellow";
  return "badge";
}

const headsByMode: Record<CustomerMode, string[]> = {
  all: ["선택", "고객", "고객유형", "상태", "차량 / 구매", "다음 액션", "AI 요약", "담당", "상담번호", "관리"],
  consulting: ["선택", "고객", "최근 상담", "상담 상태", "AI 요약", "다음 상담 액션", "담당", "관리"],
  contract: ["선택", "고객", "고객유형", "차량 / 구매", "계약 / 심사", "계약 조건", "담당", "다음 액션", "관리"],
  delivery: ["선택", "고객", "차량", "출고 상태", "출고 업무", "담당", "관리"],
  settlement: ["선택", "고객", "차량 / 구매", "출고일", "수수료", "비용", "마진", "정산 상태", "관리"],
  hold: ["선택", "고객", "상태", "마지막 상담", "이탈 / 보류 요약", "재컨택 액션", "담당", "관리"],
};

export function CustomerManagementPage({ mode }: CustomerManagementPageProps) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [statusGroup, setStatusGroup] = useState("");
  const [status, setStatus] = useState("");
  const [advisor, setAdvisor] = useState("");
  const [selected, setSelected] = useState<number[]>([]);

  const statuses = statusGroup ? customerStatusGroups[statusGroup] : Object.values(customerStatusGroups).flat();
  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const searchable = `${customer.name} ${customer.phone} ${customer.vehicle} ${customer.customerType} ${customer.customerTypeDetail} ${customer.status} ${customer.aiSummary}`.toLowerCase();
      return modeFilter(mode, customer) &&
        (!keyword || searchable.includes(keyword)) &&
        (!statusGroup || customer.statusGroup === statusGroup) &&
        (!status || customer.status === status) &&
        (!advisor || customer.advisor === advisor);
    });
  }, [advisor, customers, mode, search, status, statusGroup]);

  const allSelected = rows.length > 0 && rows.every((customer) => selected.includes(customer.no));

  function toggleAll(checked: boolean) {
    setSelected(checked ? rows.map((customer) => customer.no) : []);
  }

  function deleteSelected() {
    setCustomers((current) => current.filter((customer) => !selected.includes(customer.no)));
    setSelected([]);
  }

  function renderRow(customer: Customer) {
    const check = (
      <td>
        <input
          checked={selected.includes(customer.no)}
          onChange={(event) => {
            setSelected((current) => event.target.checked ? [...current, customer.no] : current.filter((id) => id !== customer.no));
          }}
          type="checkbox"
        />
      </td>
    );
    const customerCell = <td><strong>{customer.name}<span className="customer-code num">({customer.customerId})</span></strong><span className="table-note num">{customer.phone}</span></td>;
    const actions = <td><span className="row-actions"><button className="tiny-btn" type="button"><MessageSquare size={15} /></button><button className="tiny-btn" type="button"><FileText size={15} /></button></span></td>;

    if (mode === "all") {
      return (
        <tr key={customer.no}>
          {check}
          {customerCell}
          <td><strong>{customer.customerType}</strong><span className="table-note">{customer.customerTypeDetail}</span></td>
          <td><span className={badgeClass(customer.status, customer.statusGroup)}>{customer.status}</span><span className="table-note">{customer.statusGroup} · {customer.date}</span></td>
          <td><strong>{customer.vehicle}</strong><span className="table-note">{customer.method}</span></td>
          <td><span className={badgeClass(customer.priority)}>{customer.priority}</span><span className="table-note">{customer.nextAction}</span></td>
          <td><div className="ai-summary-cell">{customer.aiSummary}</div></td>
          <td><strong>{customer.advisor}</strong><span className="table-note">{customer.team} · {customer.assignedAt}</span></td>
          <td><strong className="num">#{customer.no}</strong><span className="table-note num">{customer.receivedAt}</span></td>
          {actions}
        </tr>
      );
    }

    if (mode === "settlement") {
      return (
        <tr key={customer.no}>
          {check}
          {customerCell}
          <td><strong>{customer.vehicle}</strong><span className="table-note">{customer.method}</span></td>
          <td>{customer.date}</td>
          <td className="num">{customer.fee}</td>
          <td className="num">{customer.cost}</td>
          <td><strong className="num">{customer.margin}</strong></td>
          <td><span className="badge green">{customer.settlementStatus}</span></td>
          {actions}
        </tr>
      );
    }

    return (
      <tr key={customer.no}>
        {check}
        {customerCell}
        {mode === "contract" && <td><strong>{customer.customerType}</strong><span className="table-note">{customer.customerTypeDetail}</span></td>}
        <td><strong>{customer.vehicle}</strong><span className="table-note">{customer.method}</span></td>
        <td><span className={badgeClass(customer.status, customer.statusGroup)}>{customer.status}</span><span className="table-note">{customer.date}</span></td>
        <td><div className="ai-summary-cell">{customer.aiSummary}</div></td>
        <td><span className={badgeClass(customer.priority)}>{customer.priority}</span><span className="table-note">{customer.nextAction}</span></td>
        <td><strong>{customer.advisor}</strong><span className="table-note">{customer.team}</span></td>
        {actions}
      </tr>
    );
  }

  return (
    <section>
      <div className="toolbar">
        <input className="input" onChange={(event) => setSearch(event.target.value)} placeholder="고객명, 차량, 연락처 검색" value={search} />
        <select className="select" onChange={(event) => { setStatusGroup(event.target.value); setStatus(""); }} value={statusGroup}>
          <option value="">상태 그룹 전체</option>
          {Object.keys(customerStatusGroups).map((group) => <option key={group}>{group}</option>)}
        </select>
        <select className="select" onChange={(event) => setStatus(event.target.value)} value={status}>
          <option value="">세부 상태 전체</option>
          {statuses.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="select" onChange={(event) => setAdvisor(event.target.value)} value={advisor}>
          <option value="">담당자 전체</option>
          <option>지안</option>
          <option>선생님</option>
          <option>제프</option>
        </select>
      </div>

      <section className="card">
        <div className="list-headbar">
          <div className="list-head-left">
            <div className="total-count">TOTAL <strong className="num">{rows.length}</strong></div>
            <div className="vertical-separator" />
            <div className="list-view-controls">
              <select className="select view-select"><option>담당자별 보기</option></select>
              <select className="select view-select"><option>상담상태별 보기</option></select>
              <select className="select view-select"><option>긴급순으로 보기</option></select>
            </div>
          </div>
          <div className="top-actions">
            <button className="btn" disabled={selected.length === 0} onClick={deleteSelected} type="button">
              {selected.length ? `선택 삭제 ${selected.length}` : "선택 삭제"}
            </button>
            <button className="btn" type="button">신규 고객 등록</button>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {headsByMode[mode].map((head, index) => (
                  <th key={head}>{index === 0 ? <input checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} type="checkbox" /> : head}</th>
                ))}
              </tr>
            </thead>
            <tbody>{rows.map(renderRow)}</tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
