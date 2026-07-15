import { useEffect, useMemo, useState } from "react";

import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { knowledgeCategoryLabel } from "@/data/knowledge-categories";
import { fetchKnowledgeArticle, fetchKnowledgeArticles, type KnowledgeDetail, type KnowledgeListItem } from "@/lib/content";

// 앱 AI 상담 근거 문서 읽기 전용(admin 참조). 카테고리 slug는 앱 매핑으로 한글 표시,
// block_number(1~12장) 순으로 그룹핑 — 앱 knowledge_list_screen 형식 미러.
function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

type KnowledgeGroup = { blockNumber: number | null; category: string; items: KnowledgeListItem[] };

export function KnowledgeBasePage() {
  const [items, setItems] = useState<KnowledgeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<KnowledgeDetail | null>(null);

  useEffect(() => {
    fetchKnowledgeArticles()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // block_number 순 그룹핑(서버가 이미 blockNumber·subNumber asc 정렬 — 등장 순서 유지).
  const groups = useMemo<KnowledgeGroup[]>(() => {
    const byCategory: KnowledgeGroup[] = [];
    for (const item of items) {
      const last = byCategory[byCategory.length - 1];
      if (last && last.category === item.category) last.items.push(item);
      else byCategory.push({ blockNumber: item.blockNumber, category: item.category, items: [item] });
    }
    return byCategory;
  }, [items]);

  function openDetail(id: string) {
    fetchKnowledgeArticle(id).then(setSelected).catch(() => setError(true));
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
          <h1>{selected.documentTitle}</h1>
          <div className="content-detail-meta">
            <span>{knowledgeCategoryLabel(selected.category)}</span>
            <span className="num">{formatDate(selected.updatedAt)}</span>
          </div>
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
          <div className="total-count">KNOWLEDGE <strong className="num">{items.length}</strong></div>
        </div>
      </div>
      {loading ? (
        <div className="content-empty">불러오는 중…</div>
      ) : error ? (
        <div className="content-empty">불러오지 못했습니다. 새로고침해 주세요.</div>
      ) : items.length === 0 ? (
        <div className="content-empty">지식 문서가 없습니다.</div>
      ) : (
        <div className="knowledge-list">
          {groups.map((group, index) => (
            <section className="knowledge-group" key={group.category}>
              <h2>
                <span className="num">{group.blockNumber ?? index + 1}.</span> {knowledgeCategoryLabel(group.category)} <span className="num">({group.items.length})</span>
              </h2>
              <div className="knowledge-items">
                {group.items.map((item) => (
                  <button className="knowledge-row" key={item.id} onClick={() => openDetail(item.id)} type="button">
                    <span>{item.documentTitle}</span>
                    <small className="num">{formatDate(item.updatedAt)}</small>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
