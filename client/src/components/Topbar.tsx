import { Maximize2, Send, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DoubleBounceDots } from "@/components/ai/DoubleBounceDots";
import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { initialCustomers, type Customer } from "@/data/customers";
import { roleAccountMeta, type RoleTab } from "@/data/roles";
import { askAssistant, fetchAssistantMessages, type AssistantAnswer, type AssistantMessage } from "@/lib/assistant";
import { signOut } from "@/lib/auth";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";

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
  return <svg className="topbar-solid-icon quote-queue-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h9.4L20 8.1v13.4H5v-19Zm8.2 1.9v4.9h4.9l-4.9-4.9Z" /><text x="12.2" y="16.4" textAnchor="middle" fill="#fff" fontSize="8.6" fontWeight="900" fontFamily="Arial, sans-serif">₩</text></svg>;
}

function ChatQueueIcon() {
  return <svg className="topbar-solid-icon chat-queue-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 22V2h20v16H6zm4-8h8v-2H6zm0-3h12V9H6zm0-3h12V6H6z" /></svg>;
}

function CalculatorIcon() {
  return <svg className="topbar-solid-icon calculator-icon" viewBox="0 0 512 512" aria-hidden="true"><path d="M416 48a16 16 0 0 0-16-16H112a16 16 0 0 0-16 16v416a16 16 0 0 0 16 16h288a16 16 0 0 0 16-16ZM192 432h-48v-48h48Zm0-80h-48v-48h48Zm0-80h-48v-48h48Zm88 160h-48v-48h48Zm0-80h-48v-48h48Zm0-80h-48v-48h48Zm88 160h-48V304h48Zm0-160h-48v-48h48Zm0-96H144V80h224Z" /></svg>;
}

function GlobalSearchIcon({ compact = false }: { compact?: boolean }) {
  return <svg className={`topbar-solid-icon global-search-icon ${compact ? "compact" : ""}`} viewBox="0 0 16 16" aria-hidden="true"><path d="M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2M0 7a7 7 0 1 1 12.606 4.192l3.101 3.1l-1.414 1.415l-3.1-3.1A7 7 0 0 1 0 7" /></svg>;
}

function CustomerSearchResult({ customer, onOpen }: { customer: Customer; onOpen: (customer: Customer) => void }) {
  return (
    <button className="global-search-result" onClick={() => onOpen(customer)} type="button">
      <span className="global-search-result-main">
        <strong>{customer.name}</strong>
        <em>{customer.customerId}</em>
      </span>
      <span className="global-search-result-meta">
        <b>{customer.phone}</b>
        <span>{customer.vehicle}</span>
      </span>
      <span className="global-search-result-foot">
        <small>{customer.status}</small>
        <small>{customer.advisor}</small>
        <small>#{customer.no}</small>
      </span>
    </button>
  );
}

function WorkAiIcon() {
  return <svg className="topbar-solid-icon work-ai-icon" viewBox="0 0 24 24" aria-hidden="true"><g transform="translate(-1.1 .5)"><path d="M8.6 4.2h2.2l6.25 16.6h-2.55l-1.6-4.35H6.45L4.85 20.8H2.3L8.6 4.2Zm-1.4 10.15h4.95L9.7 7.55l-2.5 6.8ZM19.55 12h2.35v8.8h-2.35V12Zm.62-9.75a.58.58 0 0 1 1.06 0l.26.63a3.75 3.75 0 0 0 1.92 1.99l.75.33a.6.6 0 0 1 0 1.09l-.78.35a3.72 3.72 0 0 0-1.89 1.92l-.27.62a.57.57 0 0 1-1.04 0l-.27-.62a3.72 3.72 0 0 0-1.89-1.92l-.78-.35a.6.6 0 0 1 0-1.09l.75-.33a3.75 3.75 0 0 0 1.92-1.99l.26-.63Z" /></g></svg>;
}

function AccountDefaultIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12.2a4.35 4.35 0 1 0 0-8.7 4.35 4.35 0 0 0 0 8.7Zm-7.6 7.3c.7-4.05 3.55-6.35 7.6-6.35s6.9 2.3 7.6 6.35H4.4Z" /></svg>;
}

