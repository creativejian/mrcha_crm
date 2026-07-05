import { Check, ChevronsUpDown, Minus, Plus, RefreshCcw, Search } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ADVISOR_NAMES, CHANCE_OPTIONS, CUSTOMER_MANAGE_STATUSES, type Customer, type CustomerChanceOption, type CustomerManageStatus, type CustomerMode, customerStatusGroups, initialCustomers } from "@/data/customers";
import { badgeClass, firstResponseDisplay, resolveChance, secondaryStageOptionsByGroup, type ChanceOption, type FinalUpdateInfo, type StagePickerLevel } from "@/lib/customer-table";
import { prefetchCustomerDetail } from "@/lib/customers";
import { resolveUpdateBadge } from "@/lib/manage-status";
import { bindSelect } from "@/lib/select-bind";
import { prefetchCustomerQuoteRequests } from "@/lib/quote-requests";
import { CustomerActionsCell, CustomerChanceCell, CustomerFinalUpdateCell, CustomerInfoCell, CustomerNextActionCell, CustomerOperationCell, CustomerSelectCell, CustomerStageCell, CustomerVehicleCell } from "@/pages/CustomerManagementRow";
import type { RoleTab } from "@/data/roles";

type CustomerManagementPageProps = {
  activeCustomerId?: string | null;
  customers?: Customer[];
  mode: CustomerMode;
  chanceOverrides?: Record<number, CustomerChanceOption>;
  manageStatusOverrides?: Record<number, CustomerManageStatus>;
  onChanceOverridesChange?: (overrides: Record<number, CustomerChanceOption>) => void;
  onCustomersChange?: (customers: Customer[]) => void;
  onOpenCustomer?: (customer: Customer) => void;
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
  allDraft: ["선택", "고객", "차종 · 구매방식", "진행 상태", "계약 가능성", "상담 메모 · 문의 사항", "접수 · 배정", "관리 상태", "액션"],
  consulting: ["선택", "고객", "차종 · 구매방식", "상담 상태", "AI 요약", "상담 메모", "담당", "관리"],
  contract: ["선택", "고객", "고객유형", "차종 · 구매방식", "계약 / 심사", "계약 조건", "담당", "상담 메모", "관리"],
  delivery: ["선택", "고객", "차량", "출고 상태", "출고 업무", "담당", "관리"],
  settlement: ["선택", "고객", "차종 · 구매방식", "출고일", "수수료", "비용", "마진", "정산 상태", "관리"],
  hold: ["선택", "고객", "차종 · 구매방식", "상태", "이탈 / 보류 요약", "재컨택 액션", "담당", "관리"],
};

const tableColumnsByMode: Record<CustomerMode, string[]> = {
  all: ["select", "customer", "vehicle", "stage", "chance", "action", "operation", "update", "actions"],
  allDraft: ["select", "customer", "vehicle", "stage", "chance", "action", "operation", "update", "actions"],
  consulting: ["select", "customer", "vehicle", "stage", "summary", "action", "advisor", "actions"],
  contract: ["select", "customer", "type", "vehicle", "stage", "summary", "advisor", "action", "actions"],
  delivery: ["select", "customer", "vehicle", "stage", "summary", "advisor", "actions"],
  settlement: ["select", "customer", "vehicle", "date", "money", "money", "money", "stage", "actions"],
  hold: ["select", "customer", "vehicle", "stage", "summary", "action", "advisor", "actions"],
};

