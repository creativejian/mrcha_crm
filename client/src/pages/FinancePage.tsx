export type FinanceMode = "stats" | "revenue" | "expense" | "payroll";

const financeStats = [
  ["이번 달 매출", "18,420,000원", "계약 완료 기준"],
  ["정산 대기", "4,860,000원", "출고 완료 후 입금 확인 전"],
  ["예상 지출", "3,240,000원", "시공비, 탁송비, 광고비"],
  ["예상 순마진", "11,980,000원", "수수료 - 비용"],
];

const settlementRows = [
  ["BMW X3 20i", "김민준", "운용리스", "수수료 1,520,000원", "정산대기"],
  ["Tesla Model 3", "이나경", "리스", "수수료 1,180,000원", "입금확인"],
  ["GV70", "홍유라", "장기렌트", "수수료 960,000원", "정산중"],
  ["BMW 520i", "최민석", "운용리스", "수수료 1,520,000원", "입금확인"],
];

const expenseRows = [
  ["광고비", "유튜브 / 검색 유입", "1,400,000원", "월 고정"],
  ["출고 비용", "탁송, 시공, 용품", "820,000원", "건별"],
  ["운영비", "툴, 서버, 구독", "360,000원", "월 고정"],
  ["급여/인센티브", "상담사 기본급 및 성과급", "660,000원", "산정중"],
];

const revenueRows = [
  ["BNK캐피탈", "김민준", "BMW X3 20i", "1,520,000원", "입금 예정"],
  ["메리츠캐피탈", "이나경", "Tesla Model 3", "1,180,000원", "입금 확인"],
  ["현대캐피탈", "홍유라", "GV70", "960,000원", "정산중"],
  ["iM캐피탈", "최민석", "BMW 520i", "1,520,000원", "입금 확인"],
];

const payrollRows = [
  ["김지안", "대표 / 최고관리자", "기본급 제외", "성과급 기준 검토", "대표"],
  ["선생님", "CTO / AI 총괄", "외주/파트너", "프로젝트 단위", "확인 필요"],
  ["제프", "견적 솔루션 개발", "외주/파트너", "견적 엔진 개발", "진행중"],
  ["상담사 A", "상담사", "2,400,000원", "계약 성과급 별도", "초안"],
];