function SettingSolidIcon({ name }: { name: "chat" | "insights" | "knowledge" | "mc-master" | "ai" | "org" | "partners" | "attendance" | "logout" }) {
  if (name === "chat") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H8.5L4 20V4Zm4 4v2h9V8H8Zm0 4v2h7v-2H8Z" /></svg>;
  }
  if (name === "attendance") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v3h6V2h2v3h3v17H4V5h3V2Zm11 8H6v10h12V10Zm-9 2h3v3H9v-3Zm5 0h3v3h-3v-3ZM9 16h3v2H9v-2Z" /></svg>;
  }
  if (name === "ai") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11V9h-2V7a2.006 2.006 0 0 0-2-2h-2V3h-2v2h-2V3H9v2H7a2.006 2.006 0 0 0-2 2v2H3v2h2v2H3v2h2v2a2.006 2.006 0 0 0 2 2h2v2h2v-2h2v2h2v-2h2a2.006 2.006 0 0 0 2-2v-2h2v-2h-2v-2Zm-4 6H7V7h10Z" /><path d="M11.361 8h-1.345l-2.01 8h1.027l.464-1.875h2.316L12.265 16h1.062Zm-1.729 5.324L10.65 8.95h.046l.983 4.374ZM14.244 8h1v8h-1z" /></svg>;
  }
  if (name === "insights") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9z" /></svg>;
  }
  if (name === "knowledge") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12a2 2 0 0 1 2 2v14h-2V5H7v14h10v2H5V3Zm4 4h6v2H9V7Zm0 4h6v2H9v-2Zm0 4h4v2H9v-2Z" /><path d="M3 7h2v14h12v2H3V7Z" /></svg>;
  }
  if (name === "mc-master") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m17.325 10-.275-1.175q-.275-.1-.537-.25t-.488-.35l-1.15.375-.675-1.15.875-.85q-.05-.3-.05-.6t.05-.6l-.875-.8.675-1.15L16 3.775q.225-.2.488-.35t.562-.25L17.325 2h1.325l.3 1.15q.3.125.563.275t.487.35l1.125-.325.675 1.15-.85.8q.05.3.063.613t-.063.612l.85.8-.65 1.15-1.15-.35q-.225.2-.5.35t-.55.25L18.65 10zm1.738-2.937Q19.5 6.625 19.5 6t-.437-1.062T18 4.5t-1.062.438T16.5 6t.438 1.063T18 7.5t1.063-.437M7.5 16q.625 0 1.063-.437T9 14.5t-.437-1.062T7.5 13t-1.062.438T6 14.5t.438 1.063T7.5 16m9 0q.625 0 1.063-.437T18 14.5t-.437-1.062T16.5 13t-1.062.438T15 14.5t.438 1.063T16.5 16m1.5-4q.8 0 1.563-.2T21 11.2V20q0 .425-.288.713T20 21h-1q-.425 0-.712-.288T18 20v-1H6v1q0 .425-.288.713T5 21H4q-.425 0-.712-.288T3 20v-8l2.075-6q.15-.45.538-.725T6.5 5h5.6q-.05.25-.075.488T12 6t.025.513T12.1 7H6.85L5.8 10h7.75q.875.95 2.025 1.475T18 12" /></svg>;
  }
  if (name === "org") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 10a4 4 0 1 0 0-8a4 4 0 0 0 0 8m-6.5 3a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5M21 10.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 0 1 5 0m-9 .5a5 5 0 0 1 5 5v6H7v-6a5 5 0 0 1 5-5m-7 5c0-.693.1-1.362.288-1.994l-.17.014A3.5 3.5 0 0 0 2 17.5V22h3zm17 6v-4.5a3.5 3.5 0 0 0-3.288-3.494c.187.632.288 1.301.288 1.994v6z" /></svg>;
  }
  if (name === "partners") {
    return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.835 3.161a.8.8 0 0 0 .147-.148h2.562l.035-.001a5 5 0 0 1 .545 0h.038a3.8 3.8 0 0 1 1.646.369a5.23 5.23 0 0 1 2.34 1.822a5.2 5.2 0 0 1 .804 4.348l-3.281-3.237a.75.75 0 0 0-.527-.216h-4.775a.75.75 0 0 0-.423.152l-1.884 1.428a.97.97 0 0 1-1.358-.184a.95.95 0 0 1 .181-1.34zM7.899 14.235l-.014.013l-.974.968l-.013.012a.906.906 0 0 1-1.261-.012a.89.89 0 0 1 0-1.267l.974-.968a.906.906 0 0 1 1.275 0a.89.89 0 0 1 .013 1.254m-.291 1.698a.89.89 0 0 0 .013 1.254c.352.35.923.35 1.275 0l.974-.968a.892.892 0 0 0-.14-1.38a.906.906 0 0 0-1.122.1l-.013.014l-.974.967zM5.5 11.407a.89.89 0 0 1 0 1.267l-.974.968a.906.906 0 0 1-1.275 0a.89.89 0 0 1 0-1.267l.974-.968a.906.906 0 0 1 1.275 0m6.353 5.517a.89.89 0 0 1 0 1.267l-.974.968a.906.906 0 0 1-1.275 0a.89.89 0 0 1-.172-1.028l.001-.002a.9.9 0 0 1 .171-.237l.974-.968a.906.906 0 0 1 1.275 0M5.344 4.83a6.18 6.18 0 0 1 5.112-1.749L7.98 4.958a2.45 2.45 0 0 0-.466 3.448a2.473 2.473 0 0 0 3.454.467l1.684-1.275h4.185l3.507 3.46l.036.04l1.15 1.15a1.439 1.439 0 0 1-1.936 2.124l-.096-.096l-.06-.052l-1.093-1.092a.5.5 0 1 0-.707.707l1.15 1.15q.063.062.128.119l.044.044a1.019 1.019 0 1 1-1.441 1.441l-.17-.169a.5.5 0 0 0-.853.363a.5.5 0 0 0 .147.365l.223.223a.943.943 0 1 1-1.333 1.333h-.001l-.012-.013l-.21-.21a.497.497 0 0 0-.707 0a.5.5 0 0 0 0 .707l.218.219a.96.96 0 0 1-1.35 1.367l-1.431-1.36l.525-.522a1.884 1.884 0 0 0 0-2.677a1.9 1.9 0 0 0-1.429-.552a1.88 1.88 0 0 0-.556-1.42a1.9 1.9 0 0 0-1.428-.552a1.88 1.88 0 0 0-.556-1.419a1.91 1.91 0 0 0-1.844-.489a1.88 1.88 0 0 0-.541-1.085a1.914 1.914 0 0 0-2.514-.158A6.1 6.1 0 0 1 5.344 4.83" /></svg>;
  }
  return <svg className="setting-solid-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h9v4h-2V5H7v14h5v-2h2v4H5V3Zm10.5 4.5 5 4.5-5 4.5v-3H10v-3h5.5v-3Z" /></svg>;
}

