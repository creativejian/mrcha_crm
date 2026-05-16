import { Maximize2, Send, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { roleAccountMeta, type RoleTab } from "@/data/roles";


function SolidSettingsIcon() {
  return <svg className="topbar-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.4 2h3.2l.55 2.4c.48.16.94.35 1.37.58l2.08-1.32 2.27 2.26-1.32 2.08c.23.43.42.89.58 1.37l2.37.56v3.2l-2.37.55c-.16.48-.35.94-.58 1.37l1.32 2.08-2.27 2.27-2.08-1.32c-.43.23-.89.42-1.37.58L13.6 22h-3.2l-.55-2.37a7.9 7.9 0 0 1-1.37-.58L6.4 20.37 4.13 18.1l1.32-2.08a7.9 7.9 0 0 1-.58-1.37L2.5 14.1v-3.2l2.37-.56c.16-.48.35-.94.58-1.37L4.13 6.9 6.4 4.63l2.08 1.32c.43-.23.89-.42 1.37-.58L10.4 2Zm1.6 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" /></svg>;
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className="topbar-solid-icon sidebar-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
      {collapsed ? <path d="M7.5 6.5 17.5 12 7.5 17.5v-11Z" /> : <path d="M16.5 6.5 6.5 12l10 5.5v-11Z" />}
    </svg>
  );
}

function SolidBellIcon() {
  return <svg className="topbar-solid-icon notification-bell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a2 2 0 0 1 2 2v.36c2.9.82 5 3.48 5 6.64v4.2l2 2.8v1H3v-1l2-2.8v-4.2c0-3.16 2.1-5.82 5-6.64V4.5a2 2 0 0 1 2-2Zm-3 18h6a3 3 0 0 1-6 0Z" /></svg>;
}

function QuoteQueueIcon() {
  return <svg className="topbar-solid-icon quote-queue-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h9.4L20 8.1v13.4H5v-19Zm8.2 1.9v4.9h4.9l-4.9-4.9Z" /><path fill="#fff" d="M11.1 8.2h1.5v1.05c.72.12 1.34.38 1.84.76l-.7 1.25a2.95 2.95 0 0 0-1.67-.6c-.5 0-.8.18-.8.48 0 .86 3.48.43 3.48 2.8 0 1.1-.78 1.9-2 2.12v1.16h-1.5v-1.14a4.32 4.32 0 0 1-2.36-.94l.72-1.25c.64.48 1.39.78 2.09.78.58 0 .92-.2.92-.55 0-.91-3.42-.45-3.42-2.79 0-1.05.72-1.84 1.9-2.08V8.2Z" /></svg>;
}

function ChatQueueIcon() {
  return <svg className="topbar-solid-icon chat-queue-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Zm4 4v2h9V8H8Zm0 4v2h7v-2H8Z" /></svg>;
}

function CalculatorIcon() {
  return <svg className="topbar-solid-icon calculator-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h14v19H5v-19Zm3 3v4h8v-4H8Zm0 6.5v2h2v-2H8Zm4 0v2h2v-2h-2Zm4 0v2h1v-2h-1Zm-8 4v2h2v-2H8Zm4 0v2h2v-2h-2Zm4 0v2h1v-2h-1Z" /></svg>;
}

function WorkAiIcon() {
  return <svg className="topbar-solid-icon work-ai-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.4 21h-2.154l-2-5H5.754l-2 5H1.6L8 5h2zm4.6-9v9h-2v-9zM6.554 14h4.892L9 7.885zM19.529 2.32a.507.507 0 0 1 .942 0l.253.61a4.37 4.37 0 0 0 2.25 2.327l.717.32a.53.53 0 0 1 0 .962l-.758.338a4.36 4.36 0 0 0-2.22 2.25l-.246.566a.506.506 0 0 1-.934 0l-.247-.565a4.36 4.36 0 0 0-2.219-2.251l-.76-.338a.53.53 0 0 1 0-.963l.718-.32a4.37 4.37 0 0 0 2.251-2.325z" /></svg>;
}

