import { ArrowLeft, Bot, BriefcaseBusiness, CalendarClock, CarFront, Check, ChevronRight, FileText, History, MapPin, Maximize2, MessageSquareText, Pencil, Phone, RefreshCcw, Route, Send, Trash2, UserRound, Upload, X } from "lucide-react";
import { type ChangeEvent, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { customerStatusGroups, type Customer } from "@/data/customers";

type CustomerDetailPageProps = {
  customer: Customer;
  onBack: () => void;
  onFullScreen?: () => void;
  onToast: (message: string) => void;
  variant?: "page" | "drawer";
};

type DetailMetric = {
  label: string;
  value: string;
  tone?: "accent" | "quiet";
};

type KimStatusFieldKey = "phone" | "job" | "location" | "source" | "advisor" | "assignedAt";
type KimWorkflowKey = "stage" | "chance" | "manage";
type KimOpenEditor =
  | { kind: "status"; key: KimStatusFieldKey }
  | { kind: "workflow"; key: KimWorkflowKey }
  | { kind: "needs" }
  | { kind: "purchase" }
  | { kind: "schedule" };

type KimNeedsState = {
  model: string;
  trim: string;
  colors: string;
  method: string;
  memo: string;
};

type KimScheduleItem = {
  date: string;
  time: string;
  type: string;
  memo: string;
};

type KimTimelineItem = {
  id?: string;
  kind: string;
  title: string;
  meta: string;
  body: string;
};

const chanceByPriority: Record<string, string> = {
  긴급: "높음",
  높음: "높음",
  중간: "중간",
  낮음: "낮음",
  보류: "보류",
  완료: "확정",
};

const vehicleDetailByName: Record<string, DetailMetric[]> = {
  "Maybach S-Class": [
    { label: "모델", value: "Maybach S-Class" },
    { label: "트림", value: "S 500 4M Long" },
    { label: "비교 차종", value: "GLC · X3", tone: "accent" },
    { label: "핵심 조건", value: "총비용 · 중도해지 리스크" },
  ],
  팰리세이드: [
    { label: "모델", value: "팰리세이드" },
    { label: "트림", value: "2.5T 하이브리드 · 9인승" },
    { label: "용도", value: "패밀리 SUV" },
    { label: "핵심 조건", value: "렌트와 리스 차이 이해" },
  ],
  GV80: [
    { label: "모델", value: "GV80" },
    { label: "트림", value: "2.5T 가솔린" },
    { label: "심사 포인트", value: "사업자 증빙", tone: "accent" },
    { label: "핵심 조건", value: "승인 금융사 우선 압축" },
  ],
};

function chanceLabel(customer: Customer) {
  if (customer.statusGroup === "계약완료" || customer.status === "출고완료") return "확정";
  if (customer.statusGroup === "불발") return "낮음";
  return chanceByPriority[customer.priority] ?? "중간";
}

function phoneChunks(phone: string) {
  const chunks = phone.split("-");
  return chunks.length === 3 ? chunks : [phone.slice(0, 3), phone.slice(3, 7), phone.slice(7)];
}

function sourceType(source: string) {
  if (source.includes("앱")) return "앱 유입";
  if (source.includes("카카오")) return "카카오";
  if (source.includes("대표전화")) return "전화";
  if (source.includes("디엘")) return "구DB";
  return "직접/소개";
}

function detailRows(customer: Customer): DetailMetric[] {
  return [
    { label: "고객번호", value: customer.customerId },
    { label: "고객유형", value: [customer.customerType, customer.customerTypeDetail].filter(Boolean).join(" · ") },
    { label: "연락처", value: customer.phone },
    { label: "접수", value: `${customer.source} · ${customer.receivedAt}` },
    { label: "배정", value: `${customer.advisor} · ${customer.assignedAt}` },
    { label: "응답", value: customer.talkCount === "0/0" ? "상담 시작 전" : `상담 ${customer.talkCount}` },
  ];
}

function vehicleRows(customer: Customer): DetailMetric[] {
  return vehicleDetailByName[customer.vehicle] ?? [
    { label: "모델", value: customer.vehicle },
    { label: "구매방식", value: customer.method },
    { label: "상담 상태", value: customer.status },
    { label: "핵심 조건", value: customer.nextAction },
  ];
}

function timelineRows(customer: Customer) {
  return [
    { kind: "접수", title: `${sourceType(customer.source)} 접수`, meta: customer.receivedAt, body: `${customer.source} 경로로 고객 문의가 들어왔습니다.` },
    { kind: "배정", title: `${customer.advisor} 상담사 배정`, meta: customer.assignedAt, body: `${customer.team} 기준으로 담당자를 배정했습니다.` },
    { kind: "상태", title: `${customer.statusGroup} > ${customer.status}`, meta: customer.date, body: "전체 보기의 진행 상태 컬럼과 동일한 업무 단계입니다." },
    { kind: "메모", title: "상담 메모 업데이트", meta: "최근", body: customer.nextAction },
  ];
}

const kimMinjunCustomerFields = [
  { label: "이름", value: "김민준" },
  { label: "연락처", value: "010-9588-0812" },
  { label: "거주지", value: "인천 · 상세 미확인" },
  { label: "고객유형", value: "개인 · 4대보험" },
  { label: "상담경로", value: "앱 견적비교" },
  { label: "담당자", value: "김지안 · 인천본사" },
];

const kimMinjunPurchaseFields = [
  { label: "구매방식", value: "운용리스" },
  { label: "구매시기", value: "좋은 조건 즉시" },
  { label: "월 예산", value: "월 납입액 비교 필요" },
  { label: "계약기간", value: "60개월" },
  { label: "보증금", value: "30%" },
  { label: "선수금", value: "없음" },
  { label: "주행거리", value: "확인 필요" },
  { label: "보험 포함 여부", value: "확인 필요" },
  { label: "심사 특이사항", value: "개인 4대보험 · 재직 확인 전" },
];

const kimMinjunCoreConditionFields = [
  { label: "관심 차종", value: "Maybach S-Class" },
  { label: "비교 차종", value: "GLC · X3" },
  { label: "구매방식", value: "운용리스" },
  { label: "구매시기", value: "좋은 조건 즉시" },
  { label: "예산 기준", value: "월 납입액 비교 필요" },
  { label: "확인 필요", value: "GLC 재고 · 보험 포함 · 해지 조건" },
];

const kimMinjunActionFields = [
  { label: "다음 액션", value: "GLC 재고 확인 후 X3 조건과 총비용 비교 견적 재송출" },
  { label: "처리 기한", value: "오늘 16:00 전" },
  { label: "담당", value: "김지안" },
  { label: "상태", value: "견적 재정리 필요" },
];

const kimMinjunStatusFieldMeta = [
  { key: "phone", label: "연락처", icon: Phone },
  { key: "job", label: "직군", icon: BriefcaseBusiness },
  { key: "location", label: "거주지", icon: MapPin },
  { key: "source", label: "상담경로", icon: Route },
  { key: "advisor", label: "담당자", icon: UserRound },
  { key: "assignedAt", label: "배정시간", icon: CalendarClock },
] satisfies { key: KimStatusFieldKey; label: string; icon: typeof Phone }[];

const kimMinjunInitialStatusValues: Record<KimStatusFieldKey, string> = {
  phone: "010-9588-0812",
  job: "개인 · 4대보험",
  location: "인천광역시",
  source: "앱 견적비교",
  advisor: "김지안",
  assignedAt: "오늘 13:04",
};

const kimMinjunWorkflowMeta = [
  { key: "stage", label: "진행 상태", tone: "stage" },
  { key: "chance", label: "계약 가능성", tone: "chance" },
  { key: "manage", label: "관리 상태", tone: "normal" },
] satisfies { key: KimWorkflowKey; label: string; tone: string }[];

const kimChanceOptions = ["높음", "중간", "낮음", "보류", "확정"];
const kimManageOptions = ["정상", "확인필요", "재문의", "지연", "장기방치"];
const kimMethodOptions = ["운용리스", "장기렌트", "할부", "현금"];

const kimInitialNeeds: KimNeedsState = {
  model: "Maybach S-Class",
  trim: "S 500 4M Long",
  colors: "외장 컬러 미정 · 내장 컬러 미정",
  method: "운용리스",
  memo: "월 납입액, 총비용, 중도해지 조건 차이를 비교하고 싶어함. GLC 재고 확인 후 X3 조건과 함께 다시 정리 필요.",
};

const kimMinjunQuoteHistory = [
  { title: "Maybach S 500 운용리스 1차 견적", meta: "오늘 14:20 · 앱 발송완료", status: "고객 확인 전" },
  { title: "GLC 재고 확인 후 비교 견적 예정", meta: "오늘 16:00 전 · 준비 필요", status: "대기" },
];

const kimMinjunDocumentVault = [
  { title: "운전면허증", status: "미수령" },
  { title: "재직/소득 서류", status: "미수령" },
  { title: "심사 신청서", status: "준비 전" },
  { title: "계약 서류", status: "준비 전" },
];

const kimInitialSchedules: KimScheduleItem[] = [
  { date: "2026-05-26", time: "16:00", type: "견적", memo: "GLC 재고 확인 후 X3 조건과 총비용 비교 견적 재발송" },
];

function KimMinjunDetailHeader() {
  return (
    <section className="customer-detail-summary kim-detail-summary">
      <div className="kim-header-main">
        <div className="kim-header-read">
          <div className="kim-header-primary">
            <h2 className="kim-header-breadcrumb">
              <span>고객 관리</span>
              <ChevronRight size={18} strokeWidth={2.2} />
              <span>김민준</span>
              <em className="kim-header-code-text num">CU-2605-0020</em>
            </h2>
            <p>방금 전 상담 메모 업데이트</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function kimEditorMatches(openEditor: KimOpenEditor | null, next: KimOpenEditor) {
  if (!openEditor || openEditor.kind !== next.kind) return false;
  if (openEditor.kind === "needs" && next.kind === "needs") return true;
  if (openEditor.kind === "purchase" && next.kind === "purchase") return true;
  if (openEditor.kind === "schedule" && next.kind === "schedule") return true;
  if (openEditor.kind === "status" && next.kind === "status") return openEditor.key === next.key;
  if (openEditor.kind === "workflow" && next.kind === "workflow") return openEditor.key === next.key;
  return false;
}

function fieldLabel(key: KimStatusFieldKey) {
  return kimMinjunStatusFieldMeta.find((field) => field.key === key)?.label ?? "항목";
}

function timelineRecordKey(item: KimTimelineItem) {
  return item.id ?? `${item.kind}-${item.title}-${item.meta}-${item.body}`;
}

function scheduleRecordKey(item: KimScheduleItem) {
  return `${item.date}-${item.time}-${item.type}-${item.memo}`;
}

function KimMinjunDetailContent({ customer, onToast }: { customer: Customer; onToast: (message: string) => void }) {
  const [statusValues, setStatusValues] = useState(kimMinjunInitialStatusValues);
  const [stageGroup, setStageGroup] = useState("견적");
  const [stageStatus, setStageStatus] = useState("발송완료");
  const [chance, setChance] = useState("높음");
  const [manage, setManage] = useState("정상");
  const [needs, setNeeds] = useState<KimNeedsState>(kimInitialNeeds);
  const [purchaseFields, setPurchaseFields] = useState(kimMinjunPurchaseFields);
  const [schedules, setSchedules] = useState<KimScheduleItem[]>(kimInitialSchedules);
  const [completedScheduleKeys, setCompletedScheduleKeys] = useState<string[]>([]);
  const [timelineAdditions, setTimelineAdditions] = useState<KimTimelineItem[]>([]);
  const [deletedTimelineKeys, setDeletedTimelineKeys] = useState<string[]>([]);
  const [addingTimelineRecord, setAddingTimelineRecord] = useState(false);
  const [openEditor, setOpenEditor] = useState<KimOpenEditor | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const consultBodyRef = useRef<HTMLDivElement>(null);
  const timelineItems = [...timelineRows(customer), ...timelineAdditions].filter((item) => !deletedTimelineKeys.includes(timelineRecordKey(item)));

  useEffect(() => {
    const container = consultBodyRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [timelineItems.length]);

  useEffect(() => {
    if (!openEditor) return;

    function closeEditor(event: PointerEvent) {
      if (editorRef.current?.contains(event.target as Node)) return;
      setOpenEditor(null);
    }

    function closeEditorByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpenEditor(null);
    }

    document.addEventListener("pointerdown", closeEditor, true);
    document.addEventListener("keydown", closeEditorByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeEditor, true);
      document.removeEventListener("keydown", closeEditorByKeyboard);
    };
  }, [openEditor]);

  function toggleEditor(next: KimOpenEditor) {
    setOpenEditor((current) => kimEditorMatches(current, next) ? null : next);
  }

  function openSourceEditorByKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleEditor({ kind: "status", key: "source" });
  }

  function saveStatusField(event: FormEvent<HTMLFormElement>, key: KimStatusFieldKey) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = String(formData.get("value") ?? "").trim();
    if (!value) return;
    setStatusValues((current) => ({ ...current, [key]: value }));
    setOpenEditor(null);
    onToast(`${fieldLabel(key)} 수정 완료`);
  }

  function selectStageGroup(nextGroup: string) {
    setStageGroup(nextGroup);
    setStageStatus(customerStatusGroups[nextGroup]?.[0] ?? nextGroup);
  }

  function selectStageStatus(nextStatus: string) {
    setStageStatus(nextStatus);
    setOpenEditor(null);
    onToast("진행 상태 수정 완료");
  }

  function saveNeeds(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setNeeds({
      model: String(formData.get("model") ?? "").trim() || needs.model,
      trim: String(formData.get("trim") ?? "").trim() || needs.trim,
      colors: String(formData.get("colors") ?? "").trim() || needs.colors,
      method: String(formData.get("method") ?? "").trim() || needs.method,
      memo: String(formData.get("memo") ?? "").trim() || needs.memo,
    });
    setOpenEditor(null);
    onToast("고객 니즈 수정 완료");
  }

  function savePurchaseConditions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPurchaseFields((current) => current.map((field) => {
      const value = String(formData.get(field.label) ?? "").trim();
      return { ...field, value: value || "미정" };
    }));
    setOpenEditor(null);
    onToast("상세 구매조건 수정 완료");
  }

  function attachQuoteFile(event: ChangeEvent<HTMLInputElement>, quoteTitle: string) {
    const fileName = event.target.files?.[0]?.name;
    if (!fileName) return;
    onToast(`${quoteTitle} 원본 첨부: ${fileName}`);
    event.target.value = "";
  }

  function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextSchedule = {
      date: String(formData.get("date") ?? ""),
      time: String(formData.get("time") ?? ""),
      type: String(formData.get("type") ?? "할 일"),
      memo: String(formData.get("memo") ?? "").trim(),
    };
    if (!nextSchedule.date || !nextSchedule.memo) return;
    setSchedules((current) => [nextSchedule, ...current].slice(0, 4));
    setOpenEditor(null);
    onToast("다음 일정이 생성되었습니다.");
  }

  function saveTimelineRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const kind = String(formData.get("kind") ?? "메모");
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    setTimelineAdditions((current) => [...current, {
      id: `kim-record-${Date.now()}`,
      kind,
      title: `${kind} 기록 추가`,
      meta: "방금 전",
      body,
    }]);
    setAddingTimelineRecord(false);
    onToast("상담 기록이 추가되었습니다.");
  }

  function deleteTimelineRecord(item: KimTimelineItem) {
    setDeletedTimelineKeys((current) => [...current, timelineRecordKey(item)]);
    onToast("상담 메모 기록을 삭제했습니다.");
  }

  function toggleScheduleComplete(item: KimScheduleItem) {
    const key = scheduleRecordKey(item);
    setCompletedScheduleKeys((current) => (
      current.includes(key) ? current.filter((completedKey) => completedKey !== key) : [...current, key]
    ));
  }

  function workflowValue(key: KimWorkflowKey) {
    if (key === "stage") return `${stageGroup} · ${stageStatus}`;
    if (key === "chance") return chance;
    return manage;
  }

  function renderStatusEditor(key: KimStatusFieldKey) {
    return (
      <div className="kim-edit-popover compact" role="dialog" aria-label={`${fieldLabel(key)} 수정`}>
        <form className="kim-edit-form" onSubmit={(event) => saveStatusField(event, key)}>
          <label>
            <span>{fieldLabel(key)}</span>
            <input autoFocus defaultValue={statusValues[key]} name="value" />
          </label>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">저장</button>
          </div>
        </form>
      </div>
    );
  }

  function renderWorkflowEditor(key: KimWorkflowKey) {
    if (key === "stage") {
      const secondaryOptions = customerStatusGroups[stageGroup] ?? [];
      return (
        <div className="kim-edit-popover stage" role="dialog" aria-label="진행 상태 수정">
          <div className="kim-choice-editor two-column">
            <div>
              <span className="kim-edit-label">1단계</span>
              <div className="kim-choice-list">
                {Object.keys(customerStatusGroups).map((group) => (
                  <button className={group === stageGroup ? "active" : ""} key={group} onClick={() => selectStageGroup(group)} type="button">
                    <span>{group}</span>
                    {group === stageGroup && <Check size={13} strokeWidth={2.7} />}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="kim-edit-label">2단계</span>
              <div className="kim-choice-list">
                {secondaryOptions.map((status) => (
                  <button className={status === stageStatus ? "active" : ""} key={status} onClick={() => selectStageStatus(status)} type="button">
                    <span>{status}</span>
                    {status === stageStatus && <Check size={13} strokeWidth={2.7} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    const options = key === "chance" ? kimChanceOptions : kimManageOptions;
    return (
      <div className="kim-edit-popover compact" role="dialog" aria-label={`${key === "chance" ? "계약 가능성" : "관리 상태"} 수정`}>
        <div className="kim-choice-list single">
          {options.map((option) => {
            const selected = option === (key === "chance" ? chance : manage);
            return (
              <button
                className={selected ? "active" : ""}
                key={option}
                onClick={() => {
                  if (key === "chance") setChance(option);
                  else setManage(option);
                  setOpenEditor(null);
                  onToast(`${key === "chance" ? "계약 가능성" : "관리 상태"} 수정 완료`);
                }}
                type="button"
              >
                <span>{option}</span>
                {selected && <Check size={13} strokeWidth={2.7} />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderNeedsEditor() {
    return (
      <div className="kim-edit-popover needs" role="dialog" aria-label="고객 니즈 수정">
        <form className="kim-edit-form needs" onSubmit={saveNeeds}>
          <div className="kim-edit-grid">
            <label>
              <span>관심 차종</span>
              <input autoFocus defaultValue={needs.model} name="model" />
            </label>
            <label>
              <span>트림</span>
              <input defaultValue={needs.trim} name="trim" />
            </label>
            <label>
              <span>색상</span>
              <input defaultValue={needs.colors} name="colors" />
            </label>
            <label>
              <span>구매방식</span>
              <select defaultValue={needs.method} name="method">
                {kimMethodOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>문의사항</span>
            <textarea defaultValue={needs.memo} name="memo" rows={4} />
          </label>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">저장</button>
          </div>
        </form>
      </div>
    );
  }

  function renderPurchaseEditor() {
    return (
      <div className="kim-edit-popover purchase" role="dialog" aria-label="상세 구매조건 수정">
        <form className="kim-edit-form purchase" onSubmit={savePurchaseConditions}>
          <div className="kim-edit-grid purchase">
            {purchaseFields.map((field, index) => (
              <label key={field.label}>
                <span>{field.label}</span>
                <input autoFocus={index === 0} defaultValue={field.value === "미정" ? "" : field.value} name={field.label} placeholder="미정" />
              </label>
            ))}
          </div>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">저장</button>
          </div>
        </form>
      </div>
    );
  }

  function renderScheduleEditor() {
    return (
      <div className="kim-edit-popover schedule" role="dialog" aria-label="일정 추가">
        <form className="kim-edit-form schedule" onSubmit={saveSchedule}>
          <div className="kim-edit-grid">
            <label>
              <span>날짜</span>
              <input autoFocus defaultValue="2026-05-26" name="date" type="date" />
            </label>
            <label>
              <span>시간</span>
              <input defaultValue="16:00" name="time" type="time" />
            </label>
            <label>
              <span>유형</span>
              <select defaultValue="통화" name="type">
                {["통화", "할 일", "재연락", "견적", "서류"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>메모</span>
            <textarea defaultValue="GLC 재고 확인 후 비교 견적 재안내" name="memo" rows={3} />
          </label>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">생성</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="kim-customer-dashboard">
      <div className="kim-left-dashboard">
        <KimMinjunDetailHeader />
        <section className="detail-section kim-status-dashboard">
          <div className="kim-status-grid">
            {kimMinjunStatusFieldMeta.map((field) => {
              const Icon = field.icon;
              if (field.key === "source") {
                return (
                  <div className="kim-edit-anchor" key={field.key} ref={openEditor?.kind === "status" && openEditor.key === field.key ? editorRef : undefined}>
                    <div className="kim-status-field" onClick={() => toggleEditor({ kind: "status", key: field.key })} onKeyDown={openSourceEditorByKeyboard} role="button" tabIndex={0}>
                      <span className="kim-status-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.9} /></span>
                      <span className="kim-status-copy">
                      <span>{field.label}</span>
                      <strong>
                        {statusValues[field.key]}
                        <button
                          aria-label="앱 상담 큐 보기"
                          className="kim-app-queue-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onToast("차선생 앱 상담 큐 패널 자리입니다.");
                          }}
                          type="button"
                        >
                          <MessageSquareText size={13} strokeWidth={2.4} />
                        </button>
                      </strong>
                      </span>
                    </div>
                    {openEditor?.kind === "status" && openEditor.key === field.key ? renderStatusEditor(field.key) : null}
                  </div>
                );
              }
              return (
                <div className="kim-edit-anchor" key={field.key} ref={openEditor?.kind === "status" && openEditor.key === field.key ? editorRef : undefined}>
                  <button className="kim-status-field" onClick={() => toggleEditor({ kind: "status", key: field.key })} type="button">
                    <span className="kim-status-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.9} /></span>
                    <span className="kim-status-copy">
                    <span>{field.label}</span>
                    <strong>{statusValues[field.key]}</strong>
                    </span>
                  </button>
                  {openEditor?.kind === "status" && openEditor.key === field.key ? renderStatusEditor(field.key) : null}
                </div>
              );
            })}
          </div>
          <div className="kim-workflow-strip" aria-label="김민준 업무 상태">
            {kimMinjunWorkflowMeta.map((field) => (
              <div className="kim-edit-anchor workflow" key={field.key} ref={openEditor?.kind === "workflow" && openEditor.key === field.key ? editorRef : undefined}>
                <button className={`kim-workflow-card ${field.tone}`} onClick={() => toggleEditor({ kind: "workflow", key: field.key })} type="button">
                  <span>{field.label}</span>
                  <strong>{workflowValue(field.key)}</strong>
                </button>
                {openEditor?.kind === "workflow" && openEditor.key === field.key ? renderWorkflowEditor(field.key) : null}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="detail-section kim-needs-dashboard">
        <div className="kim-needs-field">
          <div className="kim-edit-anchor needs" ref={openEditor?.kind === "needs" ? editorRef : undefined}>
          <button className="kim-needs-floating-card" onClick={() => toggleEditor({ kind: "needs" })} type="button">
            <div className="kim-needs-card-main">
              <span className="kim-needs-car-icon" aria-hidden="true"><CarFront size={22} strokeWidth={2.1} /></span>
              <div className="kim-needs-card-copy">
                <h3>{needs.model}</h3>
                <p>{needs.trim}</p>
                <span>{needs.colors}</span>
              </div>
              <span className="kim-needs-method-badge">{needs.method}</span>
            </div>
            <div className="kim-needs-card-memo">
              <span>문의사항</span>
              <p>{needs.memo}</p>
            </div>
          </button>
          {openEditor?.kind === "needs" ? renderNeedsEditor() : null}
          </div>
        </div>
      </section>

      <section className="kim-condition-quote-grid" aria-label="김민준 구매조건과 견적">
        <section className="detail-section kim-purchase-conditions" aria-label="상세 구매조건" ref={openEditor?.kind === "purchase" ? editorRef : undefined}>
          <div className="kim-mvp-card-head">
            <div className="kim-mvp-title-row">
              <h3>상세 구매조건</h3>
              <button aria-label="상세 구매조건 수정" className="kim-mvp-add-circle" onClick={() => toggleEditor({ kind: "purchase" })} type="button">
                <Pencil size={12} strokeWidth={2.4} />
              </button>
            </div>
          </div>
          <div className="kim-purchase-condition-body">
            {purchaseFields.map((field) => (
              <button className="kim-purchase-condition-item" key={field.label} onClick={() => toggleEditor({ kind: "purchase" })} type="button">
                <span>{field.label}</span>
                <strong className={field.value === "미정" ? "is-empty" : ""}>{field.value}</strong>
              </button>
            ))}
          </div>
          {openEditor?.kind === "purchase" ? renderPurchaseEditor() : null}
        </section>

        <article className="detail-section kim-mvp-card kim-quote-card compact">
          <div className="kim-mvp-card-head">
            <div className="kim-mvp-title-row">
              <h3>견적함</h3>
              <span>{kimMinjunQuoteHistory.length}</span>
              <button aria-label="견적함 추가" className="kim-mvp-add-circle" onClick={() => onToast("견적함 추가 자리입니다.")} type="button">+</button>
            </div>
          </div>
          <div className="kim-mvp-card-body">
            <div className="kim-quote-list">
              {kimMinjunQuoteHistory.map((quote) => (
                <div className="kim-quote-row" key={quote.title}>
                  <span>{quote.status}</span>
                  <div>
                    <strong>{quote.title}</strong>
                    <p>{quote.meta}</p>
                  </div>
                  <label aria-label={`${quote.title} 원본 첨부`}>
                    <Upload size={12} strokeWidth={2.4} />
                    첨부
                    <input accept="image/*,.pdf" onChange={(event) => attachQuoteFile(event, quote.title)} type="file" />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="kim-mvp-ops-grid" aria-label="김민준 고객 운영 기능">
        <section className="detail-section kim-mvp-section kim-consult-log">
          <div className="kim-mvp-section-head">
            <div className="kim-mvp-title-row">
              <h3>상담 기록</h3>
              <span>{timelineItems.length}</span>
              <button aria-label="상담 기록 추가" className="kim-mvp-add-circle" onClick={() => setAddingTimelineRecord((current) => !current)} type="button">{addingTimelineRecord ? "×" : "+"}</button>
            </div>
          </div>
          <div className="kim-consult-body" ref={consultBodyRef}>
            {addingTimelineRecord ? (
              <form className="kim-consult-composer" onSubmit={saveTimelineRecord}>
                <label>
                  <span>유형</span>
                  <select defaultValue="메모" name="kind">
                    {["메모", "통화", "카톡", "앱상담", "상태변경"].map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label>
                  <span>내용</span>
                  <textarea autoFocus defaultValue="GLC 재고 확인 후 X3 조건과 총비용 비교 견적 다시 안내 예정" name="body" rows={3} />
                </label>
                <div className="kim-consult-composer-actions">
                  <button type="button" onClick={() => setAddingTimelineRecord(false)}>취소</button>
                  <button className="primary" type="submit">저장</button>
                </div>
              </form>
            ) : null}
            <div className="kim-consult-timeline">
              {timelineItems.map((item, index) => {
                const isLatestMemo = item.kind === "메모" && !timelineItems.slice(index + 1).some((nextItem) => nextItem.kind === "메모");
                return (
                  <article
                    className={`kim-consult-event${isLatestMemo ? " is-latest-memo" : " is-muted-history"}`}
                    key={`${item.kind}-${item.title}-${item.meta}-${index}`}
                  >
                    <span>{item.kind}</span>
                    <div>
                      <div className="kim-consult-event-head">
                        <div>
                          <strong>{item.title}</strong>
                          <em>{item.meta}</em>
                        </div>
                        {item.kind === "메모" ? (
                          <button aria-label="상담 메모 삭제" onClick={() => deleteTimelineRecord(item)} type="button">
                            <Trash2 size={13} strokeWidth={2.3} />
                          </button>
                        ) : null}
                      </div>
                      <p>{item.body}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <article className="detail-section kim-mvp-card kim-schedule-card" ref={openEditor?.kind === "schedule" ? editorRef : undefined}>
          <div className="kim-mvp-card-head">
            <div className="kim-mvp-title-row">
              <h3>다음 일정</h3>
              <span>{schedules.length}</span>
              <button aria-label="다음 일정 추가" className="kim-mvp-add-circle" onClick={() => toggleEditor({ kind: "schedule" })} type="button">+</button>
            </div>
          </div>
          <div className="kim-mvp-card-body">
            <div className="kim-schedule-list">
              {schedules.map((schedule) => {
                const isCompleted = completedScheduleKeys.includes(scheduleRecordKey(schedule));
                return (
                  <div className={`kim-schedule-row${isCompleted ? " is-completed" : ""}`} key={scheduleRecordKey(schedule)}>
                    <span>{schedule.type}</span>
                    <div>
                      <strong>{schedule.date} {schedule.time}</strong>
                      <p>{schedule.memo}</p>
                    </div>
                    <button
                      aria-label={isCompleted ? "일정 완료 취소" : "일정 완료"}
                      aria-pressed={isCompleted}
                      onClick={() => toggleScheduleComplete(schedule)}
                      type="button"
                    >
                      <Check size={13} strokeWidth={2.6} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          {openEditor?.kind === "schedule" ? renderScheduleEditor() : null}
        </article>

        <article className="detail-section kim-mvp-card kim-doc-card">
          <div className="kim-mvp-card-head">
            <div className="kim-mvp-title-row">
              <h3>서류함</h3>
              <span>0</span>
              <button aria-label="서류 추가" className="kim-mvp-add-circle" onClick={() => onToast("서류 추가 자리입니다.")} type="button">+</button>
            </div>
          </div>
          <div className="kim-mvp-card-body">
            <div className="kim-doc-list">
              {kimMinjunDocumentVault.map((doc) => (
                <button className="kim-doc-row" key={doc.title} onClick={() => onToast(`${doc.title} 업로드 공간입니다.`)} type="button">
                  <span>{doc.status}</span>
                  <strong>{doc.title}</strong>
                </button>
              ))}
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

export function CustomerDetailPage({ customer, onBack, onFullScreen, onToast, variant = "page" }: CustomerDetailPageProps) {
  const chance = chanceLabel(customer);
  const phone = phoneChunks(customer.phone);
  const isContracted = chance === "확정";
  const drawerMode = variant === "drawer";
  const isKimMinjun = customer.customerId === "CU-2605-0020";

  return (
    <div className={`customer-detail-console-page ${drawerMode ? "drawer" : ""}`}>
      {isKimMinjun ? null : (
        <>
      <section className="customer-detail-summary">
        <div className="customer-detail-identity">
          <div className="customer-detail-avatar" aria-hidden="true">{customer.name.slice(0, 1)}</div>
          <div>
            <div className="customer-detail-name-row">
              <h2>{customer.name}</h2>
              <span className="customer-detail-code num">{customer.customerId}</span>
              <span className="customer-detail-type">{customer.customerType} · {customer.customerTypeDetail}</span>
            </div>
            <div className="customer-detail-contact-row">
              <span><Phone size={13} strokeWidth={2.2} />{phone.join("-")}</span>
              <span><UserRound size={13} strokeWidth={2.2} />{customer.advisor} · {customer.team}</span>
              <span><CalendarClock size={13} strokeWidth={2.2} />{customer.source} · {customer.receivedAt}</span>
            </div>
          </div>
        </div>
        <div className="customer-detail-status-strip" aria-label="고객 현재 운영 상태">
          <button className="detail-stage-pill" type="button">
            <span>{customer.statusGroup}</span>
            <em>›</em>
            <strong>{customer.status}</strong>
          </button>
          <button className={`detail-chance-pill ${isContracted ? "confirmed" : ""}`} type="button">{chance}</button>
          <button className="detail-manage-pill" type="button">{isContracted ? "완료 관리" : "정상"}</button>
        </div>
      </section>

      <section className="customer-detail-action-rail" aria-label="고객 상세 액션">
        <div className="customer-detail-panel-controls">
          <button className="detail-back-button" onClick={onBack} type="button">
            {drawerMode ? <X size={14} /> : <ArrowLeft size={14} />}
            {drawerMode ? "닫기" : "전체 보기"}
          </button>
          {drawerMode && onFullScreen ? (
            <button className="detail-back-button" onClick={onFullScreen} type="button"><Maximize2 size={14} />전체 화면</button>
          ) : null}
        </div>
        <div className="customer-detail-action-group">
          <button onClick={() => onToast(`${customer.name} 담당자 변경 패널 자리입니다.`)} type="button"><RefreshCcw size={13} />담당자 변경</button>
          <button onClick={() => onToast(`${customer.name} 상담 메모를 추가합니다.`)} type="button"><MessageSquareText size={13} />상담 메모</button>
          <button onClick={() => onToast(`${customer.name} 견적 작성 화면으로 이동합니다.`)} type="button"><FileText size={13} />견적 작성</button>
          <button className="primary" onClick={() => onToast(`${customer.name} 고객 앱으로 견적 송출 준비를 시작합니다.`)} type="button"><Send size={13} />앱으로 견적 송출</button>
        </div>
      </section>
        </>
      )}

      {isKimMinjun ? (
        <KimMinjunDetailContent customer={customer} onToast={onToast} />
      ) : (
      <div className="customer-detail-layout">
        <main className="customer-detail-main">
          <section className="detail-section timeline-section">
            <div className="detail-section-head">
              <div>
                <h3>상담 타임라인</h3>
                <p>접수부터 상태 변경, 메모, 견적 액션까지 고객 흐름을 시간순으로 봅니다.</p>
              </div>
              <span className="detail-section-count num">{timelineRows(customer).length}</span>
            </div>
            <div className="detail-timeline">
              {timelineRows(customer).map((item) => (
                <article className="detail-timeline-item" key={`${item.kind}-${item.title}`}>
                  <span className="detail-timeline-kind">{item.kind}</span>
                  <div>
                    <div className="detail-timeline-title">
                      <strong>{item.title}</strong>
                      <span>{item.meta}</span>
                    </div>
                    <p>{item.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="detail-section">
            <div className="detail-section-head">
              <div>
                <h3>상담 메모 · 문의 사항</h3>
                <p>전체 보기의 상담 메모 컬럼을 상세에서 원문 단위로 관리합니다.</p>
              </div>
              <button className="detail-inline-button" onClick={() => onToast("상담 메모 편집 모드는 다음 단계에서 연결합니다.")} type="button">수정</button>
            </div>
            <div className="detail-note-box">{customer.nextAction}</div>
          </section>

          <section className="detail-section">
            <div className="detail-tabs" role="tablist" aria-label="고객 상세 작업 탭">
              {["상담 기록", "고객 정보", "차량/견적", "계약/출고", "문서", "변경 이력"].map((tab, index) => (
                <button aria-selected={index === 0} className={index === 0 ? "active" : ""} key={tab} role="tab" type="button">{tab}</button>
              ))}
            </div>
            <div className="detail-record-grid">
              <div>
                <span>최근 상담 요약</span>
                <strong>{customer.aiSummary}</strong>
              </div>
              <div>
                <span>다음 액션</span>
                <strong>{customer.nextAction}</strong>
              </div>
            </div>
          </section>
        </main>

        <aside className="customer-detail-side">
          <section className="detail-section">
            <div className="detail-section-head compact">
              <h3>고객 스냅샷</h3>
            </div>
            <div className="detail-kv-list">
              {detailRows(customer).map((row) => (
                <div className="detail-kv-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong className={row.label === "연락처" || row.label === "고객번호" ? "num" : ""}>{row.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-section">
            <div className="detail-section-head compact">
              <h3>차량 · 구매방식</h3>
              <span className="detail-mini-badge">{customer.method}</span>
            </div>
            <div className="detail-kv-list">
              {vehicleRows(customer).map((row) => (
                <div className="detail-kv-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong className={row.tone === "accent" ? "accent" : ""}>{row.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-section ai-section">
            <div className="detail-section-head compact">
              <h3><Bot size={15} /> AI 힌트</h3>
            </div>
            <p>{customer.aiSummary}</p>
            <div className="detail-ai-next">
              <History size={14} />
              <span>상담 메모, 진행 상태, 계약 가능성 변경 이력을 기준으로 다음 액션을 추천하는 자리입니다.</span>
            </div>
          </section>
        </aside>
      </div>
      )}
    </div>
  );
}