type TopbarProps = {
  sidebarCollapsed: boolean;
  roleTab: RoleTab;
  userName: string | null;
  userAvatarUrl: string | null;
  onNavigate: (view: string) => void;
  onOpenCustomer: (customer: Customer) => void;
  onToggleSidebar: () => void;
  newAppRequestCount: number;
  pendingChatCount: number;
};

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

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/[\s-]/g, "");
}

export function Topbar({ sidebarCollapsed, roleTab, userName, userAvatarUrl, onNavigate, onOpenCustomer, onToggleSidebar, newAppRequestCount, pendingChatCount }: TopbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [recentSearchCustomers, setRecentSearchCustomers] = useState<Customer[]>([]);
  const [workAiOpen, setWorkAiOpen] = useState(false);
  const [workAiClosing, setWorkAiClosing] = useState(false);
  const [workAiExpanded, setWorkAiExpanded] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState<NotificationTab>("전체");
  const [aiInput, setAiInput] = useState("");
  const [aiTurns, setAiTurns] = useState<{ question: string; answer: AssistantAnswer | null; error?: string }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHistory, setAiHistory] = useState<AssistantMessage[]>([]);
  const [aiHistoryLoaded, setAiHistoryLoaded] = useState(false);
  const [aiHasMore, setAiHasMore] = useState(true);
  const [aiLoadingOlder, setAiLoadingOlder] = useState(false);
  const workAiBodyRef = useRef<HTMLDivElement>(null);
  const olderLoadedRef = useRef(false); // 직전 갱신이 "이전 메시지 prepend"였는지 — 상단 노출 스크롤용
  const loadingOlderRef = useRef(false); // 동기 재진입 가드(state는 커밋 지연되어 레이스)
  const AI_HISTORY_PAGE = 30; // 백엔드 DISPLAY_LIMIT와 일치
  const OLDER_INDICATOR_MIN_MS = 400; // 빠른 로드에도 로딩 표시가 최소 이 시간은 보이도록

  useEffect(() => {
    if (!workAiOpen || aiHistoryLoaded) return;
    let alive = true;
    void fetchAssistantMessages()
      .then((rows) => { if (alive) { setAiHistory(rows); setAiHistoryLoaded(true); setAiHasMore(rows.length === AI_HISTORY_PAGE); } })
      .catch(() => { if (alive) setAiHistoryLoaded(true); });
    return () => { alive = false; };
  }, [workAiOpen, aiHistoryLoaded]);

  // 대화 갱신 시 스크롤: 이전 메시지 로드면 그 배치를 상단에 노출, 그 외(진입·새 메시지)엔 최하단.
  useLayoutEffect(() => {
    if (!workAiOpen) return;
    const el = workAiBodyRef.current;
    if (!el) return;
    if (olderLoadedRef.current) {
      olderLoadedRef.current = false;
      // children: [0]오늘 브리핑 [1]빠른 질문 [2..]히스토리. 맨 앞 히스토리(=새로 불러온 가장 오래된 것)를
      // 상단에 노출한다. 상단 근접(<40px) 밖에 위치하므로 자동 연쇄 로딩도 안 생긴다.
      const firstHistory = el.children[2] as HTMLElement | undefined;
      el.scrollTop = firstHistory ? firstHistory.offsetTop : el.scrollHeight;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [workAiOpen, aiHistory, aiTurns, aiLoading]);

  async function loadOlderMessages() {
    const el = workAiBodyRef.current;
    if (!el || loadingOlderRef.current || !aiHasMore || aiHistory.length === 0) return;
    loadingOlderRef.current = true;
    setAiLoadingOlder(true);
    const startedAt = Date.now();
    try {
      const oldest = aiHistory[0];
      const older = await fetchAssistantMessages({ createdAt: oldest.createdAt, id: oldest.id });
      if (older.length > 0) {
        olderLoadedRef.current = true; // 로드된 이전 메시지를 상단에 노출
        setAiHistory((cur) => [...older, ...cur]);
      }
      setAiHasMore(older.length === AI_HISTORY_PAGE);
    } catch {
      // 실패 시 노출 스크롤 없음
    } finally {
      // 로컬 fetch가 매우 빨라도 로딩 표시가 최소 시간은 보이도록(번쩍임 방지).
      const remaining = OLDER_INDICATOR_MIN_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      loadingOlderRef.current = false;
      setAiLoadingOlder(false);
    }
  }

  async function submitAiQuestion() {
    const question = aiInput.trim();
    if (!question || aiLoading) return;
    setAiInput("");
    setAiTurns((cur) => [...cur, { question, answer: null }]);
    setAiLoading(true);
    try {
      const res = await askAssistant(question);
      setAiHistory((cur) => [...cur, ...res.messages]);
      setAiTurns((cur) => cur.filter((t) => t.question !== question)); // 낙관적 turn 제거(영속본으로 대체)
    } catch (e) {
      const message = e instanceof Error ? e.message : "일시적으로 답변에 실패했습니다.";
      setAiTurns((cur) => cur.map((t, i) => (i === cur.length - 1 ? { ...t, error: message } : t)));
    } finally {
      setAiLoading(false);
    }
  }
  const [selectedPrompt, setSelectedPrompt] = useState(quickAiPrompts[0]);
  const [liveConsulting, setLiveConsulting] = useState(true);
  // 실패한 아바타 URL을 저장한다. URL이 바뀌면(재로그인/사용자 전환) 자동으로 다시 시도한다
  // — 단순 boolean이면 한 번 onError 후 멀쩡한 새 아바타도 계속 기본 아이콘으로 표시된다.
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<"on" | "off" | null>(null);
  const workAiRef = useRef<HTMLDivElement>(null);
  const workAiCloseTimerRef = useRef<number | null>(null);
  const globalSearchRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsCloseTimerRef = useRef<number | null>(null);
  const suppressNotificationOutsideClickRef = useRef(false);
  const accountMeta = roleAccountMeta[roleTab];
  const showAdminMetrics = roleTab === "최고관리자" || roleTab === "팀장";
  const isAdminRole = roleTab === "최고관리자";
  // 실제 로그인 사용자 정보(인증 컨텍스트). full_name/avatar는 카카오 user_metadata 기반.
  const displayName = userName ?? "사용자";
  const showAvatar = !!userAvatarUrl && failedAvatarUrl !== userAvatarUrl;
  const usesDefaultAvatar = !showAvatar;
  const showAttendanceMenu = roleTab !== "딜러";
  const dealerMode = roleTab === "딜러";
  const canManageLiveConsulting = !dealerMode;
  const displayLiveConsulting = canManageLiveConsulting && liveConsulting;
  const accountOrgLabel = dealerMode ? accountMeta.title : roleTab === "최고관리자" ? "크리에이티브지안" : "인천본사 상담팀";
  const accountScopeLabel = roleTab === "최고관리자" ? "전체 운영 권한" : roleTab === "팀장" ? "팀 상담 관리" : roleTab === "상담사" ? "상담 업무" : "딜러 포털";
  const normalizedGlobalSearchQuery = normalizeSearchValue(globalSearchQuery);
  const hasGlobalSearchQuery = normalizedGlobalSearchQuery.length > 0;
  const globalSearchResults = useMemo(() => normalizedGlobalSearchQuery
    ? initialCustomers.filter((customer) => {
      const haystack = normalizeSearchValue([
        customer.name,
        customer.phone,
        customer.customerId,
        String(customer.no),
        customer.vehicle,
        customer.status,
        customer.statusGroup,
        customer.advisor,
        customer.source,
      ].join(" "));
      return haystack.includes(normalizedGlobalSearchQuery);
    }).slice(0, 6)
    : [], [normalizedGlobalSearchQuery]);

  function openSettingsMenu() {
    if (settingsCloseTimerRef.current) {
      window.clearTimeout(settingsCloseTimerRef.current);
      settingsCloseTimerRef.current = null;
    }
    setSettingsClosing(false);
    setSettingsOpen(true);
    setGlobalSearchOpen(false);
    closeWorkAi();
    setNotificationsOpen(false);
  }

  function closeSettingsMenu() {
    if (!settingsOpen || settingsClosing) return;
    setSettingsClosing(true);
    if (settingsCloseTimerRef.current) window.clearTimeout(settingsCloseTimerRef.current);
    settingsCloseTimerRef.current = window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
      settingsCloseTimerRef.current = null;
    }, 110);
  }

  function navigateFromSettings(view: string) {
    onNavigate(view);
    closeSettingsMenu();
  }

  function shouldIgnoreTopbarAction() {
    return suppressNotificationOutsideClickRef.current;
  }

  function openWorkAiMenu() {
    if (shouldIgnoreTopbarAction()) return;
    if (workAiCloseTimerRef.current) {
      window.clearTimeout(workAiCloseTimerRef.current);
      workAiCloseTimerRef.current = null;
    }
    setWorkAiClosing(false);
    setWorkAiOpen(true);
    setGlobalSearchOpen(false);
    closeSettingsMenu();
    setNotificationsOpen(false);
  }

  function closeWorkAi() {
    if (!workAiOpen || workAiClosing) return;
    setWorkAiClosing(true);
    if (workAiCloseTimerRef.current) window.clearTimeout(workAiCloseTimerRef.current);
    workAiCloseTimerRef.current = window.setTimeout(() => {
      setWorkAiOpen(false);
      setWorkAiClosing(false);
      setWorkAiExpanded(false);
      workAiCloseTimerRef.current = null;
    }, 110);
  }

  function openWorkAi() {
    if (shouldIgnoreTopbarAction()) return;
    if (workAiOpen) closeWorkAi();
    else openWorkAiMenu();
  }

  function openNotifications() {
    if (shouldIgnoreTopbarAction()) return;
    setNotificationsOpen((current) => !current);
    setGlobalSearchOpen(false);
    closeSettingsMenu();
    closeWorkAi();
  }

  function openGlobalSearch() {
    if (shouldIgnoreTopbarAction()) return;
    setGlobalSearchOpen((current) => !current);
    closeSettingsMenu();
    closeWorkAi();
    setNotificationsOpen(false);
  }

  function navigateFromTopbar(view: string) {
    if (shouldIgnoreTopbarAction()) return;
    onNavigate(view);
  }

  const handleGlobalSearchCustomerOpen = useCallback((customer: Customer) => {
    setRecentSearchCustomers((current) => [customer, ...current.filter((item) => item.customerId !== customer.customerId)].slice(0, 3));
    onOpenCustomer(customer);
    setGlobalSearchOpen(false);
    setGlobalSearchQuery("");
  }, [onOpenCustomer]);

  useEffect(() => {
    return () => {
      if (workAiCloseTimerRef.current) window.clearTimeout(workAiCloseTimerRef.current);
      if (settingsCloseTimerRef.current) window.clearTimeout(settingsCloseTimerRef.current);
    };
  }, []);

  // 계정 설정: 외부 pointerdown은 confirm 모달이 떠 있으면 무시, Esc는 항상 닫는다(원본 동작 보존).
  usePopoverDismiss(settingsMenuRef, settingsOpen, closeSettingsMenu, {
    guard: () => confirmMode !== null,
  });

  // 통합검색: Esc 닫기 + Enter로 첫 결과 열기.
  usePopoverDismiss(globalSearchRef, globalSearchOpen, () => setGlobalSearchOpen(false), {
    onKeyDown: (event) => {
      if (event.key === "Enter" && globalSearchResults[0]) handleGlobalSearchCustomerOpen(globalSearchResults[0]);
    },
  });

  // 업무 AI: 닫기 애니메이션은 closeWorkAi 내부에서 처리.
  usePopoverDismiss(workAiRef, workAiOpen, closeWorkAi);

  // 알림: 첫 외부클릭을 capture 단계에서 소비해 그 클릭이 다른 Topbar 액션을 실행하지 못하게 막는
  // 특수 동작이라 공용 usePopoverDismiss로 통합하지 않고 별도 effect로 유지한다.
  useEffect(() => {
    if (!notificationsOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (notificationsRef.current?.contains(event.target as Node)) return;
      suppressNotificationOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setNotificationsOpen(false);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressNotificationOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressNotificationOutsideClickRef.current = false;
      }, 0);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setNotificationsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationsOpen]);

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
        <div className="global-search-wrap" ref={globalSearchRef}>
          <button className={`global-search-trigger ${globalSearchOpen ? "active" : ""}`} onClick={openGlobalSearch} type="button" aria-label="고객 통합 검색" aria-expanded={globalSearchOpen}>
            <GlobalSearchIcon />
          </button>
          {globalSearchOpen && (
            <>
              <div
                aria-hidden="true"
                className="topbar-popover-shield"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setGlobalSearchOpen(false);
                }}
              />
              <section className="global-search-panel" role="dialog" aria-label="고객 통합 검색">
                <div className="global-search-input-wrap">
                  <GlobalSearchIcon compact />
                  <input autoFocus value={globalSearchQuery} onChange={(event) => setGlobalSearchQuery(event.target.value)} placeholder="고객명, 연락처, 차량, 고객번호 검색" />
                </div>
                <div className="global-search-results">
                  {!hasGlobalSearchQuery && recentSearchCustomers.length > 0 && (
                    <div className="global-search-recent">
                      <div className="global-search-section-head">
                        <strong>최근 조회 고객</strong>
                        <span>검색어를 입력하면 결과가 바로 전환됩니다.</span>
                      </div>
                      {recentSearchCustomers.map((customer) => (
                        <CustomerSearchResult customer={customer} key={customer.customerId} onOpen={handleGlobalSearchCustomerOpen} />
                      ))}
                    </div>
                  )}
                  {hasGlobalSearchQuery && globalSearchResults.length > 0 && (
                    <div className="global-search-query-results">
                      <div className="global-search-section-head">
                        <strong>조회 결과</strong>
                        <span>{globalSearchResults.length}명</span>
                      </div>
                      {globalSearchResults.map((customer) => (
                        <CustomerSearchResult customer={customer} key={customer.customerId} onOpen={handleGlobalSearchCustomerOpen} />
                      ))}
                    </div>
                  )}
                  {hasGlobalSearchQuery && globalSearchResults.length === 0 && (
                    <div className="global-search-empty">
                      <strong>검색 결과 없음</strong>
                      <span>고객명, 연락처, 차량명, 고객번호를 다시 확인해주세요.</span>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
        <div className="work-ai-wrap" ref={workAiRef}>
          <button className={`icon-btn work-ai-btn ${workAiOpen ? "active" : ""} ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} onClick={openWorkAi} type="button" aria-label="업무 AI" aria-expanded={workAiOpen}><WorkAiIcon /><span className="ai-status-dot" /></button>
          {workAiOpen && (
            <>
              <div
                aria-hidden="true"
                className="topbar-popover-shield"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  closeWorkAi();
                }}
              />
              <section className={`work-ai-panel ${workAiExpanded ? "expanded" : ""} ${workAiClosing ? "closing" : ""}`} role="dialog" aria-label="업무 AI">
                <div className="work-ai-head">
                  <div className="work-ai-title"><strong>업무 AI</strong><small>CRM 데이터를 기준으로 우선순위를 정리합니다.</small></div>
                  <div className="work-ai-actions"><button className={workAiExpanded ? "active" : ""} onClick={() => setWorkAiExpanded((current) => !current)} type="button" aria-label={workAiExpanded ? "업무 AI 축소" : "업무 AI 확대"} aria-pressed={workAiExpanded}><Maximize2 size={15} /></button><button onClick={closeWorkAi} type="button" aria-label="닫기"><X size={16} /></button></div>
                </div>
                <div className="work-ai-body-shell">
                  {aiLoadingOlder && <div className="work-ai-load-older"><DoubleBounceDots /></div>}
                  <div className="work-ai-body" ref={workAiBodyRef} onScroll={(event) => { if (event.currentTarget.scrollTop < 40 && aiHasMore && !aiLoadingOlder) void loadOlderMessages(); }}>
                  <div className="work-ai-message assistant">
                    <strong>오늘 브리핑</strong>
                    <p>궁금한 업무를 물어보면 CRM 데이터(메모·상담·니즈)를 근거로 답합니다.</p>
                  </div>
                  <div className="work-ai-quick">
                    <span>빠른 질문</span>
                    <div>
                      {quickAiPrompts.map((prompt) => (
                        <button className={selectedPrompt === prompt ? "active" : ""} key={prompt} onClick={() => { setSelectedPrompt(prompt); setAiInput(prompt); }} type="button">{prompt}</button>
                      ))}
                    </div>
                  </div>
                  {aiHistory.map((m) => (
                    <div className={`work-ai-message ${m.role}`} key={m.id}>
                      {m.role === "assistant" ? <MarkdownMessage content={m.content} /> : <p>{m.content}</p>}
                      {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                        <ul className="work-ai-sources">
                          {m.sources.map((s, j) => <li key={j}>{s.customerName} · {s.snippet}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                  {aiTurns.map((turn, i) => (
                    <Fragment key={`t${i}`}>
                      <div className="work-ai-message user"><p>{turn.question}</p></div>
                      <div className="work-ai-message assistant">
                        {turn.error ? <p className="work-ai-error">{turn.error}</p> : <DoubleBounceDots />}
                      </div>
                    </Fragment>
                  ))}
                  </div>
                </div>
                <div className="work-ai-compose">
                  <input
                    value={aiInput}
                    onChange={(event) => setAiInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitAiQuestion(); } }}
                    placeholder="업무 AI에게 물어보기"
                  />
                  <button type="button" aria-label="보내기" disabled={aiLoading} onClick={() => void submitAiQuestion()}><Send size={16} /></button>
                </div>
              </section>
            </>
          )}
        </div>
        <button className={`icon-btn calculator-btn ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} type="button" aria-label="계산기"><CalculatorIcon /></button>
        <button className={`icon-btn chat-queue-btn ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} onClick={() => navigateFromTopbar("chat")} type="button" aria-label="상담 대기"><ChatQueueIcon />{pendingChatCount > 0 && <span className="chat-queue-count num">{pendingChatCount}</span>}</button>
        <button className={`icon-btn quote-queue-btn ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} onClick={() => navigateFromTopbar("quotes")} type="button" aria-label="견적 요청 큐"><QuoteQueueIcon /><span className="quote-queue-count num">5</span></button>
        <div className="notifications-wrap" ref={notificationsRef}>
          <button className={`icon-btn notification-btn ${notificationsOpen ? "active" : ""} ${dealerMode ? "disabled" : ""}`} disabled={dealerMode} onClick={openNotifications} type="button" aria-label="업무 알림"><SolidBellIcon />{(newAppRequestCount + pendingChatCount) > 0 && <span className="notification-count num">{newAppRequestCount + pendingChatCount}</span>}</button>
          {notificationsOpen && (
            <>
              <div
                aria-hidden="true"
                className="topbar-popover-shield"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setNotificationsOpen(false);
                }}
              />
              <section className="notifications-panel" role="dialog" aria-label="알림">
                <div className="notifications-head">
                  <div><strong>알림</strong><small>놓치면 안 되는 업무 이벤트입니다.</small></div>
                  <button className="notifications-read-all" type="button">전체 읽음</button>
                </div>
                <div className="notification-tabs">
                  {notificationTabs.map((tab) => <button className={notificationTab === tab ? "active" : ""} key={tab} onClick={() => setNotificationTab(tab)} type="button">{tab}</button>)}
                </div>
                <div className="notification-list">
                  {(notificationTab === "전체" || notificationTab === "견적") && newAppRequestCount > 0 && (
                    <button className="notification-item app-request-new" onClick={() => { onNavigate("app-requests"); setNotificationsOpen(false); }} type="button">
                      <span className="notification-badge">견적</span>
                      <strong>새 앱 견적요청 {newAppRequestCount}건</strong>
                      <small>앱에서 들어온 새 견적요청을 확인하세요.</small>
                      <em>최근</em>
                    </button>
                  )}
                  {(notificationTab === "전체" || notificationTab === "상담") && pendingChatCount > 0 && (
                    <button className="notification-item app-request-new" onClick={() => { onNavigate("chat"); setNotificationsOpen(false); }} type="button">
                      <span className="notification-badge">상담</span>
                      <strong>상담원 연결 요청 {pendingChatCount}건</strong>
                      <small>앱 고객이 상담원 연결을 기다리고 있습니다.</small>
                      <em>최근</em>
                    </button>
                  )}
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
            </>
          )}
        </div>
        <div className="settings-wrap account-menu-wrap" ref={settingsMenuRef}>
          <button className={`icon-btn account-btn ${settingsOpen ? "active" : ""}`} onClick={() => { if (shouldIgnoreTopbarAction()) return; if (settingsOpen) closeSettingsMenu(); else openSettingsMenu(); }} type="button" aria-label={`${displayName}, ${roleTab}, 실시간 상담 ${displayLiveConsulting ? "켜짐" : "꺼짐"}`} aria-expanded={settingsOpen}><span className={`account-avatar ${usesDefaultAvatar ? "default" : ""}`} aria-hidden="true">{showAvatar ? <img src={userAvatarUrl ?? ""} alt="" onError={() => setFailedAvatarUrl(userAvatarUrl ?? null)} /> : <AccountDefaultIcon />}</span><span className={`settings-status-dot account-status-dot ${displayLiveConsulting ? "on" : "off"}`} aria-hidden="true" /></button>
          {settingsOpen && (
            <>
              <div
                aria-hidden="true"
                className="topbar-popover-shield"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!confirmMode) closeSettingsMenu();
                }}
              />
              <div className={`settings-menu ${settingsClosing ? "closing" : ""}`} role="dialog" aria-label="계정 설정">
                <div className="account-menu-head">
                  <div className="account-menu-title">
                    <strong>{displayName}</strong>
                    <span>{roleTab}</span>
                  </div>
                  <div className="account-menu-meta" aria-label="계정 권한 정보">
                    <span>{accountOrgLabel}</span>
                    <span>{accountScopeLabel}</span>
                  </div>
                </div>
                <div className="settings-menu-line account-line" />
                <div className={`live-setting-panel ${canManageLiveConsulting ? "" : "disabled"}`}>
                  <div className="live-setting-label"><span className={`setting-icon-live ${displayLiveConsulting ? "on" : "off"}`}><SettingSolidIcon name="chat" /></span><div><strong>실시간 상담</strong><small>{canManageLiveConsulting ? (liveConsulting ? "상담 수신 중" : "상담 수신 중지") : "상담 수신 비활성화"}</small></div></div>
                  <div className="live-toggle" role="tablist" aria-label="실시간 상담 상태">
                    <button className={displayLiveConsulting ? "active on" : ""} disabled={!canManageLiveConsulting} onClick={() => { if (canManageLiveConsulting && !liveConsulting) setConfirmMode("on"); }} type="button">On</button>
                    <button className={!displayLiveConsulting ? "active off" : ""} disabled={!canManageLiveConsulting} onClick={() => { if (canManageLiveConsulting && liveConsulting) setConfirmMode("off"); }} type="button">Off</button>
                  </div>
                </div>
                {(showAttendanceMenu || isAdminRole) && (
                  <>
                    <div className={`settings-menu-line live-line ${isAdminRole ? "" : "compact"}`} />
                    <div className="settings-menu-section">
                      {isAdminRole && <div className="settings-menu-label">운영 설정</div>}
                      {showAttendanceMenu && <button className="settings-menu-row" type="button"><span><SettingSolidIcon name="attendance" />근태관리</span></button>}
                      {isAdminRole && <button className="settings-menu-row" onClick={() => navigateFromSettings("org-members")} type="button"><span><SettingSolidIcon name="org" />조직 / 구성원</span></button>}
                      {isAdminRole && <button className="settings-menu-row" onClick={() => navigateFromSettings("partners")} type="button"><span><SettingSolidIcon name="partners" />딜러 / 거래처</span></button>}
                    </div>
                  </>
                )}
                {isAdminRole && (
                  <>
                    <div className="settings-menu-line section-line" />
                    <div className="settings-menu-section">
                      <div className="settings-menu-label">차선생 앱 설정</div>
                      <button className="settings-menu-row" onClick={() => navigateFromSettings("mc-master")} type="button"><span><SettingSolidIcon name="mc-master" />MC 마스터</span></button>
                      <button className="settings-menu-row" onClick={() => navigateFromSettings("knowledge-base")} type="button"><span><SettingSolidIcon name="knowledge" />지식 베이스</span></button>
                      <button className="settings-menu-row" onClick={() => navigateFromSettings("insights")} type="button"><span><SettingSolidIcon name="insights" />인사이트</span></button>
                      <button className="settings-menu-row" onClick={() => navigateFromSettings("ai-settings")} type="button"><span><SettingSolidIcon name="ai" />AI 커스텀</span></button>
                    </div>
                  </>
                )}
                <div className={`settings-menu-line logout-line ${dealerMode ? "after-live" : ""}`}><span>Prototype by Jian</span></div>
                <div className="settings-menu-section logout-section">
                  <button className="settings-menu-row danger" onClick={() => void signOut()} type="button"><span><SettingSolidIcon name="logout" />로그아웃</span></button>
                </div>
              </div>
            </>
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
