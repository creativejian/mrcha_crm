import { ChevronDown } from "lucide-react";
import { useState } from "react";
import mrchaLogoColor from "@/assets/mrcha-logo-color.svg";
import { customerModeMeta, type CustomerMode } from "@/data/customers";
import type { FinanceMode } from "@/pages/FinancePage";
import type { RoleTab } from "@/data/roles";
import { prefetchPendingConsultations } from "@/lib/consultations";
import { prefetchAppQuoteRequests } from "@/lib/quote-requests";
import { cn } from "@/lib/utils";

type SidebarProps = {
  activeView: string;
  collapsed: boolean;
  customerMode: CustomerMode;
  financeMode: FinanceMode;
  roleTab: RoleTab;
  newAppRequestCount?: number;
  pendingChatCount?: number;
  onViewChange: (view: string) => void;
  onCustomerModeChange: (mode: CustomerMode) => void;
  onFinanceModeChange: (mode: FinanceMode) => void;
};


type MenuIconName = "dashboard" | "chat" | "users" | "detail" | "pipeline" | "quotes" | "delivery" | "ai" | "mc-master" | "org" | "team" | "finance" | "report" | "headphones" | "discount" | "inventory";

function BrandLogo() {
  return (
    <img className="brand-logo" src={mrchaLogoColor} alt="" aria-hidden="true" />
  );
}

function MenuIcon({ name }: { name: MenuIconName }) {
  if (name === "dashboard") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 9V3h8v6zM3 13V3h8v10zm10 8V11h8v10zM3 21v-6h8v6z" /></svg>;
  }
  if (name === "chat") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 22V2h20v16H6zm4-8h8v-2H6zm0-3h12V9H6zm0-3h12V6H6z" /></svg>;
  }
  if (name === "users") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.45-3.65 2.75-6 6-6s5.55 2.35 6 6h-12Zm10.6-6.15c.75-.52 1.62-.8 2.65-.8 2.85 0 4.9 2.22 5.3 5.95h-4.7a7.63 7.63 0 0 0-3.25-5.15Z" /></svg>;
  }
  if (name === "headphones") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1c-5 0-9 4-9 9v7a3 3 0 0 0 3 3h3v-8H5v-2a7 7 0 0 1 7-7a7 7 0 0 1 7 7v2h-4v8h3a3 3 0 0 0 3-3v-7c0-5-4.03-9-9-9" /></svg>;
  }
  if (name === "detail") {
    return <svg className="menu-icon detail-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6V3Zm8 1.8V8h3.2L14 4.8ZM9 11h7v2H9v-2Zm0 4h7v2H9v-2Z" /><path d="M3 7h2v14h11v2H3V7Z" /></svg>;
  }
  if (name === "pipeline") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 9v2H8V9h2V8H4v2H2V2h2v2h8a2 2 0 0 1 2 2v3zm-6 6v3a2 2 0 0 0 2 2h8v2h2v-8h-2v2h-6v-1h2v-2H8v2z" /></svg>;
  }
  if (name === "quotes") {
    return <svg className="menu-icon quote-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 1.5h10L20.8 7v15.5H5.2v-21Zm9 1.8V8h4.8l-4.8-4.7Z" /><text x="12.35" y="16.5" textAnchor="middle" fill="#fff" fontSize="8.6" fontWeight="900" fontFamily="Arial, sans-serif">₩</text></svg>;
  }
  if (name === "delivery") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 21v-9l2.45-7H9v2H5.85L4.8 10h6.35l3.375 3.375q-.25.2-.387.488T14 14.5q0 .625.438 1.063T15.5 16q.35 0 .638-.137t.487-.388l.975.975l2.4-2.375V21h-3v-2H5v2zm4.5-5q.625 0 1.063-.437T8 14.5t-.437-1.062T6.5 13t-1.062.438T5 14.5t.438 1.063T6.5 16m11.1-2.375L11 7V1h6l6.6 6.625zM15 6q.425 0 .713-.288T16 5t-.288-.712T15 4t-.712.288T14 5t.288.713T15 6" /></svg>;
  }
  if (name === "ai") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v3h3v10h-2v3H7v-3H5V7h3V4Zm1 5v6h6V9H9Zm1.5 1.5h1.2v1.2h-1.2v-1.2Zm2.8 0h1.2v1.2h-1.2v-1.2ZM10 13h4v1h-4v-1Z" /></svg>;
  }
  if (name === "mc-master") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v4H5V5Zm0 6h6v8H5v-8Zm8 0h6v8h-6v-8Zm-6 2v1.5h2V13H7Zm8 0v1.5h2V13h-2Zm0 3v1.5h2V16h-2Z" /></svg>;
  }
  if (name === "org") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM5.5 14a2.75 2.75 0 1 1 0 5.5A2.75 2.75 0 0 1 5.5 14Zm13 0a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5ZM12 12c2.9 0 5.05 1.55 5.55 4H14.8a5.2 5.2 0 0 0-5.6 0H6.45C6.95 13.55 9.1 12 12 12Zm-6.5 8.5c1.95 0 3.45.85 3.85 2H1.65c.4-1.15 1.9-2 3.85-2Zm13 0c1.95 0 3.45.85 3.85 2h-7.7c.4-1.15 1.9-2 3.85-2Z" /></svg>;
  }
  if (name === "team") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 10a4 4 0 1 0 0-8a4 4 0 0 0 0 8m-6.5 3a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5M21 10.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 0 1 5 0m-9 .5a5 5 0 0 1 5 5v6H7v-6a5 5 0 0 1 5-5m-7 5c0-.693.1-1.362.288-1.994l-.17.014A3.5 3.5 0 0 0 2 17.5V22h3zm17 6v-4.5a3.5 3.5 0 0 0-3.288-3.494c.187.632.288 1.301.288 1.994v6z" /></svg>;
  }
  if (name === "finance") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16q-.825 0-1.412-.587T10 14t.588-1.412T12 12t1.413.588T14 14t-.587 1.413T12 16M7.375 7h9.25L17.9 4.45q.25-.5-.038-.975T17 3H7q-.575 0-.862.475T6.1 4.45zM8.4 21h7.2q2.25 0 3.825-1.562T21 15.6q0-.95-.325-1.85t-.925-1.625L17.15 9H6.85l-2.6 3.125q-.6.725-.925 1.625T3 15.6q0 2.275 1.563 3.838T8.4 21" /></svg>;
  }
  if (name === "report") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.45 15.18L22 7.31V21H2V3h2v12.54L9.5 6L16 9.78l4.24-7.33l1.73 1l-5.23 9.05l-6.51-3.75L4.31 19h2.26l4.39-7.56z" /></svg>;
  }
  if (name === "discount") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h9.2L20 10.8V20H4V4Zm10 1.8V10h4.2L14 5.8ZM8.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm.2 7.1 6.9-6.9 1.2 1.2-6.9 6.9-1.2-1.2Zm1.1-5.1a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0Zm7.8 4.4a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0Z" /></svg>;
  }
  if (name === "inventory") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v4H4V5Zm1 6h14v8H5v-8Zm4 2v2h6v-2H9Zm-3-9 2-2h8l2 2H6Z" /></svg>;
  }
  return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 8 8 4h8l1.8 4H19a2 2 0 0 1 2 2v7h-2v2h-3v-2H8v2H5v-2H3v-7a2 2 0 0 1 2-2h1.2Zm2.7-2-1 2h8.2l-1-2H8.9ZM7 14.5A1.5 1.5 0 1 0 7 11.5a1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" /></svg>;
}

