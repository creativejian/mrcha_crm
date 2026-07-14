import { Check, History, MessageSquareText } from "lucide-react";
import { type Dispatch, type RefObject, type SetStateAction } from "react";
import { useNavigate } from "react-router";

import { CHANCE_OPTIONS, CUSTOMER_MANAGE_STATUSES, customerStatusGroups, type Customer } from "@/data/customers";
import { consultKindClass } from "@/lib/detail-utils";
import { hasAppSourceQueue } from "@/lib/status-fields";

import { AdvisorStatusEditor, JobStatusEditor, LocationStatusEditor, PhoneStatusInput, SourceStatusEditor } from "./StatusFieldEditors";
import { fieldLabel, isUnassignedStatus, chanceOptionClass, chanceValueClass, statusFieldMeta, workflowMeta } from "./status-meta";
import { type StatusFieldKey, type WorkflowKey, type OpenEditorState } from "./types";
import type { useCustomerWorkflow } from "./hooks/useCustomerWorkflow";

type StatusWorkflowProps = {
  customer: Customer;
  // 부모 소유 공유 인프라(니즈·구매조건도 사용) — props로 받는다.
  openEditor: OpenEditorState | null;
  setOpenEditor: Dispatch<SetStateAction<OpenEditorState | null>>;
  toggleEditor: (next: OpenEditorState) => void;
  editorRef: RefObject<HTMLDivElement | null>;
  workflow: ReturnType<typeof useCustomerWorkflow>;
};

