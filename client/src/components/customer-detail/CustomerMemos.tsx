import { FileText, Trash2 } from "lucide-react";

import type { useCustomerMemos } from "./hooks/useCustomerMemos";

type CustomerMemosProps = ReturnType<typeof useCustomerMemos>;

export function CustomerMemos({ memos, count, adding, editingId, confirmingDeleteId, refs, handlers }: CustomerMemosProps) {
  const { bodyRef, deleteRef, editRef } = refs;
  return (
    <section className="detail-section kim-mvp-section kim-customer-memo-section">
      <div className="kim-mvp-section-head">
        <div className="kim-mvp-title-row">
          <i aria-hidden="true" className="kim-mvp-title-icon"><FileText size={14} strokeWidth={2.2} /></i>
          <h3>고객 메모</h3>
          <span className="kim-customer-memo-count">{count}개</span>
          <em>고객별 참고사항</em>
        </div>
        <button
          aria-label="고객 메모 추가"
          className="kim-customer-memo-add-button"
          onClick={handlers.toggleAdd}
          type="button"
        >
          <span aria-hidden="true">{adding ? "×" : "+"}</span>
        </button>
      </div>
      <div className="kim-customer-memo-body" ref={bodyRef}>
        <div className="kim-customer-memo-list">
          {memos.length === 0 && !adding ? (
            <div className="kim-list-empty">등록된 메모가 없습니다.</div>
          ) : memos.map((item, index) => {
            const shouldOpenDeletePopoverAbove = !adding && index === memos.length - 1;

            if (editingId === item.id) {
              return (
                <form
                  className="kim-customer-memo-edit-row"
                  key={item.id}
                  ref={editRef}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    handlers.cancelEdit();
                  }}
                  onSubmit={(event) => handlers.update(event, item.id)}
                >
                  <span>{item.createdAt}</span>
                  <textarea aria-label="고객 메모 내용" autoFocus defaultValue={item.body} name="body" rows={2} />
                  <div className="kim-customer-memo-edit-actions">
                    <button type="button" onClick={() => handlers.cancelEdit()}>취소</button>
                    <button className="primary" type="submit">저장</button>
                  </div>
                </form>
              );
            }

            return (
              <article
                className="kim-customer-memo-row"
                key={item.id}
                onClick={() => handlers.startEdit(item.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  handlers.startEdit(item.id);
                }}
                role="button"
                tabIndex={0}
              >
                <span>{item.createdAt}</span>
                <p>{item.body}</p>
                <button
                  aria-label="고객 메모 삭제"
                  onClick={(event) => {
                    event.stopPropagation();
                    handlers.requestDelete(item.id);
                  }}
                  type="button"
                >
                  <Trash2 size={13} strokeWidth={2.3} />
                </button>
                {confirmingDeleteId === item.id ? (
                  <div
                    className={`kim-customer-memo-delete-popover${shouldOpenDeletePopoverAbove ? " is-above" : ""}`}
                    ref={deleteRef}
                    role="dialog"
                    aria-label="고객 메모 삭제 확인"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <p>해당 메모를 삭제하시겠습니까?</p>
                    <div>
                      <button type="button" onClick={(event) => {
                        event.stopPropagation();
                        handlers.cancelDelete();
                      }}>아니요</button>
                      <button className="danger" type="button" onClick={(event) => {
                        event.stopPropagation();
                        handlers.confirmDelete(item.id);
                      }}>삭제</button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        {adding ? (
          <form className="kim-customer-memo-composer" onSubmit={handlers.save}>
            <label>
              <textarea aria-label="고객 메모" autoFocus name="body" rows={3} />
            </label>
            <div className="kim-customer-memo-composer-actions">
              <button type="button" onClick={() => handlers.cancelAdd()}>취소</button>
              <button className="primary" type="submit">저장</button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
