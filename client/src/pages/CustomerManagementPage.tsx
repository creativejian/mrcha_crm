import { Check, FileText, MessageSquare } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { type Customer, type CustomerMode, customerStatusGroups, initialCustomers } from "@/data/customers";
import type { RoleTab } from "@/data/roles";

type CustomerManagementPageProps = {
  mode: CustomerMode;
  onOpenCustomer?: (customer: Customer) => void;
  roleTab?: RoleTab;
};

function modeFilter(mode: CustomerMode, customer: Customer) {
  if (mode === "consulting") return ["신규", "상담", "견적", "재응대"].includes(customer.statusGroup);
  if (mode === "contract") return customer.statusGroup === "심사/계약";
  if (mode === "delivery") return customer.statusGroup === "출고";
  if (mode === "settlement") return customer.status === "출고완료" && customer.settlementStatus;
  if (mode === "hold") return customer.statusGroup === "종료" || customer.statusGroup === "재응대" || customer.status === "계약취소";
  return true;
}

function badgeClass(value: string, group?: string) {
  if (value === "완료" || value === "계약완료" || group === "출고") return "badge green";
  if (value === "긴급" || value === "계약취소" || value === "심사서류안내") return "badge red";
  if (value === "높음" || value === "보류" || group === "견적" || group === "재응대") return "badge yellow";
  return "badge";
}

function statusButtonClass(value: string, group?: string) {
  return badgeClass(value, group).replace("badge", "stage-status-button");
}

const headsByMode: Record<CustomerMode, string[]> = {
  all: ["선택", "고객", "차종 · 구매방식", "진행 상태", "다음 액션", "AI 요약", "유입 · 상담", "담당", "계약 가능성", "관리"],
  consulting: ["선택", "고객", "차종 · 구매방식", "상담 상태", "AI 요약", "다음 액션", "담당", "관리"],
  contract: ["선택", "고객", "고객유형", "차종 · 구매방식", "계약 / 심사", "계약 조건", "담당", "다음 액션", "관리"],
  delivery: ["선택", "고객", "차량", "출고 상태", "출고 업무", "담당", "관리"],
  settlement: ["선택", "고객", "차종 · 구매방식", "출고일", "수수료", "비용", "마진", "정산 상태", "관리"],
  hold: ["선택", "고객", "차종 · 구매방식", "상태", "이탈 / 보류 요약", "재컨택 액션", "담당", "관리"],
};

const tableColumnsByMode: Record<CustomerMode, string[]> = {
  all: ["select", "customer", "vehicle", "stage", "action", "summary", "source", "advisor", "chance", "actions"],
  consulting: ["select", "customer", "vehicle", "stage", "summary", "action", "advisor", "actions"],
  contract: ["select", "customer", "type", "vehicle", "stage", "summary", "advisor", "action", "actions"],
  delivery: ["select", "customer", "vehicle", "stage", "summary", "advisor", "actions"],
  settlement: ["select", "customer", "vehicle", "date", "money", "money", "money", "stage", "actions"],
  hold: ["select", "customer", "vehicle", "stage", "summary", "action", "advisor", "actions"],
};

const pageSizeOptions = [15, 30, 50, 100] as const;
const chanceOptions = ["높음", "중간", "낮음", "보류", "확정"] as const;
type ChanceOption = typeof chanceOptions[number];

const statusGroupByStatus = Object.fromEntries(
  Object.entries(customerStatusGroups).flatMap(([group, values]) => values.map((value) => [value, group])),
);

