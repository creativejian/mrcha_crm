import { useState } from "react";
import { adminBriefs, advisorBriefs, advisors, advisorTasks, brands, workQueue } from "@/data/prototype";

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="card stat"><span>{label}</span><strong className="num">{value}</strong><em>{note}</em></div>;
}

function BriefList({ items }: { items: readonly (readonly [string, string])[] }) {
  return <div className="brief-list">{items.map(([title, desc]) => <div className="brief" key={title}><strong>{title}</strong><span>{desc}</span></div>)}</div>;
}

const advisorMonthlyPerformance = [
  ["총 상담", "42", "건", "완료 기준"],
  ["계약", "9", "건", "목표 12건"],
  ["출고", "7", "대", "이번 달 누적"],
  ["예상매출", "1,842", "만원", "계약 완료 기준"],
  ["전환율", "15.2", "%", "상담 대비 계약"],
] as const;

const adminMonthlyPerformance = [
  ["전체 출고", "86", "대", "+15"],
  ["리스 실적", "4,867,469,860", "원", "+1,236,457,689"],
  ["렌트 실적", "2,987,654,300", "원", "+954,674,260"],
] as const;

const reportOptions = [
  "전체 운영",
  "상담 전환",
  "매출 / 지출",
  "직원 생산성",
  "유입 채널",
  "견적 / 계약",
  "출고 / 정산",
] as const;

type ReportOption = typeof reportOptions[number];

const reportStats: Record<ReportOption, Array<[string, string, string]>> = {
  "전체 운영": [["신규 유입", "18", "어제보다 +4"], ["상담 진행중", "46", "응답 대기 6건"], ["견적 발송", "29", "전환 후보 11건"], ["계약 완료", "7", "이번 주 누적"], ["출고 예정", "5", "탁송 조율 2건"]],
  "상담 전환": [["상담 시작", "64", "앱 AI상담 포함"], ["상담원 연결", "21", "연결률 32.8%"], ["견적 요청", "13", "전환 후보"], ["계약 후보", "6", "우선 통화"], ["이탈", "9", "재컨택 필요"]],
  "매출 / 지출": [["월 매출", "18,420,000원", "계약 완료 기준"], ["정산 대기", "4,860,000원", "출고 후 확인"], ["지출", "3,240,000원", "광고/출고/운영"], ["순마진", "11,980,000원", "예상 기준"], ["마진율", "65.0%", "목표 60% 이상"]],
  "직원 생산성": [["응답 완료", "142", "전체 상담사"], ["견적 작성", "38", "이번 주"], ["계약 전환", "12", "담당자 합산"], ["평균 응답", "8분", "첫 응답 기준"], ["미처리", "6", "15분 초과"]],
  "유입 채널": [["앱 AI상담", "42", "전환율 18.4%"], ["유튜브", "31", "고신뢰 유입"], ["검색", "18", "가격 비교 성향"], ["카카오", "11", "재문의 많음"], ["소개", "7", "계약률 높음"]],
  "견적 / 계약": [["견적 작성", "29", "오늘 누적"], ["앱 송출", "22", "고객 확인 가능"], ["심사 진행", "9", "서류 대기 3건"], ["계약 완료", "7", "이번 주"], ["보류", "5", "조건 재확인"]],
  "출고 / 정산": [["출고 예정", "5", "탁송 조율 2건"], ["출고 완료", "8", "이번 달"], ["정산중", "3", "금융사 확인"], ["입금확인", "5", "마감 완료"], ["정산 리스크", "2", "서류 확인 필요"]],
};

const reportBars: Record<ReportOption, Array<[string, number, string]>> = {
  "전체 운영": [["상담→견적", 68, "68%"], ["견적→심사", 42, "42%"], ["심사→계약", 31, "31%"], ["계약→출고", 76, "76%"]],
  "상담 전환": [["AI상담 유지", 72, "72%"], ["상담원 연결", 33, "33%"], ["견적 요청", 21, "21%"], ["계약 후보", 9, "9%"]],
  "매출 / 지출": [["수수료 매출", 82, "1,842만"], ["광고비", 32, "140만"], ["출고 비용", 18, "82만"], ["운영비", 8, "36만"]],
  "직원 생산성": [["지안", 88, "계약 4"], ["선생님", 72, "계약 3"], ["제프", 64, "계약 2"], ["상담사 A", 38, "온보딩"]],
  "유입 채널": [["앱 AI상담", 84, "42건"], ["유튜브", 62, "31건"], ["검색", 36, "18건"], ["카카오", 22, "11건"]],
  "견적 / 계약": [["견적 작성", 78, "29건"], ["앱 송출", 59, "22건"], ["심사 진행", 24, "9건"], ["계약 완료", 19, "7건"]],
  "출고 / 정산": [["출고 예정", 50, "5건"], ["출고 완료", 80, "8건"], ["정산중", 30, "3건"], ["입금확인", 50, "5건"]],
};

