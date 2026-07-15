import { useEffect, useState } from "react";

import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { fetchInsight, fetchInsights, type InsightDetail, type InsightListItem } from "@/lib/content";

// 앱 소유 콘텐츠 읽기 전용(admin 참조) — 발행 상태는 앱 status(published/draft) 미러.
function statusClass(status: string) {
  return status === "published" ? "badge green" : "badge";
}
function statusLabel(status: string) {
  return status === "published" ? "발행" : "임시저장";
}
function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function InsightsPage() {
  const [items, setItems] = useState<InsightListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<InsightDetail | null>(null);

  useEffect(() => {
    fetchInsights()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  function openDetail(id: string) {
    fetchInsight(id).then(setSelected).catch(() => setError(true));
  }

  if (selected) {
    return (
      <section className="card">
        <div className="list-headbar">
          <div className="list-head-left">
            <button className="btn" onClick={() => setSelected(null)} type="button">← 목록으로</button>
          </div>
        </div>
        <article className="content-detail">
          <h1>{selected.title}</h1>
          <div className="content-detail-meta">
            <span className={statusClass(selected.status)}>{statusLabel(selected.status)}</span>
            <span>{selected.category}</span>
            <span className="num">{formatDate(selected.updatedAt)}</span>
          </div>
          {selected.summary ? <p className="content-detail-summary">{selected.summary}</p> : null}
          <div className="md-body">
            <MarkdownMessage content={selected.content} />
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="list-headbar">
        <div className="list-head-left">
          <div className="total-count">INSIGHTS <strong className="num">{items.length}</strong></div>
        </div>
      </div>
      {loading ? (
        <div className="content-empty">불러오는 중…</div>
      ) : error ? (
        <div className="content-empty">불러오지 못했습니다. 새로고침해 주세요.</div>
      ) : items.length === 0 ? (
        <div className="content-empty">인사이트가 없습니다.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>제목</th><th>카테고리</th><th>상태</th><th>수정일</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr className="content-row" key={item.id} onClick={() => openDetail(item.id)}>
                  <td>
                    <strong>{item.title}</strong>
                    {item.summary ? <span className="table-note">{item.summary}</span> : null}
                  </td>
                  <td>{item.category}</td>
                  <td><span className={statusClass(item.status)}>{statusLabel(item.status)}</span></td>
                  <td className="num">{formatDate(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
