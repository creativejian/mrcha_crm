import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { type CustomerMode, customerModeMeta } from "@/data/customers";
import type { RoleTab } from "@/data/roles";
import { AISettingsPage } from "@/pages/AISettingsPage";
import { AdvisorDashboardPage, AdminDashboardPage } from "@/pages/DashboardPages";
import { ChatPage } from "@/pages/ChatPage";
import { CustomerDetailPage } from "@/pages/CustomerDetailPage";
import { CustomerManagementPage } from "@/pages/CustomerManagementPage";
import { DeliveryPage } from "@/pages/DeliveryPage";
import { FinancePage, type FinanceMode } from "@/pages/FinancePage";
import { InsightsPage } from "@/pages/InsightsPage";
import { KnowledgeBasePage } from "@/pages/KnowledgeBasePage";
import { MCMasterPage } from "@/pages/MCMasterPage";
import { OrgMembersPage } from "@/pages/OrgMembersPage";
import { PartnersPage } from "@/pages/PartnersPage";
import { PipelinePage } from "@/pages/PipelinePage";
import { QuotesPage } from "@/pages/QuotesPage";

type ViewKey = "advisor-dashboard" | "admin-dashboard" | "chat" | "customers" | "customer-detail" | "pipeline" | "quotes" | "delivery" | "insights" | "knowledge-base" | "ai-settings" | "mc-master" | "org-members" | "partners" | "finance";

const viewMeta: Record<ViewKey, [string, string]> = {
  "advisor-dashboard": ["대시보드", "배정된 고객 중 오늘 처리할 업무, 우선순위, 내 실적을 한눈에 보는 상담사용 화면입니다."],
  "admin-dashboard": ["경영 리포트", "전체 운영, 상담 전환, 매출/지출, 직원 생산성 등 차선생의 주요 지표를 리포트 단위로 확인합니다."],
  chat: ["실시간 상담", "앱에서 상담원 연결을 요청한 고객을 접수하고, AI 상담 요약을 보며 실시간 상담으로 전환합니다."],
  customers: ["고객 관리", "고객 정보, 상담 상태, 담당자, 유입 경로를 빠르게 찾고 분류합니다."],
  "customer-detail": ["고객 상세", "AI 요약, 상담 메모, 타임라인, 견적, 다음 액션을 한 화면에서 처리합니다."],
  pipeline: ["상담 파이프라인", "상담 진행 단계를 칸반 방식으로 관리하고 상태 변경 로그를 남기는 구조입니다."],
  quotes: ["견적 관리", "견적을 구조화 데이터로 등록하고, 비교한 뒤 앱으로 송출하는 실무 화면입니다."],
  delivery: ["계약 / 출고", "계약 이후 출고까지 필요한 상태와 체크리스트를 관리합니다."],
  insights: ["인사이트", "앱 상담 중 적재적소에 연결되는 차선생 인사이트 콘텐츠를 관리합니다."],
  "knowledge-base": ["지식베이스", "차선생 AI 상담의 기준이 되는 내부 지식 학습 포맷을 관리합니다."],
  "ai-settings": ["AI 설정", "차선생의 페르소나, 답변 성향, 상담 전환 기준을 관리합니다."],
  "mc-master": ["엠씨 마스터", "차선생 앱과 견적 솔루션에서 사용하는 브랜드, 모델, 트림, MC코드 기준 데이터를 관리합니다."],
  "org-members": ["조직 / 구성원", "구성원, 조직, 권한, 배정 기준을 한 곳에서 관리하는 대표 전용 운영 화면입니다."],
  partners: ["딜러 / 거래처", "딜러, 금융사, 시공/탁송, 제휴처 등 외부 협력 네트워크를 관리합니다."],
  finance: ["재무 관리", "매출, 지출, 정산, 급여 기준을 연결해 차선생의 돈 흐름을 관리합니다."],
};

