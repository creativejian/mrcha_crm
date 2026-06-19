import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
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
import { BrandSidebar } from "./mc-master/BrandSidebar";
import { prefetchModels, prefetchTrims } from "./mc-master/catalog-cache";
import { GroupedTrimTable } from "./mc-master/GroupedTrimTable";
import { ModelEditPanel } from "./mc-master/ModelEditPanel";
import { ModelTable } from "./mc-master/ModelTable";
import { MoveTrimsDialog } from "./mc-master/MoveTrimsDialog";
import { OptionPanel } from "./mc-master/OptionPanel";
import { TrimEditPanel } from "./mc-master/TrimEditPanel";
import { TrimTable } from "./mc-master/TrimTable";
import { moveItem } from "./mc-master/reorder";
import { useMcMasterCatalog } from "./mc-master/useMcMasterCatalog";
import { useMcMasterSelection } from "./mc-master/useMcMasterSelection";

type ModelPanelState = { mode: "add" } | { mode: "edit"; model: CatalogModel } | null;
type TrimPanelState = { mode: "add" } | { mode: "edit"; trim: CatalogTrim } | null;
type TrimTab = "list" | "order";

export function MCMasterPage({ roleTab }: { roleTab: RoleTab }) {
  const canEdit = roleTab === "최고관리자";
  const navigate = useNavigate();
  const { modelId } = useParams();

  const {
    brands,
    brandId,
    setBrandId,
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
  } = useMcMasterCatalog(modelId);
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
  const modelScrollTop = useRef(0);

  const inTrimView = modelId != null;
  const openModel = useMemo(
    () => (modelId ? (models.find((m) => String(m.id) === modelId) ?? null) : null),
    [models, modelId],
  );
  // 국산차만 서브라인 그룹/순서관리 탭. 현재 선택 브랜드 기준(트림 뷰 모델은 이 브랜드 소속).
  const isDomestic = brands.find((b) => b.id === brandId)?.isDomestic ?? false;
  const groupedView = inTrimView && isDomestic && trimTab === "list";

  // 모델 목록 스크롤 위치 보존: 트림 뷰로 들어갔다 뒤로 와도 위치 복원.
  function onScroll() {
    if (!inTrimView && scrollRef.current) modelScrollTop.current = scrollRef.current.scrollTop;
  }
  useLayoutEffect(() => {
    if (!inTrimView && scrollRef.current) scrollRef.current.scrollTop = modelScrollTop.current;
  }, [inTrimView, models]);

  function selectBrand(id: number) {
    setBrandId(id);
    resetSelect();
    modelScrollTop.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    navigate("/mc-master");
  }
  function openModelView(m: CatalogModel) {
    resetSelect();
    setTrimTab("list");
    navigate(`/mc-master/${m.id}`);
  }
  function backToModels() {
    resetSelect();
    navigate("/mc-master");
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
            <h2>차량 관리</h2>
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
        <div className="va-layout">
          <BrandSidebar brands={brands} selectedId={brandId} onSelect={selectBrand} onPrefetch={prefetchModels} />
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
                  colorsByTrim={colorsByTrim}
                  optionByTrim={optionByTrim}
                  expanded={expandedGroups}
                  onToggleGroup={toggleGroup}
                  onEdit={(t) => {
                    setPanelError(null);
                    setTrimPanel({ mode: "edit", trim: t });
                  }}
                  onOpenOptions={setOptionPanelTrim}
                />
              ) : (
                <TrimTable
                  trims={trims}
                  canEdit={canEdit}
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
          trim={optionPanelTrim}
          canEdit={canEdit}
          initialNoOption={optionByTrim.get(optionPanelTrim.id)?.noOption ?? false}
          onClose={() => setOptionPanelTrim(null)}
          onChanged={reloadOptionSummary}
        />
      )}
    </section>
  );
}
