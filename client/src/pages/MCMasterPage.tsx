import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ArrowLeft, CheckSquare, FolderInput, Hash, Plus } from "lucide-react";

import type { RoleTab } from "@/data/roles";
import type { VehicleStatus } from "@/data/vehicle-taxonomy";
import {
  type CatalogModel,
  type CatalogTrim,
  type TrimInput,
  assignMcCodes,
  createModel,
  createTrim,
  deleteModel,
  deleteTrim,
  moveTrims,
  reorderModels,
  reorderTrims,
  updateModel,
  updateTrim,
} from "@/lib/catalog";
import { useDealerDiscounts } from "@/lib/dealer-discounts";
import { useDealerMe } from "@/lib/dealer-profiles";
import type { DiscountField } from "@/lib/discount-adoption";
import { useTrimProposals } from "@/lib/discount-proposals";
import { BrandSidebar } from "./mc-master/BrandSidebar";
import { prefetchModels, prefetchOptions, prefetchTrims } from "./mc-master/catalog-cache";
import { GroupedTrimTable } from "./mc-master/GroupedTrimTable";
import { brandIdFromSearch, mcMasterPath } from "./mc-master/mc-master-route";
import { ModelEditPanel } from "./mc-master/ModelEditPanel";
import { ModelTable } from "./mc-master/ModelTable";
import { MoveTrimsDialog } from "./mc-master/MoveTrimsDialog";
import { OptionPanel } from "./mc-master/OptionPanel";
import { TrimEditPanel } from "./mc-master/TrimEditPanel";
import { TrimTable } from "./mc-master/TrimTable";
import { moveItem } from "./mc-master/reorder";
import { SCOPE_BRAND_PENDING, useMcMasterCatalog } from "./mc-master/useMcMasterCatalog";
import { useMcMasterSelection } from "./mc-master/useMcMasterSelection";
import { mcMasterViewState } from "./mc-master/view-state";

type ModelPanelState = { mode: "add" } | { mode: "edit"; model: CatalogModel } | null;
type TrimPanelState = { mode: "add" } | { mode: "edit"; trim: CatalogTrim } | null;
type TrimTab = "list" | "order";

