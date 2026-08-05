// 고객 관리 테이블 행의 셀 컴포넌트 모음.
// CustomerManagementPage.renderRow가 이 셀들을 조립한다.
// 셀별 props는 각 셀이 의존하는 상태/핸들러/ref와 1:1로 대응한다.
import { Check, Eraser, FileText, MessageSquare, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { CHANCE_OPTIONS, type Customer, type CustomerSettlementPatch, customerStatusGroups, type NextDeliverySchedule, SETTLEMENT_COST_KINDS, type SettlementCostKind } from "@/data/customers";
import { DateTextField } from "@/components/DateTextField";
import { aiHintDisplay, assignedAtDisplay, type ChanceOption, chanceButtonClass, chanceOptionClass, customerMeta, deliveryMethodDisplay, deliveryVehicleDisplay, extraTooltipValue, type FinalUpdateInfo, type FinalUpdateStatus, primaryStageOptions, receivedAtDisplay, secondaryStageOptionsByGroup, type StagePickerLevel, statusButtonClass, vehicleDisplay } from "@/lib/customer-table";
import { deliveryScheduleLabel } from "@/lib/delivery-console";
// 금액 칸 입력 포맷 SSOT(구매조건 초기비용과 같은 한 벌) — 숫자 외 문자를 지우고 천단위 콤마를
// 넣는다. 저장 파서(resolveSettlementSubmit·resolveSettlementCosts)가 콤마를 다시 벗기므로
// 표시와 저장이 어긋나지 않는다.
import { formatNumberWithCommas } from "@/lib/detail-utils";
import { deliveryInfoSummary, resolveSettlementSubmit, seedDeliveryInfoDraft, unconfirmedDeliveryDays, type DeliveryInfoDraft, type SeedableDeliveryField } from "@/lib/delivery-info";
import { fetchCustomerSettlement, requestCustomerSettlement } from "@/lib/customer-children";
import { formatSettlementMargin, resolveSettlementCosts, type SettlementCostDraft } from "@/lib/settlement";
import { bindSelect } from "@/lib/select-bind";
import { SOLUTION_LENDERS } from "@/lib/solution-quote";
import { useFixedPopoverPosition } from "@/lib/use-fixed-popover-position";

// 행 팝오버 fixed 배치 훅은 lib/use-fixed-popover-position으로 추출(0726 — 드로어 "해야 할 일"
// 확인 팝오버도 같은 클리핑을 밟아 소비처가 이 파일 밖으로 늘었다). 계약·주의사항은 그쪽 주석 참조.

// 진행 상태 1차/2차 팝오버 껍데기 — 레벨 전환은 서로 다른 .stage-control 서브트리라 재마운트되고,
// 마운트마다 자기 앵커를 새로 측정한다(레벨 전환 앵커 재계산은 이 리마운트가 담당).
function StageOptionsPopover({ ariaLabel, level, children }: { ariaLabel: string; level: StagePickerLevel; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pos = useFixedPopoverPosition(rootRef, ".stage-control");
  return (
    <div
      aria-label={ariaLabel}
      className={`stage-two-step-popover level-${level}`}
      ref={rootRef}
      role="listbox"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      <div className="stage-two-step-options">{children}</div>
    </div>
  );
}

function ChanceOptionsPopover({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pos = useFixedPopoverPosition(rootRef, ".chance-control");
  return (
    <div
      aria-label="가능성 선택"
      className="chance-status-popover"
      ref={rootRef}
      role="listbox"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      {children}
    </div>
  );
}

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

export function CustomerInfoCell({ customer, withdrawalPending = false }: { customer: Customer; withdrawalPending?: boolean }) {
  return (
    <td>
      <strong className="customer-name">
        {customer.name}
        {/* 회원탈퇴 접수 배지(2026-08-01 spec §4-1) — 행 비활성 톤과 한 쌍. 데이터는 탈퇴 인지 큐. */}
        {withdrawalPending ? <span className="withdrawal-badge">탈퇴 접수</span> : null}
        <span className="customer-code num">{customer.customerId}</span>
      </strong>
      <span className="customer-meta">{customerMeta(customer)}</span>
      {/* 추가 연락처 병기(2026-07-17 결정 — 목록에도 노출). 주 번호 = 서버 합성(앱 연결이면 앱 번호).
          값 있는 항목만 잇는다 — 주 번호 공란+추가만 있으면 선행 " · " 없이(배치 8 C#9). */}
      <span className="customer-phone num">{[customer.phone, customer.phoneSecondary].filter(Boolean).join(" · ")}</span>
    </td>
  );
}

export function CustomerVehicleCell({
  customer,
  openExtraFor,
  onToggleExtra,
  extraPopoverRef,
  contractContext = false,
}: {
  customer: Customer;
  openExtraFor: string | null;
  onToggleExtra: (event: MouseEvent<HTMLButtonElement>, extraId: string) => void;
  extraPopoverRef: RefObject<HTMLButtonElement | null>;
  /** 계약 맥락(contract·delivery mode) 표시로 전환 — 출고 2단계 spec §5.2 확장(2026-07-24).
   * 차량·구매방식 모두 **계약 근거만** 쓴다(deliveryVehicleDisplay·deliveryMethodDisplay) — 니즈는
   * 최초 승격 시드라 계약 실무 화면에선 노이즈이고, 보이면 상담사가 진짜 계약 차량을 안 채운다.
   * 없으면 "미입력"으로 두어 입력을 유도한다(출고 정보의 `+ 미지정` 패턴과 같은 결).
   * 비교 차종(+N pill)은 미표시 — 계약 확정 맥락이라 "고민 중" 어휘가 오도한다.
   * 트림은 **별도 줄**로 그린다(2026-07-24) — 전체보기와 같은 3줄 구조(차종/트림/구매방식). 구 주석의
   * "트림은 차량 라벨에 포함"은 폐기: 한 줄로 합치면 "제네시스 G80 26년형 가솔린 터보 2.5 - 2WD"처럼
   * 길어 잘렸는데, 정작 견적에는 브랜드·모델·트림이 이미 나뉘어 있었다. */
  contractContext?: boolean;
}) {
  const vehicle = vehicleDisplay(customer);
  if (contractContext) {
    const contractVehicle = deliveryVehicleDisplay(customer);
    const contractMethod = deliveryMethodDisplay(customer);
    return (
      <td>
        <strong className="vehicle-title">
          {contractVehicle ? (
            <span className="vehicle-line-text" title={contractVehicle.title}>{contractVehicle.title}</span>
          ) : (
            <span className="vehicle-line-text vehicle-line-empty">차량 미입력</span>
          )}
        </strong>
        {/* 트림 줄 — 전체보기와 같은 클래스를 쓴다(차종 굵게 / 트림·구매방식 회색 3줄).
            견적이 브랜드·모델·트림을 나눠 갖고 있을 때만 생긴다(deliveryVehicleDisplay 참조). */}
        {contractVehicle?.trim ? <span className="vehicle-trim" title={contractVehicle.trim}>{contractVehicle.trim}</span> : null}
        {contractMethod ? <span className="vehicle-method"><span className="vehicle-line-text">{contractMethod}</span></span> : null}
      </td>
    );
  }
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
  secondaryOnly = false,
  stagePickerRef,
  onOpenPicker,
  onChangePrimary,
  onChangeSecondary,
}: {
  customer: Customer;
  pickerLevel: StagePickerLevel | null;
  // true면 1차 컨트롤+커넥터를 렌더하지 않는다(출고 콘솔 — statusGroup이 이미 "계약완료"로 고정된
  // 큐라 1차 전이는 무의미. 2차 블록은 무수정 재사용, 옵션은 statusGroup 종속이라 자동으로 계약완료 5종).
  secondaryOnly?: boolean;
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
        {!secondaryOnly && (
          <>
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
                <StageOptionsPopover ariaLabel="진행 1단계 선택" level="primary">
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
                </StageOptionsPopover>
              )}
            </div>
            <span aria-hidden="true" className="stage-step-connector">›</span>
          </>
        )}
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
            <StageOptionsPopover ariaLabel="진행 2단계 선택" level="secondary">
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
            </StageOptionsPopover>
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
          <ChanceOptionsPopover>
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
          </ChanceOptionsPopover>
        )}
      </div>
    </td>
  );
}

