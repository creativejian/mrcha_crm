import { Check, ChevronsUpDown, Minus, Plus, RefreshCcw, Search } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { APP_QUOTE_REQUEST_SOURCE, CHANCE_OPTIONS, CUSTOMER_MANAGE_STATUSES, SOURCE_MANUAL_OPTIONS, type Customer, type CustomerChanceOption, type CustomerManageStatus, type CustomerMode, customerStatusGroups, initialCustomers } from "@/data/customers";
import { aiHintPlainText, badgeClass, firstResponseDisplay, resolveChance, secondaryStageOptionsByGroup, type ChanceOption, type FinalUpdateInfo, type StagePickerLevel } from "@/lib/customer-table";
import { findPhoneDuplicate, fullPhoneFromLocal } from "@/lib/customer-create";
import { formatLocalPhone } from "@/lib/detail-utils";
import { createCustomer, prefetchCustomerDetail } from "@/lib/customers";
import { resolveUpdateBadge } from "@/lib/manage-status";
import { bindSelect } from "@/lib/select-bind";
import { useStaffDirectory } from "@/lib/staff";
import { changeAdvisorBulk } from "@/lib/customer-bulk-advisor";
import { deleteCustomersBulk, formatBulkTargetNames } from "@/lib/customer-bulk-delete";
import { prefetchCustomerQuoteRequests } from "@/lib/quote-requests";
import { CustomerActionsCell, CustomerChanceCell, CustomerFinalUpdateCell, CustomerInfoCell, CustomerNextActionCell, CustomerOperationCell, CustomerSelectCell, CustomerStageCell, CustomerVehicleCell } from "@/pages/CustomerManagementRow";
import type { RoleTab } from "@/data/roles";

type CustomerManagementPageProps = {
  activeCustomerId?: string | null;
  customers?: Customer[];
  mode: CustomerMode;
  chanceOverrides?: Record<number, CustomerChanceOption>;
  onChanceOverridesChange?: (overrides: Record<number, CustomerChanceOption>) => void;
  onCustomersChange?: (customers: Customer[]) => void;
  onOpenCustomer?: (customer: Customer) => void;
  // 수기 등록 성공 후 App이 목록 리로드 + 드로어 URL 이동을 처리한다(customerCode 전달).
  onCustomerCreated?: (customerCode: string) => void;
  // 일괄 담당자 변경 성공 후 App이 목록을 서버에서 리로드한다(assignedAt 등 서버 스탬프가 진실).
  // 반환이 Promise<boolean>(App reloadCustomers)이면 실패를 advisorNotice로 맥락화한다(#215 관례).
  onCustomerListChanged?: () => void | Promise<boolean>;
  // 진행상태/계약가능성을 단일 소스(App.updateCustomerWorkflow)로 보내 DB 저장+상세 동기화한다.
  // App 라우트에선 항상 전달되고, 단독(stories/test)에선 미전달 → 내부 state 폴백.
  onWorkflowChange?: (
    customerNo: number,
    next: { statusGroup?: string; status?: string; chance?: CustomerChanceOption; manageStatus?: CustomerManageStatus },
  ) => void;
  roleTab?: RoleTab;
};

function modeFilter(mode: CustomerMode, customer: Customer) {
  if (mode === "consulting") return ["신규", "상담중", "견적", "차량체크", "심사서류", "관리중"].includes(customer.statusGroup);
  if (mode === "contract") return ["심사서류", "계약완료"].includes(customer.statusGroup);
  if (mode === "delivery") return customer.statusGroup === "계약완료";
  if (mode === "settlement") return customer.status === "출고완료" && customer.settlementStatus;
  if (mode === "hold") return ["관리중", "상담완료", "불발"].includes(customer.statusGroup);
  return true;
}

const headsByMode: Record<CustomerMode, string[]> = {
  all: ["선택", "고객", "차종 · 구매방식", "진행 상태", "계약 가능성", "상담 메모 · 문의 사항", "접수 · 배정", "관리 상태", "액션"],
  consulting: ["선택", "고객", "차종 · 구매방식", "상담 상태", "AI 요약", "상담 메모", "담당", "관리"],
  contract: ["선택", "고객", "고객유형", "차종 · 구매방식", "계약 / 심사", "계약 조건", "상담 메모", "담당", "관리"],
  delivery: ["선택", "고객", "차량", "출고 상태", "출고 업무", "담당", "관리"],
  settlement: ["선택", "고객", "차종 · 구매방식", "출고일", "수수료", "비용", "마진", "정산 상태", "관리"],
  hold: ["선택", "고객", "차종 · 구매방식", "상태", "이탈 / 보류 요약", "재컨택 액션", "담당", "관리"],
};

const tableColumnsByMode: Record<CustomerMode, string[]> = {
  all: ["select", "customer", "vehicle", "stage", "chance", "action", "operation", "update", "actions"],
  consulting: ["select", "customer", "vehicle", "stage", "summary", "action", "advisor", "actions"],
  contract: ["select", "customer", "type", "vehicle", "stage", "summary", "action", "advisor", "actions"],
  delivery: ["select", "customer", "vehicle", "stage", "summary", "advisor", "actions"],
  settlement: ["select", "customer", "vehicle", "date", "money", "money", "money", "stage", "actions"],
  hold: ["select", "customer", "vehicle", "stage", "summary", "action", "advisor", "actions"],
};

const pageSizeOptions = [15, 30, 50, 100] as const;
type FinalUpdateFilterOption = CustomerManageStatus;
type ConsoleFilterKey = "statusGroup" | "status" | "advisor" | "chance" | "finalUpdate" | "viewAdvisor" | "viewConsultStatus" | "viewUrgent";

// 뷰 select(담당자별/상담상태별/긴급순 보기)는 아직 정렬 로직이 없다(mock). 시각 pill만 통일하고
// onChange는 no-op — 옵션·핸들러는 후속 슬라이스에서 채운다.
const NOOP_VIEW_CHANGE = (_value: string) => undefined;

function shouldShowAdvisorColumn(roleTab: RoleTab) {
  return roleTab === "최고관리자" || roleTab === "팀장";
}

function visibleTableItems(items: string[], showAdvisorColumn: boolean) {
  return showAdvisorColumn ? items : items.filter((item) => item !== "담당" && item !== "advisor");
}

function filterSelectClass(active: boolean, extraClassName?: string) {
  return ["select", extraClassName, active ? "filter-active" : ""].filter(Boolean).join(" ");
}