export function StatusWorkflow({ customer, openEditor, setOpenEditor, toggleEditor, editorRef, workflow }: StatusWorkflowProps) {
  const { statusValues, advisorId, stageGroup, stageStatus, chance, manage, timelineItems, consultBodyRef, workflowValue, handlers } = workflow;
  const navigate = useNavigate();
  // 앱 채팅 이동은 앱 계정 연결(appUserId)이 전제 — source 어휘만 앱 계열이고 미연결이면 볼 채팅이 없다.
  const appChatUserId = hasAppSourceQueue(statusValues.source) ? customer.appUserId ?? null : null;

  function renderStatusEditor(key: StatusFieldKey) {
    return (
      <div className="kim-edit-popover compact" role="dialog" aria-label={`${fieldLabel(key)} 수정`}>
        {key === "job" ? (
          <JobStatusEditor
            initialValue={statusValues.job}
            onCancel={() => setOpenEditor(null)}
            onSubmit={handlers.saveJobField}
          />
        ) : key === "location" ? (
          <LocationStatusEditor
            initialValue={statusValues.location}
            onCancel={() => setOpenEditor(null)}
            onSubmit={handlers.saveLocationField}
          />
        ) : key === "source" ? (
          <SourceStatusEditor
            initialValue={statusValues.source}
            onCancel={() => setOpenEditor(null)}
            onSubmit={handlers.saveSourceField}
          />
        ) : key === "advisor" ? (
          <AdvisorStatusEditor
            initialValue={statusValues.advisor}
            initialAdvisorId={advisorId}
            onCancel={() => setOpenEditor(null)}
            onSubmit={handlers.saveAdvisorField}
          />
        ) : (
        <form className="kim-edit-form" onSubmit={(event) => handlers.saveStatusField(event, key)}>
          <label>
            <span>{key === "phone" ? "연락처 수정" : fieldLabel(key)}</span>
            {key === "phone" ? (
              <PhoneStatusInput initialValue={statusValues[key]} />
            ) : (
              <input autoFocus defaultValue={statusValues[key]} name="value" />
            )}
          </label>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => setOpenEditor(null)}>취소</button>
            <button className="primary" type="submit">저장</button>
          </div>
        </form>
        )}
      </div>
    );
  }

  function renderWorkflowEditor(key: WorkflowKey) {
    if (key === "stage") {
      const secondaryOptions = customerStatusGroups[stageGroup] ?? [];
      return (
        <div className="kim-edit-popover stage" role="dialog" aria-label="진행 상태 수정">
          <div className="kim-choice-editor two-column">
            <div>
              <span className="kim-edit-label">1단계</span>
              <div className="kim-choice-list">
                {Object.keys(customerStatusGroups).map((group) => (
                  <button className={group === stageGroup ? "active" : ""} key={group} onClick={() => handlers.selectStageGroup(group)} type="button">
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
                  <button className={status === stageStatus ? "active" : ""} key={status} onClick={() => handlers.selectStageStatus(status)} type="button">
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

    // 수동 관리 상태(이사님 2026-07-13 ⑦-①) — 선택은 영속(스누즈: 다음 실활동 기록 시 자동 해제).
    if (key === "manage") {
      return (
        <div className="kim-edit-popover compact" role="dialog" aria-label="관리 상태 수정">
          <div className="kim-choice-list single">
            {CUSTOMER_MANAGE_STATUSES.map((option) => {
              const selected = option === manage;
              return (
                <button
                  className={selected ? "active" : ""}
                  key={option}
                  onClick={() => handlers.selectManage(option)}
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

    if (key !== "chance") return null;

    return (
      <div className="kim-edit-popover compact" role="dialog" aria-label={`${key === "chance" ? "계약 가능성" : "관리 상태"} 수정`}>
        <div className="kim-choice-list single">
          {CHANCE_OPTIONS.map((option) => {
            const selected = option === chance;
            return (
              <button
                className={chanceOptionClass(option, selected)}
                key={option}
                onClick={() => handlers.selectChance(option)}
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

  function renderTimelinePanel() {
    return (
      <div className="kim-timeline-popover" role="dialog" aria-label="상담 타임라인">
        <div className="kim-timeline-popover-head">
          <div className="kim-timeline-popover-title">
            <i aria-hidden="true"><History size={17} strokeWidth={2.3} /></i>
            <h3>상담 타임라인</h3>
          </div>
        </div>
        <div className={`kim-consult-body kim-timeline-popover-body${timelineItems.length > 10 ? " is-scrollable" : ""}`} ref={consultBodyRef}>
          <div className="kim-consult-timeline">
            {timelineItems.map((item, index) => {
              const isLatestMemo = item.kind === "메모" && !timelineItems.slice(index + 1).some((nextItem) => nextItem.kind === "메모");
              return (
                <article
                  className={`kim-consult-event${consultKindClass(item.kind)}${isLatestMemo ? " is-latest-memo" : " is-muted-history"}`}
                  key={`${item.kind}-${item.title}-${item.meta}-${index}`}
                >
                  <span>{item.kind}</span>
                  <div>
                    <div className="kim-consult-event-head">
                      <div>
                        <strong>{item.title}</strong>
                        <em>{item.meta}</em>
                      </div>
                    </div>
                    <p>{item.body}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="detail-section kim-status-dashboard">
      <div className="kim-status-grid">
        {statusFieldMeta.map((field) => {
          const Icon = field.icon;
          if (field.key === "source") {
            return (
              <div className="kim-edit-anchor" key={field.key} ref={openEditor?.kind === "status" && openEditor.key === field.key ? editorRef : undefined}>
                <div className="kim-status-field" onClick={() => handlers.openStatusEditor({ kind: "status", key: field.key })} onKeyDown={handlers.openSourceEditorByKeyboard} role="button" tabIndex={0}>
                  <span className="kim-status-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.9} /></span>
                  <span className="kim-status-copy">
                  <span>{field.label}</span>
                  <strong className={`has-inline-actions${isUnassignedStatus(field.key, statusValues[field.key]) ? " is-unassigned" : ""}`}>
                    {statusValues[field.key]}
                    {appChatUserId ? (
                    <button
                      aria-label="앱 채팅 상담 보기"
                      className="kim-app-queue-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/chat?user=${encodeURIComponent(appChatUserId)}`);
                      }}
                      title="앱 채팅 상담 보기"
                      type="button"
                    >
                      <MessageSquareText size={13} strokeWidth={2.4} />
                    </button>
                    ) : null}
                  </strong>
                  </span>
                </div>
                {openEditor?.kind === "status" && openEditor.key === field.key ? renderStatusEditor(field.key) : null}
              </div>
            );
          }
          return (
            <div className="kim-edit-anchor" key={field.key} ref={openEditor?.kind === "status" && openEditor.key === field.key ? editorRef : undefined}>
              <button className="kim-status-field" onClick={() => handlers.openStatusEditor({ kind: "status", key: field.key })} type="button">
                <span className="kim-status-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.9} /></span>
                <span className="kim-status-copy">
                <span>{field.label}</span>
                <strong className={isUnassignedStatus(field.key, statusValues[field.key]) ? "is-unassigned" : undefined}>{statusValues[field.key]}</strong>
                </span>
              </button>
              {openEditor?.kind === "status" && openEditor.key === field.key ? renderStatusEditor(field.key) : null}
            </div>
          );
        })}
      </div>
      <div className="kim-workflow-strip" aria-label={`${customer.name} 업무 상태`}>
        {workflowMeta.map((field) => (
          <div className="kim-edit-anchor workflow" key={field.key} ref={openEditor?.kind === "workflow" && openEditor.key === field.key ? editorRef : undefined}>
            <button className={`kim-workflow-card ${field.tone}`} onClick={() => handlers.openWorkflowEditor(field.key)} type="button">
              <span>{field.label}</span>
              <strong className={field.key === "chance" ? chanceValueClass(chance) : undefined}>{workflowValue(field.key)}</strong>
            </button>
            {openEditor?.kind === "workflow" && openEditor.key === field.key ? renderWorkflowEditor(field.key) : null}
          </div>
        ))}
        <div className="kim-edit-anchor workflow timeline-action" ref={openEditor?.kind === "timeline" ? editorRef : undefined}>
          <button
            aria-label={`상담 타임라인 열기, ${timelineItems.length}개 이력`}
            className="kim-timeline-open-button"
            onClick={() => toggleEditor({ kind: "timeline" })}
            type="button"
          >
            <History size={18} strokeWidth={2.2} />
            <span>{timelineItems.length}</span>
          </button>
          {openEditor?.kind === "timeline" ? renderTimelinePanel() : null}
        </div>
      </div>
    </section>
  );
}
