import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import type { RoleTab } from "@/data/roles";
import type { VehicleStatus } from "@/data/vehicle-taxonomy";
import {
  type CatalogBrand,
  type CatalogModel,
  createModel,
  deleteModel,
  fetchBrands,
  fetchModels,
  updateModel,
} from "@/lib/catalog";
import { BrandSidebar } from "./mc-master/BrandSidebar";
import { ModelEditPanel } from "./mc-master/ModelEditPanel";
import { ModelTable } from "./mc-master/ModelTable";

type PanelState = { mode: "add" } | { mode: "edit"; model: CatalogModel } | null;

export function MCMasterPage({ roleTab }: { roleTab: RoleTab }) {
  const canEdit = roleTab === "최고관리자";
  const [brands, setBrands] = useState<CatalogBrand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [panel, setPanel] = useState<PanelState>(null);
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

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

  function reloadModels() {
    if (brandId == null) return;
    fetchModels(brandId)
      .then(setModels)
      .catch(() => setLoadError(true));
  }

  async function submitPanel(values: { name: string; category: string | null; status: VehicleStatus }) {
    if (brandId == null || panel == null) return;
    setBusy(true);
    setPanelError(null);
    try {
      if (panel.mode === "add") {
        await createModel({ brandId, name: values.name, category: values.category, status: values.status });
      } else {
        await updateModel(panel.model.id, { category: values.category, status: values.status });
      }
      setPanel(null);
      reloadModels();
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(model: CatalogModel) {
    if (!window.confirm(`'${model.name}' 모델과 하위 트림·옵션·색상이 모두 삭제됩니다. 계속할까요?`)) return;
    try {
      await deleteModel(model.id);
      reloadModels();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "삭제 실패");
    }
  }

  return (
    <section className="card va-card">
      <div className="panel-head">
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
              setPanel({ mode: "add" });
            }}
          >
            <Plus size={15} /> 모델 추가
          </button>
        )}
      </div>
      <div className="panel-body va-body">
        {loadError && <div className="notice-box error">불러오기 실패</div>}
        <div className="va-layout">
          <BrandSidebar brands={brands} selectedId={brandId} onSelect={setBrandId} />
          <ModelTable
            models={models}
            canEdit={canEdit}
            onEdit={(m) => {
              setPanelError(null);
              setPanel({ mode: "edit", model: m });
            }}
            onDelete={handleDelete}
          />
        </div>
      </div>
      {panel && (
        <ModelEditPanel
          model={panel.mode === "edit" ? panel.model : null}
          busy={busy}
          error={panelError}
          onClose={() => setPanel(null)}
          onSubmit={submitPanel}
        />
      )}
    </section>
  );
}