const reportFocus: Record<ReportOption, readonly (readonly [string, string])[]> = {
  "전체 운영": adminBriefs,
  "상담 전환": [["상담원 연결 전환", "AI 상담에서 상담원 연결로 넘어가는 타이밍과 사유를 확인합니다."], ["재컨택 후보", "응답 지연, 가격 불확실, 가족 상의 고객을 별도로 추적합니다."], ["상담 품질", "고객 질문에 답변이 충분했는지 상담 요약 기준으로 검토합니다."]],
  "매출 / 지출": [["정산 기준 통일", "계약, 출고, 입금 중 어떤 시점에 매출로 볼지 기준화가 필요합니다."], ["지출 누락 방지", "탁송비, 시공비, 광고비, 툴 비용을 계약별 마진과 연결합니다."], ["성과급 기준", "상담사 성과급은 계약 완료와 입금 확인을 분리해서 봅니다."]],
  "직원 생산성": [["단순 건수보다 품질", "응답 수보다 상담 전환, 견적 정확도, 계약 전환을 함께 봅니다."], ["업무 과부하 감지", "미처리 고객이 특정 담당자에게 쌓이는지 확인합니다."], ["전문 영역 배정", "리스/렌트/할부/법인 고객별 강점에 맞게 배정합니다."]],
  "유입 채널": [["유튜브 유입", "신뢰도가 높지만 상담 시간이 길 수 있어 설명형 상담으로 연결합니다."], ["검색 유입", "가격 비교 성향이 강하므로 견적 구조 설명이 중요합니다."], ["앱 AI상담", "AI 상담에서 부족했던 지점을 인사이트와 지식베이스로 보강합니다."]],
  "견적 / 계약": [["견적 정확도", "월 납입금, 총비용, 잔존가치, 중도해지 조건이 누락되지 않게 봅니다."], ["계약 전 변수", "재고, 승인, 할인 변동, 색상 옵션을 계약 전 체크합니다."], ["앱 송출 상태", "고객이 앱에서 견적을 확인했는지와 후속 상담 여부를 봅니다."]],
  "출고 / 정산": [["출고 경험", "탁송, 보험, 시공 일정이 고객에게 선명하게 안내되는지 확인합니다."], ["정산 분리", "출고 완료와 수수료 입금 확인을 분리해 미수 리스크를 줄입니다."], ["마감 체크", "계약서, 금융 승인, 세금계산서, 비용 증빙을 한 흐름으로 묶습니다."]],
};

