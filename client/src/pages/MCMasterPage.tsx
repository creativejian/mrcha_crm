import { useEffect, useState } from "react";

import { type CatalogCounts, fetchCatalogCounts } from "@/lib/catalog";

const TABLE_LABELS: [keyof CatalogCounts, string][] = [
  ["brands", "브랜드"],
  ["models", "모델"],
  ["trims", "트림"],
  ["trimOptions", "옵션"],
  ["colors", "색상"],
  ["trimOptionRelations", "옵션 관계"],
  ["trimNoOptions", "옵션 없는 트림"],
];

export function MCMasterPage() {
  const [counts, setCounts] = useState<CatalogCounts | null>(null);
  const [countsError, setCountsError] = useState(false);

  useEffect(() => {
    fetchCatalogCounts()
      .then(setCounts)
      .catch(() => setCountsError(true));
  }, []);

  return (
    <section className="card">
      <div className="panel-head">
        <h2>차선생 차량 데이터 기준</h2>
      </div>
      <div className="panel-body">
        <div className="notice-box">
          <strong>MC코드 기반 차량 마스터 — master Supabase catalog 직접 조회</strong>
          <span>브랜드/모델/트림/옵션/색상은 master catalog를 실시간으로 읽습니다. 데이터 갱신은 앱(master) 쪽에서 관리됩니다.</span>
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
      </div>
    </section>
  );
}
