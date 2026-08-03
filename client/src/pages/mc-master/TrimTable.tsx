import type { ReactNode } from "react";
import { Pencil } from "lucide-react";

import type { CatalogTrim, TrimColor, TrimOptionSummary } from "@/lib/catalog";
import type { DealerDiscountAmounts, DealerDiscountProposal } from "@/lib/dealer-discounts";
import type { TrimProposals } from "@/lib/discount-proposals";
import type { AdoptHandler, UndoHandler } from "./admin-discount-cells";
import type { PendingTrimPreview } from "./pending-preview";
import { SelectAllHeadCell, SelectCheckCell, SelectableRow } from "./table-select";
import { ColorChips, OptionBadgeButton, TrimHeadCells, TrimMetaCells } from "./trim-cells";

// 평면 트림 테이블(전체 trim_name). 국산차 '순서 관리' 탭 / 수입차 기본 뷰에서 쓴다.
// 드래그 순서변경/일괄삭제는 '선택' 모드에서만(앱과 동일).
// 신규 트림 미리보기(trim.create pending)는 목록 끝에 붙는다 — 선택 모드에선 숨긴다(드래그
// 대상이 아닌 행이 사이에 끼면 reorder 정합이 깨진다). 렌더링은 renderPreviewRow(MCMasterPage
// 소유), 여기는 배치만(GroupedTrimTable과 같은 결, 2026-08-03).
export function TrimTable({
  trims,
  canEdit,
  isDomestic,
  selectMode,
  selected,
  draggingId,
  colorsByTrim,
  optionByTrim,
  onEdit,
  onOpenOptions,
  onPrefetchOptions,
  onToggle,
  onToggleAll,
  onDragStart,
  onDragOver,
  onDrop,
  dealerProposals,
  onSaveProposal,
  proposalsByTrim,
  onAdopt,
  onUndo,
  flashTrimId,
  rowBadge,
  pendingPreviews,
  renderPreviewRow,
}: {
  trims: CatalogTrim[];
  canEdit: boolean;
  // 딜러 모드 전용(optional이라 admin 호출부는 무변경) — 있으면 할인 3셀이 제안 입력칸이 된다.
  dealerProposals?: Map<number, DealerDiscountProposal>;
  onSaveProposal?: (trimId: number, amounts: DealerDiscountAmounts) => Promise<void>;
  /** 관리자 채택(슬라이스 C) — 트림별 딜러 제안. 없으면 할인 셀은 기존 정적 표시다. */
  proposalsByTrim?: Map<number, TrimProposals>;
  onAdopt?: AdoptHandler;
  onUndo?: UndoHandler;
  /** ?hl= 딥링크 착지 마킹 대상 — 해당 행에 플래시 클래스와 스크롤 앵커(data-trim-id)를 단다. */
  flashTrimId?: number | null;
  /** 트림 행 "승인 대기" 배지(diff 팝오버·승인/반려) — 데이터·액션은 MCMasterPage가 소유. */
  rowBadge?: (trimId: number) => ReactNode;
  /** 신규 트림(trim.create pending) 미리보기 — 목록 끝에 붙는다(선택 모드에선 미표시). */
  pendingPreviews?: PendingTrimPreview[];
  renderPreviewRow?: (preview: PendingTrimPreview) => ReactNode;
  isDomestic: boolean;
  selectMode: boolean;
  selected: Set<number>;
  draggingId: number | null;
  colorsByTrim: Map<number, TrimColor[]>;
  optionByTrim: Map<number, TrimOptionSummary>;
  onEdit: (t: CatalogTrim) => void;
  onOpenOptions: (t: CatalogTrim) => void;
  onPrefetchOptions: (trimId: number) => void;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDrop: () => void;
}) {
  const previews = !selectMode && renderPreviewRow ? (pendingPreviews ?? []) : [];
  if (trims.length === 0 && previews.length === 0)
    return <div className="va-empty">트림이 없습니다. ‘트림 추가’로 등록하세요.</div>;
  const allChecked = trims.length > 0 && trims.every((t) => selected.has(t.id));
  return (
    <table className="customer-table va-trim-table">
      <thead>
        <tr>
          <SelectAllHeadCell show={selectMode} allChecked={allChecked} onToggleAll={onToggleAll} />
          <th className="va-th-trim">트림명</th>
          <TrimHeadCells dealerMode={Boolean(onSaveProposal)} showOption={isDomestic} />
          {canEdit && !selectMode && <th className="va-col-center va-th-edit" aria-label="편집" />}
        </tr>
      </thead>
      <tbody>
        {trims.map((t) => (
          <SelectableRow
            key={t.id}
            id={t.id}
            selectMode={selectMode}
            isSelected={selected.has(t.id)}
            isDragging={draggingId === t.id}
            flash={t.id === flashTrimId}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <SelectCheckCell
              show={selectMode}
              checked={selected.has(t.id)}
              onToggle={() => onToggle(t.id)}
              label={`${t.trimName} 선택`}
            />
            <td className="va-th-trim">
              <div className="va-trim-name">
                {t.trimName}
                {rowBadge?.(t.id)}
              </div>
              <ColorChips colors={colorsByTrim.get(t.id) ?? []} />
            </td>
            <TrimMetaCells
                      dealerProposal={dealerProposals?.get(t.id)}
                      onAdopt={onAdopt}
                      onUndo={onUndo}
                      onSaveProposal={onSaveProposal}
                      proposalEntry={proposalsByTrim?.get(t.id)}
                      trim={t}
                    />
            {isDomestic && (
              <td className="va-col-center">
                <OptionBadgeButton
                  summary={optionByTrim.get(t.id)}
                  onClick={() => onOpenOptions(t)}
                  onPrefetch={() => onPrefetchOptions(t.id)}
                />
              </td>
            )}
            {canEdit && !selectMode && (
              <td className="va-col-center">
                <button type="button" className="tiny-btn" aria-label={`${t.trimName} 수정`} onClick={() => onEdit(t)}>
                  <Pencil size={14} />
                </button>
              </td>
            )}
          </SelectableRow>
        ))}
        {previews.map((p) => renderPreviewRow?.(p))}
      </tbody>
    </table>
  );
}
