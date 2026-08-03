import { useEffect, useState } from "react";
import { adminBriefs, advisors, brands } from "@/data/prototype";
import { bindSelect } from "@/lib/select-bind";
import { fetchAdminReport, formatMonthLabel, recentMonthOptions, type AdminReport } from "@/lib/reports";

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="card stat"><span>{label}</span><strong className="num">{value}</strong><em>{note}</em></div>;
}

function BriefList({ items }: { items: readonly (readonly [string, string])[] }) {
  return <div className="brief-list">{items.map(([title, desc]) => <div className="brief" key={title}><strong>{title}</strong><span>{desc}</span></div>)}</div>;
}

// 상단바 요약(Topbar)은 아직 이 목업 값 계통이다 — 그쪽은 전 역할이 보는 자리라 admin 전용
// 리포트 API를 그대로 쓸 수 없어 별도 슬라이스로 남긴다(2026-08-03 spec §5).

// 히어로 3지표(2026-08-03 이사님 확정 — 출고 달 기준). 금액은 원 단위 정수로 받아 여기서 포맷한다.
type HeroMetric = { label: string; value: string; unit: string; delta: string; up: boolean };

function buildHeroPerformance(report: AdminReport): HeroMetric[] {
  const { count, prevCount, leaseAmount, prevLeaseAmount, rentAmount, prevRentAmount } = report.delivery;
  const won = (v: number) => v.toLocaleString("ko-KR");
  const metric = (label: string, unit: string, cur: number, prev: number): HeroMetric => {
    const diff = cur - prev;
    return {
      label,
      value: won(cur),
      unit,
      delta: diff === 0 ? "±0" : `${diff > 0 ? "+" : ""}${won(diff)}`,
      up: diff > 0,
    };
  };
  return [
    metric("전체 출고", "대", count, prevCount),
    metric("리스 실적", "원", leaseAmount, prevLeaseAmount),
    metric("렌트 실적", "원", rentAmount, prevRentAmount),
  ];
}

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

// "전체 운영" 탭은 실데이터로 대체됐다(아래 buildOverviewStats) — 이 상수의 "전체 운영" 항목은
// 실데이터를 못 받았을 때의 폴백이 **아니라** 나머지 6탭용 샘플이다. 실패 시엔 폴백 대신 에러를
// 보여준다(샘플로 조용히 갈아끼우면 이사님이 그걸 실적으로 읽는다).
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

const overviewMetrics = [
  ["총 상담", "42", "완료 기준", "이번 달 누적"],
  ["계약", "9", "목표 12건", "3건 남음"],
  ["출고", "7", "이번 달 누적", "예정 2대"],
  ["예상 실적", "1,842", "만원", "계약 완료 기준"],
  ["전환율", "15.2", "%", "상담 대비 계약"],
] as const;

const advisorTodayMetrics = [
  ["오늘 처리할 고객", "12", "긴급 3건", "먼저 볼 업무"],
  ["응답 대기", "6", "15분 초과 2건", "응대 지연"],
  ["견적 작성 필요", "5", "오늘 송출 목표", "조건 정리"],
  ["계약 후보", "4", "우선 통화 권장", "가능성 높음"],
  ["내 오늘 실적", "3", "견적 발송 완료", "오전 기준"],
] as const;

const advisorSignalCharts = [
  ["상담 응답", 44, 62, 58, 73, 49, 66, 81, 54, 69, 72, 63, 78],
  ["견적 작성", 18, 24, 20, 36, 31, 45, 28, 52, 39, 33, 42, 35],
  ["계약 가능성", 22, 28, 34, 31, 44, 39, 57, 48, 52, 46, 61, 55],
  ["재컨택 필요", 38, 32, 29, 42, 35, 31, 26, 34, 28, 22, 19, 24],
] as const;

