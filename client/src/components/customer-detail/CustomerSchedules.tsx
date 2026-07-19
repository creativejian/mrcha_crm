import { CalendarClock, Check, Trash2 } from "lucide-react";

import { SCHEDULE_TYPE_OPTIONS } from "@/data/customers";
import { formatDateInputValue, formatScheduleDateLabel, scheduleHourOptions, scheduleMinuteOptions, parseScheduleTimeParts } from "@/lib/detail-utils";
import { scheduleRecordKey, type ScheduleItem } from "@/lib/schedule-items";

import type { useCustomerSchedules } from "./hooks/useCustomerSchedules";

type CustomerSchedulesProps = ReturnType<typeof useCustomerSchedules>;

export function CustomerSchedules({
  items,
  completedKeys,
  count,
  adding,
  editingId,
  confirming,
  refs,
  handlers,
}: CustomerSchedulesProps) {
  const { bodyRef, completeRef, deleteRef, editRef } = refs;

  function renderInlineForm(item?: ScheduleItem) {
    const isEditing = Boolean(item);
    const timeParts = parseScheduleTimeParts(item?.time);
    return (
      <form
        className="kim-schedule-composer"
        key={item ? `${item.id}-edit` : "schedule-add"}
        ref={isEditing ? editRef : undefined}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          if (isEditing) handlers.cancelEdit();
          else handlers.cancelAdd();
        }}
        onSubmit={(event) => (item ? handlers.update(event, item.id) : handlers.save(event))}
      >
        <div className="kim-schedule-composer-top">
          <div className="kim-schedule-datetime-group">
            <label className="kim-schedule-date-field">
              <input aria-label="예정 날짜" autoFocus defaultValue={item?.date ?? formatDateInputValue()} maxLength={10} name="date" placeholder="2026-07-19" type="text" />
            </label>
            <label className="kim-schedule-time-field">
              <span className="kim-schedule-time-picker">
                <select aria-label="예정 일정 시" defaultValue={timeParts.hour} name="scheduleHour">
                  {scheduleHourOptions.map((hour) => (
                    <option key={hour} value={hour}>{hour}</option>
                  ))}
                </select>
                <b aria-hidden="true">:</b>
                <select aria-label="예정 일정 분" defaultValue={timeParts.minute} name="scheduleMinute">
                  {scheduleMinuteOptions.map((minute) => (
                    <option key={minute} value={minute}>{minute}</option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          <div className="kim-check-composer-controls kim-schedule-type-controls" aria-label="예정 일정 분류">
            {SCHEDULE_TYPE_OPTIONS.map((option) => (
              <label key={option}>
                <input defaultChecked={(item?.type ?? "재연락") === option} name="type" type="radio" value={option} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="kim-check-composer-main">
          <textarea
            aria-label="예정 일정 메모"
            defaultValue={item?.memo ?? ""}
            name="memo"
            rows={2}
          />
        </div>
        <div className="kim-check-composer-actions">
          <button type="button" onClick={() => {
            if (isEditing) handlers.cancelEdit();
            else handlers.cancelAdd();
          }}>취소</button>
          <button className="primary" type="submit">저장</button>
        </div>
      </form>
    );
  }

  return (
    <article className="detail-section kim-mvp-card kim-schedule-card">
      <div className="kim-mvp-card-head">
        <div className="kim-mvp-title-row">
          <i aria-hidden="true" className="kim-mvp-title-icon"><CalendarClock size={14} strokeWidth={2.2} /></i>
          <h3>예정 일정</h3>
          <span>{count}개</span>
          <em>다시 움직일 시점</em>
        </div>
        <button
          aria-label="예정 일정 추가"
          className="kim-mvp-add-circle"
          onClick={handlers.toggleAdd}
          type="button"
        >{adding ? "×" : "+"}</button>
      </div>
      <div className="kim-mvp-card-body" ref={bodyRef}>
        <div className="kim-schedule-list">
          {items.length === 0 && !adding ? (
            <div className="kim-list-empty">예정된 일정이 없습니다.</div>
          ) : items.map((schedule, index) => {
            const isCompleted = completedKeys.includes(scheduleRecordKey(schedule));
            const isEditing = editingId === schedule.id;
            const shouldOpenScheduleCompleteAbove = !adding && index > 0 && index === items.length - 1;
            const shouldOpenScheduleDeleteAbove = !adding && index > 0 && index === items.length - 1;
            if (isEditing) return renderInlineForm(schedule);
            return (
              <div
                className={`kim-schedule-row${isCompleted ? " is-completed" : ""}`}
                key={scheduleRecordKey(schedule)}
                onClick={() => {
                  handlers.startEdit(schedule.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  handlers.startEdit(schedule.id);
                }}
                role="button"
                tabIndex={0}
              >
                <span>{formatScheduleDateLabel(schedule.date)}{schedule.time ? ` ${schedule.time}` : ""}</span>
                <div>
                  <p><strong>{schedule.type}</strong><em>·</em>{schedule.memo}</p>
                </div>
                <div className="kim-schedule-row-actions">
                  <button
                    aria-label={isCompleted ? "일정 완료 취소" : "일정 완료"}
                    aria-pressed={isCompleted}
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.requestComplete(schedule.id);
                    }}
                    type="button"
                  >
                    <Check size={13} strokeWidth={2.6} />
                  </button>
                  <button
                    aria-label="예정 일정 삭제"
                    className="delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.requestDelete(schedule.id);
                    }}
                    type="button"
                  >
                    <Trash2 size={13} strokeWidth={2.3} />
                  </button>
                </div>
                {confirming.completeId === schedule.id ? (
                  <div className={`kim-check-confirm-popover${shouldOpenScheduleCompleteAbove ? " is-above" : ""}`} ref={completeRef} role="dialog" aria-label="예정 일정 상태 변경 확인" onClick={(event) => event.stopPropagation()}>
                    <p>{isCompleted ? "완료한 일정을 되돌릴까요?" : "해당 일정을 완료 처리할까요?"}</p>
                    <div>
                      <button type="button" onClick={() => handlers.cancelComplete()}>취소</button>
                      <button className={isCompleted ? "neutral" : "primary"} type="button" onClick={() => handlers.toggleDone(schedule)}>{isCompleted ? "되돌림" : "완료"}</button>
                    </div>
                  </div>
                ) : null}
                {confirming.deleteId === schedule.id ? (
                  <div className={`kim-check-confirm-popover delete${shouldOpenScheduleDeleteAbove ? " is-above" : ""}`} ref={deleteRef} role="dialog" aria-label="예정 일정 삭제 확인" onClick={(event) => event.stopPropagation()}>
                    <p>해당 일정을 삭제하시겠습니까?</p>
                    <div>
                      <button type="button" onClick={() => handlers.cancelDelete()}>아니요</button>
                      <button className="danger" type="button" onClick={() => handlers.confirmDelete(schedule.id)}>삭제</button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {adding ? renderInlineForm() : null}
      </div>
    </article>
  );
}
