import { Fragment, type ReactNode } from "react";
import { ChevronDown, ChevronRight, GripVertical, Pencil } from "lucide-react";

import type { CatalogTrim, TrimColor, TrimOptionSummary } from "@/lib/catalog";
import type { DealerDiscountAmounts, DealerDiscountProposal } from "@/lib/dealer-discounts";
import type { TrimProposals } from "@/lib/discount-proposals";
import type { AdoptHandler, UndoHandler } from "./admin-discount-cells";
import type { PendingCellPatch, PendingTrimPreview } from "./pending-preview";
import { ColorChips, OptionBadgeButton, TrimHeadCells, TrimMetaCells } from "./trim-cells";
import { TRIM_BODY_COLS } from "./trim-format";
import { groupTrimsBySubline, trimGrade, trimSubline } from "./trim-grouping";

// 국산차 '목록 보기': 서브라인 단위 접이식 그룹. 그룹 내에서는 등급만 표시한다(편집은 행별 ✎).
// 트림 단위 순서변경/일괄삭제는 '순서 관리' 탭(평면 TrimTable)에서만 — 여기서는 읽기/개별 편집,
// 그리고 '선택' 토글의 **그룹 순서 모드**(2026-08-03 이사님 요청: 그룹 헤더만 남기고 그립
// 드래그로 블록 이동 — 체크박스 없음, 저장·에러 처리는 MCMasterPage 소유).
// 신규 트림 미리보기(trim.create pending)는 같은 서브라인 그룹 끝에 편입되고, 기존 그룹이
// 없는 서브라인은 합성 그룹으로 뒤에 붙는다(2026-08-03) — 렌더링 자체는 renderPreviewRow
// (MCMasterPage 소유)가 하고 여기는 배치만 안다(행 배지 rowBadge도 같은 결).
export function GroupedTrimTable({
  trims,
  canEdit,
  colorsByTrim,
  optionByTrim,
  expanded,
  onToggleGroup,
  onEdit,
  onOpenOptions,
  onPrefetchOptions,
  dealerProposals,
  onSaveProposal,
  proposalsByTrim,
  onAdopt,
  onUndo,
  flashTrimId,
  rowBadge,
  pendingPreviews,
  renderPreviewRow,
  groupOrderMode = false,
  draggingGroupKey,
  onGroupDragStart,
  onGroupDragOver,
  onGroupDrop,
  pendingPatchByTrim,
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
  /** 신규 트림(trim.create pending) 미리보기 — 서브라인 매칭으로 그룹에 편입한다. */
  pendingPreviews?: PendingTrimPreview[];
  renderPreviewRow?: (preview: PendingTrimPreview) => ReactNode;
  /** 그룹 순서 모드('선택' 토글) — 그룹 헤더만 남기고 그립 드래그로 블록 이동. */
  groupOrderMode?: boolean;
  draggingGroupKey?: string | null;
  onGroupDragStart?: (key: string) => void;
  onGroupDragOver?: (key: string) => void;
  onGroupDrop?: () => void;
  /** trim.update pending의 셀 인라인 diff(트림명·가격·연식·상태 — pending-preview.ts). */
  pendingPatchByTrim?: Map<number, PendingCellPatch>;
  colorsByTrim: Map<number, TrimColor[]>;
  optionByTrim: Map<number, TrimOptionSummary>;
  expanded: Set<string>;
  onToggleGroup: (key: string) => void;
  onEdit: (t: CatalogTrim) => void;
  onOpenOptions: (t: CatalogTrim) => void;
  onPrefetchOptions: (trimId: number) => void;
}) {
  const previews = renderPreviewRow ? (pendingPreviews ?? []) : [];
  if (trims.length === 0 && previews.length === 0)
    return <div className="va-empty">트림이 없습니다. ‘트림 추가’로 등록하세요.</div>;
  const groups = groupTrimsBySubline(trims);
  const previewsByKey = new Map<string, PendingTrimPreview[]>();
  for (const p of previews) {
    const key = trimSubline(p.trim.trimName);
    const arr = previewsByKey.get(key) ?? [];
    arr.push(p);
    previewsByKey.set(key, arr);
  }
  // 기존 그룹에 없는 서브라인(새 연식 라인 통째 추가 등)은 합성 그룹으로 뒤에 붙는다 — 접힘
  // 상태(expanded)는 실 그룹과 같은 키 공간을 쓴다(승인되면 그대로 실 그룹이 되는 키라 충돌 없음).
  const extraKeys = [...previewsByKey.keys()].filter((key) => !groups.some((g) => g.key === key));
  const colSpan = TRIM_BODY_COLS + (canEdit ? 1 : 0);

  const groupHeaderRow = (key: string, open: boolean, countLabel: string) => (
    <tr className="va-group-row">
      <td colSpan={colSpan}>
        <button type="button" className="va-group-toggle" aria-expanded={open} onClick={() => onToggleGroup(key)}>
          {/* 내용물만 sticky(.va-group-label) — 버튼 자체를 sticky로 밀면 행 전체
              클릭 영역이 스크롤을 따라 이동해 행 왼쪽이 안 눌린다. 버튼(전폭 클릭)은
              그대로 두고 라벨만 왼쪽에 붙인다(2026-07-29 유슨생 — 트림명 고정과 한 축). */}
          <span className="va-group-label">
            {open ? (
              <ChevronDown size={16} className="va-group-chevron" />
            ) : (
              <ChevronRight size={16} className="va-group-chevron" />
            )}
            <span className="va-group-name">{key}</span>
            <span className="va-group-count">{countLabel}</span>
          </span>
        </button>
      </td>
    </tr>
  );

  // 그룹 순서 모드 — 그룹 헤더만 남기고(트림·미리보기·합성 그룹 숨김: 합성 그룹은 실 트림이
  // 없어 sort_order 이동 대상이 아니다) 그립 드래그로 블록을 옮긴다. 드래그 의미론은 순서 관리
  // 트림 행(SelectableRow)과 동일: dragOver에서 낙관 이동, dragEnd에서 저장.
  if (groupOrderMode) {
    return (
      <table className="customer-table va-trim-table">
        <thead>
          <tr>
            <th className="va-th-trim">트림명</th>
            <TrimHeadCells dealerMode={false} />
            {canEdit && <th className="va-col-center va-th-edit" aria-label="편집" />}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr
              key={g.key}
              className={`va-group-row${draggingGroupKey === g.key ? " va-dragging" : ""}`}
              draggable
              onDragStart={() => onGroupDragStart?.(g.key)}
              onDragOver={(e) => {
                e.preventDefault();
                onGroupDragOver?.(g.key);
              }}
              onDragEnd={onGroupDrop}
            >
              <td colSpan={colSpan}>
                <span className="va-group-label va-group-drag" aria-label={`${g.key} 순서 이동`}>
                  <GripVertical className="va-grip" size={15} />
                  <span className="va-group-name">{g.key}</span>
                  <span className="va-group-count">{g.trims.length}개 트림</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <table className="customer-table va-trim-table">
      <thead>
        <tr>
          <th className="va-th-trim">트림명</th>
          <TrimHeadCells dealerMode={Boolean(onSaveProposal)} />
          {canEdit && <th className="va-col-center va-th-edit" aria-label="편집" />}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const open = expanded.has(g.key);
          return (
            <Fragment key={g.key}>
              {groupHeaderRow(g.key, open, `${g.trims.length}개 트림`)}
              {open && (
                <>
                  {g.trims.map((t) => (
                    <tr key={t.id} data-trim-id={t.id} className={t.id === flashTrimId ? "va-row-flash" : undefined}>
                      <td className="va-grade-cell">
                        <div className="va-trim-name">
                          {trimGrade(t.trimName)}
                          {rowBadge?.(t.id)}
                        </div>
                        {pendingPatchByTrim?.get(t.id)?.trimName != null && (
                          <div className="va-cell-pending">→ {trimGrade(pendingPatchByTrim.get(t.id)!.trimName!)}</div>
                        )}
                        <ColorChips colors={colorsByTrim.get(t.id) ?? []} />
                      </td>
                      <TrimMetaCells
                        dealerProposal={dealerProposals?.get(t.id)}
                        onAdopt={onAdopt}
                        onUndo={onUndo}
                        onSaveProposal={onSaveProposal}
                        proposalEntry={proposalsByTrim?.get(t.id)}
                        pendingPatch={pendingPatchByTrim?.get(t.id)}
                        trim={t}
                      />
                      <td className="va-col-center">
                        <OptionBadgeButton
                          summary={optionByTrim.get(t.id)}
                          onClick={() => onOpenOptions(t)}
                          onPrefetch={() => onPrefetchOptions(t.id)}
                        />
                      </td>
                      {canEdit && (
                        <td className="va-col-center">
                          <button
                            type="button"
                            className="tiny-btn"
                            aria-label={`${t.trimName} 수정`}
                            onClick={() => onEdit(t)}
                          >
                            <Pencil size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {(previewsByKey.get(g.key) ?? []).map((p) => renderPreviewRow?.(p))}
                </>
              )}
            </Fragment>
          );
        })}
        {extraKeys.map((key) => {
          const open = expanded.has(key);
          const keyPreviews = previewsByKey.get(key)!;
          return (
            <Fragment key={`pending-${key}`}>
              {groupHeaderRow(key, open, `승인 대기 ${keyPreviews.length}건`)}
              {open && keyPreviews.map((p) => renderPreviewRow?.(p))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