const advisorPriorityCustomers = [
  ["긴급", "김민준", "BMW X3 / GLC", "비교 견적 확인 후 18분 응답 지연", "GLC 재고 확인 후 통화"],
  ["높음", "박서연", "Model Y", "보증금 0/10/20% 조건별 비교 필요", "조건표 완성 후 앱 송출"],
  ["높음", "이도윤", "GV80", "앱에서 견적 열람, 심사 서류 안내 필요", "서류 체크리스트 전달"],
  ["중간", "오세린", "MINI Cooper", "첫 차 구매, 리스/렌트 구조 이해 필요", "만기 인수 구조 설명"],
] as const;

const advisorCommandItems = [
  ["우선 처리", "김민준 → 박서연 → 이도윤", "응답 지연과 계약 가능성이 같이 높은 고객부터 처리합니다."],
  ["견적 큐", "오늘 5건 작성 필요", "보증금 조건, 재고 가능 색상, 총비용 기준을 먼저 맞춥니다."],
  ["재컨택", "부재/보류 4건", "카톡 인사 후 2차 재컨택 시점을 예약합니다."],
] as const;

const advisorBriefing = [
  ["AI 브리핑", "계약 가능 고객 우선", "오늘은 가격 비교 고객보다 계약 가능성이 높은 견적 확인 고객을 먼저 보는 편이 좋습니다."],
  ["상담 품질", "총비용 설명 필요", "월 납입금만 답하지 말고 총비용, 중도해지, 만기 선택지를 같이 설명하세요."],
  ["실적 포커스", "오전 견적 3건", "오후 전까지 견적 3건을 먼저 앱으로 송출하면 계약 후보 2건을 추가로 만들 수 있습니다."],
] as const;

const advisorFlow = [
  ["응답 완료", 72, "18"],
  ["견적 발송", 48, "3"],
  ["심사 진행", 35, "2"],
  ["계약 전환", 22, "1"],
] as const;

function OverviewIcon({ name }: { name: "status" | "database" | "branch" | "backup" | "ai" | "warning" }) {
  if (name === "status") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h4v4H4V5Zm6 0h4v4h-4V5Zm6 0h4v4h-4V5ZM4 11h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4ZM4 17h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4Z" /></svg>;
  if (name === "database") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4.42 0 8 1.57 8 3.5v11c0 1.93-3.58 3.5-8 3.5s-8-1.57-8-3.5v-11C4 4.57 7.58 3 12 3Zm0 2c-3.3 0-6 .72-6 1.5S8.7 8 12 8s6-.72 6-1.5S15.3 5 12 5Zm-6 5.1v2.4c0 .78 2.7 1.5 6 1.5s6-.72 6-1.5v-2.4c-1.46 1.05-3.84 1.6-6 1.6s-4.54-.55-6-1.6Zm0 5.5v1.9c0 .78 2.7 1.5 6 1.5s6-.72 6-1.5v-1.9c-1.46.92-3.84 1.4-6 1.4s-4.54-.48-6-1.4Z" /></svg>;
  if (name === "branch") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3a3 3 0 0 1 1 5.83V10a4 4 0 0 0 4 4h2.17a3 3 0 1 1 0 2H12a6 6 0 0 1-6-6V8.83A3 3 0 0 1 7 3Zm10 10a1 1 0 1 0 0 2a1 1 0 0 0 0-2ZM7 5a1 1 0 1 0 0 2a1 1 0 0 0 0-2Z" /></svg>;
  if (name === "backup") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v4H5V4Zm1 6h12v10H6V10Zm3 2v2h6v-2H9Z" /></svg>;
  if (name === "ai") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 2h2v3h3v2h-3v3h-2V7H8V5h3V2Zm7.5 6.5l1.2 2.4l2.3.9l-2.3.9l-1.2 2.4l-1.2-2.4l-2.3-.9l2.3-.9l1.2-2.4ZM5 11h8v8H5v-8Zm2 2v4h4v-4H7Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 2 21h20L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V8h2v5Z" /></svg>;
}

function MiniBarChart({ values }: { values: readonly number[] }) {
  return <div className="overview-bars" aria-hidden="true">{values.map((value, index) => <span key={`${value}-${index}`} style={{ height: `${Math.max(12, value)}%` }} />)}</div>;
}

