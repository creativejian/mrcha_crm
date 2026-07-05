import { useEffect, useRef, useState } from "react";
import { type Customer, type CustomerChanceOption, type CustomerManageStatus } from "@/data/customers";
import { fetchCustomerDetail, formatActivity, updateCustomer, type CustomerDetailData, type CustomerWritePatch } from "@/lib/customers";
import { nowMs } from "@/lib/detail-utils";
import { type PurchasePopoverFrame, isPurchaseFloatingKind } from "@/lib/popover-frames";
import { type RecentUpdate, type OpenEditorState } from "@/components/customer-detail/types";
import { CustomerDetailHeader } from "@/components/customer-detail/CustomerDetailHeader";
import { CustomerMemos } from "@/components/customer-detail/CustomerMemos";
import { useCustomerMemos } from "@/components/customer-detail/hooks/useCustomerMemos";
import { CustomerChecks } from "@/components/customer-detail/CustomerChecks";
import { useCustomerChecks } from "@/components/customer-detail/hooks/useCustomerChecks";
import { CustomerSchedules } from "@/components/customer-detail/CustomerSchedules";
import { useCustomerSchedules } from "@/components/customer-detail/hooks/useCustomerSchedules";
import { CustomerDocuments } from "@/components/customer-detail/CustomerDocuments";
import { useCustomerDocuments } from "@/components/customer-detail/hooks/useCustomerDocuments";
import { StatusWorkflow } from "@/components/customer-detail/StatusWorkflow";
import { useCustomerWorkflow } from "@/components/customer-detail/hooks/useCustomerWorkflow";
import { PurchaseConditions } from "@/components/customer-detail/PurchaseConditions";
import { useCustomerPurchase } from "@/components/customer-detail/hooks/useCustomerPurchase";
import { NeedsDashboard } from "@/components/customer-detail/NeedsDashboard";
import { useCustomerNeeds } from "@/components/customer-detail/hooks/useCustomerNeeds";
import { QuoteList, QuotePreviewModals } from "@/components/customer-detail/QuoteList";
import { useQuoteList } from "@/components/customer-detail/hooks/useQuoteList";
import { QuoteWorkbench } from "@/components/customer-detail/QuoteWorkbench";
import { useQuoteWorkbench } from "@/components/customer-detail/hooks/useQuoteWorkbench";

type CustomerDetailPageProps = {
  customer: Customer;
  chanceOverride?: CustomerChanceOption;
  manageStatusOverride?: CustomerManageStatus;
  onBack: () => void;
  onFullScreen?: () => void;
  onEditorOpenChange?: (open: boolean) => void;
  onToast: (message: string) => void;
  onWorkflowChange?: (customerNo: number, next: { statusGroup?: string; status?: string; chance?: CustomerChanceOption; manageStatus?: CustomerManageStatus }) => void;
  // 목록 표시 필드(직군/연락처/상담경로/차종·구매방식/상담메모=최신 미완료 task) 변경 시 호출 → 전체보기 목록 재페치(stale 방지).
  onCustomerListChanged?: () => void;
  variant?: "page" | "drawer";
};

function editorMatches(openEditor: OpenEditorState | null, next: OpenEditorState) {
  if (!openEditor || openEditor.kind !== next.kind) return false;
  if (openEditor.kind === "needs" && next.kind === "needs") return true;
  if (openEditor.kind === "purchase" && next.kind === "purchase") return true;
  if (openEditor.kind === "purchaseMethod" && next.kind === "purchaseMethod") return true;
  if (openEditor.kind === "purchaseTiming" && next.kind === "purchaseTiming") return true;
  if (openEditor.kind === "purchaseCostFocus" && next.kind === "purchaseCostFocus") return true;
  if (openEditor.kind === "purchaseTerm" && next.kind === "purchaseTerm") return true;
  if (openEditor.kind === "purchaseInitialCost" && next.kind === "purchaseInitialCost") return true;
  if (openEditor.kind === "purchaseAnnualMileage" && next.kind === "purchaseAnnualMileage") return true;
  if (openEditor.kind === "purchaseDeliveryMethod" && next.kind === "purchaseDeliveryMethod") return true;
  if (openEditor.kind === "purchaseCustomerNotes" && next.kind === "purchaseCustomerNotes") return true;
  if (openEditor.kind === "purchaseReviewNotes" && next.kind === "purchaseReviewNotes") return true;
  if (openEditor.kind === "timeline" && next.kind === "timeline") return true;
  if (openEditor.kind === "schedule" && next.kind === "schedule") return true;
  if (openEditor.kind === "status" && next.kind === "status") return openEditor.key === next.key;
  if (openEditor.kind === "workflow" && next.kind === "workflow") return openEditor.key === next.key;
  return false;
}

