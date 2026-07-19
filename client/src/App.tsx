import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { type Customer, type CustomerChanceOption, type CustomerMode, customerModeMeta } from "@/data/customers";
import { statusGroupByStatus } from "@/lib/customer-table";
import { applyWorkflowRowUpdate, buildWorkflowPatch, type WorkflowNext } from "@/lib/customer-workflow";
import { fetchCustomers, updateCustomer } from "@/lib/customers";
import { fetchAppQuoteRequests } from "@/lib/quote-requests";
import { subscribeNewQuoteRequests } from "@/lib/quote-requests-realtime";
import { subscribeChatSessions } from "@/lib/chat-realtime";
import { customerCodeFromLocation, customerListPath, customerModeFromSearch } from "@/lib/customer-route";
import { financeListPath, financeModeFromSearch, financeModeMeta } from "@/lib/finance-route";
import { prefetchCatalog } from "@/pages/mc-master/catalog-cache";
import { useAuth } from "./auth/AuthProvider";
import { AISettingsPage } from "@/pages/AISettingsPage";
import { AppRequestsPage } from "@/pages/AppRequestsPage";
import { AdminDashboardPage, DashboardPreviewPage } from "@/pages/DashboardPages";
import { ChatPage } from "@/pages/ChatPage";
import { ConsultationRequestsPage } from "@/pages/ConsultationRequestsPage";
import { CustomerDetailPage } from "@/pages/CustomerDetailPage";
import { CustomerManagementPage } from "@/pages/CustomerManagementPage";
import { DeliveryPage } from "@/pages/DeliveryPage";
import { FinancePage, type FinanceMode } from "@/pages/FinancePage";
import { HandoffOperationPage } from "@/pages/HandoffOperationPage";
import { InsightsPage } from "@/pages/InsightsPage";
import { KnowledgeBasePage } from "@/pages/KnowledgeBasePage";
import { MCMasterPage } from "@/pages/MCMasterPage";
import { OrgMembersPage } from "@/pages/OrgMembersPage";
import { PartnersPage } from "@/pages/PartnersPage";
import { PipelinePage } from "@/pages/PipelinePage";

type ViewKey = "advisor-dashboard" | "admin-dashboard" | "chat" | "customers" | "app-requests" | "consultation-requests" | "customer-detail" | "pipeline" | "delivery" | "insights" | "knowledge-base" | "ai-settings" | "mc-master" | "org-members" | "partners" | "finance" | "handoff-operation";

const VIEW_TO_PATH: Record<ViewKey, string> = {
  "advisor-dashboard": "/",
  "admin-dashboard": "/admin-dashboard",
  chat: "/chat",
  customers: "/customers",
  "app-requests": "/app-requests",
  "consultation-requests": "/consultation-requests",
  "customer-detail": "/customer-detail",
  pipeline: "/pipeline",
  delivery: "/delivery",
  insights: "/insights",
  "knowledge-base": "/knowledge-base",
  "ai-settings": "/ai-settings",
  "mc-master": "/mc-master",
  "org-members": "/org-members",
  partners: "/partners",
  finance: "/finance",
  "handoff-operation": "/handoff-operation",
};
const PATH_TO_VIEW: Record<string, ViewKey> = Object.fromEntries(
  Object.entries(VIEW_TO_PATH).map(([view, path]) => [path, view as ViewKey]),
);