export function MCMasterPage({ roleTab }: { roleTab: RoleTab }) {
  const canEdit = roleTab === "최고관리자";
  const navigate = useNavigate();
  const { modelId } = useParams();
  const urlBrandId = brandIdFromSearch(useLocation().search);

  // 딜러 모드 — 자기 브랜드만 본다(유슨생 결정: 경쟁사 가격·할인 전략 비노출).
  // ⚠️ 이 차단은 **클라 스코프**다. catalog 읽기 API는 그대로 열려 있고, 그 데이터(기본가·MC코드·
  // 색상)는 차선생 앱에서 고객에게 공개되는 정보라 서버 강제는 과잉으로 판단했다 — 기밀 차단이
  // 아니라 정보 위생·UX 목적이다(쓰기는 서버가 fail-closed로 막는다 — 슬라이스 B1).
  const dealerMode = roleTab === "딜러";
  const { me: dealerMe, loaded: dealerMeLoaded } = useDealerMe(dealerMode);
  // 프로필 도착 전에는 스코프를 알 수 없다 — 그 사이 전 브랜드가 스치는 것을 막으려고 센티널을
  // 넣어 빈 목록으로 둔다(fetch도 보내지 않는다 — 훅의 SCOPE_BRAND_PENDING 가드). 도착하면 실제
  // 브랜드로 좁혀진다.
  const scopeBrandId = dealerMode ? (dealerMe?.brandId ?? SCOPE_BRAND_PENDING) : null;
  // 딜러 모드에서만 내 제안을 로드한다(다른 role은 요청조차 보내지 않는다).
  // 저장은 트림 단위로 3금액을 함께 PUT하고, 실패는 셀이 자기 상태로 알린다(훅이 throw).
  const { byTrim: dealerProposals, save: saveProposal } = useDealerDiscounts(
    modelId ? Number(modelId) : null,
    dealerMode,
  );

  const {
    brands,
    brandId,
    models,
    setModels,
    trims,
    setTrims,
    colorsByTrim,
    optionByTrim,
    loadError,
    expandedGroups,
    toggleGroup,
    reloadModels,
    reloadTrims,
    reloadOptionSummary,
  } = useMcMasterCatalog(modelId, urlBrandId, scopeBrandId);

  // 관리자 채택(슬라이스 C) — 딜러가 낸 제안을 필드 단위로 확정 할인에 반영한다.
  // canEdit(최고관리자)일 때만 요청한다: 서버도 requireRoles(["admin"])로 막지만, staff 화면에서
  // 403을 유발하는 요청을 굳이 보내지 않는다.
  const { byTrim: trimProposals, adopt } = useTrimProposals(modelId ? Number(modelId) : null, canEdit);
  // 채택은 catalog.trims를 바꾸므로 트림 목록을 다시 읽어야 확정값 셀이 갱신된다
  // (제안 목록 자체는 훅이 자기 데이터를 다시 받는다 — 다른 딜러의 상태까지 함께 바뀐다).
  const handleAdopt = useCallback(
    async (trimId: number, field: DiscountField, dealerUserId: string) => {
      await adopt(trimId, field, dealerUserId);
      reloadTrims();
    },
    [adopt, reloadTrims],
  );

  // 딜러 모드: URL의 modelId가 내 브랜드 모델이 아니면 첫 모델로 교정한다.
  // brandId 스코프는 사이드바와 모델 목록을 좁히지만 **modelId는 독립 경로**다 — 손으로 고친 URL이나
  // 구 북마크로 타 브랜드 모델을 열면 브랜드는 내 것인데 트림만 남의 것이 로드된다.
  // (교정 직전 한 프레임은 그 트림이 스칠 수 있다. 기본가·MC코드는 차선생 앱 공개 정보라 그 수준을
  //  수용한다 — 쓰기는 서버가 브랜드 소유권으로 막는다, 슬라이스 B1.)
  useEffect(() => {
    if (!dealerMode || !modelId || models.length === 0) return;
    if (!models.some((m) => String(m.id) === modelId)) {
      navigate(`/mc-master/${models[0]!.id}`, { replace: true });
    }
  }, [dealerMode, modelId, models, navigate]);
  const {
    selectMode,
    selected,
    draggingId,
    dragId,
    resetSelect,
    toggleSelectMode,
    toggle,
    toggleAll,
    onDragStart,
    endDrag,
    clearSelected,
  } = useMcMasterSelection();

  const [modelPanel, setModelPanel] = useState<ModelPanelState>(null);
  const [trimPanel, setTrimPanel] = useState<TrimPanelState>(null);
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [optionPanelTrim, setOptionPanelTrim] = useState<CatalogTrim | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [trimTab, setTrimTab] = useState<TrimTab>("list");
  const scrollRef = useRef<HTMLDivElement>(null);

  const inTrimView = modelId != null;
  const openModel = useMemo(
    () => (modelId ? (models.find((m) => String(m.id) === modelId) ?? null) : null),
    [models, modelId],
  );
  // 국산차만 서브라인 그룹/순서관리 탭. 현재 선택 브랜드 기준(트림 뷰 모델은 이 브랜드 소속).
  const isDomestic = brands.find((b) => b.id === brandId)?.isDomestic ?? false;
  const groupedView = inTrimView && isDomestic && trimTab === "list";

  // 선택 브랜드를 URL에 되비춘다 — Topbar 메뉴는 쿼리 없는 /mc-master를 열기 때문에,
  // 폴백으로 복원한 브랜드를 URL에 replace로 실어야 화면과 주소가 어긋나지 않는다(공유·새로고침).
  // 모듈 상태에도 남겨 다음 재진입의 폴백으로 쓴다(view-state.ts).
  useEffect(() => {
    if (brandId == null) return;
    mcMasterViewState.brandId = brandId;
    if (brandId !== urlBrandId) navigate(mcMasterPath(brandId, modelId), { replace: true });
  }, [brandId, urlBrandId, modelId, navigate]);

  // 스크롤 위치 보존(모델 목록·트림 목록 각각): 트림 뷰 왕복은 물론 다른 메뉴에 갔다 와도 복원.
  // 트림은 모델별로 나눠 담아 다른 모델에 들어갈 땐 맨 위에서 시작한다(view-state.ts).
  function onScroll() {
    if (!scrollRef.current) return;
    if (modelId) mcMasterViewState.trimScrollTop.set(modelId, scrollRef.current.scrollTop);
    else mcMasterViewState.modelScrollTop = scrollRef.current.scrollTop;
  }
  // 목록이 채워진 뒤(models/trims) 복원해야 한다 — 빈 목록에 scrollTop을 주면 0으로 잘린다.
  // 그룹 접힘(expandedGroups)·탭 전환은 사용자가 방금 한 조작이라 일부러 deps에 넣지 않는다.
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = modelId ? (mcMasterViewState.trimScrollTop.get(modelId) ?? 0) : mcMasterViewState.modelScrollTop;
  }, [modelId, models, trims]);

  function selectBrand(id: number) {
    resetSelect();
    mcMasterViewState.modelScrollTop = 0; // 브랜드가 바뀌면 모델 목록은 맨 위부터(앱 admin과 동일).
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    // 브랜드 전환은 replace — 탭 전환 성격이라 히스토리에 쌓이면 뒤로가기가 브랜드 되짚기가 된다(앱 admin과 동일).
    navigate(mcMasterPath(id), { replace: true });
  }
  function openModelView(m: CatalogModel) {
    resetSelect();
    setTrimTab("list");
    navigate(mcMasterPath(brandId, m.id));
  }
  function backToModels() {
    resetSelect();
    navigate(mcMasterPath(brandId));
  }
  function switchTrimTab(tab: TrimTab) {
    setTrimTab(tab);
    resetSelect();
  }

  async function submitModel(values: { name: string; category: string | null; status: VehicleStatus }) {
    if (brandId == null || modelPanel == null) return;
    setBusy(true);
    setPanelError(null);
    try {
      if (modelPanel.mode === "add") {
        await createModel({ brandId, name: values.name, category: values.category, status: values.status });
      } else {
        await updateModel(modelPanel.model.id, { category: values.category, status: values.status });
      }
      setModelPanel(null);
      reloadModels();
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function submitTrim(values: TrimInput) {
    if (modelId == null || trimPanel == null) return;
    setBusy(true);
    setPanelError(null);
    try {
      if (trimPanel.mode === "add") {
        await createTrim(Number(modelId), values);
      } else {
        await updateTrim(trimPanel.trim.id, values);
      }
      setTrimPanel(null);
      reloadTrims();
      reloadModels();
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  // ── 선택 모드(일괄삭제 + 드래그 순서변경) ──────────────────────────────────────
  // 전체선택/순서변경/저장은 선택 상태(selection)와 카탈로그 데이터(catalog) 양쪽을 만져
  // 컴포넌트에서 엮는다.
  const toggleAllRows = () => toggleAll((inTrimView ? trims : models).map((r) => r.id));
  // 인덱스를 setter 안(최신 list)에서 계산 — stale closure로 엉뚱하게 이동/중복되는 문제 방지.
  function onDragOverRow(overId: number) {
    const cur = dragId.current;
    if (cur == null || cur === overId) return;
    if (inTrimView) {
      setTrims((list) => moveItem(list, list.findIndex((t) => t.id === cur), list.findIndex((t) => t.id === overId)));
    } else {
      setModels((list) => moveItem(list, list.findIndex((m) => m.id === cur), list.findIndex((m) => m.id === overId)));
    }
  }
  async function onDrop() {
    endDrag();
    try {
      if (inTrimView) await reorderTrims(trims.map((t) => t.id));
      else await reorderModels(models.map((m) => m.id));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "순서변경 실패");
      if (inTrimView) reloadTrims();
      else reloadModels();
    }
  }
  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`선택한 ${ids.length}개와 하위 데이터가 모두 삭제됩니다. 계속할까요?`)) return;
    try {
      for (const idv of ids) {
        if (inTrimView) await deleteTrim(idv);
        else await deleteModel(idv);
      }
      clearSelected();
      reloadModels();
      if (inTrimView) reloadTrims();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "삭제 실패");
    }
  }
  async function assignCodes() {
    if (modelId == null) return;
    setBusy(true);
    try {
      const r = await assignMcCodes(Number(modelId));
      reloadTrims();
      window.alert(`${r.assigned}개 트림에 고유번호를 부여했습니다.`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "고유번호 부여 실패");
    } finally {
      setBusy(false);
    }
  }
  async function doMove(targetModelId: number) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await moveTrims(ids, targetModelId);
      setMoveOpen(false);
      resetSelect();
      reloadTrims();
      reloadModels();
      reloadOptionSummary();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "이동 실패");
    } finally {
      setBusy(false);
    }
  }

  const editActions = (
    onAdd: () => void,
    addLabel: string,
    allowSelect = true,
    extra: ReactNode = null,
    onMove: (() => void) | null = null,
  ) =>
    canEdit ? (
      <div className="va-head-actions">
        {allowSelect && selectMode && selected.size > 0 && (
          <button type="button" className="btn va-danger-btn" onClick={bulkDelete}>
            선택 삭제 ({selected.size})
          </button>
        )}
        {allowSelect && selectMode && selected.size > 0 && onMove && (
          <button type="button" className="btn" onClick={onMove}>
            <FolderInput size={15} /> 모델 이동
          </button>
        )}
        {!selectMode && extra}
        {!selectMode && (
          <button type="button" className="btn primary" onClick={onAdd}>
            <Plus size={15} /> {addLabel}
          </button>
        )}
        {allowSelect && (
          <button
            type="button"
            className={`btn${selectMode ? " va-select-on" : ""}`}
            onClick={toggleSelectMode}
          >
            <CheckSquare size={15} /> {selectMode ? "취소" : "선택"}
          </button>
        )}
      </div>
    ) : null;

  return (
    <section className="card va-card">
      <div className="panel-head">
        {inTrimView ? (
          <>
            <div className="va-head-back">
              <button type="button" className="tiny-btn" aria-label="뒤로" onClick={backToModels}>
                <ArrowLeft size={15} />
              </button>
              {openModel?.imageUrl && <img src={openModel.imageUrl} alt="" className="va-head-thumb" />}
              <h2>
                {openModel?.name ?? "트림"}
                {openModel ? ` (${trims.length})` : ""}
              </h2>
            </div>
            {editActions(
              () => {
                setPanelError(null);
                setTrimPanel({ mode: "add" });
              },
              "트림 추가",
              !groupedView,
              canEdit && trims.some((t) => !t.mcCode) ? (
                <button type="button" className="btn" onClick={assignCodes} disabled={busy}>
                  <Hash size={15} /> 고유번호 할당
                </button>
              ) : null,
              () => setMoveOpen(true),
            )}
          </>
        ) : (
          <>
            {/* 딜러는 브랜드가 하나뿐이라(dealer_profiles PK = dealer_user_id) 사이드바를 감추는 대신
                브랜드명을 헤더에 넣는다 — Topbar 조직 라벨과 중복이지만 본문만 봐도 맥락이 남는다.
                brandName이 null이면(브랜드가 catalog에서 삭제됨) 접두 없이 원래 문구로 떨어진다. */}
            <h2>{dealerMode && dealerMe?.brandName ? `${dealerMe.brandName} 차량 관리` : "차량 관리"}</h2>
            {brandId != null &&
              editActions(() => {
                setPanelError(null);
                setModelPanel({ mode: "add" });
              }, "모델 추가")}
          </>
        )}
      </div>
      <div className="panel-body va-body">
        {loadError && <div className="notice-box error">불러오기 실패</div>}
        {/* 브랜드 미지정 딜러에게는 빈 사이드바만 보이면 고장으로 읽힌다 — 사실을 알려 요청하게 한다. */}
        {dealerMode && dealerMeLoaded && dealerMe == null && (
          <div className="notice-box">담당 브랜드가 지정되지 않았습니다. 관리자에게 브랜드 지정을 요청해 주세요.</div>
        )}
        {/* 딜러 모드에선 브랜드 열이 선택지 1개짜리 장식이다(진입 시 자동 선택돼 누를 것도 없다) —
            140px을 비우고 모델·트림 표를 전폭으로 쓴다. 관리자 화면은 그대로 2열이다. */}
        <div className={`va-layout${dealerMode ? " va-layout-full" : ""}`}>
          {!dealerMode && (
            <BrandSidebar brands={brands} selectedId={brandId} onSelect={selectBrand} onPrefetch={prefetchModels} />
          )}
          <div className="table-scroll va-scroll" ref={scrollRef} onScroll={onScroll}>
            {inTrimView && isDomestic && (
              <div className="va-trim-tabs">
                <button
                  type="button"
                  className={`va-trim-tab${trimTab === "list" ? " active" : ""}`}
                  onClick={() => switchTrimTab("list")}
                >
                  목록 보기
                </button>
                <button
                  type="button"
                  className={`va-trim-tab${trimTab === "order" ? " active" : ""}`}
                  onClick={() => switchTrimTab("order")}
                >
                  순서 관리
                </button>
              </div>
            )}
            {inTrimView ? (
              groupedView ? (
                <GroupedTrimTable
                  trims={trims}
                  canEdit={canEdit}
                  dealerProposals={dealerMode ? dealerProposals : undefined}
                  onSaveProposal={dealerMode ? saveProposal : undefined}
                  proposalsByTrim={canEdit ? trimProposals : undefined}
                  onAdopt={canEdit ? handleAdopt : undefined}
                  colorsByTrim={colorsByTrim}
                  optionByTrim={optionByTrim}
                  expanded={expandedGroups}
                  onToggleGroup={toggleGroup}
                  onEdit={(t) => {
                    setPanelError(null);
                    setTrimPanel({ mode: "edit", trim: t });
                  }}
                  onOpenOptions={setOptionPanelTrim}
                  onPrefetchOptions={prefetchOptions}
                />
              ) : (
                <TrimTable
                  trims={trims}
                  canEdit={canEdit}
                  dealerProposals={dealerMode ? dealerProposals : undefined}
                  onSaveProposal={dealerMode ? saveProposal : undefined}
                  proposalsByTrim={canEdit ? trimProposals : undefined}
                  onAdopt={canEdit ? handleAdopt : undefined}
                  isDomestic={isDomestic}
                  selectMode={selectMode}
                  selected={selected}
                  draggingId={draggingId}
                  colorsByTrim={colorsByTrim}
                  optionByTrim={optionByTrim}
                  onEdit={(t) => {
                    setPanelError(null);
                    setTrimPanel({ mode: "edit", trim: t });
                  }}
                  onOpenOptions={setOptionPanelTrim}
                  onPrefetchOptions={prefetchOptions}
                  onToggle={toggle}
                  onToggleAll={toggleAllRows}
                  onDragStart={onDragStart}
                  onDragOver={onDragOverRow}
                  onDrop={onDrop}
                />
              )
            ) : (
              <ModelTable
                models={models}
                canEdit={canEdit}
                selectMode={selectMode}
                selected={selected}
                draggingId={draggingId}
                onOpen={openModelView}
                onEdit={(m) => {
                  setPanelError(null);
                  setModelPanel({ mode: "edit", model: m });
                }}
                onToggle={toggle}
                onToggleAll={toggleAllRows}
                onPrefetch={(m) => prefetchTrims(m.id)}
                onDragStart={onDragStart}
                onDragOver={onDragOverRow}
                onDrop={onDrop}
              />
            )}
          </div>
        </div>
      </div>
      {modelPanel && (
        <ModelEditPanel
          model={modelPanel.mode === "edit" ? modelPanel.model : null}
          busy={busy}
          error={panelError}
          onClose={() => setModelPanel(null)}
          onSubmit={submitModel}
        />
      )}
      {trimPanel && (
        <TrimEditPanel
          trim={trimPanel.mode === "edit" ? trimPanel.trim : null}
          modelStatus={openModel?.status ?? null}
          busy={busy}
          error={panelError}
          onClose={() => setTrimPanel(null)}
          onSubmit={submitTrim}
        />
      )}
      {moveOpen && (
        <MoveTrimsDialog
          count={selected.size}
          targets={models.filter((m) => String(m.id) !== modelId)}
          busy={busy}
          onClose={() => setMoveOpen(false)}
          onMove={doMove}
        />
      )}
      {optionPanelTrim && (
        <OptionPanel
          key={optionPanelTrim.id}
          trim={optionPanelTrim}
          canEdit={canEdit}
          summary={optionByTrim.get(optionPanelTrim.id)}
          onClose={() => setOptionPanelTrim(null)}
          onChanged={reloadOptionSummary}
        />
      )}
    </section>
  );
}
