import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { RoleTab } from "@/data/roles";
import { type CatalogCounts, type SyncResponse, fetchCatalogCounts, runCatalogSync } from "@/lib/catalog";

const TABLE_LABELS: [keyof CatalogCounts, string][] = [
  ["brands", "브랜드"],
  ["models", "모델"],
  ["trims", "트림"],
  ["trimOptions", "옵션"],
  ["colors", "색상"],
  ["trimOptionRelations", "옵션 관계"],
  ["trimNoOptions", "옵션 없는 트림"],
];

// sync 결과의 테이블명(catalog 테이블명, snake_case) → 한글 라벨.
const SYNC_NAME_KO: Record<string, string> = {
  brands: "브랜드",
  models: "모델",
  trims: "트림",
  trim_options: "옵션",
  colors: "색상",
  trim_no_options: "옵션 없는 트림",
  trim_option_relations: "옵션 관계",
};

export function MCMasterPage({ roleTab }: { roleTab: RoleTab }) {
  const [counts, setCounts] = useState<CatalogCounts | null>(null);
  const [countsError, setCountsError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalogCounts()
      .then(setCounts)
      .catch(() => setCountsError(true));
  }, []);

  const reloadCounts = () => {
    setCountsError(false);
    fetchCatalogCounts()
      .then(setCounts)
      .catch(() => setCountsError(true));
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const r = await runCatalogSync();
      setResult(r);
      reloadCounts();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "동기화에 실패했습니다.");
    } finally {
      setSyncing(false);
    }
  };

  const isAdmin = roleTab === "최고관리자";

  return (
    <section className="card">
      <div className="panel-head">
        <h2>차선생 차량 데이터 기준</h2>
        {isAdmin && (
          <button
            className={`catalog-sync-btn${syncing ? " is-syncing" : ""}`}
            type="button"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw size={15} strokeWidth={2.1} />
            {syncing ? "동기화 중…" : "마스터 동기화"}
          </button>
        )}
      </div>
      <div className="panel-body">
        <div className="notice-box">
          <strong>MC코드 기반 차량 마스터 — master Supabase 거울</strong>
          <span>master에서 변경된 브랜드/모델/트림/옵션/색상을 동기화해 catalog 거울을 최신으로 맞춥니다.</span>
        </div>

        <div className="mini-grid">
          {TABLE_LABELS.map(([key, label]) => (
            <article className="mini-card catalog-count-card" key={key}>
              <strong>{label}</strong>
              <span>
                {countsError ? (
                  "불러오기 실패"
                ) : counts ? (
                  <>
                    <span className="num">{counts[key].toLocaleString()}</span>건
                  </>
                ) : (
                  "…"
                )}
              </span>
            </article>
          ))}
        </div>

        {syncError && <div className="notice-box error">{syncError}</div>}

        {result && (
          <div className={`catalog-sync-result${result.ok ? "" : " warn"}`}>
            <strong>{result.ok ? "동기화 완료" : "동기화 완료 (일부 건너뜀)"}</strong>
            <ul>
              {result.tables.map((t) => (
                <li key={t.name}>
                  {SYNC_NAME_KO[t.name] ?? t.name} · 반영 <span className="num">{t.upserted.toLocaleString()}</span>건
                  · 삭제 <span className="num">{t.softDeleted.toLocaleString()}</span>건 · {t.complete ? "완료" : "건너뜀"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