// 공통 헤더(타이틀·서브타이틀)의 단일 소스. customers는 customerModeMeta, finance는 financeModeMeta가 담당해 여기 없다.
const CUSTOMERS_MENU_TITLE = "고객 관리";
const viewMeta: Record<Exclude<ViewKey, "customers" | "finance">, [string, string]> = {
  "advisor-dashboard": ["대시보드", "상담사가 출근해서 바로 판단해야 하는 응답 지연, 견적 작성, 계약 후보, 재컨택 흐름을 한 화면에 모은 대시보드입니다."],
  "admin-dashboard": ["경영 리포트", "전체 운영, 상담 전환, 매출/지출, 직원 생산성 등 차선생의 주요 지표를 리포트 단위로 확인합니다."],
  chat: ["실시간 상담", "앱에서 상담원 연결을 요청한 고객을 접수하고, AI 상담 요약을 보며 실시간 상담으로 전환합니다."],
  "app-requests": ["앱 견적요청", "앱에서 고객이 직접 만든 견적요청을 확인하고, 추후 고객·견적으로 연결합니다."],
  "consultation-requests": ["상담 신청 DB", "앱에서 접수된 상담신청을 유저별로 모아 확인하고, 기존 고객 연결 또는 신규 고객 생성으로 승격합니다."],
  "customer-detail": ["고객 상세", "AI 요약, 상담 메모, 타임라인, 견적, 다음 액션을 한 화면에서 처리합니다."],
  pipeline: ["상담 파이프라인", "상담 진행 단계를 칸반 방식으로 관리하고 상태 변경 로그를 남기는 구조입니다."],
  delivery: ["계약 / 출고", "계약 이후 출고까지 필요한 상태와 체크리스트를 관리합니다."],
  insights: ["인사이트", "앱 상담 중 적재적소에 연결되는 차선생 인사이트 콘텐츠를 관리합니다."],
  "knowledge-base": ["지식베이스", "차선생 AI 상담의 기준이 되는 내부 지식 학습 포맷을 관리합니다."],
  "ai-settings": ["AI 설정", "차선생의 페르소나, 답변 성향, 상담 전환 기준을 관리합니다."],
  "mc-master": ["엠씨 마스터", "차선생 앱과 견적 솔루션에서 사용하는 브랜드, 모델, 트림, MC코드 기준 데이터를 관리합니다."],
  "org-members": ["조직 / 구성원", "구성원, 조직, 권한, 배정 기준을 한 곳에서 관리하는 대표 전용 운영 화면입니다."],
  partners: ["딜러 / 거래처", "딜러, 금융사, 시공/탁송, 제휴처 등 외부 협력 네트워크를 관리합니다."],
  "handoff-operation": ["상담 운영 설정", "고객 앱 실시간 상담사 연결의 운영시간과 강제 ON/OFF, 안내 문구를 관리합니다."],
};


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
  // 고객 목록 mode는 URL(?view=)이 single source — 드로어(?customer)와 같은 축. 딥링크·새로고침 유지·뒤로가기.
  const customerMode = customerModeFromSearch(location.search);
  // 재무 mode도 URL(?view=)이 single source — 고객 관리와 대칭.
  const financeMode = financeModeFromSearch(location.search);
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
  const [customerDetailEditorOpen, setCustomerDetailEditorOpen] = useState(false);
  // 선택 고객은 URL이 single source of truth: /customer-detail/:code 또는 /customers?customer=code.
  const selectedCode = customerCodeFromLocation(location.pathname, location.search);
  const selectedCustomer = selectedCode ? customers.find((customer) => customer.customerId === selectedCode) ?? null : null;
  const isDrawerOpen = activeView === "customers" && selectedCode != null && selectedCustomer != null;

  // mc-master 첫 진입 전에 brands/첫 모델을 백그라운드로 미리 받아둔다(진입 시 캐시 hit → 즉시).
  useEffect(() => {
    prefetchCatalog();
  }, []);

  // 고객 목록 로드/재로드. 마운트 시 1회 + 인박스(S2)에서 신규 고객 생성 후 재호출해 stale 방지.
  // App은 최상위라 사실상 unmount되지 않음(로그아웃 시에만) → setState-after-unmount race는 무시 가능.
  const reloadCustomers = useCallback((): Promise<boolean> => {
    return fetchCustomers()
      .then((list) => {
        setCustomers(list);
        setChanceOverrides(
          Object.fromEntries(list.filter((c) => c.chance).map((c) => [c.no, c.chance as CustomerChanceOption])),
        );
        setCustomersError(false);
        setCustomersLoaded(true);
        return true;
      })
      .catch(() => {
        setCustomersError(true);
        setCustomersLoaded(true);
        return false;
      });
  }, []);

  useEffect(() => {
    reloadCustomers();
  }, [reloadCustomers]);

  // 전체 보기(all) 타이틀은 아래 헤더에서 breadcrumb 마크업으로 렌더되지만, 문자열 소스는 여기와 동일(customerModeMeta).
  const [title, desc] = activeView === "customers"
    ? [`${CUSTOMERS_MENU_TITLE} · ${customerModeMeta[customerMode].title}`, customerModeMeta[customerMode].desc]
    : activeView === "finance"
      ? financeModeMeta[financeMode]
    : viewMeta[activeView];
  // 콘솔 톤(작은 타이틀·흰 바닥)은 2026-07-13 ② 확정으로 전 페이지 기본 — breadcrumb 여부만 뷰별 분기.
  const isCustomerListConsole = activeView === "customers" && customerMode === "all";

  // useCallback로 identity 고정 — onToast가 매 렌더 새 함수면 이를 deps에 둔 자식 effect가 계속 재실행돼,
  // 미리보기 이미지 로딩 플래그가 리셋되며 objectUrl 미리보기가 안 뜨던 버그가 있었다.
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    setToastVisible(true);
    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 1800);
  }, []);

  const [newAppRequestCount, setNewAppRequestCount] = useState(0);
  const [appRequestSignal, setAppRequestSignal] = useState(0);
  const locationRef = useRef(location.pathname);
  const markAppRequestsRead = useCallback(() => setNewAppRequestCount(0), []);
  const [pendingChatCount, setPendingChatCount] = useState(0);
  const markChatRequestsRead = useCallback(() => setPendingChatCount(0), []);

  // 콜백이 항상 현재 경로를 읽도록 ref 동기화. useLayoutEffect라 paint 전(commit 단계)에 갱신돼
  // 내비 직후 race를 제거하면서 react-hooks/refs(렌더 중 ref 갱신 금지)도 위반하지 않는다.
  useLayoutEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!auth.authed) return;
    return subscribeNewQuoteRequests(() => {
      // 인박스 자동갱신은 항상 트리거.
      setAppRequestSignal((s) => s + 1);
      // 이미 인박스를 보고 있으면 토스트/카운트는 생략(자동갱신으로 보임).
      if (locationRef.current.startsWith("/app-requests")) return;
      setNewAppRequestCount((c) => c + 1);
      fetchAppQuoteRequests()
        .then((rows) =>
          showToast(rows[0] ? `새 앱 견적요청: ${rows[0].vehicleLabel}` : "새 앱 견적요청이 도착했습니다"),
        )
        .catch(() => showToast("새 앱 견적요청이 도착했습니다"));
    });
  }, [auth.authed, showToast]);

  useEffect(() => {
    if (!auth.authed) return;
    return subscribeChatSessions((change) => {
      // pending 진입 전이만 알림(그 외 전이는 ChatPage 큐가 자체 구독으로 처리).
      if (change.newMode !== "pending" || change.oldMode === "pending") return;
      if (locationRef.current.startsWith("/chat")) return; // 보고 있으면 생략(견적요청 알림과 동일 규칙)
      setPendingChatCount((count) => count + 1);
      showToast("새 상담원 연결 요청이 도착했습니다");
    });
  }, [auth.authed, showToast]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  function handleViewChange(view: string) {
    setCustomerDetailEditorOpen(false);
    navigate(VIEW_TO_PATH[view as ViewKey] ?? "/");
  }

  // 사이드바 고객 관리 서브메뉴 → mode를 URL로 전환(all은 view 생략). 드로어는 닫힌다(customer 미포함).
  function handleCustomerModeChange(mode: CustomerMode) {
    setCustomerDetailEditorOpen(false);
    navigate(customerListPath(mode));
  }

  // 사이드바 재무 관리 서브메뉴 → mode를 URL로 전환(stats는 view 생략).
  function handleFinanceModeChange(mode: FinanceMode) {
    setCustomerDetailEditorOpen(false);
    navigate(financeListPath(mode));
  }

  function openCustomerDetailPanel(customer: Customer) {
    const alreadyOpen = isDrawerOpen;
    setCustomerDetailEditorOpen(false);
    // 현재 mode를 유지한 채 드로어를 연다(?view=x&customer=code) — 닫으면 그 목록으로 돌아간다.
    navigate(customerListPath(customerMode, customer.customerId), { replace: alreadyOpen });
    showToast(`${customer.name} 고객 상세 패널을 열었습니다.`);
  }

  // 수기 등록 직후: 드로어 URL로 이동하고 목록을 서버에서 다시 받는다.
  // 드로어는 URL이 single source(/customers?customer=code)라 목록이 도착하는 순간 자동으로 열린다
  // (isDrawerOpen이 selectedCustomer 발견 시점에 성립 — 새 상태 0, 기존 메커니즘 그대로).
  function handleCustomerCreated(customerCode: string) {
    navigate(customerListPath(customerMode, customerCode), { replace: isDrawerOpen });
    showToast("고객이 등록되었습니다.");
    // 리로드 실패 = 등록은 됐는데 드로어가 조용히 안 열리는 상태 — 실패를 등록 맥락으로 알린다.
    void reloadCustomers().then((ok) => {
      if (!ok) showToast("등록은 완료됐지만 목록을 불러오지 못했습니다. 새로고침해 주세요.");
    });
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

  function updateCustomerWorkflow(customerNo: number, next: WorkflowNext) {
    const target = customers.find((customer) => customer.no === customerNo);
    const prevCustomers = customers;
    const prevChanceOverrides = chanceOverrides;
    // 변경 후 진행상태그룹(이번 패치 우선 → status 역산 → 기존). 계약완료면 chance는 무조건 "확정"(Option A) —
    // 목록/상세 어디서 비확정으로 바꾸려 해도 무시·차단해서 불일치 상태 자체를 막는다(방어적).
    const nextStageGroup = next.statusGroup ?? target?.statusGroup ?? statusGroupByStatus[next.status ?? ""] ?? "";
    const contracted = nextStageGroup === "계약완료";

    // DB 저장 payload. manageStatus는 ⑦-①(2026-07-13)로 영속 — 서버가 manage_status_at을 함께 찍어
    // "다음 실활동까지 유효"(스누즈)로 저장된다.
    const patch = buildWorkflowPatch(next, { contracted, wasConfirmed: prevChanceOverrides[customerNo] === "확정" });
    const willPatch = Boolean(target?.id) && Object.keys(patch).length > 0;

    // 낙관 반영 — 수동 관리 상태는 row(manageStatus/manageStatusAt)에 직접 반영해 effectiveManageStatus가
    // 단일 판정자(구 manageStatusOverrides 이중 소스는 삭제 경로가 없어 서버 만료를 F5까지 가리던 결함 — 0713 감사).
    // PATCH가 나가면 서버가 updated_at을 bump하므로 lastActivityAt도 같은 now로 갱신(유효/만료 판정 서버 동치).
    const nowIso = new Date().toISOString();
    setCustomers((current) => current.map((customer) =>
      customer.no === customerNo ? applyWorkflowRowUpdate(customer, next, { nowIso, willPatch }) : customer,
    ));
    if (next.statusGroup || next.status) syncChanceWithStageGroup(customerNo, nextStageGroup);

    if (next.chance) {
      setChanceOverrides((current) => ({ ...current, [customerNo]: contracted ? "확정" : next.chance as CustomerChanceOption }));
    }

    if (target?.id && willPatch) {
      updateCustomer(target.id, patch).catch(() => {
        // 실패 롤백 — 스냅샷 복원(관리 상태 포함: row가 단일 소스라 별도 override 복원이 필요 없다).
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
      navigate(customerListPath(customerMode)); // 드로어만 닫고 현재 mode 목록 유지
    }

    document.addEventListener("keydown", closeByEscape);
    return () => document.removeEventListener("keydown", closeByEscape);
  }, [customerDetailEditorOpen, customerMode, isDrawerOpen, navigate]);

  // 고객 상세 패널이 열린 동안 배경(고객 목록 페이지) 스크롤을 잠가 스크롤 전파(chaining)를 막는다.
  useEffect(() => {
    if (!isDrawerOpen) return;
    document.body.classList.add("customer-drawer-open");
    return () => document.body.classList.remove("customer-drawer-open");
  }, [isDrawerOpen]);

  const isAdmin = roleTab === "최고관리자";

  function renderView() {
    return (
      <Routes>
        <Route path="/" element={<DashboardPreviewPage />} />
        <Route path="/admin-dashboard" element={isAdmin ? <AdminDashboardPage /> : <Navigate to="/" replace />} />
        <Route path="/chat" element={<ChatPage customers={customers} roleTab={roleTab} onOpenCustomer={openCustomerDetailPanel} onToast={showToast} onRead={markChatRequestsRead} />} />
        <Route
          path="/customers"
          element={
            <CustomerManagementPage
              activeCustomerId={isDrawerOpen ? selectedCode : null}
              chanceOverrides={chanceOverrides}
              customers={customers}
              mode={customerMode}
              roleTab={roleTab}
              onChanceOverridesChange={setChanceOverrides}
              onCustomerCreated={handleCustomerCreated}
              onCustomerListChanged={reloadCustomers}
              onCustomersChange={setCustomers}
              onOpenCustomer={openCustomerDetailPanel}
              onWorkflowChange={updateCustomerWorkflow}
            />
          }
        />
        <Route path="/app-requests" element={<AppRequestsPage signal={appRequestSignal} onRead={markAppRequestsRead} onToast={showToast} onCustomerListChanged={reloadCustomers} />} />
        {/* 상담 신청 DB 인박스 — 게이트는 견적요청 인박스와 동일 수준(라우트 무게이트, 서버 읽기는 auth만). */}
        <Route path="/consultation-requests" element={<ConsultationRequestsPage customers={customers} onToast={showToast} onCustomerListChanged={reloadCustomers} />} />
        <Route path="/customer-detail" element={<Navigate to="/customers" replace />} />
        <Route
          path="/customer-detail/:code"
          element={
            selectedCustomer ? (
              <CustomerDetailPage
                chanceOverride={chanceOverrides[selectedCustomer.no]}
                customer={selectedCustomer}
                onBack={() => navigate("/customers")}
                onToast={showToast}
                onWorkflowChange={updateCustomerWorkflow}
                onCustomerListChanged={reloadCustomers}
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
        <Route path="/delivery" element={<DeliveryPage />} />
        <Route path="/insights" element={isAdmin ? <InsightsPage /> : <Navigate to="/" replace />} />
        <Route path="/knowledge-base" element={isAdmin ? <KnowledgeBasePage /> : <Navigate to="/" replace />} />
        <Route path="/ai-settings" element={<AISettingsPage />} />
        <Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} />} />
        <Route path="/mc-master/:modelId" element={<MCMasterPage roleTab={roleTab} />} />
        <Route path="/org-members" element={<OrgMembersPage />} />
        <Route path="/partners" element={<PartnersPage />} />
        <Route path="/finance" element={isAdmin ? <FinancePage mode={financeMode} /> : <Navigate to="/" replace />} />
        <Route path="/handoff-operation" element={isAdmin ? <HandoffOperationPage onToast={showToast} /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <div className={`shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar activeView={activeView} collapsed={sidebarCollapsed} customerMode={customerMode} financeMode={financeMode} roleTab={roleTab} newAppRequestCount={newAppRequestCount} pendingChatCount={pendingChatCount} onCustomerModeChange={handleCustomerModeChange} onFinanceModeChange={handleFinanceModeChange} onViewChange={handleViewChange} />
      <main className="main">
        <Topbar
          sidebarCollapsed={sidebarCollapsed}
          roleTab={roleTab}
          userName={auth.name}
          userAvatarUrl={auth.avatarUrl}
          customers={customers}
          customersLoaded={customersLoaded}
          customersError={customersError}
          onNavigate={handleViewChange}
          onOpenCustomer={openCustomerDetailPanel}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          newAppRequestCount={newAppRequestCount}
          pendingChatCount={pendingChatCount}
        />
        {/* 대시보드·customer-detail 전체화면은 자체 헤더가 있어 공통 헤더를 숨겨 중복을 막는다. */}
        {activeView !== "advisor-dashboard" && activeView !== "customer-detail" && (
          <header className="topbar">
            <div className="title">
              <h1>
                {isCustomerListConsole ? (
                  <span className="customer-title-breadcrumb">
                    <span>{CUSTOMERS_MENU_TITLE}</span>
                    <ChevronRight aria-hidden="true" size={18} strokeWidth={2.2} />
                    <span>{customerModeMeta[customerMode].title}</span>
                  </span>
                ) : title}
              </h1>
              <p>{desc}</p>
            </div>
          </header>
        )}
        {customersError && <div className="notice-box error">고객 목록을 불러오지 못했습니다.</div>}
        {renderView()}
      </main>
      {isDrawerOpen && selectedCustomer && (
        <div className="customer-detail-drawer-overlay" role="presentation">
          <button aria-label="고객 상세 닫기" className="customer-detail-drawer-backdrop" onClick={() => navigate(customerListPath(customerMode))} type="button" />
          <aside aria-label={`${selectedCustomer.name} 고객 상세 패널`} className="customer-detail-drawer" role="dialog" aria-modal="true">
            <CustomerDetailPage
              chanceOverride={chanceOverrides[selectedCustomer.no]}
              customer={selectedCustomer}
              onBack={() => navigate(customerListPath(customerMode))}
              onEditorOpenChange={setCustomerDetailEditorOpen}
              onFullScreen={openCustomerDetailFullScreen}
              onToast={showToast}
              onWorkflowChange={updateCustomerWorkflow}
              onCustomerListChanged={reloadCustomers}
              variant="drawer"
            />
          </aside>
        </div>
      )}
      <div className={`toast ${toastVisible ? "show" : ""}`}>{toast}</div>
    </div>
  );
}