function FinanceStatsView() {
  return (
    <>
      <div className="grid finance-stats">
        {financeStats.map(([label, value, note]) => (
          <div className="card stat" key={label}>
            <span>{label}</span>
            <strong className="num">{value}</strong>
            <em>{note}</em>
          </div>
        ))}
      </div>

      <div className="finance-layout">
        <section className="card">
          <div className="panel-head"><h2>출고 정산 흐름</h2><span className="badge green">이번 달</span></div>
          <div className="panel-body table-scroll">
            <table>
              <thead><tr><th>차량</th><th>고객</th><th>방식</th><th>수수료</th><th>상태</th></tr></thead>
              <tbody>
                {settlementRows.map(([vehicle, customer, method, fee, status]) => (
                  <tr key={`${vehicle}-${customer}`}>
                    <td><strong>{vehicle}</strong></td>
                    <td>{customer}</td>
                    <td>{method}</td>
                    <td className="num">{fee}</td>
                    <td><span className={status === "입금확인" ? "badge green" : status === "정산중" ? "badge blue" : "badge yellow"}>{status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="panel-head"><h2>지출 / 급여 항목</h2><span className="badge">예산 기준</span></div>
          <div className="panel-body finance-expense-list">
            {expenseRows.map(([type, desc, amount, cycle]) => (
              <div className="finance-expense-row" key={type}>
                <div><strong>{type}</strong><span>{desc}</span></div>
                <div><strong className="num">{amount}</strong><span>{cycle}</span></div>
              </div>
            ))}
          </div>
        </section>

        <section className="card finance-command">
          <div className="panel-head"><h2>대표 확인 포인트</h2><span className="badge red">돈 흐름</span></div>
          <div className="panel-body brief-list">
            <div className="brief"><strong>입금 확인 전 출고 완료 건</strong><span>출고 완료와 수수료 입금 상태가 분리되어 보여야 합니다.</span></div>
            <div className="brief"><strong>상담사 성과급 기준</strong><span>계약 기준인지, 출고 기준인지, 입금 기준인지 정책화가 필요합니다.</span></div>
            <div className="brief"><strong>채널별 수익성</strong><span>유튜브, 검색, 앱 상담 유입별 광고비 대비 마진을 추적합니다.</span></div>
          </div>
        </section>
      </div>
    </>
  );
}

function RevenueView() {
  return (
    <div className="finance-layout">
      <section className="card">
        <div className="panel-head"><h2>매출 관리</h2><span className="badge green">수수료 기준</span></div>
        <div className="panel-body table-scroll">
          <table>
            <thead><tr><th>금융사</th><th>고객</th><th>차량</th><th>매출</th><th>상태</th></tr></thead>
            <tbody>
              {revenueRows.map(([finance, customer, vehicle, amount, status]) => (
                <tr key={`${finance}-${customer}`}>
                  <td><strong>{finance}</strong></td>
                  <td>{customer}</td>
                  <td>{vehicle}</td>
                  <td className="num">{amount}</td>
                  <td><span className={status === "입금 확인" ? "badge green" : status === "정산중" ? "badge blue" : "badge yellow"}>{status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="panel-head"><h2>매출 확인 기준</h2><span className="badge">정책</span></div>
        <div className="panel-body brief-list">
          <div className="brief"><strong>계약 매출</strong><span>계약 완료 시점의 예상 수수료를 먼저 기록합니다.</span></div>
          <div className="brief"><strong>확정 매출</strong><span>출고 완료 후 금융사 수수료 입금 확인 기준으로 확정합니다.</span></div>
          <div className="brief"><strong>채널별 매출</strong><span>유튜브, 앱 AI상담, 검색 등 유입 채널과 연결해 수익성을 봅니다.</span></div>
        </div>
      </section>
    </div>
  );
}

function ExpenseView() {
  return (
    <div className="finance-layout">
      <section className="card">
        <div className="panel-head"><h2>지출 관리</h2><span className="badge yellow">이번 달</span></div>
        <div className="panel-body finance-expense-list">
          {expenseRows.map(([type, desc, amount, cycle]) => (
            <div className="finance-expense-row" key={type}>
              <div><strong>{type}</strong><span>{desc}</span></div>
              <div><strong className="num">{amount}</strong><span>{cycle}</span></div>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="panel-head"><h2>지출 분류 기준</h2><span className="badge">관리 항목</span></div>
        <div className="panel-body brief-list">
          <div className="brief"><strong>고정비</strong><span>툴, 서버, 사무실, 구독 비용처럼 매월 반복되는 비용입니다.</span></div>
          <div className="brief"><strong>변동비</strong><span>시공비, 탁송비, 용품비처럼 출고 건별로 달라지는 비용입니다.</span></div>
          <div className="brief"><strong>마케팅비</strong><span>채널별 광고비를 매출과 연결해 실제 수익성을 계산합니다.</span></div>
        </div>
      </section>
    </div>
  );
}

function PayrollView() {
  return (
    <div className="finance-layout">
      <section className="card">
        <div className="panel-head"><h2>급여 관리</h2><span className="badge blue">초안</span></div>
        <div className="panel-body table-scroll">
          <table>
            <thead><tr><th>구성원</th><th>역할</th><th>기본 기준</th><th>성과 기준</th><th>상태</th></tr></thead>
            <tbody>
              {payrollRows.map(([name, role, base, incentive, status]) => (
                <tr key={name}>
                  <td><strong>{name}</strong></td>
                  <td>{role}</td>
                  <td className="num">{base}</td>
                  <td>{incentive}</td>
                  <td><span className={status === "대표" ? "badge" : status === "진행중" ? "badge blue" : "badge yellow"}>{status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="panel-head"><h2>성과급 설계 포인트</h2><span className="badge red">주의</span></div>
        <div className="panel-body brief-list">
          <div className="brief"><strong>계약 기준과 입금 기준 분리</strong><span>계약 완료만으로 지급할지, 수수료 입금 확인 후 지급할지 정해야 합니다.</span></div>
          <div className="brief"><strong>품질 지표 반영</strong><span>단순 계약 건수뿐 아니라 상담 품질, 재응대율, 취소율을 함께 봅니다.</span></div>
          <div className="brief"><strong>역할별 기준 분리</strong><span>상담, 견적, 출고, 정산 기여도를 역할별로 다르게 설계합니다.</span></div>
        </div>
      </section>
    </div>
  );
}

export function FinancePage({ mode }: { mode: FinanceMode }) {
  if (mode === "revenue") return <RevenueView />;
  if (mode === "expense") return <ExpenseView />;
  if (mode === "payroll") return <PayrollView />;
  return <FinanceStatsView />;
}
