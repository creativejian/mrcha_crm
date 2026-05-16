import { ChevronDown, ShieldUser } from "lucide-react";
import { useState } from "react";
import type { CustomerMode } from "@/data/customers";
import type { FinanceMode } from "@/pages/FinancePage";
import { roleTabs, type RoleTab } from "@/data/roles";

type SidebarProps = {
  activeView: string;
  collapsed: boolean;
  customerMode: CustomerMode;
  financeMode: FinanceMode;
  roleTab: RoleTab;
  onViewChange: (view: string) => void;
  onCustomerModeChange: (mode: CustomerMode) => void;
  onFinanceModeChange: (mode: FinanceMode) => void;
  onRoleTabChange: (role: RoleTab) => void;
};


type MenuIconName = "dashboard" | "chat" | "users" | "detail" | "pipeline" | "quotes" | "delivery" | "insights" | "knowledge" | "ai" | "mc-master" | "org" | "finance" | "discount" | "inventory";

function BrandLogo() {
  return (
    <svg className="brand-logo" viewBox="170 170 430 430" aria-hidden="true">
      <path d="M200 199h93l132 175-132 175h-93l104-139H200v-71h104L200 199Z" />
      <path d="M450 199h71v350h-71V199Zm71 140h47v71h-47v-71Z" />
      <path d="M354 483h71v66h-71v-66Z" fill="#c5c7c9" />
    </svg>
  );
}

function MenuIcon({ name }: { name: MenuIconName }) {
  if (name === "dashboard") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" /></svg>;
  }
  if (name === "chat") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H8.5L4 20V4Zm4 4v2h9V8H8Zm0 4v2h7v-2H8Z" /></svg>;
  }
  if (name === "users") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.45-3.65 2.75-6 6-6s5.55 2.35 6 6h-12Zm10.6-6.15c.75-.52 1.62-.8 2.65-.8 2.85 0 4.9 2.22 5.3 5.95h-4.7a7.63 7.63 0 0 0-3.25-5.15Z" /></svg>;
  }
  if (name === "detail") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6V3Zm8 1.8V8h3.2L14 4.8ZM9 11h7v2H9v-2Zm0 4h7v2H9v-2Z" /><path d="M3 7h2v14h11v2H3V7Z" /></svg>;
  }
  if (name === "pipeline") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h4v16H4V4Zm6 0h4v16h-4V4Zm6 0h4v16h-4V4Z" opacity="0.42" /><path d="M5 6h2v3H5V6Zm0 5h2v3H5v-3Zm0 5h2v2H5v-2Zm6-9h2v5h-2V7Zm0 7h2v4h-2v-4Zm6-8h2v2h-2V6Zm0 4h2v5h-2v-5Zm0 7h2v1h-2v-1Z" /></svg>;
  }
  if (name === "quotes") {
    return <svg className="menu-icon quote-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 1.5h10L20.8 7v15.5H5.2v-21Zm9 1.8V8h4.8l-4.8-4.7Z" /><path fill="#fff" d="M11.25 8.25h1.5v1.05c.72.12 1.36.39 1.88.78l-.7 1.28a3.02 3.02 0 0 0-1.72-.62c-.52 0-.82.18-.82.49 0 .9 3.55.45 3.55 2.88 0 1.15-.8 1.98-2.06 2.2v1.19h-1.5v-1.17a4.45 4.45 0 0 1-2.43-.96l.75-1.28c.65.5 1.43.8 2.15.8.6 0 .95-.2.95-.57 0-.94-3.5-.46-3.5-2.86 0-1.08.74-1.9 1.95-2.14V8.25Z" /></svg>;
  }
  if (name === "insights") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v18H5V3Zm3 4v2h8V7H8Zm0 4v2h8v-2H8Zm0 4v2h5v-2H8Z" /></svg>;
  }
  if (name === "knowledge") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12a2 2 0 0 1 2 2v14h-2V5H7v14h10v2H5V3Zm4 4h6v2H9V7Zm0 4h6v2H9v-2Zm0 4h4v2H9v-2Z" /><path d="M3 7h2v14h12v2H3V7Z" /></svg>;
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
  if (name === "finance") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4V4Zm3 4v2h10V8H7Zm0 4v2h4v-2H7Zm6 0v2h4v-2h-4Zm-6 4v2h4v-2H7Zm6 0v2h4v-2h-4Z" /><path d="M18 2h3v3h-3V2ZM3 19h3v3H3v-3Z" opacity="0.35" /></svg>;
  }
  if (name === "discount") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h9.2L20 10.8V20H4V4Zm10 1.8V10h4.2L14 5.8ZM8.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm.2 7.1 6.9-6.9 1.2 1.2-6.9 6.9-1.2-1.2Zm1.1-5.1a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0Zm7.8 4.4a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0Z" /></svg>;
  }
  if (name === "inventory") {
    return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v4H4V5Zm1 6h14v8H5v-8Zm4 2v2h6v-2H9Zm-3-9 2-2h8l2 2H6Z" /></svg>;
  }
  return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 8 8 4h8l1.8 4H19a2 2 0 0 1 2 2v7h-2v2h-3v-2H8v2H5v-2H3v-7a2 2 0 0 1 2-2h1.2Zm2.7-2-1 2h8.2l-1-2H8.9ZM7 14.5A1.5 1.5 0 1 0 7 11.5a1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" /></svg>;
}

