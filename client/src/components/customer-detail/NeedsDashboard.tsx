import { CarFront, MessageSquareText, X } from "lucide-react";
import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";

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
  // 승격 견적 "견적 보기"(부모가 quoteList에서 찾아 openEditQuote, 미발견 시 openWorkbenchForQuoteRequest로 폴백 — 고정 설계 결정 5).
  onViewQuote: (reqId: string, quoteId: string) => void;
  needsHook: ReturnType<typeof useCustomerNeeds>;
  // 견적 쓰기 권한(2026-07-21 이사님 D-4 ②) — false면 "견적 작성"/"추가 작성" 숨김("견적 보기"는 읽기라 유지).
  quoteWritable: boolean;
};

export function NeedsDashboard({ detail, onToast, openEditor, setOpenEditor, toggleEditor, editorRef, openWorkbenchForQuoteRequest, onViewQuote, needsHook, quoteWritable }: NeedsDashboardProps) {
  const { needs, appRequests, consultations, handlers } = needsHook;
  const { saveNeeds, dismissConsultation } = handlers;
  // 상담신청 카드 삭제는 되돌리는 UI가 없어(재조회해도 dismissed 제외) 오클릭 방지용 인라인 확인 —
  // X 한 번은 "삭제/취소" 확인 상태로만 전환, 실제 삭제는 "삭제"를 한 번 더 눌러야 실행.
  const [confirmingConsultId, setConfirmingConsultId] = useState<string | null>(null);

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
              {(() => {
                const requestCards = appRequests ?? [];
                const consultCards = consultations ?? [];
                const nothingYet = requestCards.length === 0 && consultCards.length === 0;
                if ((appRequests === null || consultations === null) && nothingYet) {
                  return <p className="kim-needs-request-status">앱 견적요청·상담신청 불러오는 중…</p>;
                }
                if (nothingYet) {
                  return <p className="kim-needs-request-status">앱 견적요청·상담신청이 없습니다.</p>;
                }
                return (
                  <>
                    {requestCards.map((req) => {
                      // "견적 작성"/"추가 작성" 공용 핸들러 — 토스트 문구·에러 처리 1벌(한쪽만 고치는 드리프트 방지).
                      const createQuote = () => { void openWorkbenchForQuoteRequest(req.id).catch(() => onToast("견적요청 정보를 불러오지 못했습니다.")); };
                      return (
                      <div className="kim-needs-floating-card kim-needs-request-card" key={req.id}>
                        <div className="kim-needs-card-main">
                          <span className="kim-needs-car-icon" aria-hidden="true"><CarFront size={22} strokeWidth={2.1} /></span>
                          <div className="kim-needs-card-copy">
                            <h3>{req.vehicleLabel}</h3>
                            <p>{req.paymentLabel} · 옵션 {req.optionLabel}{req.colorLabel ? ` · ${req.colorLabel}` : ""}</p>
                            <span>{req.periodLabel} · {req.depositLabel}</span>
                            {/* 출고·문의·자유문의는 V2 요청에만 있다 — 레거시 행은 null/빈배열이라 줄 자체가 안 생긴다(카드 높이 유지). */}
                            {req.deliveryLabel ? <span>출고 {req.deliveryLabel}</span> : null}
                            {req.topicLabels.length > 0 ? <span>문의 {req.topicLabels.join(", ")}</span> : null}
                            {req.additionalRequest ? <span className="kim-needs-request-note">“{req.additionalRequest}”</span> : null}
                          </div>
                          <div className="kim-needs-request-actions">
                            {req.promotedQuoteCount > 0 ? (
                              <span className="kim-needs-request-badge">견적 {req.promotedQuoteCount}건</span>
                            ) : null}
                            {req.promotedQuoteIds.length > 0 ? (
                              // 승격 견적 있음: 기본 액션은 중복 작성 방지를 위해 "견적 보기"(최신 승격 견적), "추가 작성"은 보조 액션으로 낮춤.
                              // 가로 한 줄(보조 왼쪽·기본 오른쪽 끝) — 배지+버튼 2줄 유지로 카드 높이 증가 방지.
                              <div className="kim-needs-request-button-row">
                                {quoteWritable ? (
                                  <button className="kim-needs-request-create-secondary" onClick={createQuote} type="button">
                                    추가 작성
                                  </button>
                                ) : null}
                                <button
                                  className="kim-needs-request-create"
                                  onClick={() => onViewQuote(req.id, req.promotedQuoteIds[0])}
                                  type="button"
                                >
                                  견적 보기
                                </button>
                              </div>
                            ) : quoteWritable ? (
                              <button className="kim-needs-request-create" onClick={createQuote} type="button">
                                견적 작성
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                    })}
                    {/* 앱 상담신청 문의 카드(읽기 전용, 건별) — 견적요청 카드와 같은 스크롤 스택에 공존. 원본 문의 보존(편집 없음),
                        CRM에서만 삭제 가능(public.consultations 불가침 — dismissConsultation은 crm.consultation_dismissals에만 기록). */}
                    {consultCards.map((c) => (
                      <div className="kim-needs-floating-card kim-needs-consultation-card" key={c.id}>
                        <div className="kim-needs-consultation-actions">
                          {confirmingConsultId === c.id ? (
                            <>
                              <button
                                className="kim-needs-consultation-confirm"
                                type="button"
                                onClick={() => { setConfirmingConsultId(null); dismissConsultation(c.id); }}
                              >
                                삭제
                              </button>
                              <button
                                className="kim-needs-consultation-cancel"
                                type="button"
                                onClick={() => setConfirmingConsultId(null)}
                              >
                                취소
                              </button>
                            </>
                          ) : (
                            <button
                              className="kim-needs-consultation-delete"
                              type="button"
                              aria-label="상담신청 삭제 (CRM에서만, 앱에는 유지)"
                              title="CRM에서만 삭제 (앱 원본은 유지)"
                              onClick={() => setConfirmingConsultId(c.id)}
                            >
                              <X size={13} strokeWidth={2.6} />
                            </button>
                          )}
                        </div>
                        <div className="kim-needs-card-main">
                          <span className="kim-needs-car-icon" aria-hidden="true"><MessageSquareText size={22} strokeWidth={2.1} /></span>
                          <div className="kim-needs-card-copy">
                            <h3>{c.carModel?.trim() || "상담 문의"}</h3>
                            <p>상담신청 · {c.dateLabel}</p>
                          </div>
                        </div>
                        {c.notes?.trim() ? (
                          <div className="kim-needs-card-memo">
                            <span>문의사항</span>
                            <p>{c.notes}</p>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </>
                );
              })()}
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