function SettingSolidIcon({ name }: { name: "chat" | "insights" | "knowledge" | "mc-master" | "ai" | "org" | "partners" | "attendance" | "logout" }) {
  if (name === "chat") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H8.5L4 20V4Zm4 4v2h9V8H8Zm0 4v2h7v-2H8Z" /></svg>;
  }
  if (name === "attendance") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v3h6V2h2v3h3v17H4V5h3V2Zm11 8H6v10h12V10Zm-9 2h3v3H9v-3Zm5 0h3v3h-3v-3ZM9 16h3v2H9v-2Z" /></svg>;
  }
  if (name === "ai") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v3h3v10h-2v3H7v-3H5V7h3V4Zm1 5v6h6V9H9Zm1.5 1.5h1.2v1.2h-1.2v-1.2Zm2.8 0h1.2v1.2h-1.2v-1.2ZM10 13h4v1h-4v-1Z" /></svg>;
  }
  if (name === "insights") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v18H5V3Zm3 4v2h8V7H8Zm0 4v2h8v-2H8Zm0 4v2h5v-2H8Z" /></svg>;
  }
  if (name === "knowledge") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12a2 2 0 0 1 2 2v14h-2V5H7v14h10v2H5V3Zm4 4h6v2H9V7Zm0 4h6v2H9v-2Zm0 4h4v2H9v-2Z" /><path d="M3 7h2v14h12v2H3V7Z" /></svg>;
  }
  if (name === "mc-master") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m17.325 10-.275-1.175q-.275-.1-.537-.25t-.488-.35l-1.15.375-.675-1.15.875-.85q-.05-.3-.05-.6t.05-.6l-.875-.8.675-1.15L16 3.775q.225-.2.488-.35t.562-.25L17.325 2h1.325l.3 1.15q.3.125.563.275t.487.35l1.125-.325.675 1.15-.85.8q.05.3.063.613t-.063.612l.85.8-.65 1.15-1.15-.35q-.225.2-.5.35t-.55.25L18.65 10zm1.738-2.937Q19.5 6.625 19.5 6t-.437-1.062T18 4.5t-1.062.438T16.5 6t.438 1.063T18 7.5t1.063-.437M7.5 16q.625 0 1.063-.437T9 14.5t-.437-1.062T7.5 13t-1.062.438T6 14.5t.438 1.063T7.5 16m9 0q.625 0 1.063-.437T18 14.5t-.437-1.062T16.5 13t-1.062.438T15 14.5t.438 1.063T16.5 16m1.5-4q.8 0 1.563-.2T21 11.2V20q0 .425-.288.713T20 21h-1q-.425 0-.712-.288T18 20v-1H6v1q0 .425-.288.713T5 21H4q-.425 0-.712-.288T3 20v-8l2.075-6q.15-.45.538-.725T6.5 5h5.6q-.05.25-.075.488T12 6t.025.513T12.1 7H6.85L5.8 10h7.75q.875.95 2.025 1.475T18 12" /></svg>;
  }
  if (name === "org") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM5.5 14a2.75 2.75 0 1 1 0 5.5A2.75 2.75 0 0 1 5.5 14Zm13 0a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5ZM12 12c2.9 0 5.05 1.55 5.55 4H14.8a5.2 5.2 0 0 0-5.6 0H6.45C6.95 13.55 9.1 12 12 12Z" /></svg>;
  }
  if (name === "partners") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h8v6H5V4Zm10 2h4v4h-4V6ZM4 13h7v7H4v-7Zm9 1h7v6h-7v-6Zm-6-8v2h4V6H7Zm-1 9v3h3v-3H6Zm9 1v2h3v-2h-3Z" /></svg>;
  }
  return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h9v4h-2V5H7v14h5v-2h2v4H5V3Zm10.5 4.5 5 4.5-5 4.5v-3H10v-3h5.5v-3Z" /></svg>;
}

type TopbarProps = { sidebarCollapsed: boolean; roleTab: RoleTab; onNavigate: (view: string) => void; onToggleSidebar: () => void };