const customerModes: Array<[CustomerMode, string]> = [
  ["all", "전체 보기"],
  ["consulting", "상담 필요"],
  ["contract", "계약 관리"],
  ["delivery", "출고 관리"],
  ["settlement", "출고 정산"],
  ["hold", "보류 / 이탈"],
];

const financeModes: Array<[FinanceMode, string]> = [
  ["stats", "통계"],
  ["revenue", "매출 관리"],
  ["expense", "지출 관리"],
  ["payroll", "급여 관리"],
];

const dealerMenuItems: Array<[MenuIconName, string]> = [
  ["dashboard", "대시보드"],
  ["users", "고객 관리"],
  ["discount", "할인 업데이트"],
  ["inventory", "재고 업로드"],
];

export function Sidebar({ activeView, collapsed, customerMode, financeMode, roleTab, onViewChange, onCustomerModeChange, onFinanceModeChange, onRoleTabChange }: SidebarProps) {
  const canViewAdminMenu = roleTab === "최고관리자";
  const [customersOpen, setCustomersOpen] = useState(true);
  const [financeOpen, setFinanceOpen] = useState(false);

  function handleCustomersToggle() {
    if (customersOpen) {
      setCustomersOpen(false);
      return;
    }
    setCustomersOpen(true);
    onCustomerModeChange("all");
    onViewChange("customers");
  }

  function handleFinanceToggle() {
    if (financeOpen) {
      setFinanceOpen(false);
      return;
    }
    setFinanceOpen(true);
    onFinanceModeChange("stats");
    onViewChange("finance");
  }

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand"><div className="brand-mark"><BrandLogo /></div><div><strong>Mr. Cha CRM</strong><span>상담부터 출고까지 통합 관리</span></div></div>
      <div className="nav-separator" />
      <nav className="nav">
        {roleTab === "딜러"
          ? dealerMenuItems.map(([icon, label], index) => (
            <button className={index === 0 ? "active" : ""} key={label} type="button"><MenuIcon name={icon} /><span>{label}</span></button>
          ))
          : (
            <>
              <button className={activeView === "advisor-dashboard" ? "active" : ""} onClick={() => onViewChange("advisor-dashboard")} type="button"><MenuIcon name="dashboard" /><span>대시보드</span></button>
              <button className={activeView === "chat" ? "active" : ""} onClick={() => onViewChange("chat")} type="button"><MenuIcon name="chat" /><span>실시간 상담</span><span className="nav-count num">4</span></button>
              <div className="nav-group">
                <button className={activeView === "customers" ? "active" : ""} onClick={handleCustomersToggle} type="button"><MenuIcon name="users" /><span>고객 관리</span><ChevronDown className={`nav-chevron ${customersOpen ? "open" : ""}`} size={16} /></button>
                {customersOpen && <div className="subnav">{customerModes.map(([mode, label]) => <button className={activeView === "customers" && customerMode === mode ? "active" : ""} key={mode} onClick={() => { onCustomerModeChange(mode); onViewChange("customers"); }} type="button">{label}</button>)}</div>}
              </div>
              <button className={activeView === "customer-detail" ? "active" : ""} onClick={() => onViewChange("customer-detail")} type="button"><MenuIcon name="detail" /><span>고객 상세</span></button>
              <button className={activeView === "pipeline" ? "active" : ""} onClick={() => onViewChange("pipeline")} type="button"><MenuIcon name="pipeline" /><span>상담 파이프라인</span></button>
              <button className={activeView === "quotes" ? "active" : ""} onClick={() => onViewChange("quotes")} type="button"><MenuIcon name="quotes" /><span>견적 관리</span></button>
              <button className={activeView === "delivery" ? "active" : ""} onClick={() => onViewChange("delivery")} type="button"><MenuIcon name="delivery" /><span>계약 / 출고</span></button>
            </>
          )}
      </nav>
      {canViewAdminMenu && (
        <div className="sidebar-admin-section">
          <nav className="nav admin-nav">
            <button className={activeView === "admin-dashboard" ? "active" : ""} onClick={() => onViewChange("admin-dashboard")} type="button"><ShieldUser className="menu-icon lucide-menu-icon" /><span>리포트</span></button>
            <div className="nav-group">
              <button className={activeView === "finance" ? "active" : ""} onClick={handleFinanceToggle} type="button"><MenuIcon name="finance" /><span>재무 관리</span><ChevronDown className={`nav-chevron ${financeOpen ? "open" : ""}`} size={16} /></button>
              {financeOpen && <div className="subnav">{financeModes.map(([mode, label]) => <button className={activeView === "finance" && financeMode === mode ? "active" : ""} key={mode} onClick={() => { onFinanceModeChange(mode); onViewChange("finance"); }} type="button">{label}</button>)}</div>}
            </div>
          </nav>
        </div>
      )}
      <div className="sidebar-bottom">
        <div className="sidebar-role-tabs" aria-label="임시 역할 메뉴 전환">
          {roleTabs.map((role) => (
            <button className={roleTab === role ? "active" : ""} key={role} onClick={() => onRoleTabChange(role)} type="button">
              {role}
            </button>
          ))}
        </div>
        <div className="sidebar-principle">
          <strong>이번 달 상담 철학</strong>
          <span>신뢰가 생기기 전에는 영업하지 않는다.</span>
          <span>상담, 분석, 제안 순서로 움직인다.</span>
        </div>
      </div>
    </aside>
  );
}