function CustomerDetailContent({
  chanceOverride,
  customer,
  detail,
  manageStatusOverride,
  onEditorOpenChange,
  onToast,
  onWorkflowChange,
  onCustomerListChanged,
  onQuotesPersisted,
}: {
  chanceOverride?: CustomerChanceOption;
  customer: Customer;
  detail: CustomerDetailData;
  manageStatusOverride?: CustomerManageStatus;
  onEditorOpenChange?: CustomerDetailPageProps["onEditorOpenChange"];
  onToast: (message: string) => void;
  onWorkflowChange?: CustomerDetailPageProps["onWorkflowChange"];
  onCustomerListChanged?: CustomerDetailPageProps["onCustomerListChanged"];
  onQuotesPersisted?: () => void;
}) {
  // 구매조건 영역의 팝업 위치(purchasePopoverFrame)는 부모 소유 — toggleEditor·외부클릭 dismiss effect가 기록한다.
  const [purchasePopoverFrame, setPurchasePopoverFrame] = useState<PurchasePopoverFrame | null>(null);
  const [openEditor, setOpenEditor] = useState<OpenEditorState | null>(null);
  const [recentUpdate, setRecentUpdate] = useState<RecentUpdate>(() => ({ section: "고객 메모", updatedAt: Date.now() }));
  const [recentUpdateNow, setRecentUpdateNow] = useState(() => Date.now());
  const editorRef = useRef<HTMLDivElement>(null);

  // 낙관 갱신 후 백그라운드 PATCH. 실패 시 rollback + 토스트(쓰기는 재시도 안 함).
  function savePatch(patch: CustomerWritePatch, rollback: () => void) {
    if (!customer.id) return;
    // 성공(서버 반영) 후에만 목록 재페치 — 낙관 직후 페치하면 서버 반영 전이라 stale.
    void updateCustomer(customer.id, patch)
      .then(() => onCustomerListChanged?.())
      .catch(() => {
        rollback();
        onToast("저장에 실패했습니다");
      });
  }

  function markRecentUpdate(section: string) {
    const updatedAt = nowMs();
    setRecentUpdate({ section, updatedAt });
    setRecentUpdateNow(updatedAt);
  }

  function toggleEditor(next: OpenEditorState) {
    if (!isPurchaseFloatingKind(next.kind)) {
      setPurchasePopoverFrame(null);
    }
    setOpenEditor((current) => editorMatches(current, next) ? null : next);
  }

  const memos = useCustomerMemos({ detail, customer, onToast, markRecentUpdate });
  const checks = useCustomerChecks({ detail, customer, onToast, markRecentUpdate, onCustomerListChanged });
  // 견적함 목록 + 행 액션 + 미리보기 영역(9a). 워크벤치/가격/비교카드/persist(9b~9e)는 useQuoteWorkbench가 보유.
  const quoteList = useQuoteList({ detail, customer, onToast, markRecentUpdate });
  const documents = useCustomerDocuments({ detail, customer, onToast, markRecentUpdate });
  // 예정 일정 영역 — setOpenEditor(saveSchedule이 닫음)가 위에서 선언돼야 해서 여기서 호출.
  const schedules = useCustomerSchedules({ detail, customer, onToast, markRecentUpdate, onCloseFloatingEditor: () => setOpenEditor(null) });
  // 상태+워크플로우 영역. openEditor/setOpenEditor/toggleEditor/savePatch는 부모 소유 공유 인프라(니즈·구매조건도 사용)라 인자로 주입.
  const workflow = useCustomerWorkflow({ detail, customer, chanceOverride, manageStatusOverride, onToast, onWorkflowChange, markRecentUpdate, openEditor, setOpenEditor, toggleEditor, savePatch });
  // 상세 구매조건 영역. openEditor/setOpenEditor/editorMatches/savePatch/markRecentUpdate/setPurchasePopoverFrame는 부모 소유 공유 인프라라 인자로 주입.
  const purchase = useCustomerPurchase({ detail, onToast, openEditor, setOpenEditor, editorMatches, savePatch, markRecentUpdate, setPurchasePopoverFrame });
  // 고객 니즈 영역(앱 견적요청 카드 목록 + 단일 need 카드). savePatch/markRecentUpdate/setOpenEditor는 부모 소유 공유 인프라라 인자로 주입.
  const needs = useCustomerNeeds({ detail, onToast, savePatch, markRecentUpdate, setOpenEditor });
  // 견적 워크벤치 영역(9b~9e). markRecentUpdate/quoteList/purchase.fields/needs.reloadAppRequests는 부모 보유 공유 인프라라 인자로 주입.
  // openWorkbenchForQuoteRequest는 니즈 카드 "견적 작성"·?quoteRequest 딥링크가 호출 → 훅이 반환하면 부모가 NeedsDashboard에 중계.
  const workbench = useQuoteWorkbench({ detail, customer, onToast, markRecentUpdate, onQuotesPersisted, quoteList, purchaseFields: purchase.fields, reloadAppRequests: needs.reloadAppRequests });

  // 니즈 카드 "견적 보기": 견적함에서 승격 견적을 찾아 수정 워크벤치로. 캐시 불일치(미발견)면 기존 승격 플로우로 폴백(고정 설계 결정 5).
  function viewPromotedQuote(reqId: string, quoteId: string) {
    const quote = quoteList.quotes.find((q) => q.id === quoteId);
    if (quote) workbench.openEditQuote(quote);
    else void workbench.openWorkbenchForQuoteRequest(reqId).catch(() => onToast("견적요청 정보를 불러오지 못했습니다."));
  }

  // 서류/견적 미리보기·솔루션 워크벤치가 열린 동안 배경(고객 상세 패널·페이지) 스크롤을 잠가 스크롤 전파(chaining)를 막는다.
  const detailOverlayOpen =
    documents.overlayOpen ||
    quoteList.overlayOpen ||
    workbench.overlayOpen;
  useEffect(() => {
    if (!detailOverlayOpen) return;
    document.body.classList.add("kim-detail-overlay-open");
    return () => document.body.classList.remove("kim-detail-overlay-open");
  }, [detailOverlayOpen]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRecentUpdateNow(Date.now());
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    onEditorOpenChange?.(openEditor !== null || memos.editorOpen || checks.editorOpen || schedules.editorOpen || documents.editorOpen || workbench.editorOpen || quoteList.editorOpen);
    return () => onEditorOpenChange?.(false);
  }, [checks.editorOpen, documents.editorOpen, quoteList.editorOpen, workbench.editorOpen, memos.editorOpen, onEditorOpenChange, openEditor, schedules.editorOpen]);

  useEffect(() => {
    if (!openEditor) return;

    function closeEditor(event: PointerEvent) {
      if (editorRef.current?.contains(event.target as Node)) return;
      setOpenEditor(null);
      setPurchasePopoverFrame(null);
    }

    function closeEditorByKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenEditor(null);
        setPurchasePopoverFrame(null);
      }
    }

    document.addEventListener("pointerdown", closeEditor, true);
    document.addEventListener("keydown", closeEditorByKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeEditor, true);
      document.removeEventListener("keydown", closeEditorByKeyboard);
    };
  }, [openEditor]);

  return (
    <div className="kim-customer-dashboard">
      <div className="kim-left-dashboard">
        <CustomerDetailHeader now={recentUpdateNow} recentUpdate={recentUpdate} name={detail.name} customerCode={detail.customerCode} receivedLabel={formatActivity(detail.receivedAt)} />
        <StatusWorkflow
          customer={customer}
          onToast={onToast}
          openEditor={openEditor}
          setOpenEditor={setOpenEditor}
          toggleEditor={toggleEditor}
          editorRef={editorRef}
          workflow={workflow}
        />
      </div>

      <NeedsDashboard
        detail={detail}
        onToast={onToast}
        openEditor={openEditor}
        setOpenEditor={setOpenEditor}
        toggleEditor={toggleEditor}
        editorRef={editorRef}
        openWorkbenchForQuoteRequest={workbench.openWorkbenchForQuoteRequest}
        onViewQuote={viewPromotedQuote}
        needsHook={needs}
      />

      <section className="kim-workspace-band" aria-label={`${customer.name} 실무 영역`}>
        <section className="kim-condition-consult-grid" aria-label={`${customer.name} 구매조건과 고객 메모`}>
          <PurchaseConditions
            onToast={onToast}
            openEditor={openEditor}
            setOpenEditor={setOpenEditor}
            editorRef={editorRef}
            purchasePopoverFrame={purchasePopoverFrame}
            purchase={purchase}
          />

          <CustomerMemos {...memos} />
        </section>

        <section className="kim-mvp-ops-grid" aria-label={`${customer.name} 고객 운영 기능`}>
        <CustomerChecks {...checks} />

        <CustomerSchedules {...schedules} />

        <QuoteList
          quoteList={quoteList}
          customer={customer}
          appUserId={detail.appUserId}
          onToast={onToast}
          onOpenNewWorkbench={workbench.openNewWorkbench}
          onEditQuote={workbench.openEditQuote}
        />

        <QuoteWorkbench workbench={workbench} customer={customer} onToast={onToast} />

        <CustomerDocuments {...documents} />
        </section>
      </section>
      <QuotePreviewModals quoteList={quoteList} onDownloadOriginal={documents.handlers.download} />
    </div>
  );
}