export function CustomerManagementPage({
  activeCustomerId = null,
  customers: controlledCustomers,
  mode,
  chanceOverrides: controlledChanceOverrides,
  onChanceOverridesChange,
  onCustomersChange,
  onOpenCustomer,
  onCustomerCreated,
  onCustomerListChanged,
  onWorkflowChange,
  roleTab = "최고관리자",
}: CustomerManagementPageProps) {
  const [internalCustomers, setInternalCustomers] = useState(initialCustomers);
  // 담당자 후보/필터 = 직원 디렉토리(profiles CRM 역할) — ADVISOR_NAMES 목업 폐기(#176 후속).
  const { staff: staffDirectory } = useStaffDirectory();
  const staffNames = staffDirectory.map((s) => s.name);
  const [search, setSearch] = useState("");
  const [statusGroup, setStatusGroup] = useState("");
  const [status, setStatus] = useState("");
  const [advisor, setAdvisor] = useState("");
  const [chanceFilter, setChanceFilter] = useState<"" | ChanceOption>("");
  const [finalUpdateFilter, setFinalUpdateFilter] = useState<"" | FinalUpdateFilterOption>("");
  const [selected, setSelected] = useState<number[]>([]);
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(15);
  const [currentPage, setCurrentPage] = useState(1);
  const [openStagePicker, setOpenStagePicker] = useState<{ customerNo: number; level: StagePickerLevel } | null>(null);
  const [openChanceFor, setOpenChanceFor] = useState<number | null>(null);
  const [openExtraFor, setOpenExtraFor] = useState<string | null>(null);
  const [openFinalUpdateFor, setOpenFinalUpdateFor] = useState<number | null>(null);
  const [internalChanceOverrides, setInternalChanceOverrides] = useState<Record<number, ChanceOption>>({});
  const [finalUpdateOverrides, setFinalUpdateOverrides] = useState<Record<number, FinalUpdateInfo>>({});
  const [editingNextAction, setEditingNextAction] = useState<{ customerNo: number; draft: string } | null>(null);
  const [chanceNoticeFor, setChanceNoticeFor] = useState<number | null>(null);
  const nextActionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const nextActionEditorRef = useRef<HTMLDivElement>(null);
  const stagePickerRef = useRef<HTMLDivElement>(null);
  const chancePopoverRef = useRef<HTMLDivElement>(null);
  const extraPopoverRef = useRef<HTMLButtonElement>(null);
  const finalUpdatePopoverRef = useRef<HTMLDivElement>(null);
  const consoleFilterRailRef = useRef<HTMLDivElement>(null);
  const pageSizeControlRef = useRef<HTMLDivElement>(null);
  const chanceNoticeTimerRef = useRef<number | null>(null);
  const suppressOutsideClickRef = useRef(false);
  const showAdvisorColumn = shouldShowAdvisorColumn(roleTab);
  const tableHeads = visibleTableItems(headsByMode[mode], showAdvisorColumn);
  const tableColumns = visibleTableItems(tableColumnsByMode[mode], showAdvisorColumn);
  const [openConsoleFilter, setOpenConsoleFilter] = useState<ConsoleFilterKey | null>(null);
  const [openPageSize, setOpenPageSize] = useState(false);
  // 고객 삭제 — admin만. 서버가 진짜 게이트이고(403 fail-closed) 여기 숨김은 UX 보조다.
  const canDeleteCustomers = roleTab === "최고관리자";
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  // 고객 수기 등록 — dealer는 서버가 403으로 막는다(진짜 게이트). 여기 숨김은 UX 보조다.
  const canCreateCustomers = roleTab !== "딜러";
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createSource, setCreateSource] = useState<string>(SOURCE_MANUAL_OPTIONS[0]);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // 일괄 담당자 변경 — 노출은 담당 컬럼 기준(관리자/팀장)과 정합. 서버는 개별 PATCH 그대로라
  // 추가 게이트 없음(개별 배정과 동일 권한 의미 — 숨김은 UX 보조).
  const [changingAdvisorOpen, setChangingAdvisorOpen] = useState(false);
  const [advisorPick, setAdvisorPick] = useState("");
  const [changingAdvisor, setChangingAdvisor] = useState(false);
  const [advisorNotice, setAdvisorNotice] = useState<string | null>(null);
  const customers = controlledCustomers ?? internalCustomers;
  const chanceOverrides = controlledChanceOverrides ?? internalChanceOverrides;
  // 삭제 확인창과 deleteSelected가 같은 대상 집합을 본다. selected는 페이지·필터를 넘어 유지되므로
  // "지금 화면에 보이는 행"이 아니라 이 집합이 실제 삭제 대상이다.
  const selectedCustomers = customers.filter((customer) => selected.includes(customer.no));

  function updateCustomers(next: Customer[] | ((current: Customer[]) => Customer[])) {
    const nextCustomers = typeof next === "function" ? next(customers) : next;
    if (onCustomersChange) onCustomersChange(nextCustomers);
    else setInternalCustomers(nextCustomers);
  }

  function updateChanceOverrides(next: Record<number, ChanceOption> | ((current: Record<number, ChanceOption>) => Record<number, ChanceOption>)) {
    const nextOverrides = typeof next === "function" ? next(chanceOverrides) : next;
    if (onChanceOverridesChange) onChanceOverridesChange(nextOverrides);
    else setInternalChanceOverrides(nextOverrides);
  }

  const statuses = statusGroup ? customerStatusGroups[statusGroup] : Object.values(customerStatusGroups).flat();
  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    // 계약가능성·관리상태 필터는 all mode에만 pill이 있다(다른 mode엔 해제 UI가 없다). state는
    // 유지하되 비-all mode에선 적용하지 않는다 — 잔존 필터가 비-all 목록을 조용히 좁혀 "고객이
    // 사라졌다" 혼동을 만들던 것 해소. all 복귀 시 값이 살아 있어 pill로 다시 제어한다(배치 6 A#3).
    const activeChanceFilter = mode === "all" ? chanceFilter : "";
    const activeFinalUpdateFilter = mode === "all" ? finalUpdateFilter : "";
    return customers.filter((customer) => {
      const searchable = `${customer.name} ${customer.phone} ${customer.vehicle} ${customer.customerType} ${customer.customerTypeDetail} ${customer.status} ${customer.source} ${customer.advisor} ${aiHintPlainText(customer)}`.toLowerCase();
      const chance = resolveChance(customer, chanceOverrides[customer.no]);
      const updateStatus = resolveUpdateBadge(customer, {
        finalUpdateOverride: finalUpdateOverrides[customer.no],
      }).status?.label ?? "";
      return modeFilter(mode, customer) &&
        (!keyword || searchable.includes(keyword)) &&
        (!statusGroup || customer.statusGroup === statusGroup) &&
        (!status || customer.status === status) &&
        (!advisor || customer.advisor === advisor) &&
        (!activeChanceFilter || chance === activeChanceFilter) &&
        (!activeFinalUpdateFilter || updateStatus === activeFinalUpdateFilter);
    });
  }, [advisor, chanceFilter, chanceOverrides, customers, finalUpdateFilter, finalUpdateOverrides, mode, search, status, statusGroup]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const pageStart = (effectivePage - 1) * pageSize;
  const paginatedRows = rows.slice(pageStart, pageStart + pageSize);
  const pageEnd = rows.length === 0 ? 0 : pageStart + paginatedRows.length;
  const allSelected = paginatedRows.length > 0 && paginatedRows.every((customer) => selected.includes(customer.no));
  const visiblePages = useMemo(() => {
    const maxVisiblePages = 5;
    const start = Math.max(1, Math.min(effectivePage - 2, totalPages - maxVisiblePages + 1));
    const end = Math.min(totalPages, start + maxVisiblePages - 1);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [effectivePage, totalPages]);

  useEffect(() => {
    if (openConsoleFilter === null) return;

    function closeConsoleFilter(event: PointerEvent) {
      if (consoleFilterRailRef.current?.contains(event.target as Node)) return;
      setOpenConsoleFilter(null);
    }

    function closeConsoleFilterByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenConsoleFilter(null);
    }

    document.addEventListener("pointerdown", closeConsoleFilter, true);
    document.addEventListener("keydown", closeConsoleFilterByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeConsoleFilter, true);
      document.removeEventListener("keydown", closeConsoleFilterByKeyboard);
    };
  }, [openConsoleFilter]);

  useEffect(() => {
    if (!openPageSize) return;

    function closePageSize(event: PointerEvent) {
      if (pageSizeControlRef.current?.contains(event.target as Node)) return;
      setOpenPageSize(false);
    }

    function closePageSizeByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenPageSize(false);
    }

    document.addEventListener("pointerdown", closePageSize, true);
    document.addEventListener("keydown", closePageSizeByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closePageSize, true);
      document.removeEventListener("keydown", closePageSizeByKeyboard);
    };
  }, [openPageSize]);

  function isTableControlTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(".stage-control, .chance-control, .extra-count-pill, .final-update-control"));
  }

  useEffect(() => {
    if (openStagePicker === null) return;

    function closeStagePicker(event: PointerEvent) {
      if (stagePickerRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenStagePicker(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeStagePickerByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenStagePicker(null);
    }

    document.addEventListener("pointerdown", closeStagePicker, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeStagePickerByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeStagePicker, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeStagePickerByKeyboard);
    };
  }, [openStagePicker]);

  useEffect(() => {
    if (openChanceFor === null) return;

    function closeChancePopover(event: PointerEvent) {
      if (chancePopoverRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenChanceFor(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeChancePopoverByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenChanceFor(null);
    }

    document.addEventListener("pointerdown", closeChancePopover, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeChancePopoverByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeChancePopover, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeChancePopoverByKeyboard);
    };
  }, [openChanceFor]);

  useEffect(() => {
    if (openExtraFor === null) return;

    function closeExtraPopover(event: PointerEvent) {
      if (extraPopoverRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenExtraFor(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeExtraPopoverByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenExtraFor(null);
    }

    document.addEventListener("pointerdown", closeExtraPopover, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeExtraPopoverByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeExtraPopover, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeExtraPopoverByKeyboard);
    };
  }, [openExtraFor]);

  useEffect(() => {
    if (openFinalUpdateFor === null) return;

    function closeFinalUpdatePopoverFromAiHint(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(".ai-hint-wrap")) {
        setOpenFinalUpdateFor(null);
      }
    }

    function closeFinalUpdatePopover(event: PointerEvent) {
      if (finalUpdatePopoverRef.current?.contains(event.target as Node)) return;
      if (isTableControlTarget(event.target)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenFinalUpdateFor(null);
    }

    function suppressOutsideClick(event: globalThis.MouseEvent) {
      if (!suppressOutsideClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.setTimeout(() => {
        suppressOutsideClickRef.current = false;
      }, 0);
    }

    function closeFinalUpdatePopoverByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenFinalUpdateFor(null);
    }

    document.addEventListener("pointerover", closeFinalUpdatePopoverFromAiHint, true);
    document.addEventListener("pointerdown", closeFinalUpdatePopover, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeFinalUpdatePopoverByKeyboard);
    return () => {
      document.removeEventListener("pointerover", closeFinalUpdatePopoverFromAiHint, true);
      document.removeEventListener("pointerdown", closeFinalUpdatePopover, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeFinalUpdatePopoverByKeyboard);
    };
  }, [openFinalUpdateFor]);

  useEffect(() => {
    const textarea = nextActionTextareaRef.current;
    if (!editingNextAction || !textarea) return;
    const cursorPosition = textarea.value.length;
    textarea.focus();
    textarea.setSelectionRange(cursorPosition, cursorPosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customerNo가 바뀔 때만 textarea 포커스를 옮기는 의도된 effect
  }, [editingNextAction?.customerNo]);

  useEffect(() => {
    if (!editingNextAction) return;
    const editingCustomerNo = editingNextAction.customerNo;

    function saveNextActionFromOutsideClick(event: PointerEvent) {
      if (nextActionEditorRef.current?.contains(event.target as Node)) return;
      saveNextAction(editingCustomerNo);
    }

    document.addEventListener("pointerdown", saveNextActionFromOutsideClick, true);
    return () => {
      document.removeEventListener("pointerdown", saveNextActionFromOutsideClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editingNextAction이 켜질 때만 외부 클릭 저장 리스너를 등록; saveNextAction(일반 함수)은 의도적으로 deps에서 제외
  }, [editingNextAction]);

  useEffect(() => {
    return () => {
      if (chanceNoticeTimerRef.current !== null) window.clearTimeout(chanceNoticeTimerRef.current);
    };
  }, []);

  function showChanceNotice(customerNo: number) {
    if (chanceNoticeTimerRef.current !== null) window.clearTimeout(chanceNoticeTimerRef.current);
    setChanceNoticeFor(customerNo);
    chanceNoticeTimerRef.current = window.setTimeout(() => {
      setChanceNoticeFor(null);
      chanceNoticeTimerRef.current = null;
    }, 2200);
  }

  function syncChanceWithStageGroup(customerNo: number, nextGroup: string) {
    updateChanceOverrides((current) => {
      if (nextGroup === "계약완료") return { ...current, [customerNo]: "확정" };
      if (current[customerNo] !== "확정") return current;
      const next = { ...current };
      delete next[customerNo];
      return next;
    });
  }

  function markFinalUpdate(customerNo: number, field: string, action = `${field} 업데이트`) {
    setFinalUpdateOverrides((current) => ({
      ...current,
      [customerNo]: { action, label: "방금 전", days: 0 },
    }));
  }

  function toggleFinalUpdatePopover(event: MouseEvent<HTMLButtonElement>, customerNo: number) {
    event.stopPropagation();
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor((current) => current === customerNo ? null : customerNo);
  }

  function toggleAll(checked: boolean) {
    const pageIds = paginatedRows.map((customer) => customer.no);
    setSelected((current) => checked
      ? Array.from(new Set([...current, ...pageIds]))
      : current.filter((id) => !pageIds.includes(id)));
  }

  // 고객 하드 삭제(admin 전용). spec: ref/specs/2026-07-10-crm-customer-delete-design.md
  // 되돌릴 수 없으므로 ①확인 단계를 거치고 ②서버가 성공을 확인한 건만 선택 해제한다.
  // 목록 반영은 로컬 필터가 아니라 서버 리로드(0713 감사) — updateCustomers의 함수형 인자는 App 최신
  // state가 아니라 클릭 시점 렌더 클로저(customers)를 받으므로, 삭제 진행(건별 순차, 수 초) 중 일어난
  // 다른 행 변경이 전체 배열 교체로 화면에서 되돌아가는 race가 있었다. 등록·담당자 변경과 동일 문법.
  async function deleteSelected() {
    if (deleting) return;
    const targets = selectedCustomers.map((customer) => ({ id: customer.id, name: customer.name }));
    setDeleting(true);
    const { deletedIds, failed } = await deleteCustomersBulk(targets);
    setDeleting(false);
    setConfirmingDelete(false);

    setDeleteNotice(
      failed.length
        ? `${failed.length}명 삭제 실패 — ${failed.map((f) => `${f.name}: ${f.reason}`).join(" / ")}`
        : null,
    );
    if (deletedIds.length) {
      const removed = new Set(deletedIds);
      // 성공한 건만 선택 해제 — 실패 행은 선택을 유지해 즉시 재시도할 수 있게 한다(advisor 경로와 대칭).
      setSelected((current) => current.filter((no) => {
        const customer = customers.find((c) => c.no === no);
        return !customer?.id || !removed.has(customer.id);
      }));
      const reload = onCustomerListChanged?.();
      if (reload instanceof Promise) {
        void reload.then((ok) => {
          if (ok === false) {
            // 삭제는 됐는데 화면만 stale — 전역 배너는 이 작업과 무관해 보여 오인을 만든다(#216 관례).
            setDeleteNotice((current) => current
              ? `${current} / 목록 갱신 실패 — 새로고침해 주세요.`
              : "삭제는 완료됐지만 목록을 불러오지 못했습니다. 새로고침해 주세요.");
          }
        });
      } else if (!onCustomerListChanged) {
        // 단독(stories/test) 폴백 — 리로드 경로가 없을 때만 로컬 필터(단일 사용자 전제라 race 없음).
        updateCustomers((current) => current.filter((customer) => !customer.id || !removed.has(customer.id)));
      }
    }
  }

  // 연락처 중복 소프트 경고 — 등록을 막지 않는다(가족 공유 번호 등 실무 예외).
  // createPhone은 뒤 8자리 표시값(상세 연락처 수정과 동일 문법) — 비교는 010 조립 후 전체 번호로.
  const createDuplicate = creatingOpen ? findPhoneDuplicate(customers, fullPhoneFromLocal(createPhone) ?? "") : null;

  // 닫기 경로(성공 제출·취소·헤드바 토글) 공통 리셋 — 초안이 남으면 다음 열람 때 이전 이름/번호가 그대로 보인다.
  function resetCreateForm() {
    setCreateName("");
    setCreatePhone("");
    setCreateSource(SOURCE_MANUAL_OPTIONS[0]);
    setCreateError(null);
  }

  async function submitCreateCustomer() {
    if (createSubmitting) return;
    const name = createName.trim();
    if (!name) {
      setCreateError("이름을 입력하세요.");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const { customerCode } = await createCustomer({
        name,
        phone: fullPhoneFromLocal(createPhone),
        source: createSource,
      });
      setCreatingOpen(false);
      resetCreateForm();
      onCustomerCreated?.(customerCode);
    } catch (e) {
      // 서버 한글 사유(403 권한 / 400 어휘)를 그대로 노출한다(httpError가 body.error를 싣는다).
      setCreateError(e instanceof Error ? e.message : "등록에 실패했습니다.");
    } finally {
      setCreateSubmitting(false);
    }
  }

  // select 미조작 시 첫 직원이 기본값 — 디렉토리 미로드면 빈 문자열(버튼 disabled가 막는다).
  const advisorPickId = advisorPick || (staffDirectory[0]?.id ?? "");

  async function submitAdvisorChange() {
    if (changingAdvisor) return;
    const picked = staffDirectory.find((s) => s.id === advisorPickId);
    if (!picked) return; // 디렉토리 미로드 — disabled가 막지만 이중 방어
    const targets = selectedCustomers.map((customer) => ({ id: customer.id, name: customer.name }));
    setChangingAdvisor(true);
    const { changedIds, failed } = await changeAdvisorBulk(targets, { id: picked.id, name: picked.name });
    setChangingAdvisor(false);
    setChangingAdvisorOpen(false);
    setAdvisorPick("");
    setAdvisorNotice(
      failed.length
        ? `${failed.length}명 변경 실패 — ${failed.map((f) => `${f.name}: ${f.reason}`).join(" / ")}`
        : null,
    );
    if (changedIds.length) {
      const changed = new Set(changedIds);
      // 성공한 건만 선택 해제 — 실패 행은 선택을 유지해 즉시 재시도할 수 있게 한다(deleteSelected와 대칭).
      setSelected((current) => current.filter((no) => {
        const customer = customers.find((c) => c.no === no);
        return !customer?.id || !changed.has(customer.id);
      }));
      // 서버 리로드(assignedAt 등 서버 스탬프가 진실).
      const reload = onCustomerListChanged?.();
      if (reload instanceof Promise) {
        void reload.then((ok) => {
          if (ok === false) {
            // 변경은 저장됐는데 화면만 stale — 전역 배너는 이 작업과 무관해 보여 오인을 만든다.
            setAdvisorNotice((current) => current
              ? `${current} / 목록 갱신 실패 — 새로고침해 주세요.`
              : "담당자 변경은 저장됐지만 목록을 불러오지 못했습니다. 새로고침해 주세요.");
          }
        });
      }
    }
  }

  function toggleCustomerSelected(customerNo: number, checked: boolean) {
    setSelected((current) => checked ? [...current, customerNo] : current.filter((id) => id !== customerNo));
  }

  function toggleChancePopover(customerNo: number) {
    setOpenStagePicker(null);
    setOpenFinalUpdateFor(null);
    setOpenChanceFor((current) => current === customerNo ? null : customerNo);
  }

  function openTwoStepStagePicker(customerNo: number, level: StagePickerLevel) {
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor(null);
    setOpenStagePicker((current) => current?.customerNo === customerNo && current.level === level ? null : { customerNo, level });
  }

  function changeTwoStepPrimaryStage(customerNo: number, nextGroup: string) {
    const nextStatus = secondaryStageOptionsByGroup[nextGroup]?.[0] ?? customerStatusGroups[nextGroup]?.[0] ?? nextGroup;
    // App 라우트: 단일 소스(updateCustomerWorkflow)가 setCustomers+chance 동기화+DB PATCH를 모두 처리.
    // 단독(stories/test): 폴백으로 내부 state만 갱신.
    if (onWorkflowChange) onWorkflowChange(customerNo, { statusGroup: nextGroup, status: nextStatus });
    else {
      updateCustomers((current) => current.map((customer) => customer.no === customerNo
        ? { ...customer, statusGroup: nextGroup, status: nextStatus }
        : customer));
      syncChanceWithStageGroup(customerNo, nextGroup);
    }
    markFinalUpdate(customerNo, "진행 상태");
    setOpenStagePicker({ customerNo, level: "secondary" });
    setOpenExtraFor(null);
  }

  function changeTwoStepSecondaryStage(customerNo: number, nextStatus: string) {
    if (onWorkflowChange) {
      const customer = customers.find((item) => item.no === customerNo);
      onWorkflowChange(customerNo, { statusGroup: customer?.statusGroup, status: nextStatus });
    } else {
      updateCustomers((current) => current.map((customer) => customer.no === customerNo
        ? { ...customer, status: nextStatus }
        : customer));
    }
    markFinalUpdate(customerNo, "진행 상태");
    setOpenStagePicker(null);
    setOpenExtraFor(null);
  }

  function changeCustomerChance(customerNo: number, nextChance: ChanceOption) {
    const customer = customers.find((item) => item.no === customerNo);
    if (nextChance === "확정" && customer?.statusGroup !== "계약완료") {
      showChanceNotice(customerNo);
      return;
    }
    if (onWorkflowChange) onWorkflowChange(customerNo, { chance: nextChance });
    else updateChanceOverrides((current) => ({ ...current, [customerNo]: nextChance }));
    markFinalUpdate(customerNo, "계약 가능성");
    setOpenChanceFor(null);
    setOpenExtraFor(null);
  }

  function startEditingNextAction(customer: Customer) {
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor(null);
    setEditingNextAction({ customerNo: customer.no, draft: customer.nextAction });
  }

  function changeNextActionDraft(customerNo: number, draft: string) {
    setEditingNextAction((current) => current?.customerNo === customerNo ? { ...current, draft } : current);
  }

  function saveNextAction(customerNo: number) {
    if (editingNextAction?.customerNo !== customerNo) return;
    const nextAction = editingNextAction.draft.trim();
    updateCustomers((current) => current.map((customer) => customer.no === customerNo ? { ...customer, nextAction } : customer));
    // 상담 메모 인라인 편집은 서버에 저장되지 않는 프로토타입 전용이라 markFinalUpdate를 부르지 않는다.
    // 진행 상태·계약 가능성은 실제 PATCH(updated_at bump)가 뒷받침하지만, 이 저장은 뒷받침이 없어
    // "방금 전(정상)" 마킹이 관리 상태 배지를 거짓으로 바꿨다가 리로드하면 사라지던 회귀였다.
    setEditingNextAction(null);
  }

  function cancelNextActionEdit() {
    setEditingNextAction(null);
  }

  function clearNextActionDraft(customerNo: number) {
    setEditingNextAction((current) => current?.customerNo === customerNo ? { ...current, draft: "" } : current);
    window.setTimeout(() => {
      const textarea = nextActionTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(0, 0);
    }, 0);
  }

  function handleNextActionEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, customerNo: number) {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      saveNextAction(customerNo);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelNextActionEdit();
    }
  }

  function openCustomer(customer: Customer) {
    // popover 외부클릭으로 popover가 닫히면 effect cleanup이 click 핸들러(ref 리셋 담당)를
    // 같은 클릭의 click 단계 전에 제거할 수 있어, suppressOutsideClickRef가 true로 stuck된다.
    // 그러면 이 가드가 영구히 패널을 막으므로, ref를 만나면 소비하고 리셋한다(첫 클릭은 닫기만).
    if (suppressOutsideClickRef.current) {
      suppressOutsideClickRef.current = false;
      return;
    }
    onOpenCustomer?.(customer);
  }

  function openCustomerByKeyboard(event: KeyboardEvent<HTMLTableRowElement>, customer: Customer) {
    if (event.key === "Enter") openCustomer(customer);
  }

  function toggleExtraPopover(event: MouseEvent<HTMLButtonElement>, extraId: string) {
    event.stopPropagation();
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenFinalUpdateFor(null);
    setOpenExtraFor((current) => current === extraId ? null : extraId);
  }

  function renderRow(customer: Customer) {
    const chance = resolveChance(customer, chanceOverrides[customer.no]);
    const { info: updateInfo, status: updateStatus, displayInfo } = resolveUpdateBadge(customer, {
      finalUpdateOverride: finalUpdateOverrides[customer.no],
    });
    const operationResponseValue = showAdvisorColumn ? firstResponseDisplay(customer.assignedAt, updateInfo) : "담당 배정 후 표시";
    const twoStepPickerOpen = openStagePicker?.customerNo === customer.no ? openStagePicker.level : null;
    const nextActionEditing = editingNextAction?.customerNo === customer.no;
    const rowProps = {
      className: [onOpenCustomer ? "customer-row" : "", activeCustomerId === customer.customerId ? "detail-open" : ""].filter(Boolean).join(" ") || undefined,
      onClick: () => openCustomer(customer),
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => openCustomerByKeyboard(event, customer),
      onMouseEnter: onOpenCustomer && customer.id
        ? () => {
            prefetchCustomerDetail(customer.id as string);
            if (customer.source === APP_QUOTE_REQUEST_SOURCE) prefetchCustomerQuoteRequests(customer.id as string);
          }
        : undefined,
      tabIndex: onOpenCustomer ? 0 : undefined,
    };

    const check = <CustomerSelectCell checked={selected.includes(customer.no)} onToggle={(checked) => toggleCustomerSelected(customer.no, checked)} />;
    const customerCell = <CustomerInfoCell customer={customer} />;
    const vehicleCell = <CustomerVehicleCell customer={customer} extraPopoverRef={extraPopoverRef} onToggleExtra={toggleExtraPopover} openExtraFor={openExtraFor} />;
    const stageCell = <CustomerStageCell customer={customer} onChangePrimary={changeTwoStepPrimaryStage} onChangeSecondary={changeTwoStepSecondaryStage} onOpenPicker={openTwoStepStagePicker} pickerLevel={twoStepPickerOpen} stagePickerRef={stagePickerRef} />;
    const chanceCell = <CustomerChanceCell chance={chance} chanceNoticeFor={chanceNoticeFor} chancePopoverRef={chancePopoverRef} customer={customer} onChange={changeCustomerChance} onToggle={toggleChancePopover} openChanceFor={openChanceFor} />;
    const nextActionCell = (
      <CustomerNextActionCell
        customer={customer}
        draft={editingNextAction?.customerNo === customer.no ? editingNextAction.draft : ""}
        editing={nextActionEditing}
        editorRef={nextActionEditorRef}
        onCancel={cancelNextActionEdit}
        onChangeDraft={changeNextActionDraft}
        onClear={clearNextActionDraft}
        onEditKeyDown={handleNextActionEditKeyDown}
        onSave={saveNextAction}
        onStartEdit={startEditingNextAction}
        textareaRef={nextActionTextareaRef}
      />
    );
    const operationCell = <CustomerOperationCell customer={customer} operationResponseValue={operationResponseValue} showAdvisorColumn={showAdvisorColumn} />;
    const finalUpdateCell = <CustomerFinalUpdateCell customer={customer} displayInfo={displayInfo} finalUpdatePopoverRef={finalUpdatePopoverRef} onToggle={toggleFinalUpdatePopover} openFinalUpdateFor={openFinalUpdateFor} updateStatus={updateStatus} />;
    const actions = <CustomerActionsCell customer={customer} onHintHover={() => setOpenFinalUpdateFor(null)} />;

    if (mode === "all") {
      return (
        <tr key={customer.no} {...rowProps}>
          {check}
          {customerCell}
          {vehicleCell}
          {stageCell}
          {chanceCell}
          {nextActionCell}
          {operationCell}
          {finalUpdateCell}
          {actions}
        </tr>
      );
    }

    if (mode === "settlement") {
      return (
        <tr key={customer.no} {...rowProps}>
          {check}
          {customerCell}
          {vehicleCell}
          <td>{customer.date}</td>
          <td className="num">{customer.fee}</td>
          <td className="num">{customer.cost}</td>
          <td><strong className="num">{customer.margin}</strong></td>
          <td><span className="badge green">{customer.settlementStatus}</span></td>
          {actions}
        </tr>
      );
    }

    return (
      <tr key={customer.no} {...rowProps}>
        {check}
        {customerCell}
        {mode === "contract" && <td><strong>{customer.customerType}</strong><span className="table-note">{customer.customerTypeDetail}</span></td>}
        {vehicleCell}
        <td><span className={badgeClass(customer.status, customer.statusGroup)}>{customer.status}</span><span className="table-note">{customer.date}</span></td>
        <td><div className="ai-summary-cell">{aiHintPlainText(customer)}</div></td>
        {/* priority(계약가능성/긴급) 셀은 헤더에 "action" 컬럼이 있는 mode만 그린다 — delivery는 그
            컬럼이 없어(select~stage,summary,advisor,actions) 이 셀이 잉여 8번째가 되면 table-layout:fixed
            에서 actions가 colgroup 밖으로 밀려 헤더 우측이 잘렸다(프로토타입 이래 상존, mock 렌더 시 발현). */}
        {tableColumns.includes("action") && <td><span className={badgeClass(customer.priority)}>{customer.priority}</span><span className="table-note">{customer.nextAction}</span></td>}
        {showAdvisorColumn && <td><strong>{customer.advisor}</strong><span className="table-note">{customer.team}</span></td>}
        {actions}
      </tr>
    );
  }

  const isAllMode = mode === "all";
  const consoleFilterOptions = {
    statusGroup: Object.keys(customerStatusGroups).map((group) => ({ value: group, label: group })),
    status: statuses.map((item) => ({ value: item, label: item })),
    advisor: staffNames.map((name) => ({ value: name, label: name })),
    chance: CHANCE_OPTIONS.map((option) => ({ value: option, label: option })),
    finalUpdate: CUSTOMER_MANAGE_STATUSES.map((option) => ({ value: option, label: option })),
  };

  function renderConsoleFilter(options: {
    id: ConsoleFilterKey;
    label: string;
    value: string;
    items: { value: string; label: string }[];
    onChange: (value: string) => void;
    extraClassName?: string;
    includeAllOption?: boolean;
  }) {
    const active = Boolean(options.value);
    const open = openConsoleFilter === options.id;
    const selectedLabel = options.items.find((item) => item.value === options.value)?.label ?? options.label;
    const includeAll = options.includeAllOption ?? true;
    const allItems = includeAll ? [{ value: "", label: options.label }, ...options.items] : options.items;
    // 열 옵션이 없는 pill(비-all mode의 mock 뷰 pill)은 확장 가능 신호(aria-expanded)를 주지 않는다 —
    // 클릭해도 popover가 없어 스크린리더에 "expanded, listbox"가 거짓으로 안내되던 것 해소(배치 6 A#1).
    const hasOptions = allItems.length > 0;

    return (
      <div className="console-filter">
        <button
          aria-expanded={hasOptions ? open : undefined}
          aria-haspopup={hasOptions ? "listbox" : undefined}
          className={filterSelectClass(active, ["console-filter-button", options.extraClassName].filter(Boolean).join(" "))}
          onClick={hasOptions ? () => setOpenConsoleFilter((current) => current === options.id ? null : options.id) : undefined}
          type="button"
        >
          <span>{selectedLabel}</span>
          <ChevronsUpDown aria-hidden="true" className="console-filter-chevron" size={14} strokeWidth={2.1} />
        </button>
        {open && allItems.length > 0 && (
          <div aria-label={`${options.label} 선택`} className="console-filter-popover" role="listbox">
            {allItems.map((item) => {
              const selected = item.value === options.value;
              const isDefaultOption = item.value === "";
              return (
                <button
                  aria-selected={selected}
                  className={[
                    "console-filter-option",
                    selected ? "active" : "",
                    isDefaultOption ? "default-option" : "",
                  ].filter(Boolean).join(" ")}
                  key={`${options.id}-${item.value || "default"}`}
                  onClick={() => {
                    options.onChange(item.value);
                    setCurrentPage(1);
                    setOpenConsoleFilter(null);
                  }}
                  role="option"
                  type="button"
                >
                  <span>{item.label}</span>
                  {selected && <Check aria-hidden="true" className="console-filter-check" size={14} strokeWidth={2.6} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="customer-console-page">
      <section className="card customer-console-card">
        <div className="customer-console-control-rail" ref={consoleFilterRailRef}>
          <div className="toolbar customer-console-toolbar">
            <div className="total-count">전체 <strong className="num">{rows.length}</strong><span>명</span></div>
            <label className="customer-console-search">
              <Search aria-hidden="true" size={15} strokeWidth={2.4} />
              <input onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="고객명, 연락처, 차종 검색" value={search} />
            </label>
            {renderConsoleFilter({
              id: "advisor",
              label: "담당자",
              value: advisor,
              items: consoleFilterOptions.advisor,
              onChange: setAdvisor,
              extraClassName: "filter-advisor",
            })}
            {renderConsoleFilter({
              id: "statusGroup",
              label: "진행 상태 · 1차",
              value: statusGroup,
              items: consoleFilterOptions.statusGroup,
              onChange: (value) => {
                setStatusGroup(value);
                setStatus("");
              },
              extraClassName: "filter-stage",
            })}
            {renderConsoleFilter({
              id: "status",
              label: "진행 상태 · 2차",
              value: status,
              items: consoleFilterOptions.status,
              onChange: setStatus,
              extraClassName: "filter-stage",
            })}
            <div className="list-view-controls">
              {isAllMode ? (
                <>
                  {renderConsoleFilter({
                    id: "chance",
                    label: "계약 가능성",
                    value: chanceFilter,
                    items: consoleFilterOptions.chance,
                    onChange: (value) => setChanceFilter(value as "" | ChanceOption),
                    extraClassName: "view-select filter-compact",
                  })}
                  {renderConsoleFilter({
                    id: "finalUpdate",
                    label: "관리 상태",
                    value: finalUpdateFilter,
                    items: consoleFilterOptions.finalUpdate,
                    onChange: (value) => setFinalUpdateFilter(value as "" | FinalUpdateFilterOption),
                    extraClassName: "view-select filter-compact",
                  })}
                </>
              ) : (
                <>
                  {/* 정렬/그룹 뷰 전환 — 기능은 나중(옵션 채우면 실동작), 지금은 시각 pill만(mock). */}
                  {renderConsoleFilter({ id: "viewAdvisor", label: "담당자별 보기", value: "", items: [], onChange: NOOP_VIEW_CHANGE, includeAllOption: false, extraClassName: "view-select filter-compact" })}
                  {renderConsoleFilter({ id: "viewConsultStatus", label: "상담상태별 보기", value: "", items: [], onChange: NOOP_VIEW_CHANGE, includeAllOption: false, extraClassName: "view-select filter-compact" })}
                  {renderConsoleFilter({ id: "viewUrgent", label: "긴급순으로 보기", value: "", items: [], onChange: NOOP_VIEW_CHANGE, includeAllOption: false, extraClassName: "view-select filter-compact" })}
                </>
              )}
            </div>
          </div>
          <div className="list-headbar customer-console-headbar">
            <div className="list-head-left"></div>
            <div className="top-actions">
              {showAdvisorColumn ? (
                <div className="advisor-change-wrap">
                  <button
                    aria-label="선택 고객 배정 변경"
                    className="btn advisor-change-btn"
                    disabled={selected.length === 0 || changingAdvisor}
                    onClick={() => { setAdvisorNotice(null); if (changingAdvisorOpen) setAdvisorPick(""); setChangingAdvisorOpen((open) => !open); }}
                    type="button"
                  >
                    <RefreshCcw aria-hidden="true" size={12} strokeWidth={2.25} />
                    <span>{selected.length ? `${selected.length}명 담당자 변경` : "담당자 변경"}</span>
                  </button>
                  {changingAdvisorOpen && selected.length > 0 ? (
                    <div aria-label="담당자 일괄 변경" className="advisor-change-confirm" role="dialog">
                      <strong>고객 {selected.length}명 담당자 변경</strong>
                      <p className="advisor-change-targets">{formatBulkTargetNames(selectedCustomers.map((customer) => customer.name))}</p>
                      <label>
                        <span>담당자</span>
                        <select disabled={!staffDirectory.length} {...bindSelect(advisorPickId, setAdvisorPick)}>
                          {staffDirectory.length
                            ? staffDirectory.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                            : <option value="">직원 목록 불러오는 중…</option>}
                        </select>
                      </label>
                      <p>같은 담당자인 고객은 배정시각이 바뀌지 않고, 새 담당자에게는 고객당 1건씩 알림이 갑니다.</p>
                      <div>
                        <button disabled={changingAdvisor} onClick={() => { setAdvisorPick(""); setChangingAdvisorOpen(false); }} type="button">취소</button>
                        <button className="primary-action" disabled={changingAdvisor || !staffDirectory.length} onClick={submitAdvisorChange} type="button">
                          {changingAdvisor ? "변경 중…" : "변경"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {advisorNotice ? (
                    <div className="advisor-change-notice" role="status">
                      <span>{advisorNotice}</span>
                      <button onClick={() => setAdvisorNotice(null)} type="button">닫기</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canDeleteCustomers ? (
                <div className="bulk-delete-wrap">
                  <button
                    className="btn bulk-delete-btn"
                    disabled={selected.length === 0 || deleting}
                    onClick={() => { setDeleteNotice(null); setConfirmingDelete((open) => !open); }}
                    type="button"
                  >
                    <Minus aria-hidden="true" size={14} strokeWidth={2.6} />
                    <span>{selected.length ? `${selected.length}명 고객 삭제` : "고객 삭제"}</span>
                  </button>
                  {confirmingDelete && selected.length > 0 ? (
                    <div aria-label="고객 삭제 확인" className="bulk-delete-confirm" role="dialog">
                      <strong>고객 {selected.length}명 삭제</strong>
                      {/* 선택은 페이지·필터를 넘어 유지된다 — 화면에 안 보이는 대상도 여기서 드러난다. */}
                      <p className="bulk-delete-targets">{formatBulkTargetNames(selectedCustomers.map((customer) => customer.name))}</p>
                      <p>
                        메모·할일·일정·서류·견적이 함께 사라지며, 되돌릴 수 없습니다.
                        앱으로 발송한 견적이 있는 고객은 삭제되지 않습니다 — 견적함에서 먼저 회수하세요.
                      </p>
                      <div>
                        <button disabled={deleting} onClick={() => setConfirmingDelete(false)} type="button">취소</button>
                        <button className="danger" disabled={deleting} onClick={deleteSelected} type="button">
                          {deleting ? "삭제 중…" : "삭제"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {deleteNotice ? (
                    <div className="bulk-delete-notice" role="status">
                      <span>{deleteNotice}</span>
                      <button onClick={() => setDeleteNotice(null)} type="button">닫기</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canCreateCustomers ? (
                <div className="customer-create-wrap">
                  <button
                    className="btn primary-register-btn"
                    disabled={createSubmitting}
                    onClick={() => {
                      if (creatingOpen) resetCreateForm();
                      setCreatingOpen((open) => !open);
                    }}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={14} strokeWidth={2.4} />
                    <span>고객 등록</span>
                  </button>
                  {creatingOpen ? (
                    /* form + onSubmit — 이름 input에서 Enter로 제출(상세 편집 팝오버 StatusWorkflow와 같은 문법, 0713 감사). */
                    <form
                      aria-label="고객 등록"
                      className="customer-create-form"
                      role="dialog"
                      onSubmit={(event) => { event.preventDefault(); void submitCreateCustomer(); }}
                    >
                      <strong>고객 등록</strong>
                      <p>이름만 필수입니다. 나머지 정보는 등록 직후 열리는 상세 화면에서 입력하세요.</p>
                      <label>
                        <span>이름 *</span>
                        <input autoFocus onChange={(event) => setCreateName(event.target.value)} type="text" value={createName} />
                      </label>
                      <label>
                        <span>연락처</span>
                        {/* 상세 연락처 수정 팝오버와 같은 문법 — 010 고정 prefix + 뒤 8자리(4-4 자동 하이픈, formatLocalPhone SSOT). */}
                        <div className="kim-phone-input">
                          <span aria-hidden="true" className="kim-phone-prefix">010</span>
                          <input
                            autoComplete="tel"
                            inputMode="numeric"
                            maxLength={9}
                            onChange={(event) => setCreatePhone(formatLocalPhone(event.target.value))}
                            placeholder="0000-0000"
                            type="tel"
                            value={createPhone}
                          />
                        </div>
                      </label>
                      <label>
                        <span>유입 경로</span>
                        <select {...bindSelect(createSource, setCreateSource)}>
                          {SOURCE_MANUAL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                      {createDuplicate ? (
                        <p className="customer-create-duplicate" role="status">
                          {createDuplicate.name}({createDuplicate.customerId}) 고객과 연락처가 같습니다.
                        </p>
                      ) : null}
                      {createError ? <p className="customer-create-error" role="alert">{createError}</p> : null}
                      <div>
                        <button disabled={createSubmitting} onClick={() => { resetCreateForm(); setCreatingOpen(false); }} type="button">취소</button>
                        <button className="primary-action" disabled={createSubmitting} type="submit">
                          {createSubmitting ? "등록 중…" : "등록"}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {/* 콘솔은 console-table-scroll만 — table-scroll의 overflow-x:auto는 같은 특이성·후순위
            overflow:hidden에 항상 지므로 무력(배치 5 4-B: 스크롤 의미 없는 클래스 제거, 계산값 불변).
            좁은 뷰포트 클리핑은 콘솔 원설계(#226 이전 customer-console-table-scroll부터 hidden). */}
        <div className="console-table-scroll">
          <table className={`customer-table mode-${mode} console-table`}>
            <colgroup>
              {tableColumns.map((column, index) => <col className={`col-${column}`} key={`${column}-${index}`} />)}
            </colgroup>
            <thead>
              <tr>
                {tableHeads.map((head, index) => (
                  <th className={`head-${tableColumns[index]}`} key={head}>
                    {index === 0 ? (
                      <input checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} type="checkbox" />
                    ) : tableColumns[index] === "actions" ? (
                      <span className="head-actions-label">{head}</span>
                    ) : (
                      head
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{paginatedRows.map(renderRow)}</tbody>
          </table>
        </div>
        <div className="pagination-bar customer-console-pagination">
          <div className="pagination-summary">
            <span className="num">{rows.length === 0 ? 0 : pageStart + 1}-{pageEnd}</span>
            <span> / </span>
            <span className="num">{rows.length}</span>
            <span>명</span>
          </div>
          <div className="pagination-controls" aria-label="고객 목록 페이지 이동">
            <button
              className="page-btn"
              disabled={effectivePage === 1}
              onClick={() => setCurrentPage(1)}
              type="button"
            >
              처음
            </button>
            <button
              className="page-btn compact"
              disabled={effectivePage === 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              type="button"
            >
              이전
            </button>
            {visiblePages.map((page) => (
              <button
                aria-current={effectivePage === page ? "page" : undefined}
                className="page-btn num"
                key={page}
                onClick={() => setCurrentPage(page)}
                type="button"
              >
                {page}
              </button>
            ))}
            <button
              className="page-btn compact"
              disabled={effectivePage === totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              type="button"
            >
              다음
            </button>
            <button
              className="page-btn"
              disabled={effectivePage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
              type="button"
            >
              마지막
            </button>
          </div>
          <div className="page-size-control" ref={pageSizeControlRef}>
            <span>페이지당</span>
            <div className="console-filter page-size-filter">
              <button
                aria-expanded={openPageSize}
                aria-haspopup="listbox"
                className={filterSelectClass(pageSize !== 15, "console-filter-button page-size-select page-size-button")}
                onClick={() => setOpenPageSize((current) => !current)}
                type="button"
              >
                <span>{pageSize}</span>
                <ChevronsUpDown aria-hidden="true" className="console-filter-chevron" size={14} strokeWidth={2.1} />
              </button>
              {openPageSize && (
                <div aria-label="페이지당 개수 선택" className="console-filter-popover page-size-popover" role="listbox">
                  {pageSizeOptions.map((option) => {
                    const selected = option === pageSize;
                    return (
                      <button
                        aria-selected={selected}
                        className={[
                          "console-filter-option",
                          selected ? "active" : "",
                          option === 15 ? "default-option" : "",
                        ].filter(Boolean).join(" ")}
                        key={option}
                        onClick={() => {
                          setPageSize(option);
                          setCurrentPage(1);
                          setOpenPageSize(false);
                        }}
                        role="option"
                        type="button"
                      >
                        <span>{option}</span>
                        {selected && <Check aria-hidden="true" className="console-filter-check" size={14} strokeWidth={2.6} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <span>명</span>
          </div>
        </div>
      </section>
    </section>
  );
}