export function CustomerOperationCell({
  customer,
  showAdvisorColumn,
  operationResponseValue,
}: {
  customer: Customer;
  showAdvisorColumn: boolean;
  operationResponseValue: string;
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
      </div>
    </td>
  );
}

export function CustomerFinalUpdateCell({
  customer,
  openFinalUpdateFor,
  finalUpdatePopoverRef,
  displayInfo,
  updateStatus,
  onToggle,
}: {
  customer: Customer;
  openFinalUpdateFor: number | null;
  finalUpdatePopoverRef: RefObject<HTMLDivElement | null>;
  displayInfo: FinalUpdateInfo | null;
  updateStatus: FinalUpdateStatus | null;
  onToggle: (event: MouseEvent<HTMLButtonElement>, customerNo: number) => void;
}) {
  // displayInfo = resolveUpdateBadge 합성값(파생 info, 없으면 수동 지정 시각 폴백 — 배치 5 3-C).
  // 신규·상담접수 + 유효 수동도 배지 표시(배치 4 B2 기각 번복 2026-07-14) — 합성 규칙은 lib이 소유.
  return (
    <td className="final-update-cell">
      {displayInfo && updateStatus ? (
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
            <span className="final-update-popover-date">{displayInfo.label}</span>
            <span className="final-update-popover-action">{displayInfo.action}</span>
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
        {hint.parts.length > 0 && (
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
        )}
        <button className="tiny-btn" title="상담 열기" type="button"><MessageSquare size={15} /></button>
        <button className="tiny-btn" title="상세 문서" type="button"><FileText size={15} /></button>
      </span>
    </td>
  );
}

export function CustomerDeliveryScheduleCell({
  customer,
  notice,
  open,
  popoverRef,
  saving,
  onDelete,
  onSave,
  onToggle,
}: {
  customer: Customer;
  notice: string | null;
  open: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  saving: boolean;
  onDelete: () => void;
  onSave: (draft: { date: string; time: string }) => void;
  onToggle: () => void;
}) {
  const schedule = customer.nextDeliverySchedule ?? null;
  const label = deliveryScheduleLabel(schedule, new Date());
  return (
    <td className="delivery-schedule-cell">
      <div className="delivery-schedule-wrap" ref={open ? popoverRef : undefined}>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={label ? `출고 예정 ${label.text}: ${customer.name}` : `출고 예정 입력: ${customer.name}`}
          className={["delivery-schedule-btn", label ? "" : "delivery-schedule-empty", label?.overdue ? "overdue" : ""].filter(Boolean).join(" ")}
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
          onPointerDown={stopTableControlPointer}
          type="button"
        >
          <span>{label ? label.text : "+ 미지정"}</span>
          {label?.overdue && <span className="delivery-overdue-badge">지남</span>}
        </button>
        {open && (
          <DeliverySchedulePopover key={schedule?.id ?? "new"} initial={schedule} notice={notice} saving={saving} onDelete={onDelete} onSave={onSave} />
        )}
      </div>
    </td>
  );
}

// 팝오버 본문 — key(schedule id)로 리마운트해 draft를 대표 일정 값으로 재시드.
// 날짜/시간은 text input(네이티브 date/time은 로케일 종속 표시 포맷이라 영어 환경에서 MM/DD/YYYY로 뜸 —
// 2026-07-19 유슨생 지시로 텍스트+유연 정규화(resolveDeliveryScheduleSubmit → datetime-text.ts)로 전환,
// 이후 T12로 DateTextField SSOT(달력 버튼 하이브리드)에 통합). 시간은 텍스트 유지(별도 픽커 없음).
// select가 아니므로 Safari onInput 병행 바인딩 함정과도 무관.
// position:fixed 배치(T13) — 콘솔 래퍼(.console-table-scroll) overflow:hidden 클리핑을 마지막 행에서
// 절단하던 실기 결함 대응. 앵커(.delivery-schedule-wrap)의 뷰포트 rect 기준으로 좌표를 직접 계산해
// 인라인 style에 싣는다(fixed는 조상 overflow의 영향을 받지 않음 — 스태킹은 tr:has 승격 룰이 계속 담당).
function DeliverySchedulePopover({ initial, notice, saving, onDelete, onSave }: {
  initial: NextDeliverySchedule | null;
  notice: string | null;
  saving: boolean;
  onDelete: () => void;
  onSave: (draft: { date: string; time: string }) => void;
}) {
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time?.slice(0, 5) ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  // notice 등장/소멸·**문구 교체**로 박스 높이가 바뀔 수 있어 heightDep로 재계산(날짜/시간 타이핑은
  // 높이 무관 — 제외). ⚠️Boolean()으로 감싸면 안 된다 — 검증 오류가 연속으로 나면 saveDeliverySchedule의
  // invalid 분기가 notice를 null 경유 없이 곧바로 교체해서, true→true가 되어 줄 수가 바뀌어도 재계산이 없다.
  const pos = useFixedPopoverPosition(rootRef, ".delivery-schedule-wrap", notice);

  return (
    <div
      aria-label="출고 예정 편집"
      className="delivery-schedule-popover"
      onClick={(event) => event.stopPropagation()}
      // Enter만 차단 — 출고 정보 팝오버(배치 11 B#1)와 동일 사유·동일 스코프(Escape는 통과).
      onKeyDown={(event) => { if (event.key === "Enter") event.stopPropagation(); }}
      ref={rootRef}
      role="dialog"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      <label><span>날짜</span><DateTextField onValueChange={setDate} value={date} /></label>
      <label><span>시간</span><input maxLength={5} onChange={(event) => setTime(event.target.value)} placeholder="14:00 (선택)" type="text" value={time} /></label>
      {notice && <p className="delivery-schedule-notice" role="alert">{notice}</p>}
      <div className="delivery-schedule-actions">
        {initial && <button className="danger" disabled={saving} onClick={onDelete} type="button">삭제</button>}
        <button disabled={saving} onClick={() => onSave({ date, time })} type="button">{saving ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

// 출고 정보 셀(출고 2단계 spec §5.1·§5.3) — 요약 줄 버튼 + 폼형 팝오버(soft pipe 프리필).
export function CustomerDeliveryInfoCell({
  canEditSettlement = false,
  customer,
  notice,
  open,
  popoverRef,
  saving,
  onSave,
  onToggle,
}: {
  /** 정산(입금일·실입금액) 섹션 노출 — admin만. **서버가 진짜 게이트**이고 이건 UI 보조다. */
  canEditSettlement?: boolean;
  customer: Customer;
  notice: string | null;
  open: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  saving: boolean;
  onSave: (draft: DeliveryInfoDraft, settlement: CustomerSettlementPatch | null) => void;
  onToggle: () => void;
}) {
  const summary = deliveryInfoSummary(customer.delivery);
  // 인도됐는데 계약 확정이 안 된 건 — 취소·지연이 생기는 유일한 구간이라 상담사가 챙겨야 한다
  // (2026-08-03 이사님: 1일 초과부터). 확정이 밀리면 실적 인식도 그만큼 밀린다.
  const unconfirmedDays = unconfirmedDeliveryDays(customer.delivery);
  return (
    <td className="delivery-info-cell">
      <div className="delivery-info-wrap" ref={open ? popoverRef : undefined}>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={summary ? `출고 정보: ${customer.name}` : `출고 정보 입력: ${customer.name}`}
          className={summary ? "delivery-info-btn" : "delivery-info-btn delivery-info-btn-empty"}
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
          onPointerDown={stopTableControlPointer}
          type="button"
        >
          {summary ? (
            <span className="delivery-info-lines">
              {summary.contractLine && <span>{summary.contractLine}</span>}
              {summary.deliveredLine && (
                <span>
                  {summary.deliveredLine}
                  {unconfirmedDays != null && <em className="delivery-unconfirmed">미확정 {unconfirmedDays}일</em>}
                </span>
              )}
              {summary.fallback && <span>{summary.fallback}</span>}
            </span>
          ) : (
            <span>+ 미입력</span>
          )}
        </button>
        {open && (
          <DeliveryInfoPopover
            canEditSettlement={canEditSettlement}
            customerId={customer.id ?? null}
            customerName={customer.name}
            draft={seedDeliveryInfoDraft(customer.delivery ?? null, customer.contractingQuote ?? null)}
            notice={notice}
            saving={saving}
            onCancel={onToggle}
            onSave={onSave}
          />
        )}
      </div>
    </td>
  );
}

// 출고 정보 팝오버 — 폼형(명시 저장·취소: 담당자 변경/고객 등록 관례. 출고 예정의 무취소·경량형과 다른 분류
// — spec §5.3·B#10 각주). fixed 배치·notice 높이 재계산·스크롤 닫기는 출고 예정 팝오버(T13)와 동일 기계장치.
// 팝오버는 열릴 때 마운트되므로 useState(draft) 초기값이 곧 시드 — 재오픈마다 새로 시드된다.
function DeliveryInfoPopover({ canEditSettlement, customerId, customerName, draft: initialDraft, notice, saving, onCancel, onSave }: {
  canEditSettlement: boolean;
  customerId: string | null;
  customerName: string;
  draft: DeliveryInfoDraft;
  notice: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: DeliveryInfoDraft, settlement: CustomerSettlementPatch | null) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  // 정산은 목록 응답에 없다(admin 전용 라우트로만 나간다) — 팝오버가 열릴 때 따로 조회한다.
  // 입금액은 문자열로 들고 있다가 저장 때 파싱한다(입력 중 콤마·빈 칸을 그대로 두기 위해).
  const [settledAt, setSettledAt] = useState("");
  const [feeText, setFeeText] = useState("");
  // 비용 행은 **금액을 문자열로** 들고 있다가 저장 때 한 번 파싱한다(입력 중 콤마·빈 칸 허용).
  const [costs, setCosts] = useState<SettlementCostDraft[]>([]);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  // 담당자 정산 요청 결과 — 상태를 미리 조회하지 않는다(담당자는 정산을 읽을 수 없다).
  // 버튼은 항상 눌리고 **서버가 판단**한다: 이미 요청/완료면 409 문구가 그대로 여기에 담긴다.
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  useEffect(() => {
    if (!canEditSettlement || !customerId) return;
    let cancelled = false;
    fetchCustomerSettlement(customerId)
      .then((s) => {
        if (cancelled) return;
        setSettledAt(s.settledAt ?? "");
        // 불러올 때도 같은 포맷으로 — 저장된 값만 콤마가 없으면 방금 입력한 값과 표기가 어긋난다.
        setFeeText(s.feeAmount == null ? "" : formatNumberWithCommas(String(s.feeAmount)));
        setCosts((s.costs ?? []).map((c) => ({ kind: c.kind, label: c.label, amountText: formatNumberWithCommas(String(c.amount)) })));
      })
      .catch(() => {
        if (!cancelled) setSettlementError("정산 정보를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [canEditSettlement, customerId]);
  const rootRef = useRef<HTMLDivElement>(null);
  // heightDep에 notice 문자열 자체를 넘긴다(Boolean 금지 — 위 DeliverySchedulePopover와 같은 사유).
  const pos = useFixedPopoverPosition(rootRef, ".delivery-info-wrap", notice);
  // 사용자가 고친 칸은 더 이상 "견적에서 가져온" 값이 아니므로 힌트를 뗀다(남으면 거짓 표시).
  const set = (patch: Partial<DeliveryInfoDraft>) =>
    setDraft((d) => ({ ...d, ...patch, seededFields: d.seededFields.filter((f) => !(f in patch)) }));
  // 프리필 힌트 — 저장값이 없어 견적으로 채운 칸에만 붙는다(soft pipe 규칙의 가시화, spec §5.3).
  // ⚠️ aria-hidden 필수: 라벨 안에 있어서 그냥 두면 접근성 이름이 "계약 차량견적에서 가져옴"이 되고,
  // 라벨로 요소를 찾는 코드·테스트가 전부 깨진다(getByLabelText 정확 일치 — 실제로 잡혔다).
  // 값 자체는 input에서 읽히므로 보조 표시를 빼도 정보 손실이 아니다.
  const seedHint = (field: SeedableDeliveryField) =>
    draft.seededFields.includes(field) ? (
      <em aria-hidden="true" className="delivery-seed-hint">견적에서 가져옴</em>
    ) : null;
  return (
    <div
      aria-label="출고 정보 편집"
      className="delivery-info-popover"
      onClick={(event) => event.stopPropagation()}
      // Enter만 차단(배치 11 B#1) — 입력 필드의 Enter keydown이 행까지 버블되면 openCustomerByKeyboard가
      // 드로어를 팝오버 위로 연다. 무차별 stopPropagation은 dismiss 훅의 Escape 닫기(document 버블
      // 리스너)를 죽이는 회귀(적대 검증 V2)라 금지.
      onKeyDown={(event) => { if (event.key === "Enter") event.stopPropagation(); }}
      ref={rootRef}
      role="dialog"
      // 내용이 가변이라(비용 행을 계속 추가할 수 있다) 위아래 어디에도 안 들어가는 길이가 될 수
      // 있다 — 그때 배치 훅은 아래로 붙이고, maxHeight가 없으면 넘친 부분이 조용히 잘린다
      // (2026-08-05 실화면: "실입금액" 아래가 통째로 안 보였다). 남는 공간만큼으로 제한하고 스크롤.
      style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { visibility: "hidden" }}
    >
      {/* 폼형 관례(담당자 변경·고객 삭제·고객 등록 전부 가시 타이틀) + fixed 분리 대비 고객명 병기(배치 11 C#1·spec §6) */}
      <strong className="delivery-info-title">출고 정보 — {customerName}</strong>
      <label><span>계약 차량{seedHint("contractVehicle")}</span><input onChange={(e) => set({ contractVehicle: e.target.value })} type="text" value={draft.contractVehicle} /></label>
      <label><span>계약일</span><DateTextField onValueChange={(v) => set({ contractDate: v })} value={draft.contractDate} /></label>
      <label>
        <span>금융사{seedHint("lender")}</span>
        <input list="delivery-lender-options" onChange={(e) => set({ lender: e.target.value })} type="text" value={draft.lender} />
        <datalist id="delivery-lender-options">{SOLUTION_LENDERS.map((l) => <option key={l.code} value={l.label} />)}</datalist>
      </label>
      <label><span>출고 실측일</span><DateTextField onValueChange={(v) => set({ deliveredDate: v })} value={draft.deliveredDate} /></label>
      {/* 계약 확정일 = **실적 귀속 기준**(2026-08-03 이사님). 인도 후 URL 인증까지 끝난 날이고,
          월을 넘기면 확정된 달의 실적이다. 위 실측일과 나란히 두되 라벨을 구분한다 — 현장에서는
          둘 다 "출고"라 부르지만 여기서는 어느 칸에 뭘 넣을지 명확해야 한다. */}
      <label><span>계약 확정일</span><DateTextField onValueChange={(v) => set({ contractConfirmedDate: v })} value={draft.contractConfirmedDate} /></label>
      <label><span>탁송/정비 메모</span><textarea onChange={(e) => set({ deliveryMemo: e.target.value })} rows={3} value={draft.deliveryMemo} /></label>
      {/* 정산 — admin에게만 렌더된다. 서버가 진짜 게이트이고(requireRoles) 이건 UI 보조다. */}
      {canEditSettlement && (
        <div className="delivery-settlement">
          <strong className="delivery-settlement-title">정산 <span className="badge">관리자</span></strong>
          <label><span>입금일</span><DateTextField onValueChange={setSettledAt} value={settledAt} /></label>
          <label>
            <span>실입금액</span>
            <span className="delivery-fee-input">
              <input inputMode="numeric" onChange={(e) => setFeeText(formatNumberWithCommas(e.target.value))} type="text" value={feeText} />
              <em>원</em>
            </span>
          </label>
          {/* 비용 항목(2026-08-04 이사님 확정 5종) — 마진은 저장하지 않고 여기서 파생 표시한다. */}
          <div className="settlement-costs">
            <span className="settlement-costs-label">비용</span>
            {costs.map((c, i) => (
              <div className="settlement-cost-row" key={i}>
                {/* controlled select — Safari onInput 병행 바인딩 규칙(bindSelect). */}
                <select
                  aria-label={`비용 ${i + 1} 종류`}
                  {...bindSelect(c.kind, (v) =>
                    setCosts((rows) => rows.map((r, j) => (j === i ? { ...r, kind: v as SettlementCostKind } : r))),
                  )}
                >
                  {SETTLEMENT_COST_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                {/* 직접입력에만 항목명 칸이 열린다 — 고정 항목에 이름을 붙이면 집계 키가 갈린다. */}
                {c.kind === "직접입력" && (
                  <input
                    aria-label={`비용 ${i + 1} 항목명`}
                    onChange={(e) => setCosts((rows) => rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                    placeholder="항목명"
                    type="text"
                    value={c.label ?? ""}
                  />
                )}
                <input
                  aria-label={`비용 ${i + 1} 금액`}
                  inputMode="numeric"
                  onChange={(e) => setCosts((rows) => rows.map((r, j) => (j === i ? { ...r, amountText: formatNumberWithCommas(e.target.value) } : r)))}
                  type="text"
                  value={c.amountText}
                />
                <button aria-label={`비용 ${i + 1} 삭제`} onClick={() => setCosts((rows) => rows.filter((_, j) => j !== i))} type="button">✕</button>
              </div>
            ))}
            <button
              className="settlement-cost-add"
              onClick={() => setCosts((rows) => [...rows, { kind: SETTLEMENT_COST_KINDS[0], label: null, amountText: "" }])}
              type="button"
            >
              + 비용 추가
            </button>
            {/* 마진 = 실입금액 − 비용합(파생·미저장). 실입금액이 비면 "—"로 둔다 — 0원과 "모른다"는 다르다. */}
            <p className="settlement-margin">
              마진 <strong>{formatSettlementMargin(feeText, costs)}</strong>
            </p>
          </div>
          {settlementError && <p className="delivery-schedule-notice" role="alert">{settlementError}</p>}
        </div>
      )}
      {/* 담당자 정산 요청(2026-08-04 이사님 확정) — **admin이 아니어도 보인다**. 정산 금액은 계속
          안 보이고, 이 버튼이 하는 일은 미정산 → 정산요청 전이 하나뿐이다. 상태를 미리 조회하지
          않으므로(담당자는 정산을 읽을 수 없다) 항상 눌리고 결과는 서버가 알려준다. */}
      {customerId && (
        <div className="settlement-request">
          <button
            disabled={requesting || saving}
            onClick={() => {
              setRequesting(true);
              setRequestNotice(null);
              requestCustomerSettlement(customerId)
                .then(() => setRequestNotice("정산을 요청했습니다."))
                .catch((e: unknown) => setRequestNotice(e instanceof Error ? e.message : "정산 요청에 실패했습니다."))
                .finally(() => setRequesting(false));
            }}
            type="button"
          >
            {requesting ? "요청 중…" : "정산 요청"}
          </button>
          {requestNotice && <p className="delivery-schedule-notice" role="status">{requestNotice}</p>}
        </div>
      )}
      {notice && <p className="delivery-schedule-notice" role="alert">{notice}</p>}
      <div className="delivery-schedule-actions">
        <button disabled={saving} onClick={onCancel} type="button">취소</button>
        <button
          disabled={saving}
          onClick={() => {
            if (!canEditSettlement) return onSave(draft, null);
            const submit = resolveSettlementSubmit(settledAt, feeText);
            if (submit.kind === "invalid") return setSettlementError(submit.reason);
            // 비용도 같은 저장에 실어 보낸다 — 따로 호출하면 한쪽만 성공하는 창이 생긴다.
            const resolvedCosts = resolveSettlementCosts(costs);
            if (resolvedCosts.kind === "invalid") return setSettlementError(resolvedCosts.reason);
            setSettlementError(null);
            onSave(draft, { ...submit.body, costs: resolvedCosts.costs });
          }}
          type="button"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
