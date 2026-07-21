import { useEffect, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent } from "react";

import { type Customer } from "@/data/customers";
import { type CustomerDetailData } from "@/lib/customers";
import { toQuoteItem, flattenPrimaryScenario, type QuoteItem } from "@/lib/quote-items";
import { updateQuote as apiUpdateQuote, deleteQuote as apiDeleteQuote, uploadQuoteOriginal, deleteQuoteOriginal, getQuoteOriginalUrl } from "@/lib/customer-quotes";
import { formatKoreanShortTime } from "@/lib/detail-utils";
import { type QuoteActionFrame, type QuoteStatusTooltip } from "@/lib/popover-frames";
import { fetchAppQuoteRequestsCached } from "@/lib/quote-requests";

import { quoteStatusDetailParts } from "../quote-meta";

type UseQuoteListArgs = {
  detail: CustomerDetailData; // quotes 초기값 + preview-URL effect의 detail.id
  customer: Customer;
  onToast: (message: string) => void;
  markRecentUpdate: (section: string) => void; // 부모 소유 — 콜백 주입
  reloadAppRequests: () => void; // 승격 견적 삭제 시 니즈 카드 배지("견적 N건"·견적 보기) 갱신 — 부모(needs) 소유
  // 목록 리로드(App 소유) — 결정 상태(contracting 등)는 목록 파생 contractingQuote(출고 정보 soft pipe
  // 프리필 소스, 2026-07-20 2단계)의 입력이라 마킹 성공 시 리프레시해야 같은 세션의 출고 콘솔이 최신
  // (savePatch의 onCustomerListChanged 관례와 동일 경로).
  onCustomerListChanged?: () => void;
  // 진행 상태 전이(App.updateCustomerWorkflow) — 계약 진행 마킹 넛지(delivery-step2 spec §8 ①ⓑ)가
  // 수락 시 호출. 낙관 반영·chance 확정 동기·PATCH·실패 롤백 전부 부모 경로 승계(신규 저장 경로 0).
  onWorkflowChange?: (customerNo: number, next: { statusGroup?: string; status?: string }) => void;
};