const vehicleDisplayByVehicle: Record<string, { title: string; trim: string; trimShort?: string }> = {
  "Maybach S-Class": { title: "Maybach S-Class", trim: "S 500 4M Long" },
  "Model Y": { title: "Model Y", trim: "Premium RWD" },
  GV80: { title: "GV80", trim: "26년형 가솔린 터보 2.5", trimShort: "2.5T 가솔린" },
  "GV80 Coupe": { title: "GV80 Coupe", trim: "26년형 가솔린 터보 3.5", trimShort: "3.5T 가솔린" },
  싼타페: { title: "싼타페", trim: "26년형 가솔린 터보 1.6 하이브리드 2WD", trimShort: "1.6T 하이브리드 2WD" },
  "Cooper Convertible": { title: "Cooper Convertible", trim: "JCW" },
  Panamera: { title: "Panamera", trim: "Panamera 4 E-Hybrid" },
  팰리세이드: { title: "팰리세이드", trim: "26년형 가솔린 터보 2.5 하이브리드 (9인승)", trimShort: "2.5T 하이브리드 · 9인승" },
  "E-Class": { title: "E-Class", trim: "E 300 4M AMG Line" },
  K8: { title: "K8", trim: "26년형 가솔린 터보 1.6 하이브리", trimShort: "1.6T 하이브리드" },
  GLE: { title: "GLE", trim: "GLE 450 4M AMG Line" },
  쏘렌토: { title: "쏘렌토", trim: "26년형 가솔린 터보 2.5 2WD", trimShort: "2.5T 가솔린 2WD" },
  Cybertruck: { title: "Cybertruck", trim: "Cyberbeast" },
  "5 Series": { title: "5 Series", trim: "520i M Spt" },
  GV70: { title: "GV70", trim: "2.5T 가솔린" },
  카니발: { title: "카니발", trim: "3.5 가솔린 · 7인승" },
  A6: { title: "A6", trim: "A6 45 TFSI qu. S-Line" },
  G80: { title: "G80", trim: "2.5T 가솔린" },
  XC90: { title: "XC90", trim: "T8 AWD Ultra Dark" },
};

const extraVehicleDisplayByCustomerId: Record<string, string[]> = {
  "CU-2605-0020": ["GLC"],
};

const extraPurchaseMethodDisplayByCustomerId: Record<string, string[]> = {
  "CU-2605-0020": ["할부"],
  "CU-2605-0014": ["장기렌트"],
  "CU-2605-0012": ["운용리스"],
  "CU-2605-0010": ["운용리스", "할부"],
};

function vehicleDisplay(customer: Customer) {
  const display = vehicleDisplayByVehicle[customer.vehicle] ?? { title: customer.vehicle, trim: "트림 미확인" };
  const extraVehicles = extraVehicleDisplayByCustomerId[customer.customerId] ?? [];
  const extraMethods = extraPurchaseMethodDisplayByCustomerId[customer.customerId] ?? [];
  return {
    ...display,
    extraVehicles,
    extraMethods,
    trimLabel: display.trimShort ?? display.trim,
    method: customer.method,
  };
}

function customerMeta(customer: Customer) {
  return [customer.customerType, customer.customerTypeDetail].filter(Boolean).join(" · ");
}

function extraTooltipValue(values: string[]) {
  return values.join(", ");
}

function chanceLabel(customer: Customer): ChanceOption {
  if (customer.status === "계약완료" || customer.statusGroup === "출고") return "확정";
  if (customer.status === "계약취소" || customer.statusGroup === "종료") return "낮음";
  if (customer.priority === "긴급" || customer.priority === "높음") return "높음";
  if (customer.priority === "보류") return "보류";
  if (customer.priority === "낮음") return "낮음";
  return "중간";
}

function chanceButtonClass(value: ChanceOption) {
  const toneByChance: Record<ChanceOption, string> = {
    높음: "purple",
    중간: "",
    낮음: "red",
    보류: "yellow",
    확정: "green",
  };

  return ["chance-status-button", toneByChance[value]].filter(Boolean).join(" ");
}

function stageSignal(customer: Customer) {
  const signalsByStatus: Record<string, string> = {
    신규: "상담 배정",
    상담중: "방식 확정",
    관리중: "조건 재확인",
    상담완료: "조건 대기",
    견적준비중: "견적 작성",
    차량체크중: "재고 확인",
    견적발송: "응답 대기",
    심사서류안내: "서류 대기",
    계약완료: "출고 준비",
    계약취소: "재컨택 후보",
    출고예정: "출고 확인",
    출고완료: customer.settlementStatus ? "정산 확인" : "완료 관리",
    "부재(1차 부재중)": "2차 예정",
    "부재(카톡인사)": "2차 예정",
    "부재(미응답)": "마지막 재컨택",
    재컨택완료: "조건 재확인",
    미정: "시점 보류",
    불발: "이탈 기록",
  };

  return signalsByStatus[customer.status] ?? (customer.priority === "긴급" ? "우선 처리" : "후속 확인");
}

function shouldShowAdvisorColumn(roleTab: RoleTab) {
  return roleTab === "최고관리자" || roleTab === "팀장";
}

function visibleTableItems(items: string[], showAdvisorColumn: boolean) {
  return showAdvisorColumn ? items : items.filter((item) => item !== "담당" && item !== "advisor");
}