export function CustomerDetailPage({
  chanceOverride,
  customer,
  manageStatusOverride,
  onEditorOpenChange,
  onToast,
  onWorkflowChange,
  onCustomerListChanged,
  variant = "page",
}: CustomerDetailPageProps) {
  const drawerMode = variant === "drawer";
  const [detail, setDetail] = useState<CustomerDetailData | null>(null);
  const [detailError, setDetailError] = useState(false);
  useEffect(() => {
    if (!customer.id) return;
    let cancelled = false;
    fetchCustomerDetail(customer.id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetailError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customer.id]);

  // 견적 저장/발송 성공 후 현재 마운트의 detail을 재동기화한다. apiUpdate/CreateQuote가 이미
  // invalidateCustomerDetail을 호출하므로 fetch는 fresh. detail.quotes가 stale이면 수정 진입
  // editPrefill(옵션/색상/가격)이 옛 값으로 복원되던 버그를 막는다.
  function reloadDetail() {
    if (!customer.id) return;
    fetchCustomerDetail(customer.id).then((data) => setDetail(data)).catch(() => {});
  }

  return (
    <div className={`customer-detail-console-page ${drawerMode ? "drawer" : ""} kim-detail-mode`}>
      {detailError ? (
        <div className="kim-detail-loading">고객 정보를 불러오지 못했습니다.</div>
      ) : detail ? (
        <CustomerDetailContent
          key={customer.id}
          detail={detail}
          chanceOverride={chanceOverride}
          customer={customer}
          manageStatusOverride={manageStatusOverride}
          onEditorOpenChange={onEditorOpenChange}
          onToast={onToast}
          onWorkflowChange={onWorkflowChange}
          onCustomerListChanged={onCustomerListChanged}
          onQuotesPersisted={reloadDetail}
        />
      ) : (
        <div className="kim-detail-skeleton" aria-hidden="true" />
      )}
    </div>
  );
}