// 서브메뉴 라벨·순서는 customerModeMeta(단일 소스)에서 파생 — 헤더 타이틀과 드리프트 불가.
const customerModes: Array<[CustomerMode, string]> = (Object.keys(customerModeMeta) as CustomerMode[]).map(
  (mode) => [mode, customerModeMeta[mode].title],
);

const financeModes: Array<[FinanceMode, string]> = [
  ["stats", "통계"],
  ["revenue", "매출 관리"],
  ["expense", "지출 관리"],
  ["payroll", "급여 관리"],
];

// "상담 신청 DB"는 실제 라우트(/consultation-requests — 상담신청 인박스), "실시간 상담 요청"은 아직 스텁(하이라이트만).
const advisorAssignmentModes = [
  ["consultation-requests", "상담 신청 DB"],
  ["advisor-assignment-live", "실시간 상담 요청"],
] as const;

const dealerMenuItems: Array<[MenuIconName, string]> = [
  ["dashboard", "대시보드"],
  ["users", "고객 관리"],
  ["discount", "할인 업데이트"],
  ["inventory", "재고 업로드"],
];

type FlyoutItem = {
  active: boolean;
  label: string;
  onClick: () => void;
};

function SidebarFlyout({ items, title }: { items: FlyoutItem[]; title: string }) {
  function handleItemClick(onClick: () => void) {
    onClick();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  return (
    <div className="sidebar-flyout" role="menu" aria-label={title}>
      <strong>{title}</strong>
      {items.map((item) => (
        <button className={item.active ? "active" : ""} key={item.label} onClick={() => handleItemClick(item.onClick)} type="button" role="menuitem">
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Sidebar({ activeView, collapsed, customerMode, financeMode, roleTab, newAppRequestCount = 0, pendingChatCount = 0, onViewChange, onCustomerModeChange, onFinanceModeChange }: SidebarProps) {
  const canViewAdminMenu = roleTab === "최고관리자";
  const canViewTeamMenu = roleTab === "최고관리자" || roleTab === "팀장";
  const [customersOpen, setCustomersOpen] = useState(true);
  const [advisorAssignmentOpen, setAdvisorAssignmentOpen] = useState(true);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [selectedDraftMenu, setSelectedDraftMenu] = useState<string | null>(null);
  const visibleActiveView = selectedDraftMenu ?? activeView;
  // 아코디언 펼침 상태는 chevron 방향+펼쳐진 서브메뉴로 이미 표현된다 — 헤더에 배경을 깔면
  // active와 구분이 안 돼 "선택된 것처럼" 읽힌다(2026-07-11 실기 버그, 구 nav-parent-open 폐기).
  const navButtonClass = (active: boolean) => cn(
    "nav-item",
    active && "active nav-item-active",
  );
  const subnavButtonClass = (active: boolean) => cn("subnav-item", active && "active");

  function navigate(view: string) {
    setSelectedDraftMenu(null);
    onViewChange(view);
  }

  function handleCustomersToggle() {
    if (collapsed) {
      onCustomerModeChange("all");
      navigate("customers");
      return;
    }
    if (customersOpen) {
      setCustomersOpen(false);
      return;
    }
    setCustomersOpen(true);
    onCustomerModeChange("all");
    navigate("customers");
  }

  function handleFinanceToggle() {
    if (collapsed) {
      onFinanceModeChange("stats");
      navigate("finance");
      return;
    }
    if (financeOpen) {
      setFinanceOpen(false);
      return;
    }
    setFinanceOpen(true);
    onFinanceModeChange("stats");
    navigate("finance");
  }

  function handleAdvisorAssignmentToggle() {
    if (collapsed) {
      // 접힘 상태 부모 클릭 = 첫 서브메뉴(고객 관리 handleCustomersToggle 미러 — 구 draft 하이라이트 폐기).
      navigate("consultation-requests");
      return;
    }
    setSelectedDraftMenu("advisor-assignment");
    if (advisorAssignmentOpen) {
      setAdvisorAssignmentOpen(false);
      return;
    }
    setAdvisorAssignmentOpen(true);
  }

  // 상담사 배정 서브메뉴 — 상담 신청 DB만 실제 navigate, 나머지(실시간 상담 요청)는 스텁 하이라이트 유지.
  function handleAdvisorAssignmentSelect(view: string) {
    if (view === "consultation-requests") {
      navigate(view);
      return;
    }
    setSelectedDraftMenu(view);
  }

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand"><div className="brand-mark"><BrandLogo /></div><div><strong>Mr. Cha CRM</strong><span><mark>이것은 CRM인가 혁명인가</mark></span></div></div>
      <div className="nav-separator" />
      <nav className="nav">
        {roleTab === "딜러"
          ? dealerMenuItems.map(([icon, label], index) => (
            <button aria-label={label} className={navButtonClass(index === 0)} data-label={label} key={label} type="button"><MenuIcon name={icon} /><span>{label}</span></button>
          ))
          : (
            <>
              <button aria-label="대시보드" className={navButtonClass(visibleActiveView === "advisor-dashboard")} data-label="대시보드" onClick={() => navigate("advisor-dashboard")} type="button"><MenuIcon name="dashboard" /><span>대시보드</span></button>
              <button aria-label="실시간 상담" className={navButtonClass(visibleActiveView === "chat")} data-label="실시간 상담" onClick={() => navigate("chat")} type="button"><MenuIcon name="chat" /><span>실시간 상담</span>{pendingChatCount > 0 ? <span className="nav-count num">{pendingChatCount}</span> : null}</button>
              <div className="nav-group">
                <button aria-label="고객 관리" className={cn(navButtonClass(visibleActiveView === "customers"), collapsed && "has-flyout")} data-label="고객 관리" onClick={handleCustomersToggle} type="button"><MenuIcon name="users" /><span>고객 관리</span><ChevronDown className={`nav-chevron ${customersOpen ? "open" : ""}`} size={16} /></button>
                {!collapsed && customersOpen && <div className="subnav">{customerModes.map(([mode, label]) => <button className={subnavButtonClass(visibleActiveView === "customers" && customerMode === mode)} key={mode} onClick={() => onCustomerModeChange(mode)} type="button">{label}</button>)}</div>}
                {collapsed && <SidebarFlyout title="고객 관리" items={customerModes.map(([mode, label]) => ({ active: visibleActiveView === "customers" && customerMode === mode, label, onClick: () => { onCustomerModeChange(mode); navigate("customers"); } }))} />}
              </div>
              <button aria-label="고객 상세" className={navButtonClass(visibleActiveView === "customer-detail")} data-label="고객 상세" onClick={() => navigate("customer-detail")} type="button"><MenuIcon name="detail" /><span>고객 상세</span></button>
              <button aria-label="앱 견적요청" className={navButtonClass(visibleActiveView === "app-requests")} data-label="앱 견적요청" onMouseEnter={() => prefetchAppQuoteRequests()} onClick={() => navigate("app-requests")} type="button"><MenuIcon name="quotes" /><span>앱 견적요청</span>{newAppRequestCount > 0 ? <span className="nav-count num">{newAppRequestCount}</span> : null}</button>
              <button aria-label="상담 파이프라인" className={navButtonClass(visibleActiveView === "pipeline")} data-label="상담 파이프라인" onClick={() => navigate("pipeline")} type="button"><MenuIcon name="pipeline" /><span>상담 파이프라인</span></button>
              <button aria-label="계약 / 출고" className={navButtonClass(visibleActiveView === "delivery")} data-label="계약 / 출고" onClick={() => navigate("delivery")} type="button"><MenuIcon name="delivery" /><span>계약 / 출고</span></button>
            </>
          )}
      </nav>
      {canViewTeamMenu && (
        <div className="sidebar-admin-section">
          <nav className="nav admin-nav">
            <div className="nav-group">
              <button aria-label="상담사 배정" className={cn(navButtonClass(visibleActiveView.startsWith("advisor-assignment") || visibleActiveView === "consultation-requests"), collapsed && "has-flyout")} data-label="상담사 배정" onClick={handleAdvisorAssignmentToggle} type="button"><MenuIcon name="headphones" /><span>상담사 배정</span><ChevronDown className={`nav-chevron ${advisorAssignmentOpen ? "open" : ""}`} size={16} /></button>
              {!collapsed && advisorAssignmentOpen && <div className="subnav">{advisorAssignmentModes.map(([view, label]) => <button className={subnavButtonClass(visibleActiveView === view)} key={view} onClick={() => handleAdvisorAssignmentSelect(view)} onMouseEnter={view === "consultation-requests" ? () => prefetchPendingConsultations() : undefined} type="button">{label}</button>)}</div>}
              {collapsed && <SidebarFlyout title="상담사 배정" items={advisorAssignmentModes.map(([view, label]) => ({ active: visibleActiveView === view, label, onClick: () => handleAdvisorAssignmentSelect(view) }))} />}
            </div>
            <button aria-label="팀원 관리" className={navButtonClass(visibleActiveView === "team-members")} data-label="팀원 관리" onClick={() => setSelectedDraftMenu("team-members")} type="button"><MenuIcon name="team" /><span>팀원 관리</span></button>
            {canViewAdminMenu && (
              <>
                <div className="admin-nav-separator" />
                <button aria-label="경영 리포트" className={navButtonClass(visibleActiveView === "admin-dashboard")} data-label="경영 리포트" onClick={() => navigate("admin-dashboard")} type="button"><MenuIcon name="report" /><span>경영 리포트</span></button>
                <div className="nav-group">
                  <button aria-label="재무 관리" className={cn(navButtonClass(visibleActiveView === "finance"), collapsed && "has-flyout")} data-label="재무 관리" onClick={handleFinanceToggle} type="button"><MenuIcon name="finance" /><span>재무 관리</span><ChevronDown className={`nav-chevron ${financeOpen ? "open" : ""}`} size={16} /></button>
                  {!collapsed && financeOpen && <div className="subnav">{financeModes.map(([mode, label]) => <button className={subnavButtonClass(visibleActiveView === "finance" && financeMode === mode)} key={mode} onClick={() => onFinanceModeChange(mode)} type="button">{label}</button>)}</div>}
                  {collapsed && <SidebarFlyout title="재무 관리" items={financeModes.map(([mode, label]) => ({ active: visibleActiveView === "finance" && financeMode === mode, label, onClick: () => { onFinanceModeChange(mode); navigate("finance"); } }))} />}
                </div>
                {/* 인사이트·지식베이스 진입은 프로필 팝오버 "차선생 앱 설정" 그룹만(프로토타입 원 설계).
                    #251이 덧붙인 사이드바 진입점은 중복이라 제거(2026-07-19 유슨생 — pending 항목 12). */}
              </>
            )}
          </nav>
        </div>
      )}
      <div className="sidebar-bottom">
        <div className="sidebar-principle">
          <strong><span aria-hidden="true">📌</span> 이번 달 상담 철학</strong>
          <span><mark>신뢰가 생기기 전에는</mark> 영업하지 않는다.</span>
          <span><mark>상담, 분석, 제안 순서로</mark> 움직인다.</span>
        </div>
      </div>
    </aside>
  );
}