export function CustomerManagementPage({ mode, onOpenCustomer, roleTab = "최고관리자" }: CustomerManagementPageProps) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [statusGroup, setStatusGroup] = useState("");
  const [status, setStatus] = useState("");
  const [advisor, setAdvisor] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(15);
  const [currentPage, setCurrentPage] = useState(1);
  const [openStageFor, setOpenStageFor] = useState<number | null>(null);
  const [openChanceFor, setOpenChanceFor] = useState<number | null>(null);
  const [chanceOverrides, setChanceOverrides] = useState<Record<number, ChanceOption>>({});
  const stagePopoverRef = useRef<HTMLDivElement>(null);
  const chancePopoverRef = useRef<HTMLDivElement>(null);
  const suppressOutsideClickRef = useRef(false);
  const showAdvisorColumn = shouldShowAdvisorColumn(roleTab);
  const tableHeads = visibleTableItems(headsByMode[mode], showAdvisorColumn);
  const tableColumns = visibleTableItems(tableColumnsByMode[mode], showAdvisorColumn);

  const statuses = statusGroup ? customerStatusGroups[statusGroup] : Object.values(customerStatusGroups).flat();
  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const searchable = `${customer.name} ${customer.phone} ${customer.vehicle} ${customer.customerType} ${customer.customerTypeDetail} ${customer.status} ${customer.source} ${customer.advisor} ${customer.aiSummary}`.toLowerCase();
      return modeFilter(mode, customer) &&
        (!keyword || searchable.includes(keyword)) &&
        (!statusGroup || customer.statusGroup === statusGroup) &&
        (!status || customer.status === status) &&
        (!advisor || customer.advisor === advisor);
    });
  }, [advisor, customers, mode, search, status, statusGroup]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedRows = rows.slice(pageStart, pageStart + pageSize);
  const pageEnd = rows.length === 0 ? 0 : pageStart + paginatedRows.length;
  const allSelected = paginatedRows.length > 0 && paginatedRows.every((customer) => selected.includes(customer.no));
  const visiblePages = useMemo(() => {
    const maxVisiblePages = 5;
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - maxVisiblePages + 1));
    const end = Math.min(totalPages, start + maxVisiblePages - 1);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [advisor, mode, pageSize, search, status, statusGroup]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (openStageFor === null) return;

    function closeStagePopover(event: PointerEvent) {
      if (stagePopoverRef.current?.contains(event.target as Node)) return;
      suppressOutsideClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpenStageFor(null);
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

    function closeStagePopoverByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenStageFor(null);
    }

    document.addEventListener("pointerdown", closeStagePopover, true);
    document.addEventListener("click", suppressOutsideClick, true);
    document.addEventListener("keydown", closeStagePopoverByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeStagePopover, true);
      document.removeEventListener("click", suppressOutsideClick, true);
      document.removeEventListener("keydown", closeStagePopoverByKeyboard);
    };
  }, [openStageFor]);

  useEffect(() => {
    if (openChanceFor === null) return;

    function closeChancePopover(event: PointerEvent) {
      if (chancePopoverRef.current?.contains(event.target as Node)) return;
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

  function toggleAll(checked: boolean) {
    const pageIds = paginatedRows.map((customer) => customer.no);
    setSelected((current) => checked
      ? Array.from(new Set([...current, ...pageIds]))
      : current.filter((id) => !pageIds.includes(id)));
  }

  function deleteSelected() {
    setCustomers((current) => current.filter((customer) => !selected.includes(customer.no)));
    setSelected([]);
  }

  function changeCustomerStatus(customerNo: number, nextStatus: string) {
    const nextGroup = statusGroupByStatus[nextStatus] ?? "";
    setCustomers((current) => current.map((customer) => customer.no === customerNo
      ? { ...customer, status: nextStatus, statusGroup: nextGroup }
      : customer));
    setOpenStageFor(null);
  }

  function changeCustomerChance(customerNo: number, nextChance: ChanceOption) {
    setChanceOverrides((current) => ({ ...current, [customerNo]: nextChance }));
    setOpenChanceFor(null);
  }

  function openCustomer(customer: Customer) {
    if (suppressOutsideClickRef.current) return;
    onOpenCustomer?.(customer);
  }

  function openCustomerByKeyboard(event: KeyboardEvent<HTMLTableRowElement>, customer: Customer) {
    if (event.key === "Enter") openCustomer(customer);
  }

  function stopRowClick(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function renderRow(customer: Customer) {
    const check = (
      <td className="select-cell" onClick={stopRowClick}>
        <input
          checked={selected.includes(customer.no)}
          onChange={(event) => {
            setSelected((current) => event.target.checked ? [...current, customer.no] : current.filter((id) => id !== customer.no));
          }}
          type="checkbox"
        />
      </td>
    );
    const customerCell = (
      <td>
        <strong className="customer-name">{customer.name}<span className="customer-code num">{customer.customerId}</span></strong>
        <span className="customer-meta">{customerMeta(customer)}</span>
        <span className="customer-phone num">{customer.phone}</span>
      </td>
    );
    const actions = (
      <td className="actions-cell" onClick={stopRowClick}>
        <span className="row-actions">
          <button className="tiny-btn" title="상담 열기" type="button"><MessageSquare size={15} /></button>
          <button className="tiny-btn" title="상세 문서" type="button"><FileText size={15} /></button>
        </span>
      </td>
    );
    const rowProps = {
      className: onOpenCustomer ? "customer-row" : undefined,
      onClick: () => openCustomer(customer),
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => openCustomerByKeyboard(event, customer),
      tabIndex: onOpenCustomer ? 0 : undefined,
    };
    const vehicle = vehicleDisplay(customer);
    const vehicleCell = (
      <td>
        <strong className="vehicle-title">
          <span className="vehicle-line-text">{vehicle.title}</span>
          {vehicle.extraVehicles.length > 0 && (
            <span className="extra-count-pill">
              +{vehicle.extraVehicles.length}
              <span className="extra-tooltip">
                <strong>{extraTooltipValue(vehicle.extraVehicles)}</strong>
                <span>도 고민 · 비교 중..</span>
              </span>
            </span>
          )}
        </strong>
        <span className="vehicle-trim" title={vehicle.trim}>{vehicle.trimLabel}</span>
        <span className="vehicle-method">
          <span className="vehicle-line-text">{vehicle.method}</span>
          {vehicle.extraMethods.length > 0 && (
            <span className="extra-count-pill">
              +{vehicle.extraMethods.length}
              <span className="extra-tooltip">
                <strong>{extraTooltipValue(vehicle.extraMethods)}</strong>
                <span>도 고민 · 비교 중..</span>
              </span>
            </span>
          )}
        </span>
      </td>
    );
    const stageCell = (
      <td className="stage-cell" onClick={stopRowClick}>
        <div className="stage-control" ref={openStageFor === customer.no ? stagePopoverRef : undefined}>
          <button
            aria-expanded={openStageFor === customer.no}
            aria-haspopup="listbox"
            aria-label={`진행 상태 변경: ${customer.status}`}
            className={statusButtonClass(customer.status, customer.statusGroup)}
            onClick={(event) => {
              event.stopPropagation();
              setOpenChanceFor(null);
              setOpenStageFor((current) => current === customer.no ? null : customer.no);
            }}
            type="button"
          >
            <span>{customer.status}</span>
          </button>
          {openStageFor === customer.no && (
            <div aria-label="진행 상태 선택" className="stage-status-popover" role="listbox">
              {Object.entries(customerStatusGroups).map(([group, values]) => (
                <div className="stage-status-group" key={group}>
                  <div className="stage-status-group-label">{group}</div>
                  <div className="stage-status-options">
                    {values.map((value) => {
                      const selectedStatus = value === customer.status;
                      return (
                        <button
                          aria-selected={selectedStatus}
                          className={selectedStatus ? "stage-status-option active" : "stage-status-option"}
                          key={value}
                          onClick={(event) => {
                            event.stopPropagation();
                            changeCustomerStatus(customer.no, value);
                          }}
                          role="option"
                          type="button"
                        >
                          <span>{value}</span>
                          {selectedStatus && <Check aria-hidden="true" size={13} strokeWidth={2.6} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <span className="stage-meta">{customer.statusGroup} · {customer.date}</span>
        <span className="stage-signal">{stageSignal(customer)}</span>
      </td>
    );
    const chance = chanceOverrides[customer.no] ?? chanceLabel(customer);
    const chanceCell = (
      <td className="chance-cell" onClick={stopRowClick}>
        <div className="chance-control" ref={openChanceFor === customer.no ? chancePopoverRef : undefined}>
          <button
            aria-expanded={openChanceFor === customer.no}
            aria-haspopup="listbox"
            aria-label={`가능성 변경: ${chance}`}
            className={chanceButtonClass(chance)}
            onClick={(event) => {
              event.stopPropagation();
              setOpenStageFor(null);
              setOpenChanceFor((current) => current === customer.no ? null : customer.no);
            }}
            type="button"
          >
            <span>{chance}</span>
          </button>
          {openChanceFor === customer.no && (
            <div aria-label="가능성 선택" className="chance-status-popover" role="listbox">
              {chanceOptions.map((value) => {
                const selectedChance = value === chance;
                return (
                  <button
                    aria-selected={selectedChance}
                    className={selectedChance ? "stage-status-option active" : "stage-status-option"}
                    key={value}
                    onClick={(event) => {
                      event.stopPropagation();
                      changeCustomerChance(customer.no, value);
                    }}
                    role="option"
                    type="button"
                  >
                    <span>{value}</span>
                    {selectedChance && <Check aria-hidden="true" size={13} strokeWidth={2.6} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </td>
    );

    if (mode === "all") {
      return (
        <tr key={customer.no} {...rowProps}>
          {check}
          {customerCell}
          {vehicleCell}
          {stageCell}
          <td><div className="next-action-cell">{customer.nextAction}</div></td>
          <td><div className="ai-summary-cell">{customer.aiSummary}</div></td>
          <td><strong>{customer.source}</strong><span className="table-note">상담 {customer.talkCount}</span><span className="table-note num">#{customer.no}</span></td>
          {showAdvisorColumn && <td><strong>{customer.advisor}</strong><span className="table-note">{customer.team} · {customer.assignedAt}</span></td>}
          {chanceCell}
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

  return (
    <section>
      <div className="toolbar">
        <input className="input" onChange={(event) => setSearch(event.target.value)} placeholder="고객명, 차량, 연락처 검색" value={search} />
        <select className="select" onChange={(event) => { setStatusGroup(event.target.value); setStatus(""); }} value={statusGroup}>
          <option value="">상태 그룹 전체</option>
          {Object.keys(customerStatusGroups).map((group) => <option key={group}>{group}</option>)}
        </select>
        <select className="select" onChange={(event) => setStatus(event.target.value)} value={status}>
          <option value="">세부 상태 전체</option>
          {statuses.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="select" onChange={(event) => setAdvisor(event.target.value)} value={advisor}>
          <option value="">담당자 전체</option>
          <option>지안</option>
          <option>선생님</option>
          <option>제프</option>
        </select>
      </div>

      <section className="card">
        <div className="list-headbar">
          <div className="list-head-left">
            <div className="total-count">TOTAL <strong className="num">{rows.length}</strong></div>
            <div className="vertical-separator" />
            <div className="list-view-controls">
              <select className="select view-select"><option>담당자별 보기</option></select>
              <select className="select view-select"><option>상담상태별 보기</option></select>
              <select className="select view-select"><option>긴급순으로 보기</option></select>
            </div>
          </div>
          <div className="top-actions">
            <button className="btn" disabled={selected.length === 0} onClick={deleteSelected} type="button">
              {selected.length ? `선택 삭제 ${selected.length}` : "선택 삭제"}
            </button>
            <button className="btn" type="button">신규 고객 등록</button>
          </div>
        </div>
        <div className="table-scroll">
          <table className={`customer-table mode-${mode}`}>
            <colgroup>
              {tableColumns.map((column, index) => <col className={`col-${column}`} key={`${column}-${index}`} />)}
            </colgroup>
            <thead>
              <tr>
                {tableHeads.map((head, index) => (
                  <th className={`head-${tableColumns[index]}`} key={head}>{index === 0 ? <input checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} type="checkbox" /> : head}</th>
                ))}
              </tr>
            </thead>
            <tbody>{paginatedRows.map(renderRow)}</tbody>
          </table>
        </div>
        <div className="pagination-bar">
          <div className="pagination-summary">
            <span className="num">{rows.length === 0 ? 0 : pageStart + 1}-{pageEnd}</span>
            <span> / </span>
            <span className="num">{rows.length}</span>
            <span>명</span>
          </div>
          <div className="pagination-controls" aria-label="고객 목록 페이지 이동">
            <button
              className="page-btn"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(1)}
              type="button"
            >
              처음
            </button>
            <button
              className="page-btn compact"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              type="button"
            >
              이전
            </button>
            {visiblePages.map((page) => (
              <button
                aria-current={currentPage === page ? "page" : undefined}
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
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              type="button"
            >
              다음
            </button>
            <button
              className="page-btn"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
              type="button"
            >
              마지막
            </button>
          </div>
          <label className="page-size-control">
            <span>페이지당</span>
            <select
              className="select page-size-select"
              onChange={(event) => setPageSize(Number(event.target.value) as (typeof pageSizeOptions)[number])}
              value={pageSize}
            >
              {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <span>개</span>
          </label>
        </div>
      </section>
    </section>
  );
}