// 견적함 목록 + 행 액션 + 미리보기 영역(9a). 워크벤치/가격/비교카드/persist(9b~9e)는 부모 보유.
export function useQuoteList({ detail, customer, onToast, markRecentUpdate, reloadAppRequests, onCustomerListChanged, onWorkflowChange }: UseQuoteListArgs) {
  const [quotes, setQuotes] = useState<QuoteItem[]>(() => detail.quotes.map((q) => toQuoteItem(q, Date.now())));
  const [confirmingQuoteDeleteId, setConfirmingQuoteDeleteId] = useState<string | null>(null);
  const [confirmingQuoteSendId, setConfirmingQuoteSendId] = useState<string | null>(null);
  const [confirmingQuoteContractId, setConfirmingQuoteContractId] = useState<string | null>(null);
  const [confirmingQuoteContractEditId, setConfirmingQuoteContractEditId] = useState<string | null>(null);
  const [confirmingQuoteContractDowngrade, setConfirmingQuoteContractDowngrade] = useState<{ id: string; status: "confirmed" | "considering" } | null>(null);
  const [contractStageNudgeQuoteId, setContractStageNudgeQuoteId] = useState<string | null>(null);
  const [openQuoteActionId, setOpenQuoteActionId] = useState<string | null>(null);
  const [quoteActionFrame, setQuoteActionFrame] = useState<QuoteActionFrame | null>(null);
  const [hoveredQuoteStatus, setHoveredQuoteStatus] = useState<QuoteStatusTooltip | null>(null);
  const [pinnedQuoteStatus, setPinnedQuoteStatus] = useState<QuoteStatusTooltip | null>(null);
  const [quoteDropTargetId, setQuoteDropTargetId] = useState<string | null>(null);
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null);
  const [previewSentQuoteId, setPreviewSentQuoteId] = useState<string | null>(null);
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [previewQuoteUrl, setPreviewQuoteUrl] = useState<string | null>(null);

  const quoteBodyRef = useRef<HTMLDivElement>(null);
  const prevQuoteLenRef = useRef(0); // 견적함 자동 하단스크롤: 첫 로드(0→N) 제외, 새 추가(N→N+1)만

  const openQuoteAction = quotes.find((quote) => quote.id === openQuoteActionId) ?? null;
  const activeQuoteStatusTooltip = pinnedQuoteStatus ?? hoveredQuoteStatus;
  const activeQuoteStatus = activeQuoteStatusTooltip ? quotes.find((quote) => quote.id === activeQuoteStatusTooltip.id) ?? null : null;
  const activeQuoteStatusDetail = activeQuoteStatus ? quoteStatusDetailParts(activeQuoteStatus) : null;
  const previewQuote = quotes.find((quote) => quote.id === previewQuoteId) ?? null;
  // 미리보기 URL: 업로드 직후 메모리 objectUrl 우선, 영속본은 signed URL을 비동기 발급.
  const activePreviewQuoteUrl = previewQuote ? previewQuote.objectUrl ?? previewQuoteUrl : null;
  useEffect(() => {
    if (!previewQuoteId || quotes.find((q) => q.id === previewQuoteId)?.objectUrl) return () => setPreviewQuoteUrl(null);
    let cancelled = false;
    getQuoteOriginalUrl(detail.id, previewQuoteId)
      .then((r) => { if (!cancelled) setPreviewQuoteUrl(r.url); })
      .catch(() => onToast("미리보기 URL 발급에 실패했습니다."));
    return () => { cancelled = true; setPreviewQuoteUrl(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewQuoteId 변경 시에만 재실행(quotes는 파생 조회라 dep 제외)
  }, [previewQuoteId, detail.id, onToast]);
  const previewSentQuote = quotes.find((quote) => quote.id === previewSentQuoteId) ?? null;

  useEffect(() => {
    const container = quoteBodyRef.current;
    // 첫 로드(0→N)는 상단 유지, 새 견적 추가(N→N+1)만 그 견적이 보이게 하단으로.
    const grew = quotes.length > prevQuoteLenRef.current && prevQuoteLenRef.current > 0;
    prevQuoteLenRef.current = quotes.length;
    if (!grew || !container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [quotes.length]);

  useEffect(() => {
    if (!openQuoteActionId) return;

    function closeQuoteAction(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (target.closest(".kim-quote-action-popover") || target.closest(".kim-quote-row-actions")) return;
      setOpenQuoteActionId(null);
      setQuoteActionFrame(null);
      setConfirmingQuoteSendId(null);
      setConfirmingQuoteDeleteId(null);
      setConfirmingQuoteContractId(null);
      setConfirmingQuoteContractEditId(null);
      setConfirmingQuoteContractDowngrade(null);
      setContractStageNudgeQuoteId(null); // 외부 클릭 = 넛지 거절과 동치(전이 없음 — spec §8 계약 3)
    }

    function closeQuoteActionByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenQuoteActionId(null);
      setQuoteActionFrame(null);
      setConfirmingQuoteSendId(null);
      setConfirmingQuoteDeleteId(null);
      setConfirmingQuoteContractId(null);
      setConfirmingQuoteContractEditId(null);
      setConfirmingQuoteContractDowngrade(null);
      setContractStageNudgeQuoteId(null);
    }

    document.addEventListener("pointerdown", closeQuoteAction, true);
    document.addEventListener("keydown", closeQuoteActionByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeQuoteAction, true);
      document.removeEventListener("keydown", closeQuoteActionByKeyboard);
    };
  }, [openQuoteActionId]);

  useEffect(() => {
    if (!pinnedQuoteStatus) return;

    function closePinnedQuoteStatus(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (target.closest(".kim-quote-status-detail") || target.closest(".kim-quote-status-tooltip")) return;
      setPinnedQuoteStatus(null);
    }

    function closePinnedQuoteStatusByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setPinnedQuoteStatus(null);
    }

    document.addEventListener("pointerdown", closePinnedQuoteStatus, true);
    document.addEventListener("keydown", closePinnedQuoteStatusByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closePinnedQuoteStatus, true);
      document.removeEventListener("keydown", closePinnedQuoteStatusByKeyboard);
    };
  }, [pinnedQuoteStatus]);

  function attachQuoteFileToQuote(quoteId: string, file: File) {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onToast("이미지 또는 PDF 파일만 첨부할 수 있습니다.");
      return;
    }
    const quoteTitle = quotes.find((quote) => quote.id === quoteId)?.title ?? "견적";
    const prevQuotes = quotes;
    const objectUrl = URL.createObjectURL(file);
    const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    setQuotes((current) => current.map((quote) => (
      quote.id === quoteId ? {
        ...quote,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        objectUrl,
        file,
        status: quote.status === "작성중" ? "발송대기" : quote.status,
        appStatus: quote.appStatus === "draft" ? "queued" : quote.appStatus,
        originalNeedsReplacement: false,
      } : quote
    )));
    markRecentUpdate("견적함");
    if (customer.id && !quoteId.startsWith("kim-")) {
      void uploadQuoteOriginal(customer.id, quoteId, file).catch(() => {
        URL.revokeObjectURL(objectUrl);
        setQuotes(prevQuotes);
        onToast("원본 업로드에 실패했습니다.");
      });
    }
    onToast(`${quoteTitle} 원본 첨부: ${file.name}`);
  }

  function removeQuoteOriginal(quoteId: string) {
    const prevQuotes = quotes;
    const target = quotes.find((quote) => quote.id === quoteId);
    if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
    setQuotes((current) => current.map((quote) => (
      quote.id === quoteId ? { ...quote, fileName: undefined, fileSize: undefined, mimeType: undefined, objectUrl: undefined, file: undefined } : quote
    )));
    setPreviewQuoteId((current) => (current === quoteId ? null : current));
    if (customer.id && !quoteId.startsWith("kim-")) {
      void deleteQuoteOriginal(customer.id, quoteId).catch(() => { setQuotes(prevQuotes); onToast("원본 삭제에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast("견적 원본을 삭제했습니다.");
  }

  function attachQuoteFile(event: ChangeEvent<HTMLInputElement>, quoteId: string) {
    const file = event.target.files?.[0];
    if (!file) return;
    attachQuoteFileToQuote(quoteId, file);
    event.target.value = "";
  }

  function dropQuoteFile(event: ReactDragEvent<HTMLElement>, quoteId: string) {
    event.preventDefault();
    event.stopPropagation();
    setQuoteDropTargetId(null);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    attachQuoteFileToQuote(quoteId, file);
  }

  function deleteQuote(id: string) {
    const targetQuote = quotes.find((quote) => quote.id === id);
    if (targetQuote?.objectUrl) URL.revokeObjectURL(targetQuote.objectUrl);
    const prevQuotes = quotes;
    setQuotes((current) => current.filter((quote) => quote.id !== id));
    setPreviewQuoteId((current) => (current === id ? null : current));
    setConfirmingQuoteDeleteId(null);
    setConfirmingQuoteContractId(null);
    if (customer.id && !id.startsWith("kim-")) {
      void apiDeleteQuote(customer.id, id)
        .then(() => {
          // 승격 견적 삭제 시 니즈 카드 배지/버튼과 인박스 캐시를 서버 확정 후 갱신(생성 경로 useQuoteWorkbench와 대칭 —
          // 즉시 갱신하면 서버가 아직 옛 카운트를 반환해 리로딩 전까지 어긋난다).
          if (targetQuote?.sourceQuoteRequestId) { void fetchAppQuoteRequestsCached(true); reloadAppRequests(); }
          // 삭제도 contractingQuote 파생의 입력(배치 11 B#3) — 미리로드면 저장된 delivery.sourceQuoteId가
          // 죽은 견적 id로 승계 시드돼 출고 정보 저장이 400에 막힌다(마킹 경로와 동일 관례).
          onCustomerListChanged?.();
        })
        .catch(() => { setQuotes(prevQuotes); onToast("삭제에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast("견적 항목을 삭제했습니다.");
  }

  function sendQuoteToApp(id: string) {
    const sentAt = formatKoreanShortTime();
    const prevQuotes = quotes;
    setQuotes((current) => current.map((quote) => (
      quote.id === id ? {
        ...quote,
        status: "고객 확인 전",
        appStatus: "sent",
        sentAt,
        meta: `${sentAt} · 앱 발송완료`,
      } : quote
    )));
    if (customer.id && !id.startsWith("kim-")) {
      void apiUpdateQuote(customer.id, id, { status: "고객 확인 전", appStatus: "sent" }).catch(() => { setQuotes(prevQuotes); onToast("발송 저장에 실패했습니다."); });
    }
    markRecentUpdate("견적함");
    onToast(`${customer.name} 고객 앱 견적함으로 발송했습니다. 대상: ${customer.customerId}`);
  }

  function updateQuoteDecisionStatus(id: string, decisionStatus: QuoteItem["decisionStatus"]) {
    const prevQuotes = quotes;
    setQuotes((current) => current.map((quote) => (
      quote.id === id ? { ...quote, decisionStatus } : quote
    )));
    if (customer.id && !id.startsWith("kim-") && decisionStatus) {
      // 2-인자 then — 리로드 자체의 실패(reject 없는 계약이지만)가 롤백 분기로 새지 않게 분리.
      void apiUpdateQuote(customer.id, id, { decisionStatus }).then(
        () => { onCustomerListChanged?.(); },
        () => { setQuotes(prevQuotes); onToast("저장에 실패했습니다."); },
      );
    }
    markRecentUpdate("견적함");
    onToast(decisionStatus === "contracting" ? "계약 진행 견적으로 표시했습니다." : decisionStatus === "confirmed" ? "고객 확정 견적으로 표시했습니다." : decisionStatus === "considering" ? "최종 고민중 견적으로 표시했습니다." : "견적 확정 상태를 해제했습니다.");
  }

  // "최종 계약 진행" 확인창 확정 — 마킹/해제 공통 진입. 신규 마킹 ∧ 비계약완료 고객이면 계약완료 전이
  // 넛지를 연다(2026-07-21 이사님 ①ⓑ, delivery-step2 spec §8). 넛지는 마킹 확정과 동시 노출 —
  // 마킹 PATCH와 상태 전이 PATCH는 독립 낙관 2건(각자 롤백·토스트, spec §8 계약 4).
  function confirmContractDecision(id: string, currentDecisionStatus: QuoteItem["decisionStatus"]) {
    const marking = currentDecisionStatus !== "contracting";
    updateQuoteDecisionStatus(id, marking ? "contracting" : "none");
    if (marking && customer.statusGroup !== "계약완료") setContractStageNudgeQuoteId(id);
  }

  // 넛지 수락(발주 경로 선택) — 전이는 부모 App.updateCustomerWorkflow 경로 그대로(chance 확정 동기 포함).
  function applyContractStageNudge(status: string) {
    setContractStageNudgeQuoteId(null);
    setOpenQuoteActionId(null);
    setQuoteActionFrame(null);
    onWorkflowChange?.(customer.no, { statusGroup: "계약완료", status });
    markRecentUpdate("진행 상태");
    onToast(`진행 상태를 계약완료 · ${status}으로 변경했습니다.`);
  }

  // 넛지 거절 — 견적 마킹만 남기고 진행 상태는 그대로(팝오버는 유지).
  function dismissContractStageNudge() {
    setContractStageNudgeQuoteId(null);
  }

  function setPrimaryScenario(quoteId: string, scenarioId: string) {
    const prevQuotes = quotes;
    setQuotes((current) => current.map((quote) => {
      if (quote.id !== quoteId) return quote;
      const next = quote.scenarios?.find((s) => s.id === scenarioId) ?? null;
      return { ...quote, primaryScenarioId: scenarioId, ...flattenPrimaryScenario(next) };
    }));
    if (customer.id && !quoteId.startsWith("kim-")) {
      // contracting 견적의 대표 변경 = 목록 contractingQuote.lender 입력(배치 11 B#4 — 마킹 경로 관례).
      void apiUpdateQuote(customer.id, quoteId, { primaryScenarioId: scenarioId }).then(
        () => { onCustomerListChanged?.(); },
        () => { setQuotes(prevQuotes); onToast("대표 시나리오 저장에 실패했습니다."); },
      );
    }
    markRecentUpdate("견적함");
    onToast("대표 시나리오를 변경했습니다.");
  }

  // 서류/견적 미리보기가 열린 동안 배경 스크롤 잠금(부모 detailOverlayOpen OR용).
  const overlayOpen = previewQuoteId !== null || previewSentQuoteId !== null;
  // 부모 onEditorOpenChange OR용 — 9a가 보유한 모든 열림 플래그.
  const editorOpen =
    openQuoteActionId !== null ||
    previewQuoteId !== null ||
    previewSentQuoteId !== null ||
    confirmingQuoteDeleteId !== null ||
    confirmingQuoteSendId !== null ||
    confirmingQuoteContractId !== null ||
    confirmingQuoteContractEditId !== null ||
    confirmingQuoteContractDowngrade !== null ||
    contractStageNudgeQuoteId !== null;

  return {
    quotes,
    // setQuotes 임시 노출 — 9e(persist) 추출 시 명명 핸들러(appendQuote/replaceQuote/...)로 tighten 예정.
    setQuotes,
    quoteBodyRef,
    // state(컴포넌트가 직접 읽음)
    confirmingQuoteDeleteId,
    confirmingQuoteSendId,
    confirmingQuoteContractId,
    confirmingQuoteContractEditId,
    confirmingQuoteContractDowngrade,
    contractStageNudgeQuoteId,
    openQuoteActionId,
    quoteActionFrame,
    pinnedQuoteStatus,
    quoteDropTargetId,
    expandedQuoteId,
    // derived
    openQuoteAction,
    activeQuoteStatusTooltip,
    activeQuoteStatusDetail,
    previewQuote,
    activePreviewQuoteUrl,
    previewSentQuote,
    // overlay 플래그(부모 OR용)
    overlayOpen,
    editorOpen,
    handlers: {
      // 인라인 setter(JSX/부모 seam이 직접 사용)
      setConfirmingQuoteDeleteId,
      setConfirmingQuoteSendId,
      setConfirmingQuoteContractId,
      setConfirmingQuoteContractEditId,
      setConfirmingQuoteContractDowngrade,
      setOpenQuoteActionId,
      setQuoteActionFrame,
      setHoveredQuoteStatus,
      setPinnedQuoteStatus,
      setQuoteDropTargetId,
      setPreviewQuoteId,
      setPreviewSentQuoteId,
      setExpandedQuoteId,
      // 액션 함수
      attachQuoteFile,
      dropQuoteFile,
      deleteQuote,
      sendQuoteToApp,
      updateQuoteDecisionStatus,
      confirmContractDecision,
      applyContractStageNudge,
      dismissContractStageNudge,
      setPrimaryScenario,
      removeQuoteOriginal,
    },
  };
}