const financeModeMeta: Record<FinanceMode, [string, string]> = {
  stats: ["재무 관리 · 통계", "매출, 지출, 정산, 순마진 흐름을 한눈에 확인합니다."],
  revenue: ["재무 관리 · 매출 관리", "계약과 출고에서 발생하는 수수료 매출과 입금 상태를 관리합니다."],
  expense: ["재무 관리 · 지출 관리", "광고비, 출고 비용, 운영비처럼 차선생 운영 지출을 분류합니다."],
  payroll: ["재무 관리 · 급여 관리", "구성원별 급여, 성과급, 지급 기준을 관리합니다."],
};

export function App() {
  const [activeView, setActiveView] = useState<ViewKey>("advisor-dashboard");
  const [customerMode, setCustomerMode] = useState<CustomerMode>("all");
  const [financeMode, setFinanceMode] = useState<FinanceMode>("stats");
  const [toast, setToast] = useState("작업이 반영되었습니다.");
  const [toastVisible, setToastVisible] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [roleTab, setRoleTab] = useState<RoleTab>("최고관리자");

  const [title, desc] = activeView === "customers"
    ? [`고객 관리 · ${customerModeMeta[customerMode].title}`, customerModeMeta[customerMode].desc]
    : activeView === "finance"
      ? financeModeMeta[financeMode]
    : viewMeta[activeView];

  function showToast(message: string) {
    setToast(message);
    setToastVisible(true);
    window.setTimeout(() => setToastVisible(false), 1800);
  }

  function handleRoleTabChange(role: RoleTab) {
    setRoleTab(role);
    if (role !== "최고관리자" && (activeView === "admin-dashboard" || activeView === "finance")) {
      setActiveView("advisor-dashboard");
    }
  }

  function renderView() {
    if (activeView === "advisor-dashboard") return <AdvisorDashboardPage />;
    if (activeView === "admin-dashboard") return <AdminDashboardPage />;
    if (activeView === "chat") return <ChatPage onNavigate={(view) => setActiveView(view as ViewKey)} onToast={showToast} />;
    if (activeView === "customers") {
      return <CustomerManagementPage mode={customerMode} onOpenCustomer={(customer) => {
        setActiveView("customer-detail");
        showToast(`${customer.name} 고객 상세로 이동합니다.`);
      }} />;
    }
    if (activeView === "customer-detail") return <CustomerDetailPage onToast={showToast} />;
    if (activeView === "pipeline") return <PipelinePage />;
    if (activeView === "quotes") return <QuotesPage onToast={showToast} />;
    if (activeView === "insights") return <InsightsPage />;
    if (activeView === "knowledge-base") return <KnowledgeBasePage />;
    if (activeView === "ai-settings") return <AISettingsPage />;
    if (activeView === "mc-master") return <MCMasterPage />;
    if (activeView === "org-members") return <OrgMembersPage />;
    if (activeView === "partners") return <PartnersPage />;
    if (activeView === "finance") return <FinancePage mode={financeMode} />;
    return <DeliveryPage />;
  }

  return (
    <div className={`shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar activeView={activeView} collapsed={sidebarCollapsed} customerMode={customerMode} financeMode={financeMode} roleTab={roleTab} onCustomerModeChange={setCustomerMode} onFinanceModeChange={setFinanceMode} onRoleTabChange={handleRoleTabChange} onViewChange={(view) => setActiveView(view as ViewKey)} />
      <main className="main">
        <Topbar sidebarCollapsed={sidebarCollapsed} roleTab={roleTab} onNavigate={(view) => setActiveView(view as ViewKey)} onToggleSidebar={() => setSidebarCollapsed((current) => !current)} />
        <header className="topbar">
          <div className="title"><h1>{title}</h1><p>{desc}</p></div>
          <div className="top-actions"><button className="btn" onClick={() => showToast("고객 상세의 상담 메모 영역으로 이동합니다.")} type="button">상담 메모</button><button className="btn primary" onClick={() => showToast("견적 송출 프로토타입: 고객 앱에 비교 견적이 전달된 것으로 표시합니다.")} type="button">앱으로 견적 송출</button></div>
        </header>
        {renderView()}
      </main>
      <div className={`toast ${toastVisible ? "show" : ""}`}>{toast}</div>
    </div>
  );
}
