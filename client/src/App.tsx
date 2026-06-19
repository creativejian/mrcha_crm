import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { type Customer, type CustomerChanceOption, type CustomerManageStatus, type CustomerMode, customerModeMeta, customerStatusGroups } from "@/data/customers";
import { fetchCustomers, updateCustomer, type CustomerWritePatch } from "@/lib/customers";
import { customerCodeFromLocation } from "@/lib/customer-route";
import { prefetchCatalog } from "@/pages/mc-master/catalog-cache";
import { useAuth } from "./auth/AuthProvider";
import { AISettingsPage } from "@/pages/AISettingsPage";
import { AdvisorDashboardPage, AdminDashboardPage, DashboardPreviewPage } from "@/pages/DashboardPages";
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

type ViewKey = "advisor-dashboard" | "dashboard-preview" | "admin-dashboard" | "chat" | "customers" | "customer-detail" | "pipeline" | "quotes" | "delivery" | "insights" | "knowledge-base" | "ai-settings" | "mc-master" | "org-members" | "partners" | "finance";

const VIEW_TO_PATH: Record<ViewKey, string> = {
  "advisor-dashboard": "/",
  "dashboard-preview": "/dashboard-preview",
  "admin-dashboard": "/admin-dashboard",
  chat: "/chat",
  customers: "/customers",
  "customer-detail": "/customer-detail",
  pipeline: "/pipeline",
  quotes: "/quotes",
  delivery: "/delivery",
  insights: "/insights",
  "knowledge-base": "/knowledge-base",
  "ai-settings": "/ai-settings",
  "mc-master": "/mc-master",
  "org-members": "/org-members",
  partners: "/partners",
  finance: "/finance",
};
const PATH_TO_VIEW: Record<string, ViewKey> = Object.fromEntries(
  Object.entries(VIEW_TO_PATH).map(([view, path]) => [path, view as ViewKey]),
);

