import type { KeyboardEvent } from "react";

import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { fetchInsight, fetchInsights, formatContentDate, type InsightDetail, type InsightListItem } from "@/lib/content";
import { useReadonlyContent } from "@/lib/use-readonly-content";

// 앱 소유 콘텐츠 읽기 전용(admin 참조) — 발행 상태는 앱 status(published/draft) 미러.
function statusClass(status: string) {
  return status === "published" ? "badge green" : "badge";
}
function statusLabel(status: string) {
  return status === "published" ? "발행" : "임시저장";
}

export function InsightsPage() {
  const { items, loading, listError, selected, detailLoading, detailError, openDetail, closeDetail } =
    useReadonlyContent<InsightListItem, InsightDetail>(fetchInsights, fetchInsight);

  function openByKeyboard(event: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(id);
    }
  }

  if (selected) {
    return (
      <section className="card">
        <div className="list-headbar">
          <div className="list-head-left">
            <button className="btn" onClick={closeDetail} type="button">← 목록으로</button>
          </div>
        </div>
        <article className="content-detail">
          <h1>{selected.title}</h1>
          <div className="content-detail-meta">
            <span className={statusClass(selected.status)}>{statusLabel(selected.status)}</span>
            <span>{selected.category}</span>
            <span className="num">{formatContentDate(selected.updatedAt)}</span>
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
      {/* 상세 열기 실패/로딩은 목록과 분리 — 목록을 통째로 대체하지 않는다(배치 6 C#1·C#2). */}
      {detailLoading ? <div className="content-notice">문서를 여는 중…</div> : null}
      {detailError ? <div className="content-notice error">문서를 불러오지 못했습니다. 다시 시도해 주세요.</div> : null}
      {loading ? (
        <div className="content-empty">불러오는 중…</div>
      ) : listError ? (
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
                <tr className="content-row" key={item.id} onClick={() => openDetail(item.id)} onKeyDown={(event) => openByKeyboard(event, item.id)} role="button" tabIndex={0}>
                  <td>
                    <strong>{item.title}</strong>
                    {item.summary ? <span className="table-note">{item.summary}</span> : null}
                  </td>
                  <td>{item.category}</td>
                  <td><span className={statusClass(item.status)}>{statusLabel(item.status)}</span></td>
                  <td className="num">{formatContentDate(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