export function DashboardPreviewPage() {
  return (
    <div className="overview-page">
      <section className="overview-hero">
        <div className="overview-project">
          <span className="overview-kicker">ADVISOR COMMAND CENTER</span>
          <h2>오늘 상담 우선순위</h2>
          <p>상담사가 출근해서 바로 판단해야 하는 응답 지연, 견적 작성, 계약 후보, 재컨택 흐름을 한 화면에 모은 대시보드입니다.</p>
          <div className="overview-health-grid">
            <div><OverviewIcon name="warning" /><span>FIRST ACTION</span><strong>응답 지연 2건</strong></div>
            <div><OverviewIcon name="branch" /><span>QUOTE QUEUE</span><strong>견적 5건 필요</strong></div>
            <div><OverviewIcon name="ai" /><span>AI SUMMARY</span><strong>브리핑 준비됨</strong></div>
            <div><OverviewIcon name="status" /><span>MY STATUS</span><strong>상담 수신 중</strong></div>
          </div>
        </div>
        <div className="overview-map">
          <div className="overview-node primary"><OverviewIcon name="database" /><div><strong>김민준</strong><span>18분 응답 지연 · X3/GLC</span></div><em>긴급</em></div>
          <div className="overview-node ai"><OverviewIcon name="ai" /><div><strong>AI 요약</strong><span>총비용 민감 고객</span></div></div>
          <div className="overview-node quote"><OverviewIcon name="branch" /><div><strong>견적 작성</strong><span>조건별 비교표 필요</span></div></div>
          <div className="overview-node risk"><OverviewIcon name="warning" /><div><strong>계약 후보</strong><span>오늘 통화 권장</span></div></div>
        </div>
      </section>

      <section className="overview-metrics" aria-label="이번 달 상담사 핵심 지표">
        {overviewMetrics.map(([label, value, delta, note]) => (
          <div className="overview-metric-card" key={label}>
            <span>{label}</span>
            <strong className="num">{value}</strong>
            <div><em>{delta}</em><small>{note}</small></div>
          </div>
        ))}
      </section>

      <section className="overview-metrics today" aria-label="오늘 상담사 업무 지표">
        {advisorTodayMetrics.map(([label, value, delta, note]) => (
          <div className="overview-metric-card today" key={label}>
            <span>{label}</span>
            <strong className="num">{value}</strong>
            <div><em>{delta}</em><small>{note}</small></div>
          </div>
        ))}
      </section>

      <section className="overview-request-section">
        <div className="overview-section-head"><h3>오늘 업무 신호</h3><button type="button">09:00 - 현재</button></div>
        <div className="overview-chart-grid">
          {advisorSignalCharts.map(([label, ...values]) => (
            <div className="overview-chart-card" key={label}>
              <span>{label}</span>
              <strong className="num">{values.reduce((sum, value) => sum + value, 0)}</strong>
              <MiniBarChart values={values} />
            </div>
          ))}
        </div>
      </section>

      <section className="overview-bottom-grid">
        <div className="overview-flow-card">
          <div className="overview-section-head compact"><h3>오늘 우선순위 고객</h3><span>상담사 지안</span></div>
          {advisorPriorityCustomers.map(([priority, name, vehicle, issue, action]) => (
            <button className="overview-priority-row" key={`${name}-${vehicle}`} type="button">
              <span className={`overview-priority-badge ${priority === "긴급" ? "urgent" : priority === "높음" ? "high" : ""}`}>{priority}</span>
              <div><strong>{name}</strong><small>{vehicle}</small></div>
              <p>{issue}</p>
              <em>{action}</em>
            </button>
          ))}
        </div>
        <div className="overview-risk-card">
          <div className="overview-section-head compact"><h3>내 업무 큐</h3><button type="button">Ask AI</button></div>
          {advisorCommandItems.map(([type, title, desc]) => (
            <button className="overview-risk-row" key={title} type="button">
              <OverviewIcon name={type === "우선 처리" ? "warning" : type === "견적 큐" ? "branch" : "backup"} />
              <div><span>{type}</span><strong>{title}</strong><small>{desc}</small></div>
            </button>
          ))}
        </div>
      </section>

      <section className="overview-bottom-grid secondary">
        <div className="overview-flow-card">
          <div className="overview-section-head compact"><h3>내 실적 흐름</h3><span>오늘 / 이번 주</span></div>
          {advisorFlow.map(([label, pct, value]) => (
            <div className="overview-flow-row" key={label}>
              <div><strong>{label}</strong><span>상담 진행 기준</span></div>
              <em className="num">{value}</em>
              <div className="overview-track"><span style={{ width: `${pct}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="overview-risk-card">
          <div className="overview-section-head compact"><h3>AI 브리핑</h3><button type="button">업무 정리</button></div>
          {advisorBriefing.map(([type, title, desc]) => (
            <button className="overview-risk-row" key={title} type="button">
              <OverviewIcon name="ai" />
              <div><span>{type}</span><strong>{title}</strong><small>{desc}</small></div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// 실데이터 5칩(2026-08-02 리포트 spec §2). 스냅샷 지표는 note에 **"현재 기준"**을 명시한다 —
// 상태 전이 시각이 없어 과거 월을 골라도 오늘 값이 나오기 때문이다(§2a). 전이 이력이 생겨
// 월 스코프가 가능해지면 그 표기를 함께 걷어야 한다.
function buildOverviewStats(report: AdminReport): Array<[string, string, string]> {
  const { newInflow, inProgress, quotesSent, contracted, upcomingDeliveries } = report.overview;
  const delta = newInflow.count - newInflow.prevCount;
  const deltaNote = delta === 0 ? "전월과 같음" : `전월 ${newInflow.prevCount}건 · ${delta > 0 ? "+" : ""}${delta}`;
  return [
    ["신규 유입", String(newInflow.count), deltaNote],
    ["상담 진행중", String(inProgress.count), "현재 기준"],
    ["견적 발송", String(quotesSent.count), `고객 열람 ${quotesSent.viewedCount}건`],
    ["계약 완료", String(contracted.count), "현재 기준"],
    [
      "출고 예정",
      String(upcomingDeliveries.count),
      upcomingDeliveries.overdueCount > 0 ? `예정일 지남 ${upcomingDeliveries.overdueCount}건` : "미완료 일정",
    ],
  ];
}

// 견적/계약 퍼널 — 비율 기준은 '작성'이다(월 코호트의 출발점). 작성이 0이면 전부 0%로 그린다.
function buildFunnelBars(report: AdminReport): Array<[string, number, string]> {
  const { created, sent, viewed, contracting } = report.quoteFunnel;
  const pct = (value: number) => (created > 0 ? Math.round((value / created) * 100) : 0);
  return [
    ["견적 작성", pct(created), `${created}건`],
    ["앱 송출", pct(sent), `${sent}건`],
    ["고객 열람", pct(viewed), `${viewed}건`],
    ["계약 진행", pct(contracting), `${contracting}건`],
  ];
}

export function AdminDashboardPage() {
  const [activeReport, setActiveReport] = useState<ReportOption>("전체 운영");
  // undefined = 서버가 정한 현재 월(KST). 클라가 현재 월을 스스로 계산하지 않는다 — 기준 시각의
  // 소유자를 서버 한 곳으로 둔다(로컬 타임존이 다른 접속에서도 같은 달을 본다).
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined);
  // 응답과 "그 응답이 어느 요청의 것인지"를 한 상태로 묶는다 — 로딩 플래그를 따로 두면 effect
  // 본문에서 setState(true)를 해야 하고 그건 cascading render 룰(react-hooks/set-state-in-effect)에
  // 걸린다. requested !== selectedMonth인 동안이 곧 "요청 중"이다.
  const [loaded, setLoaded] = useState<{
    requested: string | undefined;
    report: AdminReport | null;
    error: string | null;
  } | null>(null);
  // 월 선택 옵션의 기준 — **첫 응답의 월로 고정**한다. report.month를 그대로 쓰면 과거 달을 고르는
  // 순간 옵션이 그 달 기준으로 다시 만들어져 최근 달로 돌아올 수 없다.
  const [baseMonth, setBaseMonth] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminReport(selectedMonth)
      .then((next) => {
        if (cancelled) return;
        setBaseMonth((prev) => prev ?? next.month);
        setLoaded({ requested: selectedMonth, report: next, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "알 수 없는 오류입니다.";
        setLoaded({ requested: selectedMonth, report: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMonth]);

  const loading = loaded?.requested !== selectedMonth;
  const report = loaded?.report ?? null;
  const error = loaded?.error ?? null;
  const isOverview = activeReport === "전체 운영";
  // 로딩 중에는 직전 월 데이터를 그대로 두지 않는다 — 라벨(선택한 달)과 숫자(이전 달)가 어긋난다.
  const live = isOverview && !loading ? report : null;
  const monthOptions = recentMonthOptions(baseMonth ?? report?.month ?? "");
  // 라벨은 **선택한 달**을 따른다(응답 대기 중에도) — 응답의 month를 쓰면 전환 중 한 프레임 동안
  // 이전 달 이름이 남는다.
  const shownMonth = selectedMonth ?? report?.month ?? null;
  // 실데이터 탭에서 응답이 없으면 **샘플로 폴백하지 않고 비운다**. 폴백하면 로딩·실패 상태가
  // 그럴듯한 숫자로 가려져 이사님이 그걸 실적으로 읽는다.
  const stats = live ? buildOverviewStats(live) : isOverview ? [] : reportStats[activeReport];
  const bars = live ? buildFunnelBars(live) : isOverview ? [] : reportBars[activeReport];
  const focus = reportFocus[activeReport];
  const brandRows: readonly (readonly [string, number])[] = live
    ? live.brandInquiries.rows.map((row) => [row.brand, row.count] as const)
    : isOverview
      ? []
      : brands;
  const max = Math.max(1, ...brandRows.map(([, count]) => count));
  // 월 초에는 이번 달이 통째로 비는 게 정상이다(그게 사실이다) — 다만 "고장"으로 읽히지 않게
  // 바로 위 월 선택으로 안내한다.
  const emptyNote = loading
    ? "불러오는 중…"
    : error
      ? "표시할 수 없습니다."
      : "이 달 기록이 아직 없습니다. 위에서 다른 달을 선택해 보세요.";
  // 히어로는 탭과 무관하게 항상 그 달의 실적을 보여준다(리포트 탭 전환에 영향받지 않음).
  const hero = report ? buildHeroPerformance(report) : null;
  const heroNote = loading ? "불러오는 중…" : error ? "실적을 표시할 수 없습니다." : "실적 데이터가 없습니다.";
  // 0건은 고장이 아니라 사실이다 — 다만 원인이 "출고 실측일 미입력"인 경우가 대부분이라 안내한다
  // (상태만 '출고완료'로 바꾸고 날짜를 비워두면 월 집계에 잡히지 않는다, spec §3a).
  const heroHint =
    report && report.delivery.count === 0
      ? "이 달 출고 기록이 없습니다 — 출고 정보에 실측일을 입력하면 집계됩니다."
      : "출고 실측일 기준입니다. 리스는 취득원가, 렌트는 차량가로 집계합니다.";

  return (
    <>
      <section className="card advisor-performance admin-performance">
        <div className="advisor-performance-head">
          <div>
            <strong>{shownMonth ? `${formatMonthLabel(shownMonth)} 핵심 지표` : "관리자 핵심 지표"}</strong>
            <span>{heroHint}</span>
          </div>
          <span className="badge green">실데이터</span>
        </div>
        {hero ? (
          <div className="advisor-performance-grid admin-performance-grid">
            {hero.map((metric) => (
              <div className="advisor-performance-item admin-performance-item" key={metric.label}>
                <span>{metric.label}</span>
                <strong><span className="num">{metric.value}</span>{metric.unit}</strong>
                <em className={metric.up ? "up" : undefined}><span className="num">{metric.delta}</span> 전월 대비</em>
              </div>
            ))}
          </div>
        ) : (
          <div className="report-empty">{heroNote}</div>
        )}
      </section>
      <div className="report-toolbar">
        <div className="report-toolbar-copy">
          <strong>{activeReport}</strong>
          <span>
            {isOverview
              ? `${shownMonth ? formatMonthLabel(shownMonth) : "이번 달"} 실적입니다. 상담 진행중·계약 완료는 현재 기준입니다.`
              : "차선생 전체 흐름을 리포트 단위로 확인합니다."}
          </span>
        </div>
        <div className="report-toolbar-actions">
          {isOverview ? (
            <>
              {/* controlled select — Safari는 선택 시 input→(React 복원)→change 순서로 발화해
                  onChange만 들으면 선택이 유실된다. bindSelect가 onChange+onInput을 함께 건다. */}
              <select
                aria-label="리포트 기준 월"
                className="select"
                disabled={!baseMonth}
                {...bindSelect(selectedMonth ?? report?.month ?? "", (next) => setSelectedMonth(next))}
              >
                {monthOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatMonthLabel(option)}
                  </option>
                ))}
              </select>
              <span className="badge green">실데이터</span>
            </>
          ) : (
            <span className="badge yellow">샘플</span>
          )}
        </div>
      </div>
      {isOverview && error ? (
        <div className="report-error card" role="alert">
          리포트를 불러오지 못했습니다. {error}
        </div>
      ) : null}
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
      {stats.length > 0 ? (
        <div className="grid stats">
          {stats.map(([label, value, note]) => <Stat key={label} label={label} value={value} note={note} />)}
        </div>
      ) : (
        <div className="card report-empty">{emptyNote}</div>
      )}
      <div className="grid dashboard-layout">
        <section className="card">
          <div className="panel-head">
            <h2>{isOverview ? "브랜드별 문의 현황" : `${activeReport} 핵심 흐름`}</h2>
            <span className={isOverview ? "badge green" : "badge yellow"}>{isOverview ? "앱 견적요청" : "샘플"}</span>
          </div>
          <div className="panel-body bar-list">
            {isOverview
              ? brandRows.length > 0
                ? brandRows.map(([brand, count]) => <div className="bar-row" key={brand}><span>{brand}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(count / max) * 100}%` }} /></div><strong className="num">{count}</strong></div>)
                : <p className="report-empty">{emptyNote}</p>
              : bars.map(([label, pct, value]) => <div className="bar-row" key={label}><span>{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div><strong className="num">{value}</strong></div>)}
          </div>
        </section>
        <section className="card">
          <div className="panel-head"><h2>담당자 관점</h2><span className="badge yellow">샘플</span></div>
          <div className="panel-body advisor-list">
            {advisors.map(([name, desc, initial]) => <div className="advisor-item" key={name}><div className="avatar small">{initial}</div><div><strong>{name}</strong><span>{desc}</span></div></div>)}
          </div>
        </section>
        <section className="card">
          <div className="panel-head"><h2>확인 포인트</h2><span className="badge yellow">샘플</span></div>
          <div className="panel-body"><BriefList items={focus} /></div>
        </section>
        <section className="card">
          <div className="panel-head">
            <h2>{isOverview ? "견적 / 계약 퍼널" : "전환 / 성과 흐름"}</h2>
            <span className={isOverview ? "badge green" : "badge yellow"}>{isOverview ? "실데이터" : "샘플"}</span>
          </div>
          <div className="panel-body bar-list">
            {bars.length > 0
              ? bars.map(([label, pct, value]) => <div className="bar-row" key={label}><span>{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div><strong className="num">{value}</strong></div>)
              : <p className="report-empty">{emptyNote}</p>}
          </div>
        </section>
      </div>
    </>
  );
}
