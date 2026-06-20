// 고객 관리 테이블 행의 셀 컴포넌트 모음.
// CustomerManagementPage.renderRow가 이 셀들을 조립한다.
// 셀별 props는 각 셀이 의존하는 상태/핸들러/ref와 1:1로 대응한다.
import { Check, Eraser, FileText, MessageSquare, Pencil, RefreshCcw, X } from "lucide-react";
import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { CHANCE_OPTIONS, type Customer, customerStatusGroups } from "@/data/customers";
import type { RoleTab } from "@/data/roles";
import { aiHintDisplay, assignedAtDisplay, type ChanceOption, chanceButtonClass, chanceOptionClass, customerMeta, extraTooltipValue, type FinalUpdateInfo, type FinalUpdateStatus, primaryStageOptions, receivedAtDisplay, secondaryStageOptionsByGroup, type StagePickerLevel, statusButtonClass, vehicleDisplay } from "@/lib/customer-table";

function stopTableControlPointer(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation();
}

function AiHintIcon() {
  return (
    <svg aria-hidden="true" className="ai-hint-icon" viewBox="0 0 512 512">
      <path
        d="m320 192l-85.333-32L320 127.968l32-85.301l32.03 85.301L469.333 160l-85.303 32L352 277.333zM149.333 362.667L42.667 320l106.666-42.667L192 170.667l42.667 106.666L341.333 320l-106.666 42.667L192 469.333z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CustomerSelectCell({ checked, onToggle }: { checked: boolean; onToggle: (checked: boolean) => void }) {
  return (
    <td className="select-cell">
      <input
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={stopTableControlPointer}
        type="checkbox"
      />
    </td>
  );
}

export function CustomerInfoCell({ customer }: { customer: Customer }) {
  return (
    <td>
      <strong className="customer-name">{customer.name}<span className="customer-code num">{customer.customerId}</span></strong>
      <span className="customer-meta">{customerMeta(customer)}</span>
      <span className="customer-phone num">{customer.phone}</span>
    </td>
  );
}

export function CustomerVehicleCell({
  customer,
  openExtraFor,
  onToggleExtra,
  extraPopoverRef,
}: {
  customer: Customer;
  openExtraFor: string | null;
  onToggleExtra: (event: MouseEvent<HTMLButtonElement>, extraId: string) => void;
  extraPopoverRef: RefObject<HTMLButtonElement | null>;
}) {
  const vehicle = vehicleDisplay(customer);
  const vehicleExtraId = `${customer.no}:vehicle`;
  const methodExtraId = `${customer.no}:method`;
  return (
    <td>
      <strong className="vehicle-title">
        <span className="vehicle-line-text">{vehicle.title}</span>
        {vehicle.extraVehicles.length > 0 && (
          <button
            aria-expanded={openExtraFor === vehicleExtraId}
            aria-label={`${vehicle.title} 추가 차종 보기`}
            className={openExtraFor === vehicleExtraId ? "extra-count-pill active" : "extra-count-pill"}
            onClick={(event) => onToggleExtra(event, vehicleExtraId)}
            ref={openExtraFor === vehicleExtraId ? extraPopoverRef : undefined}
            type="button"
          >
            +{vehicle.extraVehicles.length}
            <span className="extra-tooltip">
              <strong>{extraTooltipValue(vehicle.extraVehicles)}</strong>
              <span>도 고민 · 비교 중..</span>
            </span>
          </button>
        )}
      </strong>
      <span className="vehicle-trim" title={vehicle.trim}>{vehicle.trimLabel}</span>
      <span className="vehicle-method">
        <span className="vehicle-line-text">{vehicle.method}</span>
        {vehicle.extraMethods.length > 0 && (
          <button
            aria-expanded={openExtraFor === methodExtraId}
            aria-label={`${vehicle.method} 추가 구매방식 보기`}
            className={openExtraFor === methodExtraId ? "extra-count-pill active" : "extra-count-pill"}
            onClick={(event) => onToggleExtra(event, methodExtraId)}
            ref={openExtraFor === methodExtraId ? extraPopoverRef : undefined}
            type="button"
          >
            +{vehicle.extraMethods.length}
            <span className="extra-tooltip">
              <strong>{extraTooltipValue(vehicle.extraMethods)}</strong>
              <span>도 고민 · 비교 중..</span>
            </span>
          </button>
        )}
      </span>
    </td>
  );
}

export function CustomerStageCell({
  customer,
  pickerLevel,
  stagePickerRef,
  onOpenPicker,
  onChangePrimary,
  onChangeSecondary,
}: {
  customer: Customer;
  pickerLevel: StagePickerLevel | null;
  stagePickerRef: RefObject<HTMLDivElement | null>;
  onOpenPicker: (customerNo: number, level: StagePickerLevel) => void;
  onChangePrimary: (customerNo: number, nextGroup: string) => void;
  onChangeSecondary: (customerNo: number, nextStatus: string) => void;
}) {
  const secondaryStageOptions = secondaryStageOptionsByGroup[customer.statusGroup] ?? customerStatusGroups[customer.statusGroup] ?? [customer.status];
  const showNewLeadBadge = customer.statusGroup === "신규" && customer.status === "상담접수";
  return (
    <td className="stage-cell stage-cell-two-step-preview">
      <div className="stage-two-step-stack" ref={pickerLevel ? stagePickerRef : undefined}>
        <div className="stage-control">
          <button
            aria-expanded={pickerLevel === "primary"}
            aria-haspopup="listbox"
            aria-label={`진행 1단계 변경: ${customer.statusGroup}`}
            className="stage-step-button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPicker(customer.no, "primary");
            }}
            onPointerDown={stopTableControlPointer}
            type="button"
          >
            <span>{customer.statusGroup}</span>
          </button>
          {pickerLevel === "primary" && (
            <div aria-label="진행 1단계 선택" className="stage-two-step-popover level-primary" role="listbox">
              <div className="stage-two-step-options">
                {primaryStageOptions.map((value) => {
                  const selected = value === customer.statusGroup;
                  return (
                    <button
                      aria-selected={selected}
                      className={selected ? "stage-two-step-option level-primary active" : "stage-two-step-option level-primary"}
                      key={value}
                      onClick={(event) => {
                        event.stopPropagation();
                        onChangePrimary(customer.no, value);
                      }}
                      role="option"
                      type="button"
                    >
                      <span>{value}</span>
                      {selected && <Check aria-hidden="true" size={13} strokeWidth={2.6} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <span aria-hidden="true" className="stage-step-connector">›</span>
        <div className="stage-control">
          <button
            aria-expanded={pickerLevel === "secondary"}
            aria-haspopup="listbox"
            aria-label={`진행 2단계 변경: ${customer.status}`}
            className={statusButtonClass(customer.status, customer.statusGroup)}
            onClick={(event) => {
              event.stopPropagation();
              onOpenPicker(customer.no, "secondary");
            }}
            onPointerDown={stopTableControlPointer}
            type="button"
          >
            <span>{customer.status}</span>
            {showNewLeadBadge && <span className="stage-new-badge">NEW</span>}
          </button>
          {pickerLevel === "secondary" && (
            <div aria-label="진행 2단계 선택" className="stage-two-step-popover level-secondary" role="listbox">
              <div className="stage-two-step-options">
                {secondaryStageOptions.map((value) => {
                  const selected = value === customer.status;
                  return (
                    <button
                      aria-selected={selected}
                      className={[statusButtonClass(value, customer.statusGroup), "stage-two-step-option level-secondary", selected ? "active" : ""].filter(Boolean).join(" ")}
                      key={value}
                      onClick={(event) => {
                        event.stopPropagation();
                        onChangeSecondary(customer.no, value);
                      }}
                      role="option"
                      type="button"
                    >
                      <span>{value}</span>
                      {selected && <Check aria-hidden="true" size={13} strokeWidth={2.6} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </td>
  );
}

export function CustomerNextActionCell({
  customer,
  editing,
  draft,
  editorRef,
  textareaRef,
  onChangeDraft,
  onEditKeyDown,
  onSave,
  onCancel,
  onClear,
  onStartEdit,
}: {
  customer: Customer;
  editing: boolean;
  draft: string;
  editorRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChangeDraft: (customerNo: number, draft: string) => void;
  onEditKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, customerNo: number) => void;
  onSave: (customerNo: number) => void;
  onCancel: () => void;
  onClear: (customerNo: number) => void;
  onStartEdit: (customer: Customer) => void;
}) {
  return (
    <td className="text-block-cell">
      {editing ? (
        <div className="next-action-editor" onClick={(event) => event.stopPropagation()} onPointerDown={stopTableControlPointer} ref={editorRef}>
          <textarea
            aria-label={`${customer.name} 상담 메모 수정`}
            autoFocus
            onChange={(event) => onChangeDraft(customer.no, event.target.value)}
            onKeyDown={(event) => onEditKeyDown(event, customer.no)}
            ref={textareaRef}
            rows={3}
            value={draft}
          />
          <span className="next-action-editor-actions">
            <button aria-label="상담 메모 저장" className="inline-edit-control save" onClick={() => onSave(customer.no)} type="button">
              <Check size={12} strokeWidth={2.8} />
            </button>
            <button aria-label="상담 메모 수정 취소" className="inline-edit-control cancel" onClick={onCancel} type="button">
              <X size={12} strokeWidth={2.8} />
            </button>
            <button aria-label="상담 메모 비우기" className="inline-edit-control reset" onClick={() => onClear(customer.no)} type="button">
              <Eraser size={11} strokeWidth={2.6} />
            </button>
          </span>
        </div>
      ) : (
        <div className="next-action-display">
          <div className="next-action-cell">{customer.nextAction}</div>
          <button
            aria-label={`${customer.name} 상담 메모 수정`}
            className="next-action-edit-pill"
            onClick={(event) => {
              event.stopPropagation();
              onStartEdit(customer);
            }}
            onPointerDown={stopTableControlPointer}
            title="상담 메모 수정"
            type="button"
          >
            <Pencil size={10} strokeWidth={2.6} />
          </button>
        </div>
      )}
    </td>
  );
}

export function CustomerChanceCell({
  customer,
  chance,
  openChanceFor,
  chancePopoverRef,
  chanceNoticeFor,
  onToggle,
  onChange,
}: {
  customer: Customer;
  chance: ChanceOption;
  openChanceFor: number | null;
  chancePopoverRef: RefObject<HTMLDivElement | null>;
  chanceNoticeFor: number | null;
  onToggle: (customerNo: number) => void;
  onChange: (customerNo: number, nextChance: ChanceOption) => void;
}) {
  return (
    <td className="chance-cell">
      <div className="chance-control" ref={openChanceFor === customer.no ? chancePopoverRef : undefined}>
        <button
          aria-expanded={openChanceFor === customer.no}
          aria-haspopup="listbox"
          aria-label={`가능성 변경: ${chance}`}
          className={chanceButtonClass(chance)}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(customer.no);
          }}
          onPointerDown={stopTableControlPointer}
          type="button"
        >
          <span>{chance}</span>
        </button>
        {chanceNoticeFor === customer.no && (
          <div className="chance-inline-notice" role="status">
            <span className="chance-inline-notice-mark" aria-hidden="true">!</span>
            <span><strong>계약완료 시</strong> 자동 확정됩니다</span>
          </div>
        )}
        {openChanceFor === customer.no && (
          <div aria-label="가능성 선택" className="chance-status-popover" role="listbox">
            {CHANCE_OPTIONS.map((value) => {
              const selectedChance = value === chance;
              return (
                <button
                  aria-selected={selectedChance}
                  className={chanceOptionClass(value, selectedChance)}
                  key={value}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(customer.no, value);
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
}

export function CustomerOperationCell({
  customer,
  showAdvisorColumn,
  roleTab,
  operationResponseValue,
  onChangeAdvisor,
}: {
  customer: Customer;
  showAdvisorColumn: boolean;
  roleTab: RoleTab;
  operationResponseValue: string;
  onChangeAdvisor: (customerNo: number) => void;
}) {
  return (
    <td className="operation-cell">
      <div className={showAdvisorColumn ? "operation-stack" : "operation-stack source-only"}>
        <div className="operation-lines">
          <div className="operation-line">
            <span className="operation-label">접수</span>
            <strong className="operation-main">
              <span className="operation-main-text">{customer.source}</span>
              <span className="operation-line-time">{receivedAtDisplay(customer.receivedAt)}</span>
            </strong>
          </div>
          {showAdvisorColumn ? (
            <div className="operation-line">
              <span className="operation-label">배정</span>
              <strong className="operation-main">
                <span className="operation-main-text">{customer.advisor}</span>
                <span className="operation-line-time">{assignedAtDisplay(customer.assignedAt)}</span>
              </strong>
            </div>
          ) : null}
          <div className="operation-line operation-response-line">
            <span className="operation-label">응답</span>
            <span className="operation-response-main">{operationResponseValue}</span>
          </div>
        </div>
        {showAdvisorColumn ? (
          <button
            aria-label={roleTab === "최고관리자" ? `${customer.name} 접수·담당 변경` : `${customer.name} 담당자 변경`}
            className="next-action-edit-pill operation-change-pill"
            onClick={(event) => {
              event.stopPropagation();
              onChangeAdvisor(customer.no);
            }}
            onPointerDown={stopTableControlPointer}
            title={roleTab === "최고관리자" ? "접수·담당 변경" : "담당자 변경"}
            type="button"
          >
            <RefreshCcw size={10} strokeWidth={2.6} />
          </button>
        ) : null}
      </div>
    </td>
  );
}

export function CustomerFinalUpdateCell({
  customer,
  openFinalUpdateFor,
  finalUpdatePopoverRef,
  updateInfo,
  updateStatus,
  onToggle,
}: {
  customer: Customer;
  openFinalUpdateFor: number | null;
  finalUpdatePopoverRef: RefObject<HTMLDivElement | null>;
  updateInfo: FinalUpdateInfo | null;
  updateStatus: FinalUpdateStatus | null;
  onToggle: (event: MouseEvent<HTMLButtonElement>, customerNo: number) => void;
}) {
  return (
    <td className="final-update-cell">
      {updateInfo && updateStatus ? (
        <div
          className={openFinalUpdateFor === customer.no ? "final-update-control pinned" : "final-update-control"}
          ref={openFinalUpdateFor === customer.no ? finalUpdatePopoverRef : undefined}
        >
          <button
            aria-expanded={openFinalUpdateFor === customer.no}
            aria-label={`최종 업데이트: ${updateStatus.label}`}
            className={`final-update-status ${updateStatus.className}`}
            onClick={(event) => onToggle(event, customer.no)}
            onPointerDown={stopTableControlPointer}
            type="button"
          >
            <span>{updateStatus.label}</span>
          </button>
          <div
            aria-hidden={openFinalUpdateFor === customer.no ? undefined : true}
            className="final-update-popover"
            role={openFinalUpdateFor === customer.no ? "status" : undefined}
          >
            <span className="final-update-popover-date">{updateInfo.label}</span>
            <span className="final-update-popover-action">{updateInfo.action}</span>
          </div>
        </div>
      ) : (
        <span className="final-update-empty" aria-label="최종 업데이트 없음" />
      )}
    </td>
  );
}

export function CustomerActionsCell({ customer, onHintHover }: { customer: Customer; onHintHover: () => void }) {
  const hint = aiHintDisplay(customer);
  return (
    <td className="actions-cell">
      <span className="row-actions" onClick={(event) => event.stopPropagation()} onPointerDown={stopTableControlPointer}>
        <span
          className="ai-hint-wrap"
          onFocus={onHintHover}
          onMouseEnter={onHintHover}
          onPointerEnter={onHintHover}
        >
          <button
            aria-label="AI 힌트"
            className="tiny-btn ai-hint-btn"
            title="AI 힌트"
            type="button"
          >
            <AiHintIcon />
          </button>
          <span className="ai-hint-tooltip">
            {hint.parts.map((part, index) => (
              part.strong ? <strong key={`${part.text}-${index}`}>{part.text}</strong> : <span key={`${part.text}-${index}`}>{part.text}</span>
            ))}
          </span>
        </span>
        <button className="tiny-btn" title="상담 열기" type="button"><MessageSquare size={15} /></button>
        <button className="tiny-btn" title="상세 문서" type="button"><FileText size={15} /></button>
      </span>
    </td>
  );
}