const quickAiPrompts = [
  "오늘 내가 먼저 처리할 일 정리해줘",
  "계약 가능성 높은 고객 순위 뽑아줘",
  "응답 지연 고객 알려줘",
  "오늘 견적 보낼 고객 정리해줘",
  "출고/정산 리스크 찾아줘",
];

const notificationTabs = ["전체", "긴급", "상담", "견적", "계약/출고", "정산"] as const;
type NotificationTab = typeof notificationTabs[number];

const notifications = [
  ["긴급", "김민준 고객 응답 지연 18분", "X3/GLC 비교 견적 이후 후속 응대가 필요합니다.", "방금 전"],
  ["상담", "박서연 고객 상담원 연결 요청", "AI 상담에서 보증금 조건별 상담 연결을 요청했습니다.", "7분 전"],
  ["견적", "이도윤 고객 GV80 견적 확인", "앱에서 견적서를 열람했습니다. 심사 서류 안내가 필요합니다.", "22분 전"],
  ["계약/출고", "이나경 고객 출고 전 체크 필요", "보험 담보와 시공 일정 확인이 남아 있습니다.", "오늘 10:42"],
  ["정산", "최민석 출고 건 입금 확인 필요", "금융사 수수료 입금 상태를 정산 관리에서 확인하세요.", "어제 17:20"],
] as const;

