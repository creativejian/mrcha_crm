import { BriefcaseBusiness, Calculator, Check, ChevronDown, Download, Eye, FilePlus2, FileText, FileUp, MessageSquareText, MoreHorizontal, Paperclip, PencilLine, Send, Star, Trash2, UserRound, X } from "lucide-react";

import { type Customer } from "@/data/customers";
import { formatMonthly, formatScenarioMoneyMode, viewedBadgeOf, type QuoteItem } from "@/lib/quote-items";
import { formatMoney } from "@/lib/quote-pricing";
import { formatFileSize, isDocumentFileDrag, documentFileKind, quoteValidClass } from "@/lib/detail-utils";
import { calculateQuoteActionFrame, calculateQuoteStatusTooltip } from "@/lib/popover-frames";
import { prefetchWorkbenchVehicle } from "@/lib/vehicles-cache";

import {
  quoteAppSendLabel,
  quoteAppStatusLabel,
  quoteDecisionLabel,
  quoteDeleteConfirmMessage,
  quoteDeleteConfirmTitle,
  quoteStockClass,
} from "./quote-meta";
import type { useQuoteList } from "./hooks/useQuoteList";

function quoteSourceIcon(source: QuoteItem["source"]) {
  if (source === "solution") return <Calculator size={12} strokeWidth={2.35} />;
  if (source === "original") return <FileText size={12} strokeWidth={2.35} />;
  return <PencilLine size={12} strokeWidth={2.35} />;
}

type QuoteListProps = {
  quoteList: ReturnType<typeof useQuoteList>;
  customer: Customer;
  // 앱 연결 게이트(detail.appUserId) — 없으면 열람 배지 미노출(내부 발송 "미열람" 오표기 방지, 편차 노트 Task 5/6).
  appUserId: string | null;
  onToast: (message: string) => void;
  // 워크벤치 시드(부모 보유 9b/9d/9e) — seam 콜백. 견적함 "+"=신규, 액션 "견적 수정"=수정.
  onOpenNewWorkbench: () => void;
  onEditQuote: (quote: QuoteItem) => void;
};

