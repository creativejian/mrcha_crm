// 고객 관리 테이블 행의 셀 컴포넌트 모음.
// CustomerManagementPage.renderRow가 이 셀들을 조립한다.
// 셀별 props는 각 셀이 의존하는 상태/핸들러/ref와 1:1로 대응한다.
import { Check, Eraser, FileText, MessageSquare, Pencil, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { CHANCE_OPTIONS, type Customer, customerStatusGroups, type NextDeliverySchedule } from "@/data/customers";
import { DateTextField } from "@/components/DateTextField";
import { aiHintDisplay, assignedAtDisplay, type ChanceOption, chanceButtonClass, chanceOptionClass, customerMeta, deliveryVehicleDisplay, extraTooltipValue, type FinalUpdateInfo, type FinalUpdateStatus, primaryStageOptions, receivedAtDisplay, secondaryStageOptionsByGroup, type StagePickerLevel, statusButtonClass, vehicleDisplay } from "@/lib/customer-table";
import { deliveryScheduleLabel } from "@/lib/delivery-console";
import { deliveryInfoSummary, seedDeliveryInfoDraft, type DeliveryInfoDraft } from "@/lib/delivery-info";
import { SOLUTION_LENDERS } from "@/lib/solution-quote";
import { resolveFixedPopoverPosition } from "@/lib/popover-position";

// 행 팝오버 fixed 배치 공유 훅(2026-07-19 클리핑 확산 픽스) — 콘솔 래퍼
// `.console-table-scroll{overflow:hidden}`(콘솔 서피스 SSOT·불가침)이 absolute 팝오버를 마지막 행에서
// 절단하던 결함의 탈출 경로. 팝오버 루트에서 closest(anchorSelector)로 앵커를 찾아 뷰포트 rect 기준
// 좌표를 계산한다(useLayoutEffect = paint 전 1회 — pos 미확정 구간은 호출부가 visibility:hidden 방어).
// fixed는 스크롤·리사이즈를 따라가지 않으므로 열림 상태의 닫기는 페이지 effect가 담당한다.
// heightDep: 마운트 후 팝오버 높이를 바꾸는 상태(notice 등)가 있으면 넘겨 재계산한다.
// ⚠️계약(배치 10 B#8): anchorSelector가 조상에서 안 잡히면 pos가 영구 null = 팝오버가 **무경고로
// 영구 hidden**(fail-silent — "버튼 눌러도 아무 일 없음"으로 보인다). 재사용 시 팝오버를 반드시
// 앵커 요소의 서브트리 안에 렌더하고, 셀렉터 오타를 의심할 것(현 3소비처는 전부 앵커 내부라 안전).
function useFixedPopoverPosition(rootRef: RefObject<HTMLElement | null>, anchorSelector: string, heightDep?: unknown) {
  const [pos, setPos] = useState<ReturnType<typeof resolveFixedPopoverPosition> | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    const anchorEl = el?.closest(anchorSelector);
    if (!el || !anchorEl) return;
    const anchor = anchorEl.getBoundingClientRect();
    setPos(resolveFixedPopoverPosition(
      { top: anchor.top, bottom: anchor.bottom, left: anchor.left },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, [rootRef, anchorSelector, heightDep]);
  return pos;
}

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

export function CustomerInfoCell({ customer }: { customer: Customer }) {
  return (
    <td>
      <strong className="customer-name">{customer.name}<span className="customer-code num">{customer.customerId}</span></strong>
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
  deliveryMode = false,
}: {
  customer: Customer;
  openExtraFor: string | null;
  onToggleExtra: (event: MouseEvent<HTMLButtonElement>, extraId: string) => void;
  extraPopoverRef: RefObject<HTMLButtonElement | null>;
  /** delivery mode 한정(출고 2단계 spec §5.2): 계약 맥락 표시로 전환.
   * 계약 차량 저장값 → 계약 진행 견적 → 니즈 3단 폴백(deliveryVehicleDisplay)이고, 니즈로 내려가면
   * "관심" 라벨로 구분한다 — 니즈는 최초 승격 때 박힌 관심 차종이라 계약 차량으로 오독되면 안 된다.
   * 비교 차종(+N pill)·트림 줄은 미표시 — 계약 확정 맥락이라 "고민 중" 어휘가 오도. 구매방식 줄은 니즈 파생 유지. */
  deliveryMode?: boolean;
}) {
  const vehicle = vehicleDisplay(customer);
  if (deliveryMode) {
    const dv = deliveryVehicleDisplay(customer);
    const title = dv.kind === "needs" ? (dv.label ? `관심 차종(계약 차량 미입력) — ${dv.label}` : undefined) : (dv.label ?? undefined);
    return (
      <td>
        <strong className="vehicle-title">
          {dv.label ? (
            <span className="vehicle-line-text" title={title}>
              {dv.kind === "needs" ? <em className="vehicle-needs-tag">관심</em> : null}
              {dv.label}
            </span>
          ) : (
            <span className="vehicle-line-text vehicle-line-empty">차량 미입력</span>
          )}
        </strong>
        <span className="vehicle-method"><span className="vehicle-line-text">{vehicle.method}</span></span>
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
  // notice 등장/소멸로 박스 높이가 바뀔 수 있어 heightDep로 재계산(날짜/시간 타이핑은 높이 무관 — 제외).
  const pos = useFixedPopoverPosition(rootRef, ".delivery-schedule-wrap", Boolean(notice));

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
  customer,
  notice,
  open,
  popoverRef,
  saving,
  onSave,
  onToggle,
}: {
  customer: Customer;
  notice: string | null;
  open: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  saving: boolean;
  onSave: (draft: DeliveryInfoDraft) => void;
  onToggle: () => void;
}) {
  const summary = deliveryInfoSummary(customer.delivery);
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
              {summary.deliveredLine && <span>{summary.deliveredLine}</span>}
              {summary.fallback && <span>{summary.fallback}</span>}
            </span>
          ) : (
            <span>+ 미입력</span>
          )}
        </button>
        {open && (
          <DeliveryInfoPopover
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
function DeliveryInfoPopover({ customerName, draft: initialDraft, notice, saving, onCancel, onSave }: {
  customerName: string;
  draft: DeliveryInfoDraft;
  notice: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: DeliveryInfoDraft) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const rootRef = useRef<HTMLDivElement>(null);
  const pos = useFixedPopoverPosition(rootRef, ".delivery-info-wrap", Boolean(notice));
  const set = (patch: Partial<DeliveryInfoDraft>) => setDraft((d) => ({ ...d, ...patch }));
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
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      {/* 폼형 관례(담당자 변경·고객 삭제·고객 등록 전부 가시 타이틀) + fixed 분리 대비 고객명 병기(배치 11 C#1·spec §6) */}
      <strong className="delivery-info-title">출고 정보 — {customerName}</strong>
      <label><span>계약 차량</span><input onChange={(e) => set({ contractVehicle: e.target.value })} type="text" value={draft.contractVehicle} /></label>
      <label><span>계약일</span><DateTextField onValueChange={(v) => set({ contractDate: v })} value={draft.contractDate} /></label>
      <label>
        <span>금융사</span>
        <input list="delivery-lender-options" onChange={(e) => set({ lender: e.target.value })} type="text" value={draft.lender} />
        <datalist id="delivery-lender-options">{SOLUTION_LENDERS.map((l) => <option key={l.code} value={l.label} />)}</datalist>
      </label>
      <label><span>출고 실측일</span><DateTextField onValueChange={(v) => set({ deliveredDate: v })} value={draft.deliveredDate} /></label>
      <label><span>탁송/정비 메모</span><textarea onChange={(e) => set({ deliveryMemo: e.target.value })} rows={3} value={draft.deliveryMemo} /></label>
      {notice && <p className="delivery-schedule-notice" role="alert">{notice}</p>}
      <div className="delivery-schedule-actions">
        <button disabled={saving} onClick={onCancel} type="button">취소</button>
        <button disabled={saving} onClick={() => onSave(draft)} type="button">{saving ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}
