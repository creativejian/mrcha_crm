import { initialCustomers } from "@/data/customers";

export function PipelinePage() {
  const lanes = [
    ["신규 유입", initialCustomers.slice(1, 3)],
    ["AI 상담 진행중", [initialCustomers[0]]],
    ["견적 요청", [initialCustomers[1]]],
    ["조건 비교중", [initialCustomers[0], initialCustomers[2]]],
    ["계약 / 출고", initialCustomers.slice(3, 7)],
  ] as const;

  return <div className="pipeline">{lanes.map(([title, customers]) => <section className="lane" key={title}><div className="lane-head"><strong>{title}</strong><span>{customers.length}</span></div>{customers.map((customer) => <article className="mini-card" key={`${title}-${customer.no}`}><strong>{customer.name}</strong><span>{customer.vehicle}</span><span className="table-note">{customer.status} · {customer.advisor}</span></article>)}</section>)}</div>;
}