const pageSizeOptions = [15, 30, 50, 100] as const;
type FinalUpdateFilterOption = CustomerManageStatus;
type DraftFilterKey = "statusGroup" | "status" | "advisor" | "chance" | "finalUpdate";

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
  manageStatusOverrides = {},
  onChanceOverridesChange,
  onCustomersChange,
  onOpenCustomer,
  onWorkflowChange,
  roleTab = "최고관리자",
}: CustomerManagementPageProps) {
  const [internalCustomers, setInternalCustomers] = useState(initialCustomers);
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
  const draftFilterRailRef = useRef<HTMLDivElement>(null);
  const pageSizeControlRef = useRef<HTMLDivElement>(null);
  const chanceNoticeTimerRef = useRef<number | null>(null);
  const suppressOutsideClickRef = useRef(false);
  const showAdvisorColumn = shouldShowAdvisorColumn(roleTab);
  const tableHeads = visibleTableItems(headsByMode[mode], showAdvisorColumn);
  const tableColumns = visibleTableItems(tableColumnsByMode[mode], showAdvisorColumn);
  const [openDraftFilter, setOpenDraftFilter] = useState<DraftFilterKey | null>(null);
  const [openPageSize, setOpenPageSize] = useState(false);
  const customers = controlledCustomers ?? internalCustomers;
  const chanceOverrides = controlledChanceOverrides ?? internalChanceOverrides;

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
    return customers.filter((customer) => {
      const searchable = `${customer.name} ${customer.phone} ${customer.vehicle} ${customer.customerType} ${customer.customerTypeDetail} ${customer.status} ${customer.source} ${customer.advisor} ${customer.aiSummary}`.toLowerCase();
      const chance = resolveChance(customer, chanceOverrides[customer.no]);
      const updateStatus = resolveUpdateBadge(customer, {
        finalUpdateOverride: finalUpdateOverrides[customer.no],
        manageStatusOverride: manageStatusOverrides[customer.no],
      }).status?.label ?? "";
      return modeFilter(mode, customer) &&
        (!keyword || searchable.includes(keyword)) &&
        (!statusGroup || customer.statusGroup === statusGroup) &&
        (!status || customer.status === status) &&
        (!advisor || customer.advisor === advisor) &&
        (!chanceFilter || chance === chanceFilter) &&
        (!finalUpdateFilter || updateStatus === finalUpdateFilter);
    });
  }, [advisor, chanceFilter, chanceOverrides, customers, finalUpdateFilter, finalUpdateOverrides, manageStatusOverrides, mode, search, status, statusGroup]);

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
    if (openDraftFilter === null) return;

    function closeDraftFilter(event: PointerEvent) {
      if (draftFilterRailRef.current?.contains(event.target as Node)) return;
      setOpenDraftFilter(null);
    }

    function closeDraftFilterByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenDraftFilter(null);
    }

    document.addEventListener("pointerdown", closeDraftFilter, true);
    document.addEventListener("keydown", closeDraftFilterByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeDraftFilter, true);
      document.removeEventListener("keydown", closeDraftFilterByKeyboard);
    };
  }, [openDraftFilter]);

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
    return target instanceof Element && Boolean(target.closest(".stage-control, .chance-control, .extra-count-pill, .final-update-control, .advisor-change-pill"));
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

  function changeCustomerAdvisor(customerNo: number) {
    updateCustomers((current) => current.map((customer) => {
      if (customer.no !== customerNo) return customer;
      const currentIndex = ADVISOR_NAMES.findIndex((name) => name === customer.advisor);
      const nextAdvisor = ADVISOR_NAMES[(currentIndex + 1 + ADVISOR_NAMES.length) % ADVISOR_NAMES.length];
      return { ...customer, advisor: nextAdvisor, assignedAt: "방금 전" };
    }));
    markFinalUpdate(customerNo, "담당", "담당자 변경");
    setOpenStagePicker(null);
    setOpenChanceFor(null);
    setOpenExtraFor(null);
    setOpenFinalUpdateFor(null);
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

  function deleteSelected() {
    updateCustomers((current) => current.filter((customer) => !selected.includes(customer.no)));
    setSelected([]);
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
    markFinalUpdate(customerNo, "상담 메모");
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
    const { info: updateInfo, status: updateStatus } = resolveUpdateBadge(customer, {
      finalUpdateOverride: finalUpdateOverrides[customer.no],
      manageStatusOverride: manageStatusOverrides[customer.no],
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
            if (customer.source === "앱 견적요청") prefetchCustomerQuoteRequests(customer.id as string);
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
    const operationCell = <CustomerOperationCell customer={customer} onChangeAdvisor={changeCustomerAdvisor} operationResponseValue={operationResponseValue} roleTab={roleTab} showAdvisorColumn={showAdvisorColumn} />;
    const finalUpdateCell = <CustomerFinalUpdateCell customer={customer} finalUpdatePopoverRef={finalUpdatePopoverRef} onToggle={toggleFinalUpdatePopover} openFinalUpdateFor={openFinalUpdateFor} updateInfo={updateInfo} updateStatus={updateStatus} />;
    const actions = <CustomerActionsCell customer={customer} onHintHover={() => setOpenFinalUpdateFor(null)} />;

    if (mode === "all" || mode === "allDraft") {
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
        <td><div className="ai-summary-cell">{customer.aiSummary}</div></td>
        <td><span className={badgeClass(customer.priority)}>{customer.priority}</span><span className="table-note">{customer.nextAction}</span></td>
        {showAdvisorColumn && <td><strong>{customer.advisor}</strong><span className="table-note">{customer.team}</span></td>}
        {actions}
      </tr>
    );
  }

  const isLineDraft = mode === "allDraft";
  const draftFilterOptions = {
    statusGroup: Object.keys(customerStatusGroups).map((group) => ({ value: group, label: group })),
    status: statuses.map((item) => ({ value: item, label: item })),
    advisor: ADVISOR_NAMES.map((name) => ({ value: name, label: name })),
    chance: CHANCE_OPTIONS.map((option) => ({ value: option, label: option })),
    finalUpdate: CUSTOMER_MANAGE_STATUSES.map((option) => ({ value: option, label: option })),
  };

  function renderDraftFilter(options: {
    id: DraftFilterKey;
    label: string;
    value: string;
    items: { value: string; label: string }[];
    onChange: (value: string) => void;
    extraClassName?: string;
  }) {
    const active = Boolean(options.value);
    const open = openDraftFilter === options.id;
    const selectedLabel = options.items.find((item) => item.value === options.value)?.label ?? options.label;
    const allItems = [{ value: "", label: options.label }, ...options.items];

    return (
      <div className="draft-filter">
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          className={filterSelectClass(active, ["draft-filter-button", options.extraClassName].filter(Boolean).join(" "))}
          onClick={() => setOpenDraftFilter((current) => current === options.id ? null : options.id)}
          type="button"
        >
          <span>{selectedLabel}</span>
          <ChevronsUpDown aria-hidden="true" className="draft-filter-chevron" size={14} strokeWidth={2.1} />
        </button>
        {open && (
          <div aria-label={`${options.label} 선택`} className="draft-filter-popover" role="listbox">
            {allItems.map((item) => {
              const selected = item.value === options.value;
              const isDefaultOption = item.value === "";
              return (
                <button
                  aria-selected={selected}
                  className={[
                    "draft-filter-option",
                    selected ? "active" : "",
                    isDefaultOption ? "default-option" : "",
                  ].filter(Boolean).join(" ")}
                  key={`${options.id}-${item.value || "default"}`}
                  onClick={() => {
                    options.onChange(item.value);
                    setCurrentPage(1);
                    setOpenDraftFilter(null);
                  }}
                  role="option"
                  type="button"
                >
                  <span>{item.label}</span>
                  {selected && <Check aria-hidden="true" className="draft-filter-check" size={14} strokeWidth={2.6} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className={isLineDraft ? "customer-console-page" : undefined}>
      <section className={isLineDraft ? "card customer-console-card" : "card"}>
        <div className={isLineDraft ? "customer-console-control-rail" : undefined} ref={isLineDraft ? draftFilterRailRef : undefined}>
          <div className={isLineDraft ? "toolbar customer-console-toolbar" : "toolbar"}>
            {isLineDraft && <div className="total-count">전체 <strong className="num">{rows.length}</strong><span>명</span></div>}
            {isLineDraft ? (
              <label className="customer-console-search">
                <Search aria-hidden="true" size={15} strokeWidth={2.4} />
                <input onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="고객명, 연락처, 차종 검색" value={search} />
              </label>
            ) : (
              <input className="input" onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="고객명, 연락처, 차종 검색" value={search} />
            )}
            {isLineDraft ? (
              <>
                {renderDraftFilter({
                  id: "advisor",
                  label: "담당자",
                  value: advisor,
                  items: draftFilterOptions.advisor,
                  onChange: setAdvisor,
                  extraClassName: "filter-advisor",
                })}
                {renderDraftFilter({
                  id: "statusGroup",
                  label: "진행 상태 · 1차",
                  value: statusGroup,
                  items: draftFilterOptions.statusGroup,
                  onChange: (value) => {
                    setStatusGroup(value);
                    setStatus("");
                  },
                  extraClassName: "filter-stage",
                })}
                {renderDraftFilter({
                  id: "status",
                  label: "진행 상태 · 2차",
                  value: status,
                  items: draftFilterOptions.status,
                  onChange: setStatus,
                  extraClassName: "filter-stage",
                })}
              </>
            ) : (
              <>
                <select className="select" {...bindSelect(statusGroup, (v) => { setStatusGroup(v); setStatus(""); setCurrentPage(1); })}>
                  <option value="">진행 상태 · 1차</option>
                  {Object.keys(customerStatusGroups).map((group) => <option key={group}>{group}</option>)}
                </select>
                <select className="select" {...bindSelect(status, (v) => { setStatus(v); setCurrentPage(1); })}>
                  <option value="">진행 상태 · 2차</option>
                  {statuses.map((item, index) => <option key={`${item}-${index}`}>{item}</option>)}
                </select>
                <select className="select" {...bindSelect(advisor, (v) => { setAdvisor(v); setCurrentPage(1); })}>
                  <option value="">담당자</option>
                  {ADVISOR_NAMES.map((name) => <option key={name}>{name}</option>)}
                </select>
              </>
            )}
            {isLineDraft && (
              <div className="list-view-controls">
                {renderDraftFilter({
                  id: "chance",
                  label: "계약 가능성",
                  value: chanceFilter,
                  items: draftFilterOptions.chance,
                  onChange: (value) => setChanceFilter(value as "" | ChanceOption),
                  extraClassName: "view-select filter-compact",
                })}
                {renderDraftFilter({
                  id: "finalUpdate",
                  label: "관리 상태",
                  value: finalUpdateFilter,
                  items: draftFilterOptions.finalUpdate,
                  onChange: (value) => setFinalUpdateFilter(value as "" | FinalUpdateFilterOption),
                  extraClassName: "view-select filter-compact",
                })}
              </div>
            )}
          </div>
          <div className={isLineDraft ? "list-headbar customer-console-headbar" : "list-headbar"}>
            <div className="list-head-left">
              {!isLineDraft && (
                <>
                  <div className="total-count">TOTAL <strong className="num">{rows.length}</strong></div>
                  <div className="vertical-separator" />
                  <div className="list-view-controls">
                    <select className="select view-select"><option>담당자별 보기</option></select>
                    <select className="select view-select"><option>상담상태별 보기</option></select>
                    <select className="select view-select"><option>긴급순으로 보기</option></select>
                  </div>
                </>
              )}
            </div>
            <div className="top-actions">
              <button aria-label="선택 고객 배정 변경" className="btn advisor-change-btn" disabled={selected.length === 0} type="button">
                <RefreshCcw aria-hidden="true" size={12} strokeWidth={2.25} />
                <span>담당자 변경</span>
              </button>
              <button className="btn bulk-delete-btn" disabled={selected.length === 0} onClick={deleteSelected} type="button">
                <Minus aria-hidden="true" size={14} strokeWidth={2.6} />
                <span>{selected.length ? `${selected.length}명 고객 삭제` : "고객 삭제"}</span>
              </button>
              <button className="btn primary-register-btn" type="button">
                <Plus aria-hidden="true" size={14} strokeWidth={2.4} />
                <span>고객 등록</span>
              </button>
            </div>
          </div>
        </div>
        <div className={isLineDraft ? "table-scroll customer-console-table-scroll" : "table-scroll"}>
          <table className={`customer-table mode-${mode}`}>
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
        <div className={isLineDraft ? "pagination-bar customer-console-pagination" : "pagination-bar"}>
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
          {isLineDraft ? (
            <div className="page-size-control" ref={pageSizeControlRef}>
              <span>페이지당</span>
              <div className="draft-filter page-size-filter">
                <button
                  aria-expanded={openPageSize}
                  aria-haspopup="listbox"
                  className={filterSelectClass(pageSize !== 15, "draft-filter-button page-size-select page-size-button")}
                  onClick={() => setOpenPageSize((current) => !current)}
                  type="button"
                >
                  <span>{pageSize}</span>
                  <ChevronsUpDown aria-hidden="true" className="draft-filter-chevron" size={14} strokeWidth={2.1} />
                </button>
                {openPageSize && (
                  <div aria-label="페이지당 개수 선택" className="draft-filter-popover page-size-popover" role="listbox">
                    {pageSizeOptions.map((option) => {
                      const selected = option === pageSize;
                      return (
                        <button
                          aria-selected={selected}
                          className={[
                            "draft-filter-option",
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
                          {selected && <Check aria-hidden="true" className="draft-filter-check" size={14} strokeWidth={2.6} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <span>명</span>
            </div>
          ) : (
            <label className="page-size-control">
              <span>페이지당</span>
              <select
                className="select page-size-select"
                {...bindSelect(pageSize, (v) => {
                  setPageSize(Number(v) as (typeof pageSizeOptions)[number]);
                  setCurrentPage(1);
                })}
              >
                {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <span>개</span>
            </label>
          )}
        </div>
      </section>
    </section>
  );
}