export function AdminDashboardPage() {
  const [activeReport, setActiveReport] = useState<ReportOption>("전체 운영");
  const max = Math.max(...brands.map(([, count]) => count));
  const stats = reportStats[activeReport];
  const bars = reportBars[activeReport];
  const focus = reportFocus[activeReport];

  return (
    <>
      <section className="card advisor-performance admin-performance">
        <div className="advisor-performance-head">
          <div><strong>2026년 5월 관리자 핵심 지표</strong><span>리포트 상세 분석 전 확인하는 월간 실적 요약입니다.</span></div>
          <span className="badge blue">관리자</span>
        </div>
        <div className="advisor-performance-grid admin-performance-grid">
          {adminMonthlyPerformance.map(([label, value, unit, delta]) => (
            <div className="advisor-performance-item admin-performance-item" key={label}>
              <span>{label}</span>
              <strong><span className="num">{value}</span>{unit}</strong>
              <em><span className="num">{delta}</span> 전월 대비</em>
            </div>
          ))}
        </div>
      </section>
      <div className="report-toolbar">
        <div className="report-toolbar-copy">
          <strong>{activeReport}</strong>
          <span>차선생 전체 흐름을 리포트 단위로 확인합니다.</span>
        </div>
      </div>
      <div className="report-tabbar">
        <div className="report-tabs" role="tablist" aria-label="리포트 종류">
          {reportOptions.map((option) => (
            <button
              aria-selected={activeReport === option}
              className={activeReport === option ? "active" : ""}
              key={option}
              onClick={() => setActiveReport(option)}
              role="tab"
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="grid stats">
        {stats.map(([label, value, note]) => <Stat key={label} label={label} value={value} note={note} />)}
      </div>
      <div className="grid dashboard-layout">
        <section className="card">
          <div className="panel-head"><h2>{activeReport === "전체 운영" ? "브랜드별 문의 현황" : `${activeReport} 핵심 흐름`}</h2><span className="badge blue">리포트</span></div>
          <div className="panel-body bar-list">
            {activeReport === "전체 운영"
              ? brands.map(([brand, count]) => <div className="bar-row" key={brand}><span>{brand}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(count / max) * 100}%` }} /></div><strong className="num">{count}</strong></div>)
              : bars.map(([label, pct, value]) => <div className="bar-row" key={label}><span>{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div><strong className="num">{value}</strong></div>)}
          </div>
        </section>
        <section className="card">
          <div className="panel-head"><h2>담당자 관점</h2><span className="badge">오늘</span></div>
          <div className="panel-body advisor-list">
            {advisors.map(([name, desc, initial]) => <div className="advisor-item" key={name}><div className="avatar small">{initial}</div><div><strong>{name}</strong><span>{desc}</span></div></div>)}
          </div>
        </section>
        <section className="card">
          <div className="panel-head"><h2>확인 포인트</h2><span className="badge yellow">리스크 3건</span></div>
          <div className="panel-body"><BriefList items={focus} /></div>
        </section>
        <section className="card">
          <div className="panel-head"><h2>전환 / 성과 흐름</h2><span className="badge green">요약</span></div>
          <div className="panel-body bar-list">
            {bars.map(([label, pct, value]) => <div className="bar-row" key={label}><span>{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div><strong className="num">{value}</strong></div>)}
          </div>
        </section>
      </div>
    </>
  );
}

export function AdvisorDashboardPage() {
  return (
    <>
      <section className="card advisor-performance">
        <div className="advisor-performance-head">
          <div><strong>2026년 5월 성과 요약</strong><span>상담사 지안 계정 기준</span></div>
          <span className="badge blue">이번 달</span>
        </div>
        <div className="advisor-performance-grid">
          {advisorMonthlyPerformance.map(([label, value, unit, note]) => (
            <div className="advisor-performance-item" key={label}>
              <span>{label}</span>
              <strong><span className="num">{value}</span>{unit}</strong>
              <em>{note}</em>
            </div>
          ))}
        </div>
      </section>
      <div className="grid stats">
        <Stat label="오늘 처리할 고객" value="12" note="긴급 3건" />
        <Stat label="응답 대기" value="6" note="15분 초과 2건" />
        <Stat label="견적 작성 필요" value="5" note="오늘 송출 목표" />
        <Stat label="계약 후보" value="4" note="우선 통화 권장" />
        <Stat label="내 오늘 실적" value="3" note="견적 발송 완료" />
      </div>
      <div className="grid dashboard-layout">
        <section className="card">
          <div className="panel-head"><h2>오늘 우선순위 고객</h2><span className="badge red">상담사 배정</span></div>
          <div className="panel-body table-scroll">
            <table>
              <thead><tr><th>우선</th><th>고객</th><th>차량</th><th>현재 이슈</th><th>다음 액션</th><th>마감</th></tr></thead>
              <tbody>{advisorTasks.map(([priority, name, vehicle, issue, action, due]) => <tr key={`${name}-${vehicle}`}><td><span className={priority === "긴급" ? "badge red" : priority === "높음" ? "badge yellow" : "badge blue"}>{priority}</span></td><td><strong>{name}</strong></td><td>{vehicle}</td><td>{issue}</td><td>{action}</td><td>{due}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <section className="card"><div className="panel-head"><h2>내 업무 큐</h2><span className="badge blue">지안 계정</span></div><div className="panel-body"><BriefList items={workQueue} /></div></section>
        <section className="card"><div className="panel-head"><h2>AI 브리핑</h2><span className="badge yellow">상담 전 확인</span></div><div className="panel-body"><BriefList items={advisorBriefs} /></div></section>
        <section className="card">
          <div className="panel-head"><h2>내 실적 흐름</h2><span className="badge green">오늘 / 이번 주</span></div>
          <div className="panel-body bar-list">
            {[["응답 완료", 72, "18"], ["견적 발송", 48, "3"], ["심사 진행", 35, "2"], ["계약 전환", 22, "1"]].map(([label, pct, value]) => <div className="bar-row" key={label as string}><span>{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div><strong className="num">{value}</strong></div>)}
          </div>
        </section>
      </div>
    </>
  );
}
