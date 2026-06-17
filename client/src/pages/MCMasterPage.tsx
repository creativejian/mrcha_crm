import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Plus } from "lucide-react";

import type { RoleTab } from "@/data/roles";
import type { VehicleStatus } from "@/data/vehicle-taxonomy";
import {
  type CatalogBrand,
  type CatalogModel,
  type CatalogTrim,
  type TrimInput,
  createModel,
  createTrim,
  deleteModel,
  deleteTrim,
  fetchBrands,
  fetchModels,
  fetchTrims,
  updateModel,
  updateTrim,
} from "@/lib/catalog";
import { BrandSidebar } from "./mc-master/BrandSidebar";
import { ModelEditPanel } from "./mc-master/ModelEditPanel";
import { ModelTable } from "./mc-master/ModelTable";
import { TrimEditPanel } from "./mc-master/TrimEditPanel";
import { TrimTable } from "./mc-master/TrimTable";

type ModelPanelState = { mode: "add" } | { mode: "edit"; model: CatalogModel } | null;
type TrimPanelState = { mode: "add" } | { mode: "edit"; trim: CatalogTrim } | null;

export function MCMasterPage({ roleTab }: { roleTab: RoleTab }) {
  const canEdit = roleTab === "최고관리자";
  const navigate = useNavigate();
  const { modelId } = useParams();
  const [brands, setBrands] = useState<CatalogBrand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [trims, setTrims] = useState<CatalogTrim[]>([]);
  const [modelPanel, setModelPanel] = useState<ModelPanelState>(null);
  const [trimPanel, setTrimPanel] = useState<TrimPanelState>(null);
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  // 드릴다운은 URL(/mc-master/:modelId)이 source of truth → 브라우저 뒤로가기 작동.
  const openModel = useMemo(
    () => (modelId ? (models.find((m) => String(m.id) === modelId) ?? null) : null),
    [models, modelId],
  );

  useEffect(() => {
    fetchBrands()
      .then((b) => {
        setBrands(b);
        setBrandId((cur) => cur ?? b[0]?.id ?? null);
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    if (brandId == null) return;
    fetchModels(brandId)
      .then(setModels)
      .catch(() => setLoadError(true));
  }, [brandId]);

  useEffect(() => {
    // modelId 없으면 트림 뷰가 렌더되지 않으므로 동기 clear 불필요(set-state-in-effect 회피).
    if (!modelId) return;
    fetchTrims(Number(modelId))
      .then(setTrims)
      .catch(() => setLoadError(true));
  }, [modelId]);

  function reloadModels() {
    if (brandId == null) return;
    fetchModels(brandId)
      .then(setModels)
      .catch(() => setLoadError(true));
  }
  function reloadTrims() {
    if (!modelId) return;
    fetchTrims(Number(modelId))
      .then(setTrims)
      .catch(() => setLoadError(true));
  }

  function selectBrand(id: number) {
    setBrandId(id);
    navigate("/mc-master"); // 브랜드 전환 시 드릴다운 해제
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

  async function handleDeleteModel(model: CatalogModel) {
    if (!window.confirm(`'${model.name}' 모델과 하위 트림·옵션·색상이 모두 삭제됩니다. 계속할까요?`)) return;
    try {
      await deleteModel(model.id);
      reloadModels();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "삭제 실패");
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
      reloadModels(); // 모델 집계(트림수·가격범위) 갱신
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteTrim(trim: CatalogTrim) {
    if (!window.confirm(`'${trim.trimName}' 트림과 하위 옵션·색상이 모두 삭제됩니다. 계속할까요?`)) return;
    try {
      await deleteTrim(trim.id);
      reloadTrims();
      reloadModels();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "삭제 실패");
    }
  }

  return (
    <section className="card va-card">
      <div className="panel-head">
        {modelId ? (
          <>
            <div className="va-head-back">
              <button type="button" className="tiny-btn" aria-label="뒤로" onClick={() => navigate("/mc-master")}>
                <ArrowLeft size={15} />
              </button>
              <h2>{openModel?.name ?? "트림"}</h2>
            </div>
            {canEdit && (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setPanelError(null);
                  setTrimPanel({ mode: "add" });
                }}
              >
                <Plus size={15} /> 트림 추가
              </button>
            )}
          </>
        ) : (
          <>
            <div>
              <h2>차량 관리</h2>
              <p className="va-subtitle">
                차선생 앱·견적 솔루션이 쓰는 브랜드/모델/트림 기준 데이터입니다. 편집 즉시 master에 반영됩니다.
              </p>
            </div>
            {canEdit && brandId != null && (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setPanelError(null);
                  setModelPanel({ mode: "add" });
                }}
              >
                <Plus size={15} /> 모델 추가
              </button>
            )}
          </>
        )}
      </div>
      <div className="panel-body va-body">
        {loadError && <div className="notice-box error">불러오기 실패</div>}
        <div className="va-layout">
          <BrandSidebar brands={brands} selectedId={brandId} onSelect={selectBrand} />
          {modelId ? (
            <TrimTable
              trims={trims}
              canEdit={canEdit}
              onEdit={(t) => {
                setPanelError(null);
                setTrimPanel({ mode: "edit", trim: t });
              }}
              onDelete={handleDeleteTrim}
            />
          ) : (
            <ModelTable
              models={models}
              canEdit={canEdit}
              onOpen={(m) => navigate(`/mc-master/${m.id}`)}
              onEdit={(m) => {
                setPanelError(null);
                setModelPanel({ mode: "edit", model: m });
              }}
              onDelete={handleDeleteModel}
            />
          )}
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
          busy={busy}
          error={panelError}
          onClose={() => setTrimPanel(null)}
          onSubmit={submitTrim}
        />
      )}
    </section>
  );
}
