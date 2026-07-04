import { CarFront } from "lucide-react";
import { type Dispatch, type RefObject, type SetStateAction } from "react";

import { type CustomerDetailData } from "@/lib/customers";

import { NEEDS_COLOR_PLACEHOLDER } from "./needs-meta";
import { methodOptions } from "./purchase-meta";
import { type OpenEditorState } from "./types";
import type { useCustomerNeeds } from "./hooks/useCustomerNeeds";

type NeedsDashboardProps = {
  detail: CustomerDetailData; // appUserId로 앱 카드 목록 / 단일 need 카드 분기
  onToast: (message: string) => void;
  // 부모 소유 공유 인프라(상태·구매조건도 사용) — props로 받는다.
  openEditor: OpenEditorState | null;
  setOpenEditor: Dispatch<SetStateAction<OpenEditorState | null>>;
  toggleEditor: (next: OpenEditorState) => void;
  editorRef: RefObject<HTMLDivElement | null>;
  // 워크벤치 소유(Task 9 미추출, 부모 보유) — 앱 카드 "견적 작성"이 호출만 한다.
  openWorkbenchForQuoteRequest: (reqId: string) => Promise<void>;
  needsHook: ReturnType<typeof useCustomerNeeds>;
};

export function NeedsDashboard({ detail, onToast, openEditor, setOpenEditor, toggleEditor, editorRef, openWorkbenchForQuoteRequest, needsHook }: NeedsDashboardProps) {
  const { needs, appRequests, handlers } = needsHook;
  const { saveNeeds } = handlers;

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
                {methodOptions.map((option) => <option key={option} value={option}>{option}</option>)}
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

  return (
    <section className={`detail-section kim-needs-dashboard${detail.appUserId ? " is-app" : ""}`}>
      <div className="kim-needs-field">
        {detail.appUserId ? (
          <div className="kim-needs-app">
            {/* 카드 목록만 상한 높이 스크롤(overscroll-contain으로 부모 드로어 스크롤 격리) */}
            <div className="kim-needs-request-scroll">
              {appRequests === null ? (
                <p className="kim-needs-request-status">앱 견적요청 불러오는 중…</p>
              ) : appRequests.length === 0 ? (
                <p className="kim-needs-request-status">앱 견적요청이 없습니다.</p>
              ) : (
                appRequests.map((req) => (
                  <div className="kim-needs-floating-card kim-needs-request-card" key={req.id}>
                    <div className="kim-needs-card-main">
                      <span className="kim-needs-car-icon" aria-hidden="true"><CarFront size={22} strokeWidth={2.1} /></span>
                      <div className="kim-needs-card-copy">
                        <h3>{req.vehicleLabel}</h3>
                        <p>{req.paymentLabel} · 옵션 {req.optionLabel}</p>
                        <span>{req.periodLabel} · {req.depositLabel}</span>
                      </div>
                      <div className="kim-needs-request-actions">
                        {req.promotedQuoteCount > 0 ? (
                          <span className="kim-needs-request-badge">견적 {req.promotedQuoteCount}건</span>
                        ) : null}
                        <button
                          className="kim-needs-request-create"
                          onClick={() => { void openWorkbenchForQuoteRequest(req.id).catch(() => onToast("견적요청 정보를 불러오지 못했습니다.")); }}
                          type="button"
                        >
                          견적 작성
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {/* 문의사항·관심 색상은 고객 단위(요청별 아님). 값 있을 때만 노출(스크롤 영역 밖 고정). */}
            {needs.memo.trim() || (needs.colors.trim() && needs.colors !== NEEDS_COLOR_PLACEHOLDER) ? (
              <div className="kim-needs-customer-meta">
                {needs.memo.trim() ? (
                  <div className="kim-needs-card-memo">
                    <span>문의사항</span>
                    <p>{needs.memo}</p>
                  </div>
                ) : null}
                {needs.colors.trim() && needs.colors !== NEEDS_COLOR_PLACEHOLDER ? (
                  <div className="kim-needs-card-memo">
                    <span>관심 색상</span>
                    <p>{needs.colors}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
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
        )}
      </div>
    </section>
  );
}
