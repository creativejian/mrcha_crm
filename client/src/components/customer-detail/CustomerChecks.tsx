import { Check, Trash2 } from "lucide-react";

import { TASK_CATEGORY_OPTIONS } from "@/data/customers";
import { checkDueOptions, parseCheckDueDate } from "@/lib/detail-utils";
import { type CheckItem } from "@/lib/schedule-items";

import type { useCustomerChecks } from "./hooks/useCustomerChecks";

type CustomerChecksProps = ReturnType<typeof useCustomerChecks>;

export function CustomerChecks({
  items,
  completedIds,
  remainingCount,
  adding,
  editingId,
  selectedDue,
  selectedEditingDue,
  confirming,
  refs,
  handlers,
}: CustomerChecksProps) {
  const { bodyRef, confirmRef, deleteRef, editRef } = refs;

  function renderEditForm(item: CheckItem) {
    return (
      <form
        className="kim-check-edit-row"
        key={`${item.id}-edit`}
        ref={editRef}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          handlers.cancelEdit();
        }}
        onSubmit={(event) => handlers.update(event, item.id, item.due)}
      >
        <div className="kim-check-composer-pickers">
          <div className="kim-check-due-stack">
            <div className="kim-check-composer-controls due" aria-label="해야 할 일 마감 수정">
              {checkDueOptions.map((option) => (
                <label key={option}>
                  <input checked={selectedEditingDue === option} name="due" onChange={() => handlers.setEditingDue(option)} type="radio" value={option} />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {selectedEditingDue === "지정" ? (
              <label className="kim-check-date-field compact">
                <span>마감 날짜</span>
                <input defaultValue={parseCheckDueDate(item.due)} name="dueDate" type="date" />
              </label>
            ) : null}
          </div>
          <div className="kim-check-composer-controls" aria-label="해야 할 일 분류 수정">
            {TASK_CATEGORY_OPTIONS.map((option) => (
              <label key={option}>
                <input defaultChecked={item.category === option} name="category" type="radio" value={option} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="kim-check-composer-main">
          <textarea
            aria-label="해야 할 일 내용 수정"
            autoFocus
            defaultValue={item.body}
            name="body"
            onFocus={(event) => {
              const target = event.currentTarget;
              window.requestAnimationFrame(() => {
                target.setSelectionRange(target.value.length, target.value.length);
              });
            }}
            rows={2}
          />
        </div>
        <div className="kim-check-composer-actions">
          <button type="button" onClick={handlers.cancelEdit}>취소</button>
          <button className="primary" type="submit">저장</button>
        </div>
      </form>
    );
  }

  return (
    <article className="detail-section kim-mvp-card kim-check-card">
      <div className="kim-mvp-card-head">
        <div className="kim-mvp-title-row">
          <i aria-hidden="true" className="kim-mvp-title-icon"><Check size={14} strokeWidth={2.2} /></i>
          <h3>해야 할 일</h3>
          <span>{remainingCount}개</span>
          <em>상담사가 처리할 업무</em>
        </div>
        <button
          aria-label="해야 할 일 추가"
          className="kim-mvp-add-circle"
          onClick={handlers.toggleAdd}
          type="button"
        >{adding ? "×" : "+"}</button>
      </div>
      <div className="kim-mvp-card-body" ref={bodyRef}>
        <div className="kim-check-list">
          {items.length === 0 && !adding ? (
            <div className="kim-list-empty">등록된 할 일이 없습니다.</div>
          ) : items.map((item, index) => {
            const isCompleted = completedIds.includes(item.id);
            const shouldOpenCheckConfirmAbove = !adding && index === items.length - 1;
            const shouldOpenCheckDeleteAbove = !adding && index === items.length - 1;
            const isEditing = editingId === item.id;
            if (isEditing) return renderEditForm(item);

            return (
              <div
                className={`kim-check-row${isCompleted ? " is-completed" : ""}`}
                key={item.id}
                onClick={() => {
                  handlers.startEdit(item);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  handlers.startEdit(item);
                }}
                role="button"
                tabIndex={0}
              >
                <span>{item.due} · {item.category}</span>
                <div>
                  <strong>{item.body}</strong>
                </div>
                <div className="kim-check-row-actions">
                  <button
                    aria-label={isCompleted ? "해야 할 일 완료 취소" : "해야 할 일 완료"}
                    aria-pressed={isCompleted}
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.requestComplete(item.id);
                    }}
                    type="button"
                  >
                    <Check size={13} strokeWidth={2.6} />
                  </button>
                  <button
                    aria-label="해야 할 일 삭제"
                    className="delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.requestDelete(item.id);
                    }}
                    type="button"
                  >
                    <Trash2 size={13} strokeWidth={2.3} />
                  </button>
                </div>
                {confirming.title === item.id ? (
                  <div className={`kim-check-confirm-popover${shouldOpenCheckConfirmAbove ? " is-above" : ""}`} ref={confirmRef} role="dialog" aria-label="해야 할 일 상태 변경 확인" onClick={(event) => event.stopPropagation()}>
                    <p>{isCompleted ? "완료한 일을 다시 진행 중으로 되돌릴까요?" : "해당 할 일을 완료 처리할까요?"}</p>
                    <div>
                      <button type="button" onClick={() => handlers.cancelComplete()}>취소</button>
                      <button className={isCompleted ? "neutral" : "primary"} type="button" onClick={() => handlers.toggleDone(item.id)}>{isCompleted ? "되돌림" : "완료"}</button>
                    </div>
                  </div>
                ) : null}
                {confirming.deleteId === item.id ? (
                  <div className={`kim-check-confirm-popover delete${shouldOpenCheckDeleteAbove ? " is-above" : ""}`} ref={deleteRef} role="dialog" aria-label="해야 할 일 삭제 확인" onClick={(event) => event.stopPropagation()}>
                    <p>해당 할 일을 삭제하시겠습니까?</p>
                    <div>
                      <button type="button" onClick={() => handlers.cancelDelete()}>아니요</button>
                      <button className="danger" type="button" onClick={() => handlers.confirmDelete(item.id)}>삭제</button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {adding ? (
          <form className="kim-check-composer" onSubmit={handlers.save}>
            <div className="kim-check-composer-pickers">
              <div className="kim-check-due-stack">
                <div className="kim-check-composer-controls due" aria-label="해야 할 일 마감">
                  {checkDueOptions.map((option) => (
                    <label key={option}>
                      <input checked={selectedDue === option} name="due" onChange={() => handlers.setDue(option)} type="radio" value={option} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
                {selectedDue === "지정" ? (
                  <label className="kim-check-date-field">
                    <span>마감 날짜</span>
                    <input name="dueDate" type="date" />
                  </label>
                ) : null}
              </div>
              <div className="kim-check-composer-controls" aria-label="해야 할 일 분류">
                {TASK_CATEGORY_OPTIONS.map((option) => (
                  <label key={option}>
                    <input defaultChecked={option === "체크"} name="category" type="radio" value={option} />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="kim-check-composer-main">
              <textarea aria-label="해야 할 일 내용" autoFocus name="body" rows={2} />
            </div>
            <div className="kim-check-composer-actions">
              <button type="button" onClick={() => handlers.cancelAdd()}>취소</button>
              <button className="primary" type="submit">저장</button>
            </div>
          </form>
        ) : null}
      </div>
    </article>
  );
}