export function Topbar({ sidebarCollapsed, roleTab, onNavigate, onToggleSidebar }: TopbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workAiOpen, setWorkAiOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState<NotificationTab>("전체");
  const [aiInput, setAiInput] = useState("");
  const [selectedPrompt, setSelectedPrompt] = useState(quickAiPrompts[0]);
  const [liveConsulting, setLiveConsulting] = useState(true);
  const [confirmMode, setConfirmMode] = useState<"on" | "off" | null>(null);
  const accountMeta = roleAccountMeta[roleTab];
  const showAdminMetrics = roleTab === "최고관리자";
  const dealerMode = roleTab === "딜러";

  function navigateFromSettings(view: string) {
    onNavigate(view);
    setSettingsOpen(false);
  }

  function openWorkAi() {
    setWorkAiOpen((current) => !current);
    setSettingsOpen(false);
    setNotificationsOpen(false);
  }

  function openNotifications() {
    setNotificationsOpen((current) => !current);
    setSettingsOpen(false);
    setWorkAiOpen(false);
  }

  const visibleNotifications = notifications.filter(([type]) => notificationTab === "전체" || type === notificationTab);

  return (
      <div className="globalbar">
      <div className="global-left"><button className="icon-btn" onClick={onToggleSidebar} type="button" aria-label={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}><SidebarToggleIcon collapsed={sidebarCollapsed} /></button></div>
      {showAdminMetrics && (
        <div className="admin-metric-strip" aria-label="관리자 월간 핵심 지표">
          <span>2026년 5월</span>
          <strong><small>전체 출고</small><b><span className="num">86</span>대</b><em>+15</em></strong>
          <strong><small>리스 실적</small><b><span className="num">48.7</span>억</b><em>+12.4억</em></strong>
          <strong><small>렌트 실적</small><b><span className="num">29.9</span>억</b><em>+9.5억</em></strong>
        </div>
      )}
      <div className="global-right">
        <div className="work-ai-wrap">
          <button className={`icon-btn work-ai-btn ${workAiOpen ? "active" : ""} ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} onClick={openWorkAi} type="button" aria-label="업무 AI"><WorkAiIcon /><span className="ai-status-dot" /></button>
          {workAiOpen && (
            <section className="work-ai-panel" role="dialog" aria-label="업무 AI">
              <div className="work-ai-head">
                <div className="work-ai-title"><span><Sparkles size={16} /></span><div><strong>업무 AI</strong><small>CRM 데이터를 기준으로 우선순위를 정리합니다.</small></div></div>
                <div className="work-ai-actions"><button type="button" aria-label="전체 화면"><Maximize2 size={15} /></button><button onClick={() => setWorkAiOpen(false)} type="button" aria-label="닫기"><X size={16} /></button></div>
              </div>
              <div className="work-ai-body">
                <div className="work-ai-message assistant">
                  <strong>오늘 브리핑</strong>
                  <p>응답 대기 3건, 견적 요청 5건, 출고 예정 2건이 있습니다. 먼저 15분 이상 응답이 지연된 고객과 계약 가능성이 높은 견적 요청 고객을 확인하는 흐름이 좋습니다.</p>
                </div>
                <div className="work-ai-quick">
                  <span>빠른 질문</span>
                  <div>
                    {quickAiPrompts.map((prompt) => (
                      <button className={selectedPrompt === prompt ? "active" : ""} key={prompt} onClick={() => { setSelectedPrompt(prompt); setAiInput(prompt); }} type="button">{prompt}</button>
                    ))}
                  </div>
                </div>
                <div className="work-ai-message user"><p>{selectedPrompt}</p></div>
                <div className="work-ai-message assistant">
                  <strong>예상 답변</strong>
                  <p>현재 기준으로는 김민준, 박서연, 이도윤 순서가 우선입니다. 김민준 고객은 X3/GLC 비교 견적 이후 계약 가능성이 높고, 박서연 고객은 보증금 조건별 견적 정리가 필요합니다.</p>
                </div>
              </div>
              <div className="work-ai-compose">
                <input value={aiInput} onChange={(event) => setAiInput(event.target.value)} placeholder="업무 AI에게 물어보기" />
                <button type="button" aria-label="보내기"><Send size={16} /></button>
              </div>
            </section>
          )}
        </div>
        <button className={`icon-btn calculator-btn ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} type="button" aria-label="계산기"><CalculatorIcon /></button>
        <button className={`icon-btn chat-queue-btn ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} onClick={() => onNavigate("chat")} type="button" aria-label="상담 대기"><ChatQueueIcon /><span className="chat-queue-count num">4</span></button>
        <button className={`icon-btn quote-queue-btn ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} onClick={() => onNavigate("quotes")} type="button" aria-label="견적 요청 큐"><QuoteQueueIcon /><span className="quote-queue-count num">5</span></button>
        <div className="notifications-wrap">
          <button className={`icon-btn notification-btn ${notificationsOpen ? "active" : ""} ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} onClick={openNotifications} type="button" aria-label="업무 알림"><SolidBellIcon /><span className="notification-count num">5</span></button>
          {notificationsOpen && (
            <section className="notifications-panel" role="dialog" aria-label="알림">
              <div className="notifications-head">
                <div><strong>알림</strong><small>놓치면 안 되는 업무 이벤트입니다.</small></div>
                <button type="button">전체 읽음</button>
              </div>
              <div className="notification-tabs">
                {notificationTabs.map((tab) => <button className={notificationTab === tab ? "active" : ""} key={tab} onClick={() => setNotificationTab(tab)} type="button">{tab}</button>)}
              </div>
              <div className="notification-list">
                {visibleNotifications.map(([type, title, desc, time]) => (
                  <button className={`notification-item ${type === "긴급" ? "urgent" : ""}`} key={title} onClick={() => { if (type === "견적") onNavigate("quotes"); else if (type === "정산") onNavigate("finance"); else if (type === "계약/출고") onNavigate("delivery"); else onNavigate("customers"); setNotificationsOpen(false); }} type="button">
                    <span className={`notification-badge ${type === "긴급" ? "urgent" : ""}`}>{type}</span>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                    <em>{time}</em>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="account-chip"><span className="account-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 11.3a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Zm-8 9.2c.65-4.2 3.62-6.8 8-6.8s7.35 2.6 8 6.8H4Z" /></svg></span><span className="account-text">{accountMeta.name} <span>{accountMeta.title}</span></span></div>
        <div className="settings-wrap">
          <button className={`settings-btn ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((current) => !current)} type="button" aria-label={`설정, 실시간 상담 ${liveConsulting ? "켜짐" : "꺼짐"}`}><SolidSettingsIcon /><span className={`settings-status-dot ${liveConsulting ? "on" : "off"}`} aria-hidden="true" /></button>
          {settingsOpen && (
            <div className="settings-menu" role="dialog" aria-label="계정 설정">
              <div className="live-setting-panel">
                <div className="live-setting-label"><span className={`setting-icon-live ${liveConsulting ? "on" : "off"}`}><SettingSolidIcon name="chat" /></span><div><strong>실시간 상담</strong><small>{liveConsulting ? "상담 요청을 받는 중" : "상담 요청을 멈춘 상태"}</small></div></div>
                <div className="live-toggle" role="tablist" aria-label="실시간 상담 상태">
                  <button className={liveConsulting ? "active on" : ""} onClick={() => { if (!liveConsulting) setConfirmMode("on"); }} type="button">On</button>
                  <button className={!liveConsulting ? "active off" : ""} onClick={() => { if (liveConsulting) setConfirmMode("off"); }} type="button">Off</button>
                </div>
              </div>
              <div className="settings-menu-line" />
              <div className="settings-menu-label">운영 설정</div>
              <button className="settings-menu-row" type="button"><span><SettingSolidIcon name="attendance" />근태관리</span></button>
              <button className="settings-menu-row" onClick={() => navigateFromSettings("org-members")} type="button"><span><SettingSolidIcon name="org" />조직 / 구성원</span></button>
              <button className="settings-menu-row" onClick={() => navigateFromSettings("partners")} type="button"><span><SettingSolidIcon name="partners" />딜러 / 거래처</span></button>
              <div className="settings-menu-line" />
              <div className="settings-menu-label">차선생 앱 설정</div>
              <button className="settings-menu-row" onClick={() => navigateFromSettings("mc-master")} type="button"><span><SettingSolidIcon name="mc-master" />MC 마스터</span></button>
              <button className="settings-menu-row" onClick={() => navigateFromSettings("knowledge-base")} type="button"><span><SettingSolidIcon name="knowledge" />지식 베이스</span></button>
              <button className="settings-menu-row" onClick={() => navigateFromSettings("insights")} type="button"><span><SettingSolidIcon name="insights" />인사이트</span></button>
              <button className="settings-menu-row" onClick={() => navigateFromSettings("ai-settings")} type="button"><span><SettingSolidIcon name="ai" />AI 커스텀</span></button>
              <div className="settings-menu-line" />
              <button className="settings-menu-row danger" type="button"><span><SettingSolidIcon name="logout" />로그아웃</span></button>
            </div>
          )}
        </div>
      </div>
      {confirmMode && (
        <div className="modal-backdrop" role="presentation">
          <div className={`confirm-modal ${confirmMode}`} role="dialog" aria-modal="true" aria-label={`실시간 상담 ${confirmMode === "on" ? "켜기" : "끄기"} 확인`}>
            <div className="confirm-icon"><SettingSolidIcon name="chat" /></div>
            <h2>{confirmMode === "on" ? "실시간 상담을 켤까요?" : "실시간 상담을 끌까요?"}</h2>
            <div className="confirm-copy">{confirmMode === "on" ? <><p>On 상태에서는 관리자가 상담 배정을 시작합니다.</p><p>잠시 자리를 비우거나 상담을 받을 수 없을 때는 꼭 Off 상태로 바꿔주세요.</p></> : <><p>Off 상태에서는 앱에서 들어오는 상담 요청이 배정되지 않을 수 있습니다.</p><p>잠시 자리를 비우거나 상담을 받을 수 없을 때만 꺼주세요.</p></>}</div>
            <div className="confirm-actions"><button className="btn cancel" onClick={() => setConfirmMode(null)} type="button">취소</button><button className={`btn ${confirmMode === "on" ? "success" : "danger"}`} onClick={() => { setLiveConsulting(confirmMode === "on"); setConfirmMode(null); }} type="button">{confirmMode === "on" ? "실시간 상담 켜기" : "실시간 상담 끄기"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
