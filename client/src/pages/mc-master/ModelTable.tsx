import { Pencil } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogModel } from "@/lib/catalog";
import { formatPriceRangeKorean } from "@/lib/price-format";
import { SelectAllHeadCell, SelectCheckCell, SelectableRow } from "./table-select";

export function ModelTable({
  models,
  canEdit,
  selectMode,
  selected,
  draggingId,
  onOpen,
  onEdit,
  onToggle,
  onToggleAll,
  onDragStart,
  onDragOver,
  onDrop,
  onPrefetch,
  pendingByModel,
}: {
  models: CatalogModel[];
  canEdit: boolean;
  selectMode: boolean;
  selected: Set<number>;
  draggingId: number | null;
  onOpen: (model: CatalogModel) => void;
  onEdit: (model: CatalogModel) => void;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDrop: () => void;
  // hover/focus 시 해당 모델의 트림 뷰(트림·색상·옵션)를 미리 받아둬 클릭 즉시 진입.
  onPrefetch?: (model: CatalogModel) => void;
  /** 모델별 승인 대기 건수(2026-08-05) — 없거나 0이면 배지를 그리지 않는다. 대기열을 볼 수 있는
   * 역할(admin)에만 채워 내려온다: 나머지 역할은 애초에 그 목록을 못 받아 셀 수가 없다. */
  pendingByModel?: Map<number, number>;
}) {
  if (models.length === 0) return <div className="va-empty">브랜드를 선택하세요.</div>;
  const allChecked = models.length > 0 && models.every((m) => selected.has(m.id));
  return (
    <table className="customer-table va-model-table">
      <thead>
        <tr>
          <SelectAllHeadCell show={selectMode} allChecked={allChecked} onToggleAll={onToggleAll} />
          <th className="va-mt-name">모델명</th>
          <th className="va-mt-cat">카테고리</th>
          <th className="va-mt-price">가격 범위</th>
          <th className="va-col-center va-mt-status">상태</th>
          <th className="va-col-center va-mt-count">트림 수</th>
          {canEdit && !selectMode && <th className="va-col-center va-mt-edit" aria-label="편집" />}
        </tr>
      </thead>
      <tbody>
        {models.map((m) => {
          const pending = pendingByModel?.get(m.id) ?? 0;
          return (
          <SelectableRow
            key={m.id}
            id={m.id}
            selectMode={selectMode}
            isSelected={selected.has(m.id)}
            isDragging={draggingId === m.id}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            // 행 전체가 트림 뷰 진입 버튼이다(2026-08-05 유슨생) — 모델명 텍스트만 눌리던 때는
            // "캐스퍼"처럼 짧은 이름의 클릭 폭이 행 높이에 견줘 지나치게 좁았다.
            onActivate={() => onOpen(m)}
            onHover={onPrefetch ? () => onPrefetch(m) : undefined}
          >
            <SelectCheckCell
              show={selectMode}
              checked={selected.has(m.id)}
              onToggle={() => onToggle(m.id)}
              label={`${m.name} 선택`}
            />
            <td className="va-model-name">
              {m.imageUrl && <img src={m.imageUrl} alt="" className="va-model-thumb" loading="lazy" decoding="async" />}
              {/* 링크 색을 뺀 평문이다 — 행 전체가 눌리는데 이름만 브랜드 색이면 "여기만 눌러라"는
                  틀린 신호가 된다. 진입은 행이 담당하므로 여기엔 클릭 핸들러가 없다. */}
              <span>{m.name}</span>
              {/* 승인 대기 건수 — 어느 모델에 처리할 게 있는지 목록에서 바로 보이게(사이드바
                  `.nav-count`와 같은 어휘). 0이면 아예 안 그린다: 모든 행에 "0"이 붙으면 신호가
                  죽는다. 세는 대상은 그 모델에 걸린 pending **전부**(모델 수정·트림·옵션·신규
                  트림)로, 트림 화면 배지(useModelPendingRequests)와 같은 기준이다. */}
              {pending > 0 && (
                <span aria-label={`승인 대기 ${pending}건`} className="va-pending-count num">
                  {pending}
                </span>
              )}
            </td>
            <td>{m.category ?? "—"}</td>
            <td className="va-num va-mt-price">{formatPriceRangeKorean(m.minPrice, m.maxPrice)}</td>
            <td className="va-col-center">
              <span className={`badge ${statusBadgeTone(m.status)}`}>{statusLabel(m.status)}</span>
            </td>
            <td className="va-col-center va-num">{m.trimCount}</td>
            {canEdit && !selectMode && (
              <td className="va-col-center">
                {/* ⚠️ stopPropagation 필수 — 없으면 수정 클릭이 행까지 버블돼 편집 패널을 열면서
                    트림 뷰로도 함께 이동한다(행 진입과 한 클릭에 겹친다). */}
                <button
                  type="button"
                  className="tiny-btn"
                  aria-label={`${m.name} 수정`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(m);
                  }}
                >
                  <Pencil size={14} />
                </button>
              </td>
            )}
          </SelectableRow>
          );
        })}
      </tbody>
    </table>
  );
}
