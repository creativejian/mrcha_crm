import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction, type SyntheticEvent } from "react";

import { customerStatusGroups, type Customer, type CustomerChanceOption, type CustomerManageStatus } from "@/data/customers";
import { formatActivity, formatPhone, type CustomerDetailData, type CustomerWritePatch } from "@/lib/customers";
import { initialFinalUpdateByCustomerId, finalUpdateStatus, resolveChance } from "@/lib/customer-table";
import { formatKimAssignmentTime } from "@/lib/kim-detail-utils";
import { type KimAdvisorTeam, type KimCustomerType, formatKimAdvisorValue, formatKimJobValue, formatKimLocationValue, isKimAutomaticSource } from "@/lib/kim-status-fields";

import { fieldLabel } from "../status-meta";
import { type KimStatusFieldKey, type KimWorkflowKey, type OpenEditorState } from "../types";

// onWorkflowChange — 부모 CustomerDetailPageProps의 인라인 시그니처와 구조적으로 동일.
type WorkflowChange = (
  customerNo: number,
  next: { statusGroup?: string; status?: string; chance?: CustomerChanceOption; manageStatus?: CustomerManageStatus },
) => void;

function sourceType(source: string) {
  if (source.includes("앱")) return "앱 유입";
  if (source.includes("카카오")) return "카카오";
  if (source.includes("대표전화")) return "전화";
  if (source.includes("디엘")) return "구DB";
  return "직접/소개";
}

function timelineRows(customer: Customer) {
  return [
    { kind: "접수", title: `${sourceType(customer.source)} 접수`, meta: customer.receivedAt, body: `${customer.source} 경로로 고객 문의가 들어왔습니다.` },
    { kind: "배정", title: `${customer.advisor} 상담사 배정`, meta: customer.assignedAt, body: `${customer.team} 기준으로 담당자를 배정했습니다.` },
    { kind: "상태", title: `${customer.statusGroup} > ${customer.status}`, meta: customer.date, body: "전체 보기의 진행 상태 컬럼과 동일한 업무 단계입니다." },
    { kind: "메모", title: "상담 메모 업데이트", meta: "최근", body: customer.nextAction },
  ];
}

// 상세 관리 상태 = 목록과 동일 규칙. override(워크플로우 변경) 있으면 그것, 없으면 목록과 같은 mock map 계산,
// 둘 다 없으면 ""(신규·상담접수 등 아직 관리 상태 없음 → 목록처럼 공백). 무조건 "정상" 폴백 금지.
function resolveKimManageStatus(override: CustomerManageStatus | undefined, customerCode: string): CustomerManageStatus | "" {
  if (override) return override;
  const info = initialFinalUpdateByCustomerId[customerCode];
  return info ? (finalUpdateStatus(info).label as CustomerManageStatus) : "";
}

type UseCustomerWorkflowArgs = {
  detail: CustomerDetailData; // statusValues 초기값 매핑 소스
  customer: Customer;
  chanceOverride?: CustomerChanceOption;
  manageStatusOverride?: CustomerManageStatus;
  onToast: (message: string) => void;
  onWorkflowChange?: WorkflowChange; // 부모 prop 그대로(목록·상세 진행상태/가능성 동기화)
  markRecentUpdate: (section: string) => void; // 부모 소유 — 콜백 주입
  // 아래 4개는 부모 소유 공유 인프라(니즈·구매조건도 사용). 훅은 인자로만 받아 쓴다.
  openEditor: OpenEditorState | null;
  setOpenEditor: Dispatch<SetStateAction<OpenEditorState | null>>;
  toggleEditor: (next: OpenEditorState) => void;
  savePatch: (patch: CustomerWritePatch, rollback: () => void) => void;
};

