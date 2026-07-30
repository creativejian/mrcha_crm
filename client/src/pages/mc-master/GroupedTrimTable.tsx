import { Fragment } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";

import type { CatalogTrim, TrimColor, TrimOptionSummary } from "@/lib/catalog";
import type { DealerDiscountAmounts, DealerDiscountProposal } from "@/lib/dealer-discounts";
import type { TrimProposals } from "@/lib/discount-proposals";
import type { AdoptHandler, UndoHandler } from "./admin-discount-cells";
import { ColorChips, OptionBadgeButton, TrimHeadCells, TrimMetaCells } from "./trim-cells";
import { TRIM_BODY_COLS } from "./trim-format";
import { groupTrimsBySubline, trimGrade } from "./trim-grouping";

// 국산차 '목록 보기': 서브라인 단위 접이식 그룹. 그룹 내에서는 등급만 표시한다(편집은 행별 ✎).
// 순서변경/일괄삭제는 '순서 관리' 탭(평면 TrimTable)에서만 — 여기서는 읽기/개별 편집만.
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
  pendingBadgeByTrim,
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
  /** 트림별 "승인 대기" 배지 title(요청자·경과·작업 — MCMasterPage가 합성). 없으면 미표시. */
  pendingBadgeByTrim?: Map<number, string>;
  colorsByTrim: Map<number, TrimColor[]>;
  optionByTrim: Map<number, TrimOptionSummary>;
  expanded: Set<string>;
  onToggleGroup: (key: string) => void;
  onEdit: (t: CatalogTrim) => void;
  onOpenOptions: (t: CatalogTrim) => void;
  onPrefetchOptions: (trimId: number) => void;
}) {
  if (trims.length === 0) return <div className="va-empty">트림이 없습니다. ‘트림 추가’로 등록하세요.</div>;
  const groups = groupTrimsBySubline(trims);
  const colSpan = TRIM_BODY_COLS + (canEdit ? 1 : 0);
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
              <tr className="va-group-row">
                <td colSpan={colSpan}>
                  <button
                    type="button"
                    className="va-group-toggle"
                    aria-expanded={open}
                    onClick={() => onToggleGroup(g.key)}
                  >
                    {/* 내용물만 sticky(.va-group-label) — 버튼 자체를 sticky로 밀면 행 전체
                        클릭 영역이 스크롤을 따라 이동해 행 왼쪽이 안 눌린다. 버튼(전폭 클릭)은
                        그대로 두고 라벨만 왼쪽에 붙인다(2026-07-29 유슨생 — 트림명 고정과 한 축). */}
                    <span className="va-group-label">
                      {open ? (
                        <ChevronDown size={16} className="va-group-chevron" />
                      ) : (
                        <ChevronRight size={16} className="va-group-chevron" />
                      )}
                      <span className="va-group-name">{g.key}</span>
                      <span className="va-group-count">{g.trims.length}개 트림</span>
                    </span>
                  </button>
                </td>
              </tr>
              {open &&
                g.trims.map((t) => (
                  <tr key={t.id} data-trim-id={t.id} className={t.id === flashTrimId ? "va-row-flash" : undefined}>
                    <td className="va-grade-cell">
                      <div className="va-trim-name">
                        {trimGrade(t.trimName)}
                        {pendingBadgeByTrim?.has(t.id) && (
                          <span className="va-cr-badge" title={pendingBadgeByTrim.get(t.id)}>
                            승인 대기
                          </span>
                        )}
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
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