const viewMeta: Record<ViewKey, [string, string]> = {
  "advisor-dashboard": ["대시보드", "배정된 고객 중 오늘 처리할 업무, 우선순위, 내 실적을 한눈에 보는 상담사용 화면입니다."],
  "dashboard-preview": ["대시보드 · 공사중", "차선생 전체 운영 상태를 Supabase Overview처럼 한눈에 훑는 신규 대시보드 초안입니다."],
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

const statusGroupByStatus = Object.fromEntries(
  Object.entries(customerStatusGroups).flatMap(([group, values]) => values.map((value) => [value, group])),
);

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeView: ViewKey =
    PATH_TO_VIEW[location.pathname] ??
    (location.pathname.startsWith("/customer-detail")
      ? "customer-detail"
      : location.pathname.startsWith("/mc-master/")
        ? "mc-master"
        : "advisor-dashboard");
  const [customerMode, setCustomerMode] = useState<CustomerMode>("allDraft");
  const [financeMode, setFinanceMode] = useState<FinanceMode>("stats");
  const [toast, setToast] = useState("작업이 반영되었습니다.");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // RequireAuth가 App 렌더 전에 roleTab null(권한 없음)을 막으므로 이 폴백은 프로덕션에선 도달 불가(타입 안전용).
  const auth = useAuth();
  const roleTab = auth.roleTab ?? "상담사";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersError, setCustomersError] = useState(false);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [chanceOverrides, setChanceOverrides] = useState<Record<number, CustomerChanceOption>>({});
  const [manageStatusOverrides, setManageStatusOverrides] = useState<Record<number, CustomerManageStatus>>({});
  const [customerDetailEditorOpen, setCustomerDetailEditorOpen] = useState(false);
  // 선택 고객은 URL이 single source of truth: /customer-detail/:code 또는 /customers?customer=code.
  const selectedCode = customerCodeFromLocation(location.pathname, location.search);
  const selectedCustomer = selectedCode ? customers.find((customer) => customer.customerId === selectedCode) ?? null : null;
  const isDrawerOpen = activeView === "customers" && selectedCode != null && selectedCustomer != null;

  // mc-master 첫 진입 전에 brands/첫 모델을 백그라운드로 미리 받아둔다(진입 시 캐시 hit → 즉시).
  useEffect(() => {
    prefetchCatalog();
  }, []);

  useEffect(() => {
    let alive = true;
    fetchCustomers()
      .then((list) => {
        if (!alive) return;
        setCustomers(list);
        setChanceOverrides(
          Object.fromEntries(list.filter((c) => c.chance).map((c) => [c.no, c.chance as CustomerChanceOption])),
        );
        setCustomersError(false);
        setCustomersLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setCustomersError(true);
        setCustomersLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const [title, desc] = activeView === "customers"
    ? [
      customerMode === "allDraft" ? "고객 관리 > 전체 보기" : `고객 관리 · ${customerModeMeta[customerMode].title}`,
      customerModeMeta[customerMode].desc,
    ]
    : activeView === "customer-detail"
      ? [`고객 관리 > 전체 보기 > ${selectedCustomer?.name ?? ""}`, `${selectedCustomer?.customerId ?? ""} 고객의 상담 기록, 상태, 견적 조건, 다음 액션을 한 화면에서 처리합니다.`]
    : activeView === "finance"
      ? financeModeMeta[financeMode]
    : viewMeta[activeView];
  const isCustomerLineDraft = activeView === "customers" && customerMode === "allDraft";
  const isCustomerConsole = isCustomerLineDraft || activeView === "customer-detail";

  function showToast(message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    setToastVisible(true);
    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 1800);
  }

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  function handleViewChange(view: string) {
    setCustomerDetailEditorOpen(false);
    navigate(VIEW_TO_PATH[view as ViewKey] ?? "/");
  }

  function openCustomerDetailPanel(customer: Customer) {
    const alreadyOpen = isDrawerOpen;
    setCustomerDetailEditorOpen(false);
    navigate(`/customers?customer=${encodeURIComponent(customer.customerId)}`, { replace: alreadyOpen });
    showToast(`${customer.name} 고객 상세 패널을 열었습니다.`);
  }

  function openCustomerDetailFullScreen() {
    setCustomerDetailEditorOpen(false);
    if (selectedCode) navigate(`/customer-detail/${encodeURIComponent(selectedCode)}`);
  }

  function syncChanceWithStageGroup(customerNo: number, nextGroup: string) {
    setChanceOverrides((current) => {
      if (nextGroup === "계약완료") return { ...current, [customerNo]: "확정" };
      if (current[customerNo] !== "확정") return current;
      const next = { ...current };
      delete next[customerNo];
      return next;
    });
  }

  function updateCustomerWorkflow(customerNo: number, next: { statusGroup?: string; status?: string; chance?: CustomerChanceOption; manageStatus?: CustomerManageStatus }) {
    const target = customers.find((customer) => customer.no === customerNo);
    const prevCustomers = customers;
    const prevChanceOverrides = chanceOverrides;

    if (next.statusGroup || next.status) {
      const nextStageGroup = next.statusGroup ?? target?.statusGroup ?? statusGroupByStatus[next.status ?? ""] ?? "";
      setCustomers((current) => current.map((customer) => {
        if (customer.no !== customerNo) return customer;
        const statusGroup = next.statusGroup ?? customer.statusGroup;
        const status = next.status ?? customer.status;
        return { ...customer, statusGroup, status, date: "방금 전" };
      }));
      syncChanceWithStageGroup(customerNo, nextStageGroup);
    }

    if (next.chance) {
      setChanceOverrides((current) => ({ ...current, [customerNo]: next.chance as CustomerChanceOption }));
    }

    if (next.manageStatus) {
      setManageStatusOverrides((current) => ({ ...current, [customerNo]: next.manageStatus as CustomerManageStatus }));
    }

    // DB 저장(statusGroup/status/chance만 — manageStatus는 컬럼 없음). chance는 계약완료 동기화 규칙 반영.
    const patch: CustomerWritePatch = {};
    if (next.statusGroup) patch.statusGroup = next.statusGroup;
    if (next.status) patch.status = next.status;
    if (next.statusGroup === "계약완료") patch.chance = "확정";
    else if (next.statusGroup && prevChanceOverrides[customerNo] === "확정") patch.chance = null;
    else if (next.chance) patch.chance = next.chance;
    if (target?.id && Object.keys(patch).length > 0) {
      updateCustomer(target.id, patch).catch(() => {
        setCustomers(prevCustomers);
        setChanceOverrides(prevChanceOverrides);
        showToast("저장에 실패했습니다");
      });
    }
  }

  useEffect(() => {
    if (!isDrawerOpen) return;

    function closeByEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (customerDetailEditorOpen) return;
      navigate("/customers");
    }

    document.addEventListener("keydown", closeByEscape);
    return () => document.removeEventListener("keydown", closeByEscape);
  }, [customerDetailEditorOpen, isDrawerOpen, navigate]);

  const isAdmin = roleTab === "최고관리자";

  function renderView() {
    return (
      <Routes>
        <Route path="/" element={<AdvisorDashboardPage />} />
        <Route path="/dashboard-preview" element={<DashboardPreviewPage />} />
        <Route path="/admin-dashboard" element={isAdmin ? <AdminDashboardPage /> : <Navigate to="/" replace />} />
        <Route path="/chat" element={<ChatPage onNavigate={handleViewChange} onToast={showToast} />} />
        <Route
          path="/customers"
          element={
            <CustomerManagementPage
              activeCustomerId={isDrawerOpen ? selectedCode : null}
              chanceOverrides={chanceOverrides}
              customers={customers}
              manageStatusOverrides={manageStatusOverrides}
              mode={customerMode}
              roleTab={roleTab}
              onChanceOverridesChange={setChanceOverrides}
              onCustomersChange={setCustomers}
              onOpenCustomer={openCustomerDetailPanel}
            />
          }
        />
        <Route path="/customer-detail" element={<Navigate to="/customers" replace />} />
        <Route
          path="/customer-detail/:code"
          element={
            selectedCustomer ? (
              <CustomerDetailPage
                chanceOverride={chanceOverrides[selectedCustomer.no]}
                customer={selectedCustomer}
                manageStatusOverride={manageStatusOverrides[selectedCustomer.no]}
                onBack={() => navigate("/customers")}
                onToast={showToast}
                onWorkflowChange={updateCustomerWorkflow}
                variant="page"
              />
            ) : customersLoaded ? (
              <Navigate to="/customers" replace />
            ) : (
              <div className="kim-detail-loading">고객 정보를 불러오는 중…</div>
            )
          }
        />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/quotes" element={<QuotesPage onToast={showToast} />} />
        <Route path="/delivery" element={<DeliveryPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
        <Route path="/ai-settings" element={<AISettingsPage />} />
        <Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} />} />
        <Route path="/mc-master/:modelId" element={<MCMasterPage roleTab={roleTab} />} />
        <Route path="/org-members" element={<OrgMembersPage />} />
        <Route path="/partners" element={<PartnersPage />} />
        <Route path="/finance" element={isAdmin ? <FinancePage mode={financeMode} /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <div className={`shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar activeView={activeView} collapsed={sidebarCollapsed} customerMode={customerMode} financeMode={financeMode} roleTab={roleTab} onCustomerModeChange={setCustomerMode} onFinanceModeChange={setFinanceMode} onViewChange={handleViewChange} />
      <main className={`main ${isCustomerConsole ? "customer-line-draft" : ""}`}>
        <Topbar
          sidebarCollapsed={sidebarCollapsed}
          roleTab={roleTab}
          userName={auth.name}
          userAvatarUrl={auth.avatarUrl}
          onNavigate={handleViewChange}
          onOpenCustomer={openCustomerDetailPanel}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        />
        {/* customer-detail 전체화면은 CustomerDetailPage 자체 헤더가 있어 공통 헤더를 숨겨 중복을 막는다. */}
        {activeView !== "dashboard-preview" && activeView !== "customer-detail" && (
          <header className={`topbar ${isCustomerConsole ? "page-heading-console" : ""}`}>
            <div className="title">
              <h1>
                {isCustomerConsole ? (
                  <span className="customer-title-breadcrumb">
                    <span>고객 관리</span>
                    <ChevronRight aria-hidden="true" size={18} strokeWidth={2.2} />
                    <span>전체 보기</span>
                  </span>
                ) : title}
              </h1>
              <p>{desc}</p>
            </div>
            {!isCustomerConsole && (
              <div className="top-actions"><button className="btn" onClick={() => showToast("고객 상세의 상담 메모 영역으로 이동합니다.")} type="button">상담 메모</button><button className="btn primary" onClick={() => showToast("견적 송출 프로토타입: 고객 앱에 비교 견적이 전달된 것으로 표시합니다.")} type="button">앱으로 견적 송출</button></div>
            )}
          </header>
        )}
        {customersError && <div className="notice-box error">고객 목록을 불러오지 못했습니다.</div>}
        {renderView()}
      </main>
      {isDrawerOpen && selectedCustomer && (
        <div className="customer-detail-drawer-overlay" role="presentation">
          <button aria-label="고객 상세 닫기" className="customer-detail-drawer-backdrop" onClick={() => navigate("/customers")} type="button" />
          <aside aria-label={`${selectedCustomer.name} 고객 상세 패널`} className="customer-detail-drawer" role="dialog" aria-modal="true">
            <CustomerDetailPage
              chanceOverride={chanceOverrides[selectedCustomer.no]}
              customer={selectedCustomer}
              manageStatusOverride={manageStatusOverrides[selectedCustomer.no]}
              onBack={() => navigate("/customers")}
              onEditorOpenChange={setCustomerDetailEditorOpen}
              onFullScreen={openCustomerDetailFullScreen}
              onToast={showToast}
              onWorkflowChange={updateCustomerWorkflow}
              variant="drawer"
            />
          </aside>
        </div>
      )}
      <div className={`toast ${toastVisible ? "show" : ""}`}>{toast}</div>
    </div>
  );
}