export function useCustomerWorkflow({
  detail,
  customer,
  chanceOverride,
  manageStatusOverride,
  onToast,
  onWorkflowChange,
  markRecentUpdate,
  openEditor,
  setOpenEditor,
  toggleEditor,
  savePatch,
}: UseCustomerWorkflowArgs) {
  const [statusValues, setStatusValues] = useState<Record<KimStatusFieldKey, string>>(() => ({
    phone: detail.phone ? formatPhone(detail.phone) : "미입력",
    job: detail.customerType ? formatKimJobValue(detail.customerType as KimCustomerType, detail.customerTypeDetail ?? "") : "미입력",
    location: detail.residence ?? "확인 필요",
    source: detail.source ?? "미입력",
    advisor: detail.advisorName ? formatKimAdvisorValue((detail.team ?? "인천본사") as KimAdvisorTeam, detail.advisorName) : "미배정",
    assignedAt: detail.assignedAt ? formatActivity(detail.assignedAt) : "미배정",
  }));
  const [stageGroup, setStageGroup] = useState(customer.statusGroup);
  const [stageStatus, setStageStatus] = useState(customer.status);
  const [chance, setChance] = useState<CustomerChanceOption>(resolveChance(customer, chanceOverride));
  const [manage, setManage] = useState<CustomerManageStatus | "">(() => resolveKimManageStatus(manageStatusOverride, customer.customerId));

  const consultBodyRef = useRef<HTMLDivElement>(null);
  const timelineItems = timelineRows(customer);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- customer prop이 바뀔 때 진행 상태를 외부 값과 동기화하는 의도된 effect
    setStageGroup(customer.statusGroup);
    setStageStatus(customer.status);
  }, [customer.status, customer.statusGroup]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chanceOverride/customer 변경 시 계약 가능성을 동기화하는 의도된 effect
    setChance(resolveChance(customer, chanceOverride));
  }, [chanceOverride, customer]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manageStatusOverride 변경 시 관리 상태를 동기화하는 의도된 effect
    setManage(resolveKimManageStatus(manageStatusOverride, customer.customerId));
  }, [manageStatusOverride, customer.customerId]);

  useEffect(() => {
    const container = consultBodyRef.current;
    if (openEditor?.kind !== "timeline") return;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openEditor?.kind, timelineItems.length]);

  function workflowValue(key: KimWorkflowKey) {
    if (key === "stage") return `${stageGroup} · ${stageStatus}`;
    if (key === "chance") return chance;
    return manage || "—"; // 관리 상태 없음(신규·상담접수)이면 목록 공백과 동치인 "—"
  }

  function openStatusEditor(next: OpenEditorState) {
    if (next.kind === "status" && next.key === "source" && isKimAutomaticSource(statusValues.source)) {
      setOpenEditor(null);
      onToast("자동 접수 경로는 수정할 수 없습니다.");
      return;
    }
    if (next.kind === "status" && next.key === "assignedAt") {
      setOpenEditor(null);
      onToast("배정시간은 담당자 배정 시 자동 기록됩니다.");
      return;
    }
    toggleEditor(next);
  }

  function openSourceEditorByKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openStatusEditor({ kind: "status", key: "source" });
  }

  function openWorkflowEditor(key: KimWorkflowKey) {
    if (key === "manage") {
      setOpenEditor(null);
      onToast("관리 상태는 상담 메모와 최근 업데이트 기준으로 자동 반영됩니다.");
      return;
    }
    toggleEditor({ kind: "workflow", key });
  }

  function saveStatusField(event: SyntheticEvent<HTMLFormElement>, key: KimStatusFieldKey) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = String(formData.get("value") ?? "").trim();
    if (!value) return;
    const prev = statusValues[key];
    if (key === "phone") {
      const digits = `010${value.replace(/\D/g, "")}`; // 입력 8자리 + 010 고정 prefix = 11자리
      const display = formatPhone(digits);
      setStatusValues((current) => ({ ...current, phone: display }));
      setOpenEditor(null);
      markRecentUpdate("고객 정보");
      onToast("연락처 수정 완료");
      savePatch({ phone: digits }, () => setStatusValues((current) => ({ ...current, phone: prev })));
      return;
    }
    setStatusValues((current) => ({ ...current, [key]: value }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast(`${fieldLabel(key)} 수정 완료`);
  }

  function saveJobField(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const customerType = String(formData.get("customerType") ?? "개인") as KimCustomerType;
    const customerTypeDetail = String(formData.get("customerTypeDetail") ?? "").trim();
    const nextJobValue = formatKimJobValue(customerType, customerTypeDetail);
    const prevJob = statusValues.job;
    setStatusValues((current) => ({ ...current, job: nextJobValue }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("직군 수정 완료");
    savePatch({ customerType, customerTypeDetail }, () => setStatusValues((current) => ({ ...current, job: prevJob })));
  }

  function saveLocationField(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const province = String(formData.get("province") ?? "확인 필요");
    const detailField = String(formData.get("detail") ?? "확인 필요");
    const nextLocation = formatKimLocationValue(province, detailField);
    const prevLocation = statusValues.location;
    setStatusValues((current) => ({ ...current, location: nextLocation }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("거주지 수정 완료");
    savePatch({ residence: nextLocation }, () => setStatusValues((current) => ({ ...current, location: prevLocation })));
  }

  function saveSourceField(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextSource = String(formData.get("source") ?? "").trim();
    if (!nextSource) return;
    const prevSource = statusValues.source;
    setStatusValues((current) => ({ ...current, source: nextSource }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("상담경로 수정 완료");
    savePatch({ source: nextSource }, () => setStatusValues((current) => ({ ...current, source: prevSource })));
  }

  function saveAdvisorField(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const team = String(formData.get("team") ?? "인천본사") as KimAdvisorTeam;
    const advisor = String(formData.get("advisor") ?? "").trim();
    const nextAdvisor = formatKimAdvisorValue(team, advisor);
    const prevAdvisor = statusValues.advisor;
    const prevAssignedAt = statusValues.assignedAt;
    setStatusValues((current) => ({ ...current, advisor: nextAdvisor, assignedAt: formatKimAssignmentTime() }));
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("담당자 배정 완료");
    // advisorName은 이름만(빈 값=미배정→null). team은 그대로. 배정시각은 서버가 now()로 기록.
    savePatch({ advisorName: advisor || null, team }, () =>
      setStatusValues((current) => ({ ...current, advisor: prevAdvisor, assignedAt: prevAssignedAt })));
  }

  function selectStageGroup(nextGroup: string) {
    const nextStatus = customerStatusGroups[nextGroup]?.[0] ?? nextGroup;
    setStageGroup(nextGroup);
    setStageStatus(nextStatus);
    onWorkflowChange?.(customer.no, { statusGroup: nextGroup, status: nextStatus });
    markRecentUpdate("진행 상태");
    onToast("진행 상태 수정 완료");
  }

  function selectStageStatus(nextStatus: string) {
    setStageStatus(nextStatus);
    setOpenEditor(null);
    onWorkflowChange?.(customer.no, { statusGroup: stageGroup, status: nextStatus });
    markRecentUpdate("진행 상태");
    onToast("진행 상태 수정 완료");
  }

  // 계약 가능성 변경(Option A). 계약완료 단계면 "확정"으로 고정 — 비확정으로 바꿀 수 없다.
  // 비계약완료 단계면 "확정"으로 직접 바꿀 수 없다(계약완료 시 자동 확정).
  function selectChance(option: CustomerChanceOption) {
    if (stageGroup === "계약완료") {
      if (option !== "확정") {
        onToast("계약완료 단계에서는 계약 가능성이 확정으로 고정됩니다.");
        return;
      }
    } else if (option === "확정") {
      onToast("계약완료 단계에서만 확정으로 변경할 수 있습니다.");
      return;
    }
    setChance(option);
    onWorkflowChange?.(customer.no, { chance: option });
    setOpenEditor(null);
    markRecentUpdate("계약 가능성");
    onToast("계약 가능성 수정 완료");
  }

  return {
    statusValues,
    stageGroup,
    stageStatus,
    chance,
    manage,
    timelineItems,
    consultBodyRef,
    workflowValue,
    handlers: {
      openStatusEditor,
      openSourceEditorByKeyboard,
      openWorkflowEditor,
      saveStatusField,
      saveJobField,
      saveLocationField,
      saveSourceField,
      saveAdvisorField,
      selectStageGroup,
      selectStageStatus,
      selectChance,
    },
  };
}