export function QuoteList({ quoteList, customer, appUserId, onToast, onOpenNewWorkbench, onEditQuote }: QuoteListProps) {
  const {
    quotes,
    quoteBodyRef,
    quoteDropTargetId,
    openQuoteActionId,
    quoteActionFrame,
    openQuoteAction,
    pinnedQuoteStatus,
    expandedQuoteId,
    activeQuoteStatusTooltip,
    activeQuoteStatusDetail,
    confirmingQuoteSendId,
    confirmingQuoteContractEditId,
    confirmingQuoteContractDowngrade,
    confirmingQuoteContractId,
    confirmingQuoteDeleteId,
  } = quoteList;
  const {
    setQuoteDropTargetId,
    setHoveredQuoteStatus,
    setPinnedQuoteStatus,
    setExpandedQuoteId,
    setOpenQuoteActionId,
    setQuoteActionFrame,
    setConfirmingQuoteDeleteId,
    setConfirmingQuoteSendId,
    setConfirmingQuoteContractId,
    setConfirmingQuoteContractEditId,
    setConfirmingQuoteContractDowngrade,
    setPreviewQuoteId,
    setPreviewSentQuoteId,
    dropQuoteFile,
    attachQuoteFile,
    deleteQuote,
    sendQuoteToApp,
    updateQuoteDecisionStatus,
    setPrimaryScenario,
  } = quoteList.handlers;

  return (
    <>
      <article className="detail-section kim-mvp-card kim-quote-card compact">
        <div className="kim-mvp-card-head">
          <div className="kim-mvp-title-row">
            <i aria-hidden="true" className="kim-mvp-title-icon"><FileText size={14} strokeWidth={2.2} /></i>
            <h3>견적함</h3>
            <span>{quotes.length}개</span>
            <em>고객에게 나간 조건</em>
          </div>
          <div className="kim-quote-head-actions">
            <button
              aria-label="견적 작성"
              className="kim-mvp-add-circle kim-quote-head-action kim-quote-solution-entry"
              onClick={onOpenNewWorkbench}
              type="button"
            ><FilePlus2 size={13} strokeWidth={2.35} /></button>
          </div>
        </div>
        <div className="kim-mvp-card-body" ref={quoteBodyRef}>
          <div className="kim-quote-list">
            {quotes.length === 0 ? (
              <div className="kim-list-empty">작성된 견적이 없습니다.</div>
            ) : quotes.map((quote) => {
              const viewedBadge = viewedBadgeOf(quote, appUserId);
              return (
              <div
                className={`kim-quote-row app-status-${quote.appStatus}${quoteDropTargetId === quote.id ? " is-file-drop-target" : ""}${openQuoteActionId === quote.id ? " is-action-open" : ""}`}
                key={quote.id}
                onMouseEnter={() => { if (quote.trimId) prefetchWorkbenchVehicle(quote.trimId); }}
                onDragEnter={(event) => {
                  if (!isDocumentFileDrag(event)) return;
                  event.preventDefault();
                  setQuoteDropTargetId(quote.id);
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                  if (quoteDropTargetId === quote.id) setQuoteDropTargetId(null);
                }}
                onDragOver={(event) => {
                  if (!isDocumentFileDrag(event)) return;
                  event.preventDefault();
                }}
                onDrop={(event) => dropQuoteFile(event, quote.id)}
              >
                <span className="kim-quote-status-stack">
                  {quote.appStatus === "sent" || quote.appStatus === "viewed" ? (
                    <button
                      className={`kim-quote-status-detail ${quote.appStatus === "viewed" ? "send-viewed" : "send-sent"}${pinnedQuoteStatus?.id === quote.id ? " is-pinned" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        const nextFrame = calculateQuoteStatusTooltip(event.currentTarget, quote.id);
                        setPinnedQuoteStatus((current) => (current?.id === quote.id ? null : nextFrame));
                        setHoveredQuoteStatus(null);
                      }}
                      onMouseEnter={(event) => setHoveredQuoteStatus(calculateQuoteStatusTooltip(event.currentTarget, quote.id))}
                      onMouseLeave={() => setHoveredQuoteStatus(null)}
                      type="button"
                    >
                      {quoteSourceIcon(quote.source)}
                      <i aria-hidden="true" />
                      <span>{quoteAppStatusLabel(quote.appStatus, quote)}</span>
                    </button>
                  ) : (
                    <b className="send-draft">
                      {quoteSourceIcon(quote.source)}
                      <i aria-hidden="true" />
                      <span>{quoteAppStatusLabel(quote.appStatus, quote)}</span>
                    </b>
                  )}
                </span>
                <div className="kim-quote-row-main">
                  <div className="kim-quote-meta-primary">
                    {quote.brand ? <span>{quote.brand}</span> : null}
                    <strong>{quote.model || quote.vehicleName || quote.title}</strong>
                    {quote.trim ? <span>{quote.trim}</span> : null}
                    {quote.quoteRound ? <b>{quote.quoteRound}</b> : null}
                    {quote.sourceQuoteRequestId ? <span className="quote-source-app-badge">앱 요청</span> : null}
                    {viewedBadge ? (
                      <span className={viewedBadge.viewed ? "quote-viewed-badge" : "quote-unviewed-badge"} title={viewedBadge.title}>
                        {viewedBadge.label}
                      </span>
                    ) : null}
                  </div>
                  <div className="kim-quote-meta-secondary">
                    {quote.financeType ? <span>{quote.financeType}</span> : null}
                    {quote.term ? <span>{quote.term}</span> : null}
                    {quote.monthlyPayment ? <strong>{quote.monthlyPayment}</strong> : <span>월 납입금 확인 전</span>}
                    {quote.lender ? <span>{quote.lender}</span> : null}
                    {quote.stockStatus ? <span className={`stock${quoteStockClass(quote.stockStatus)}`}>{quote.stockStatus}</span> : null}
                    {quote.validLabel ? <span className={`valid${quoteValidClass(quote.validLabel)}`}>{quote.validLabel}</span> : null}
                  </div>
                  {(quote.finalVehiclePrice != null || quote.exteriorColorName || quote.interiorColorName || quote.fileName) ? (
                    <div className="kim-quote-meta-pricing">
                      {quote.finalVehiclePrice != null ? <span className="kim-quote-final-price">최종 차량가 {formatMoney(quote.finalVehiclePrice)}</span> : null}
                      {quote.exteriorColorName ? (
                        <span className="kim-quote-color-chip">
                          {quote.exteriorColorHex ? <i aria-hidden="true" style={{ background: quote.exteriorColorHex }} /> : null}
                          외장 {quote.exteriorColorName}
                        </span>
                      ) : null}
                      {quote.interiorColorName ? (
                        <span className="kim-quote-color-chip">
                          {quote.interiorColorHex ? <i aria-hidden="true" style={{ background: quote.interiorColorHex }} /> : null}
                          내장 {quote.interiorColorName}
                        </span>
                      ) : null}
                      {quote.fileName ? (
                        <button type="button" className="kim-quote-attach-chip" onClick={() => setPreviewQuoteId(quote.id)} title={`견적 원본 보기 · ${quote.fileName}`}>
                          <Paperclip size={11} strokeWidth={2.5} />
                          <span>{quote.fileName}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {quote.note ? <p className="kim-quote-row-note">{quote.note}</p> : null}
                  {quote.scenarios && quote.scenarios.length >= 2 ? (
                    <div className="kim-quote-compare">
                      <button
                        type="button"
                        className={`kim-quote-compare-toggle${expandedQuoteId === quote.id ? " is-open" : ""}`}
                        aria-expanded={expandedQuoteId === quote.id}
                        onClick={() => setExpandedQuoteId((current) => (current === quote.id ? null : quote.id))}
                      >
                        비교 {quote.scenarios.length}
                        <ChevronDown size={12} strokeWidth={2.6} />
                      </button>
                      {expandedQuoteId === quote.id ? (
                        <ul className="kim-quote-scenario-cards">
                          {[...quote.scenarios]
                            .sort((a, b) => (a.scenarioNo ?? 0) - (b.scenarioNo ?? 0))
                            .map((scenario) => {
                              const isPrimary = (quote.primaryScenarioId ?? null) === scenario.id;
                              const monthly = formatMonthly(scenario.monthlyPayment);
                              const deposit = formatScenarioMoneyMode(scenario.depositMode, scenario.depositValue);
                              const downPayment = formatScenarioMoneyMode(scenario.downPaymentMode, scenario.downPaymentValue);
                              const residual = formatScenarioMoneyMode(scenario.residualMode, scenario.residualValue);
                              return (
                                <li key={scenario.id} className={`kim-quote-scenario-card${isPrimary ? " is-primary" : ""}`}>
                                  <div className="kim-quote-scenario-head">
                                    <span className="kim-quote-scenario-no">{scenario.scenarioNo ?? "-"}</span>
                                    {scenario.lender ? <span className="kim-quote-scenario-lender">{scenario.lender}</span> : null}
                                    {isPrimary ? (
                                      <span className="kim-quote-scenario-star"><Star size={11} strokeWidth={2.6} />대표</span>
                                    ) : (
                                      <button type="button" className="kim-quote-scenario-pick" onClick={() => setPrimaryScenario(quote.id, scenario.id)}>대표로</button>
                                    )}
                                  </div>
                                  <div className="kim-quote-scenario-figures">
                                    {monthly ? <strong>{monthly}</strong> : <span>월 납입금 미정</span>}
                                    {deposit ? <span>보증금 {deposit}</span> : null}
                                    {/* 도메인 규칙(Task 3와 동일): 구매방식이 할부면 초기비용 어휘는 "선납금" */}
                                    {downPayment ? <span>{quote.financeType === "할부" ? "선납금" : "선수금"} {downPayment}</span> : null}
                                    {residual ? <span>잔존 {residual}</span> : null}
                                    {scenario.mileageValue ? <span>약정 {scenario.mileageValue}</span> : null}
                                  </div>
                                </li>
                              );
                            })}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="kim-quote-row-actions">
                  <div className="kim-quote-row-action-line">
                    {quote.originalNeedsReplacement ? (
                      <span className="kim-quote-replace-pill">수정견적으로 교체 필요</span>
                    ) : null}
                    {quote.decisionStatus && quote.decisionStatus !== "none" ? (
                      <span className={`kim-quote-decision-pill decision-${quote.decisionStatus}`}>{quoteDecisionLabel(quote.decisionStatus)}</span>
                    ) : null}
                    <button
                      aria-label={`${quote.title} 견적 작업 열기`}
                      className={openQuoteActionId === quote.id ? "is-active" : undefined}
                      onClick={(event) => {
                        const nextFrame = calculateQuoteActionFrame(event.currentTarget);
                        setConfirmingQuoteDeleteId(null);
                        setConfirmingQuoteSendId(null);
                        setConfirmingQuoteContractId(null);
                        setConfirmingQuoteContractEditId(null);
                        setOpenQuoteActionId((current) => {
                          if (current === quote.id) {
                            setQuoteActionFrame(null);
                            return null;
                          }
                          setQuoteActionFrame(nextFrame);
                          return quote.id;
                        });
                      }}
                      type="button"
                    >
                      <MoreHorizontal size={14} strokeWidth={2.4} />
                    </button>
                  </div>
                </div>
                <div className="kim-file-drop-overlay" aria-hidden="true">
                  <FileUp size={28} strokeWidth={1.9} />
                  <strong>견적 원본 첨부</strong>
                  <span>해당 견적의 금융사 견적 원본을 첨부합니다</span>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </article>

      {activeQuoteStatusDetail && activeQuoteStatusTooltip ? (
        <div
          className="kim-quote-status-tooltip"
          style={{ left: activeQuoteStatusTooltip.left, top: activeQuoteStatusTooltip.top }}
        >
          <strong>{activeQuoteStatusDetail.time}</strong>
          <span>{activeQuoteStatusDetail.body}</span>
        </div>
      ) : null}

      {openQuoteAction && quoteActionFrame ? (
        <div
          className="kim-quote-action-popover"
          role="dialog"
          aria-label="견적 작업"
          style={{ left: quoteActionFrame.left, top: quoteActionFrame.top }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="kim-quote-action-popover-head">
            <span>{openQuoteAction.quoteCode}</span>
            <b className={openQuoteAction.appStatus === "viewed" ? "is-viewed" : openQuoteAction.appStatus === "sent" ? "is-sent" : "is-draft"}>{quoteAppSendLabel(openQuoteAction.appStatus, openQuoteAction)}</b>
          </div>
          <button type="button" onClick={() => {
            setConfirmingQuoteContractId(null);
            setConfirmingQuoteDeleteId(null);
            setConfirmingQuoteContractEditId(null);
            if (openQuoteAction.appStatus === "sent" || openQuoteAction.appStatus === "viewed") {
              setPreviewSentQuoteId(openQuoteAction.id);
              setOpenQuoteActionId(null);
              setQuoteActionFrame(null);
              setConfirmingQuoteSendId(null);
            } else {
              setConfirmingQuoteSendId((current) => (current === openQuoteAction.id ? null : openQuoteAction.id));
            }
          }}>
            {openQuoteAction.appStatus === "sent" || openQuoteAction.appStatus === "viewed" ? <Eye size={13} strokeWidth={2.3} /> : <Send size={13} strokeWidth={2.3} />}
            {openQuoteAction.appStatus === "sent" || openQuoteAction.appStatus === "viewed" ? "발송 견적 보기" : "앱 발송"}
          </button>
          {confirmingQuoteSendId === openQuoteAction.id ? (
            <div className="kim-quote-send-confirm" role="dialog" aria-label="견적 앱 발송 확인">
              <strong>앱 견적함으로 발송</strong>
              <p>{customer.name}({customer.customerId}) 고객에게 견적을 보내고 푸시알림을 발송합니다.</p>
              <div>
                <button type="button" onClick={() => setConfirmingQuoteSendId(null)}>취소</button>
                <button className="primary" type="button" onClick={() => {
                  sendQuoteToApp(openQuoteAction.id);
                  setOpenQuoteActionId(null);
                  setQuoteActionFrame(null);
                  setConfirmingQuoteSendId(null);
                }}>발송</button>
              </div>
            </div>
          ) : null}
          <button type="button" onClick={() => onEditQuote(openQuoteAction)}>
            <PencilLine size={13} strokeWidth={2.3} />
            견적 수정
          </button>
          {confirmingQuoteContractEditId === openQuoteAction.id ? (
            <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="계약 진행 견적 수정 안내">
              <strong>계약 관리에서 수정</strong>
              <p>계약 진행 중인 견적은 계약 관리 창에서 수정할 수 있습니다.</p>
              <div>
                <button type="button" onClick={() => setConfirmingQuoteContractEditId(null)}>확인</button>
                <button className="primary" type="button" onClick={() => onToast("계약 관리 화면 연결 후 이동됩니다.")}>계약 관리로 이동</button>
              </div>
            </div>
          ) : null}
          {openQuoteAction.fileName ? (
            <button type="button" onClick={() => {
              setPreviewQuoteId(openQuoteAction.id);
              setOpenQuoteActionId(null);
              setQuoteActionFrame(null);
            }}>
              <Eye size={13} strokeWidth={2.3} />
              견적 원본 보기
            </button>
          ) : (
            <label>
              <Paperclip size={13} strokeWidth={2.4} />
              견적 원본 첨부
              <input accept="image/*,.pdf" onChange={(event) => {
                attachQuoteFile(event, openQuoteAction.id);
                setOpenQuoteActionId(null);
                setQuoteActionFrame(null);
              }} type="file" />
            </label>
          )}
          <button className="is-group-start" type="button" onClick={() => {
            setConfirmingQuoteSendId(null);
            setConfirmingQuoteDeleteId(null);
            setConfirmingQuoteContractId(null);
            setConfirmingQuoteContractEditId(null);
            if (openQuoteAction.decisionStatus === "contracting") {
              setConfirmingQuoteContractDowngrade((current) => (current?.id === openQuoteAction.id && current.status === "considering" ? null : { id: openQuoteAction.id, status: "considering" }));
              return;
            }
            setConfirmingQuoteContractDowngrade(null);
            updateQuoteDecisionStatus(openQuoteAction.id, openQuoteAction.decisionStatus === "considering" ? "none" : "considering");
          }}>
            <MessageSquareText size={13} strokeWidth={2.2} />
            최종 고민중
            {openQuoteAction.decisionStatus === "considering" ? <Check className="kim-quote-action-state-check" size={13} strokeWidth={2.6} /> : null}
          </button>
          {confirmingQuoteContractDowngrade?.id === openQuoteAction.id && confirmingQuoteContractDowngrade.status === "considering" ? (
            <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="계약 진행 해제 확인">
              <strong>계약 진행 해제</strong>
              <p>고객 앱의 진행 중인 계약을 다시 견적함으로 이동하고, CRM 계약 관리 창 연결을 해제합니다. 푸시알림도 발송합니다.</p>
              <div>
                <button type="button" onClick={() => setConfirmingQuoteContractDowngrade(null)}>취소</button>
                <button className="primary" type="button" onClick={() => {
                  updateQuoteDecisionStatus(openQuoteAction.id, "considering");
                  setConfirmingQuoteContractDowngrade(null);
                }}>확정</button>
              </div>
            </div>
          ) : null}
          <button type="button" onClick={() => {
            setConfirmingQuoteSendId(null);
            setConfirmingQuoteDeleteId(null);
            setConfirmingQuoteContractId(null);
            setConfirmingQuoteContractEditId(null);
            if (openQuoteAction.decisionStatus === "contracting") {
              setConfirmingQuoteContractDowngrade((current) => (current?.id === openQuoteAction.id && current.status === "confirmed" ? null : { id: openQuoteAction.id, status: "confirmed" }));
              return;
            }
            setConfirmingQuoteContractDowngrade(null);
            updateQuoteDecisionStatus(openQuoteAction.id, openQuoteAction.decisionStatus === "confirmed" ? "none" : "confirmed");
          }}>
            <UserRound size={13} strokeWidth={2.25} />
            고객 확정
            {openQuoteAction.decisionStatus === "confirmed" ? <Check className="kim-quote-action-state-check" size={13} strokeWidth={2.6} /> : null}
          </button>
          {confirmingQuoteContractDowngrade?.id === openQuoteAction.id && confirmingQuoteContractDowngrade.status === "confirmed" ? (
            <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="계약 진행 해제 확인">
              <strong>계약 진행 해제</strong>
              <p>고객 앱의 진행 중인 계약을 다시 견적함으로 이동하고, CRM 계약 관리 창 연결을 해제합니다. 푸시알림도 발송합니다.</p>
              <div>
                <button type="button" onClick={() => setConfirmingQuoteContractDowngrade(null)}>취소</button>
                <button className="primary" type="button" onClick={() => {
                  updateQuoteDecisionStatus(openQuoteAction.id, "confirmed");
                  setConfirmingQuoteContractDowngrade(null);
                }}>확정</button>
              </div>
            </div>
          ) : null}
          <button type="button" onClick={() => {
            setConfirmingQuoteSendId(null);
            setConfirmingQuoteDeleteId(null);
            setConfirmingQuoteContractEditId(null);
            setConfirmingQuoteContractDowngrade(null);
            setConfirmingQuoteContractId((current) => (current === openQuoteAction.id ? null : openQuoteAction.id));
          }}>
            <BriefcaseBusiness size={13} strokeWidth={2.25} />
            계약 진행
            {openQuoteAction.decisionStatus === "contracting" ? <Check className="kim-quote-action-state-check" size={13} strokeWidth={2.6} /> : null}
          </button>
          {confirmingQuoteContractId === openQuoteAction.id ? (
            <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="최종 계약 진행 확인">
              <strong>{openQuoteAction.decisionStatus === "contracting" ? "계약 진행 해제" : "최종 계약 진행"}</strong>
              <p>{openQuoteAction.decisionStatus === "contracting" ? "고객 앱의 진행 중인 계약을 다시 견적함으로 이동하고, CRM 계약 관리 창 연결을 해제합니다. 푸시알림도 발송합니다." : "고객 앱의 해당 견적을 진행 중인 계약으로 이동하고, CRM에는 별도 계약 관리 창이 생성됩니다. 푸시알림도 발송합니다."}</p>
              <div>
                <button type="button" onClick={() => setConfirmingQuoteContractId(null)}>취소</button>
                <button className="primary" type="button" onClick={() => {
                  updateQuoteDecisionStatus(openQuoteAction.id, openQuoteAction.decisionStatus === "contracting" ? "none" : "contracting");
                  setConfirmingQuoteContractId(null);
                }}>확정</button>
              </div>
            </div>
          ) : null}
          <button className="delete is-group-start" type="button" onClick={() => {
            setConfirmingQuoteSendId(null);
            setConfirmingQuoteContractId(null);
            setConfirmingQuoteContractEditId(null);
            setConfirmingQuoteContractDowngrade(null);
            setConfirmingQuoteDeleteId((current) => (current === openQuoteAction.id ? null : openQuoteAction.id));
          }}>
            <Trash2 size={13} strokeWidth={2.3} />
            삭제
          </button>
          {confirmingQuoteDeleteId === openQuoteAction.id ? (
            openQuoteAction.decisionStatus === "contracting" ? (
              <div className="kim-quote-send-confirm kim-quote-contract-inline-confirm" role="dialog" aria-label="계약 진행 견적 삭제 안내">
                <strong>계약 진행 견적 삭제 불가</strong>
                <p>계약 진행 중인 견적은 삭제할 수 없습니다. 계약 관리 메뉴에서 견적 수정 또는 계약 취소를 진행해주세요.</p>
                <div>
                  <button type="button" onClick={() => setConfirmingQuoteDeleteId(null)}>확인</button>
                  <button className="primary" type="button" onClick={() => onToast("계약 관리 화면 연결 후 이동됩니다.")}>계약 관리로 이동</button>
                </div>
              </div>
            ) : (
              <div className="kim-quote-send-confirm kim-quote-delete-inline-confirm" role="dialog" aria-label="견적 항목 삭제 확인">
                <strong>{quoteDeleteConfirmTitle(openQuoteAction)}</strong>
                <p>{quoteDeleteConfirmMessage(openQuoteAction)}</p>
                <div>
                  <button type="button" onClick={() => setConfirmingQuoteDeleteId(null)}>취소</button>
                  <button className="danger" type="button" onClick={() => {
                    deleteQuote(openQuoteAction.id);
                    setOpenQuoteActionId(null);
                    setQuoteActionFrame(null);
                  }}>삭제</button>
                </div>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </>
  );
}

type QuotePreviewModalsProps = {
  quoteList: ReturnType<typeof useQuoteList>;
  // 견적 원본 다운로드 — 부모가 documents.handlers.download을 중계(9a가 서류 훅과 결합되지 않게).
  onDownloadOriginal: (url: string, fileName: string) => void;
};

export function QuotePreviewModals({ quoteList, onDownloadOriginal }: QuotePreviewModalsProps) {
  const { previewSentQuote, previewQuote, activePreviewQuoteUrl } = quoteList;
  const { setPreviewSentQuoteId, setPreviewQuoteId, removeQuoteOriginal } = quoteList.handlers;

  return (
    <>
      {previewSentQuote ? (
        <div className="kim-document-preview-backdrop" role="dialog" aria-label={`${previewSentQuote.title} 발송본`} onClick={() => setPreviewSentQuoteId(null)}>
          <div className="kim-sent-quote-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="kim-document-preview-head">
              <div>
                <strong>{previewSentQuote.title}</strong>
                <span>{previewSentQuote.quoteCode} · {previewSentQuote.sentAt ?? "발송 시각 확인 전"} · 고객 앱 발송본</span>
              </div>
              <button aria-label="발송본 보기 닫기" onClick={() => setPreviewSentQuoteId(null)} type="button"><X size={15} strokeWidth={2.4} /></button>
            </div>
            <div className="kim-sent-quote-preview-body">
              <section>
                <span>고객 앱 표시</span>
                <h4>{previewSentQuote.vehicleName || previewSentQuote.title}</h4>
                <p>{previewSentQuote.financeType || "조건 미정"} · {previewSentQuote.term || "기간 미정"} · {previewSentQuote.quoteCode}</p>
              </section>
              <div>
                <strong>{previewSentQuote.monthlyPayment || "월 납입금 확인 중"}</strong>
                <small>월 납입금</small>
              </div>
              <ul>
                <li>고객 앱 `내 견적` 추천 견적 탭에 노출되는 구조화 견적입니다.</li>
                <li>원본 파일과 별도로 차량/금융/기간/월납입 조건을 보관합니다.</li>
                <li>{previewSentQuote.decisionStatus === "contracting" ? "최종 계약 진행 견적으로 표시됩니다." : previewSentQuote.decisionStatus === "confirmed" ? "고객 최종 확정 견적으로 표시됩니다." : previewSentQuote.decisionStatus === "considering" ? "고객이 최종 고민중인 견적으로 표시됩니다." : "고객 확정 전 추천 견적입니다."}</li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}
      {previewQuote ? (
        <div className="kim-document-preview-backdrop" role="dialog" aria-label={`${previewQuote.title} 원본 미리보기`} onClick={() => setPreviewQuoteId(null)}>
          <div className="kim-document-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="kim-document-preview-head">
              <div>
                <strong>{previewQuote.title}</strong>
                <span>{previewQuote.quoteCode} · {previewQuote.fileName} · {formatFileSize(previewQuote.fileSize)}</span>
              </div>
              <div className="kim-document-preview-head-actions">
                <button aria-label="견적 원본 다운로드" disabled={!activePreviewQuoteUrl} onClick={() => { if (activePreviewQuoteUrl) onDownloadOriginal(activePreviewQuoteUrl, previewQuote.fileName ?? "quote"); }} type="button"><Download size={15} strokeWidth={2.3} /></button>
                <button aria-label="견적 원본 삭제" onClick={() => removeQuoteOriginal(previewQuote.id)} type="button"><Trash2 size={15} strokeWidth={2.3} /></button>
                <button aria-label="견적 원본 미리보기 닫기" onClick={() => setPreviewQuoteId(null)} type="button"><X size={15} strokeWidth={2.4} /></button>
              </div>
            </div>
            <div className="kim-document-preview-body">
              {!activePreviewQuoteUrl ? (
                <p>불러오는 중…</p>
              ) : previewQuote.mimeType?.startsWith("image/") ? (
                <img alt={previewQuote.title} src={activePreviewQuoteUrl} />
              ) : documentFileKind(previewQuote.mimeType, previewQuote.fileName) === "PDF" ? (
                <iframe src={activePreviewQuoteUrl} title={previewQuote.title} />
              ) : (
                <p>미리보기를 지원하지 않는 파일입니다.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
