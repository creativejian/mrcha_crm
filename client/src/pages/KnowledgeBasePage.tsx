import { useMemo } from "react";

import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { knowledgeCategoryLabel } from "@/data/knowledge-categories";
import { fetchKnowledgeArticle, fetchKnowledgeArticles, formatContentDate, type KnowledgeDetail, type KnowledgeListItem } from "@/lib/content";
import { useReadonlyContent } from "@/lib/use-readonly-content";

// 앱 AI 상담 근거 문서 읽기 전용(admin 참조). 카테고리 slug는 앱 매핑으로 한글 표시,
// block_number(1~12장) 순으로 그룹핑 — 앱 knowledge_list_screen 형식 미러.
type KnowledgeGroup = { blockNumber: number | null; category: string; items: KnowledgeListItem[] };

export function KnowledgeBasePage() {
  const { items, loading, listError, selected, detailLoading, detailError, openDetail, closeDetail } =
    useReadonlyContent<KnowledgeListItem, KnowledgeDetail>(fetchKnowledgeArticles, fetchKnowledgeArticle);

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

  if (selected) {
    return (
      <section className="card">
        <div className="list-headbar">
          <div className="list-head-left">
            <button className="btn" onClick={closeDetail} type="button">← 목록으로</button>
          </div>
        </div>
        <article className="content-detail">
          <h1>{selected.documentTitle}</h1>
          <div className="content-detail-meta">
            <span>{knowledgeCategoryLabel(selected.category)}</span>
            <span className="num">{formatContentDate(selected.updatedAt)}</span>
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
          {/* 로드 완료 전엔 숫자를 비운다 — InsightsPage 미러(리로드 0 깜빡임 방지) */}
          {/* 로드 완료 전·실패 시엔 숫자를 비운다(InsightsPage 미러 — 배치 10 C#1, 0은 "정말 0건"만) */}
          <div className="total-count">KNOWLEDGE <strong className="num">{loading || listError ? "" : items.length}</strong></div>
        </div>
      </div>
      {/* 상세 열기 실패/로딩은 목록과 분리 — 목록을 통째로 대체하지 않는다(배치 6 C#1·C#2). */}
      {detailLoading ? <div className="content-notice">문서를 여는 중…</div> : null}
      {detailError ? <div className="content-notice error">문서를 불러오지 못했습니다. 다시 시도해 주세요.</div> : null}
      {loading ? (
        <div className="content-empty">불러오는 중…</div>
      ) : listError ? (
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
                    <small className="num">{formatContentDate(item.updatedAt)}</small>
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
